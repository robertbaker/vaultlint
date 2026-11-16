import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from "@angular/core";
import {
  type AiHygieneFinding,
  type AiProviderContainer,
  type AiProviderConfig,
  type AiUriSuggestion,
  applyCategorySuggestions,
  applyOrganizeSuggestions,
  applyUriSuggestions,
  buildAiItemRefs,
  restoreAiItemIdRecord,
  restoreAiItemIds,
  sanitizeVaultItemsForAi,
} from "@vaultlint/ai";
import type { VaultFormatId, VaultRoundTripReport } from "@vaultlint/vault-formats";
import { VAULT_FORMATS } from "@vaultlint/vault-formats/metadata";
import {
  applyBatchEditToVault,
  applyDomainMappingsToVault,
  applyLintFixes,
  type BatchEditTargetMode,
  buildDuplicateGroupFromIds,
  checkVaultPasswordsHibp,
  computeVaultBreakdown,
  findInvalidUriFindings,
  findReusedPasswordGroupFindings,
  findWeakPasswordFindings,
  generateStrongPassword as createStrongPassword,
  groupDuplicatesByName,
  importAegisFidoKeys,
  isWeakPassword as checkWeakPassword,
  type LintPresetName,
  type LintResult,
  type LintRuleId,
  type LintSeverity,
  lintVault,
  mergeAllDuplicateGroups,
  mergeVaultMigration,
  type VaultMigrationOptions,
  mergeDuplicateIndices,
  normalizeVaultItems,
  previewBatchEditOnVault,
  regenerateWeakPasswordsInVault,
  suggestSubdomainMappings,
  type VaultLintConfig,
} from "@vaultlint/vault-ops";
import {
  buildVaultItemRefs,
  extractDomainParts,
  getSafeUriDisplayLabel,
  getUriString,
  hasFidoCredentials,
  inferItemType,
  type VaultData,
  type VaultItem,
  withUpdatedUri,
} from "@vaultlint/vault-schema";

import { AI_CONTAINER, loadDefaultAiContainer } from "./ai-container.token";
import { downloadBlob } from "./download";
import { parseErrorMessage } from "./parse-error";
import { BROWSER_STORAGE } from "./storage.token";
import type {
  AiResolvedDuplicateGroup,
  AuditLogEntry,
  BatchMatchPreview,
  DuplicateGroup,
  InvalidUriInfo,
  ReusedPasswordGroup,
  ToastItem,
  VaultChartBreakdown,
  VendorCliId,
  VendorCliProviderInfo,
  VendorPlanSummary,
  VendorPushResult,
  WeakItemInfo,
  WebDeadLinkFinding,
  WebMobileUriFinding,
  WebRedirectFinding,
} from "./vault.models";

export interface VaultRecoverySnapshot {
  data: VaultData;
  format: VaultFormatId;
  exportFormat?: VaultFormatId;
  formatName: string;
  sourceName: string;
  rawMeta?: Record<string, unknown>;
}

export type FormatCoverageResult =
  | { ok: true; report: VaultRoundTripReport }
  | { ok: false; formatName: string; error: string };

/** Readable message for anything thrown (including non-Error values and AiResponseError). */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Unexpected error.";
}

/** A compact in-memory identity check; do not retain serialized vault secrets in findings. */
function fingerprintItem(item: VaultItem): string {
  const serialized = JSON.stringify(item);
  let hash = 0xcbf29ce484222325n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < serialized.length; index++) {
    hash = ((hash ^ BigInt(serialized.charCodeAt(index))) * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Upper bound on retained undo/redo snapshots; each is a full serialized vault. */
const MAX_HISTORY_ENTRIES = 50;

@Injectable({ providedIn: "root" })
export class VaultStoreService {
  private readonly providedAiContainer = inject(AI_CONTAINER, { optional: true });
  private aiContainerPromise: Promise<AiProviderContainer> | null = null;
  private readonly storage = inject(BROWSER_STORAGE);

  readonly vaultData = signal<VaultData | null>(null);
  readonly sourceFormat = signal<VaultFormatId>("bitwarden-json");
  readonly sourceFormatName = signal<string>("Bitwarden JSON");
  readonly exportFormat = signal<VaultFormatId>("bitwarden-json");
  private sourceName = "vault.json";
  private sourceRawMeta: Record<string, unknown> | undefined;
  private exportPreviewRequest = 0;
  private loadRequest = 0;
  /** Passwords that were found breached, by item key; a flag is only valid for that password. */
  private compromisedPasswords = new Map<string, string>();
  /** Item snapshots (by item key) that AI URI suggestions were generated for. */
  private aiSuggestionFingerprints = new Map<string, string>();
  private readonly historyStack = signal<string[]>([]);
  private readonly redoStack = signal<string[]>([]);
  /** Incremented whenever the open vault is replaced or cleared; guards in-flight async results. */
  readonly vaultGeneration = signal(0);

  readonly revealedIds = signal<Set<string>>(new Set());
  readonly compromisedIds = signal<Set<string>>(new Set());
  readonly checkingHibp = signal(false);
  readonly checkingLinks = signal(false);
  readonly checkingMobileUris = signal(false);
  readonly aiRunning = signal(false);
  readonly aiActiveTask = signal<string | null>(null);
  readonly aiDuplicateGroups = signal<AiResolvedDuplicateGroup[]>([]);
  readonly aiUriSuggestions = signal<AiUriSuggestion[]>([]);
  readonly aiHygieneFindings = signal<AiHygieneFinding[]>([]);
  readonly aiOrganizeSummary = signal<string | null>(null);
  readonly redirectFindings = signal<WebRedirectFinding[]>([]);
  readonly deadLinkFindings = signal<WebDeadLinkFinding[]>([]);
  readonly mobileUriFindings = signal<WebMobileUriFinding[]>([]);
  readonly passwordLength = signal(16);
  readonly lintRuleset = signal<LintPresetName>(this.readSavedLintProfile().extends);
  readonly lintRuleOverrides = signal<Partial<Record<LintRuleId, LintSeverity>>>(
    this.readSavedLintProfile().rules,
  );
  readonly toasts = signal<ToastItem[]>([]);
  readonly auditLog = signal<AuditLogEntry[]>([]);
  readonly exportWarnings = signal<string[]>([]);

  constructor() {
    inject(DestroyRef, { optional: true })?.onDestroy(() => {
      for (const entry of this.toastTimers.values()) clearTimeout(entry.timer);
      this.toastTimers.clear();
    });

    effect(() => {
      const data = this.vaultData();
      const format = this.exportFormat();
      const rawMeta = format === this.sourceFormat() ? this.sourceRawMeta : undefined;
      const request = ++this.exportPreviewRequest;
      this.exportWarnings.set([]);
      if (!data) return;

      void import("@vaultlint/vault-formats")
        .then(({ exportVault }) => exportVault(data, format, { rawMeta }).warnings)
        .then((warnings) => {
          if (request === this.exportPreviewRequest) this.exportWarnings.set(warnings);
        })
        .catch((err: unknown) => {
          if (request === this.exportPreviewRequest) {
            this.exportWarnings.set([`Export preview unavailable: ${errorMessage(err)}`]);
          }
        });
    });

    // Item indexes shift on delete/merge/undo/redo/create. Re-locate (or drop) index-addressed
    // findings and positional per-item state whenever the vault contents change.
    effect(() => {
      const data = this.vaultData();
      untracked(() => this.syncVaultScopedState(data));
    });
  }

  /** Items by collision-free local reference, using position when IDs are missing or duplicated. */
  private keyedItems(data: VaultData): Map<string, VaultItem> {
    return new Map(buildVaultItemRefs(data).map((ref, index) => [ref, data.items[index]] as const));
  }

  /**
   * Items by AI reference (`@vaultlint/ai` `buildAiItemRefs`: the unique item id, else
   * `index:<position>`). AI results are addressed and applied by these references, which differ
   * from the explorer's `item.id || String(index)` keys for id-less or duplicate-id items.
   */
  private aiKeyedItems(data: VaultData): Map<string, VaultItem> {
    const refs = buildAiItemRefs(data);
    return new Map(refs.map((ref, index) => [ref, data.items[index]] as const));
  }

  /**
   * Find the current index of the item a finding was produced for. Items with an id are located by
   * id; id-less items by name (and URI when known), preferring the original position.
   */
  private locateFindingItem(
    data: VaultData,
    finding: { itemIndex: number; itemId?: string; itemName: string; itemFingerprint?: string },
    uri?: string,
  ): number {
    const matchesFingerprint = (item: VaultItem | undefined): boolean =>
      Boolean(item) &&
      (finding.itemFingerprint === undefined ||
        (item !== undefined && fingerprintItem(item) === finding.itemFingerprint));
    if (finding.itemId) {
      const matches = (item: VaultItem | undefined): boolean =>
        Boolean(item) &&
        matchesFingerprint(item) &&
        item!.id === finding.itemId &&
        (uri === undefined ||
          (item!.login?.uris ?? []).some((entry) => getUriString(entry) === uri));
      return matches(data.items[finding.itemIndex])
        ? finding.itemIndex
        : data.items.findIndex((item) => matches(item));
    }
    const matches = (item: VaultItem | undefined): boolean =>
      Boolean(item) &&
      matchesFingerprint(item) &&
      !item!.id &&
      (item!.name || "Unnamed") === finding.itemName &&
      (uri === undefined || (item!.login?.uris ?? []).some((u) => getUriString(u) === uri));
    return matches(data.items[finding.itemIndex])
      ? finding.itemIndex
      : data.items.findIndex((item) => matches(item));
  }

  private remapFindings<T extends { itemIndex: number; itemId?: string; itemName: string }>(
    list: T[],
    data: VaultData,
    uriOf: (finding: T) => string | undefined,
  ): T[] {
    let changed = false;
    const next = list.flatMap((finding) => {
      const index = this.locateFindingItem(data, finding, uriOf(finding));
      if (index < 0) {
        changed = true;
        return [];
      }
      if (index !== finding.itemIndex) {
        changed = true;
        return [{ ...finding, itemIndex: index }];
      }
      return [finding];
    });
    return changed ? next : list;
  }

  private syncVaultScopedState(data: VaultData | null): void {
    if (!data) return;
    this.redirectFindings.update((list) => this.remapFindings(list, data, (f) => f.originalUri));
    this.deadLinkFindings.update((list) => this.remapFindings(list, data, (f) => f.uri));
    this.mobileUriFindings.update((list) =>
      this.remapFindings(list, data, (f) => (f.status === "suggested" ? f.sourceUri : f.uri)),
    );

    // Revealed state for id-less items is positional and would unmask a different item's password
    // after the list shifts, so only id-backed reveals survive a vault change.
    const revealed = this.revealedIds();
    if (revealed.size > 0) {
      const ids = new Set(data.items.map((item) => item.id).filter(Boolean));
      const kept = new Set([...revealed].filter((key) => ids.has(key)));
      if (kept.size !== revealed.size) this.revealedIds.set(kept);
    }
    this.pruneCompromised(data);
  }

  /**
   * A breach flag is only valid while the flagged item still holds the password that was checked.
   * Flags are derived from the checked passwords, so undoing an edit brings the flag back.
   */
  private pruneCompromised(data: VaultData): void {
    if (this.compromisedPasswords.size === 0) return;
    const compromised = this.compromisedIds();
    const keyed = this.keyedItems(data);
    const kept = new Set(
      [...this.compromisedPasswords].flatMap(([key, checked]) =>
        keyed.get(key)?.login?.password === checked ? [key] : [],
      ),
    );
    if (kept.size !== compromised.size || [...kept].some((key) => !compromised.has(key))) {
      this.compromisedIds.set(kept);
    }
  }

  readonly vendorBridgeAvailable = signal(false);
  readonly vendorProviders = signal<VendorCliProviderInfo[]>([]);
  readonly activeVendorProvider = signal<VendorCliId | null>(null);
  readonly vendorOriginalVault = signal<VaultData | null>(null);
  readonly vendorBusy = signal(false);
  private vendorPushPlan: {
    providerId: VendorCliId;
    originalSnapshot: string;
    updatedSnapshot: string;
  } | null = null;
  readonly activeVendorPushLabel = computed(() => {
    const id = this.activeVendorProvider();
    if (!id || !this.vaultData()) return "";
    const provider = this.vendorProviders().find((p) => p.id === id);
    return provider?.write ? `Push to ${provider.displayName}` : "";
  });

  readonly domainMappings = signal<Record<string, string>>(this.loadInitialMappings());

  private readSavedLintProfile(): {
    extends: LintPresetName;
    rules: Partial<Record<LintRuleId, LintSeverity>>;
  } {
    try {
      const raw = this.storage.getItem("vaultlint-lint-profile");
      if (raw) {
        const value = JSON.parse(raw) as { extends?: unknown; rules?: unknown };
        const extendsPreset = value.extends;
        const rules = value.rules;
        if (
          (extendsPreset === "recommended" ||
            extendsPreset === "strict" ||
            extendsPreset === "minimal") &&
          rules &&
          typeof rules === "object"
        ) {
          return {
            extends: extendsPreset,
            rules: rules as Partial<Record<LintRuleId, LintSeverity>>,
          };
        }
        if (
          extendsPreset === "recommended" ||
          extendsPreset === "strict" ||
          extendsPreset === "minimal"
        ) {
          return { extends: extendsPreset, rules: {} };
        }
      }
    } catch {}
    return { extends: "recommended", rules: {} };
  }

  private saveLintProfile(): void {
    this.storage.setItem(
      "vaultlint-lint-profile",
      JSON.stringify({ extends: this.lintRuleset(), rules: this.lintRuleOverrides() }),
    );
  }

  private loadInitialMappings(): Record<string, string> {
    try {
      const saved = this.storage.getItem("bw-domain-mappings");
      if (saved) return JSON.parse(saved) as Record<string, string>;
    } catch {}
    return {
      "mail.google.com": "google.com",
      "drive.google.com": "google.com",
    };
  }

  private saveMappings(mappings: Record<string, string>): void {
    this.storage.setItem("bw-domain-mappings", JSON.stringify(mappings));
  }

  readonly canUndo = computed(() => this.historyStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  readonly totalItems = computed(() => this.vaultData()?.items.length ?? 0);

  getRecoverySnapshot(): VaultRecoverySnapshot | null {
    const data = this.vaultData();
    if (!data) return null;
    return {
      data: structuredClone(data),
      format: this.sourceFormat(),
      exportFormat: this.exportFormat(),
      formatName: this.sourceFormatName(),
      sourceName: this.sourceName,
      ...(this.sourceRawMeta ? { rawMeta: structuredClone(this.sourceRawMeta) } : {}),
    };
  }

  get loadRequestRevision(): number {
    return this.loadRequest;
  }

  restoreRecoverySnapshotIfCurrent(
    snapshot: VaultRecoverySnapshot,
    expectedLoadRevision: number,
  ): boolean {
    // Recovery reads IndexedDB asynchronously. Do not let an older recovery request overwrite a
    // vault that was loaded (or started loading) while that read was in progress.
    if (this.loadRequest !== expectedLoadRevision || this.vaultData()) return false;
    this.applyParsedVault(
      snapshot.data,
      snapshot.format,
      snapshot.formatName,
      snapshot.sourceName,
      snapshot.rawMeta,
    );
    this.exportFormat.set(snapshot.exportFormat ?? snapshot.format);
    return true;
  }

  readonly duplicateGroups = computed<DuplicateGroup[]>(() => {
    const data = this.vaultData();
    return data ? groupDuplicatesByName(data) : [];
  });

  readonly weakItems = computed<WeakItemInfo[]>(() => {
    const data = this.vaultData();
    return data ? findWeakPasswordFindings(data) : [];
  });

  readonly lintConfig = computed<VaultLintConfig>(() => ({
    extends: this.lintRuleset(),
    rules: this.lintRuleOverrides(),
  }));

  readonly lintResult = computed<LintResult | null>(() => {
    const data = this.vaultData();
    return data ? lintVault(data, this.lintConfig()) : null;
  });

  readonly roundTripCoverage = signal<FormatCoverageResult[]>([]);
  readonly checkingFormatCoverage = signal(false);

  async inspectAllFormatCoverage(): Promise<void> {
    const data = this.vaultData();
    if (!data || this.checkingFormatCoverage()) return;
    this.checkingFormatCoverage.set(true);
    this.roundTripCoverage.set([]);
    const generation = this.vaultGeneration();
    const snapshot = structuredClone(data);
    const sourceFormat = this.sourceFormat();
    const sourceRawMeta = this.sourceRawMeta;
    try {
      const { inspectVaultRoundTrip } = await import("@vaultlint/vault-formats");
      if (generation !== this.vaultGeneration() || this.vaultData() !== data) return;
      const results: FormatCoverageResult[] = [];
      for (const format of VAULT_FORMATS) {
        try {
          const report = await inspectVaultRoundTrip(snapshot, format.id, {
            rawMeta: format.id === sourceFormat ? sourceRawMeta : undefined,
          });
          results.push({ ok: true, report });
        } catch (err) {
          results.push({ ok: false, formatName: format.name, error: errorMessage(err) });
        }
        // The vault was replaced or cleared mid-run: drop results that describe the old vault.
        if (generation !== this.vaultGeneration() || this.vaultData() !== data) return;
        this.roundTripCoverage.set([...results]);
      }
    } finally {
      if (generation === this.vaultGeneration()) this.checkingFormatCoverage.set(false);
    }
  }

  readonly fidoCount = computed(() => {
    const data = this.vaultData();
    if (!data) return 0;
    return data.items.filter((i) => hasFidoCredentials(i)).length;
  });

  readonly folders = computed(() => this.vaultData()?.folders ?? []);

  readonly folderNameById = computed(() => {
    const map = new Map<string, string>();
    for (const f of this.folders()) {
      map.set(f.id, f.name);
    }
    return map;
  });

  readonly invalidUriItems = computed<InvalidUriInfo[]>(() => {
    const data = this.vaultData();
    return data ? findInvalidUriFindings(data) : [];
  });

  readonly reusedGroups = computed<ReusedPasswordGroup[]>(() => {
    const data = this.vaultData();
    return data ? findReusedPasswordGroupFindings(data) : [];
  });

  readonly reusedItemIndices = computed<Set<number>>(() => {
    const set = new Set<number>();
    for (const group of this.reusedGroups()) {
      for (const entry of group.items) {
        set.add(entry.index);
      }
    }
    return set;
  });

  readonly passwordHealthScore = computed(() => {
    const data = this.vaultData();
    if (!data) return 100;
    const withPasswords = data.items.filter((i) => Boolean(i.login?.password));
    if (withPasswords.length === 0) return 100;

    const reused = this.reusedItemIndices();
    let healthy = 0;
    data.items.forEach((item, index) => {
      const pw = item.login?.password;
      if (!pw) return;
      if (!this.isWeakPassword(pw) && !reused.has(index)) {
        healthy++;
      }
    });
    return Math.round((healthy / withPasswords.length) * 100);
  });

  readonly chartBreakdown = computed<VaultChartBreakdown>(() => {
    const data = this.vaultData();
    return computeVaultBreakdown(data ?? { items: [] });
  });

  private nextToastId = 1;
  private nextLogId = 1;
  private readonly toastTimers = new Map<
    number,
    { timer?: ReturnType<typeof setTimeout>; remainingMs: number; startedAt: number }
  >();
  private toastsPaused = false;

  notify(message: string): void {
    const id = this.nextToastId++;
    this.toasts.update((list) => [...list, { id, message }]);
    this.auditLog.update((log) => [
      { id: this.nextLogId++, timestamp: new Date().toLocaleTimeString(), action: message },
      ...log.slice(0, 49),
    ]);
    // Long messages (e.g. AI failures that explain what to try) stay up long enough to be read.
    const duration = Math.min(15000, Math.max(4500, message.length * 70));
    const entry: { timer?: ReturnType<typeof setTimeout>; remainingMs: number; startedAt: number } =
      {
        remainingMs: duration,
        startedAt: Date.now(),
      };
    if (!this.toastsPaused) {
      entry.timer = setTimeout(() => this.dismissToast(id), duration);
    }
    this.toastTimers.set(id, entry);
  }

  pauseToasts(): void {
    if (this.toastsPaused) return;
    this.toastsPaused = true;
    const now = Date.now();
    for (const entry of this.toastTimers.values()) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.remainingMs = Math.max(1000, entry.remainingMs - (now - entry.startedAt));
    }
  }

  resumeToasts(): void {
    if (!this.toastsPaused) return;
    this.toastsPaused = false;
    const now = Date.now();
    for (const [id, entry] of this.toastTimers) {
      entry.startedAt = now;
      entry.timer = setTimeout(() => this.dismissToast(id), entry.remainingMs);
    }
  }

  dismissToast(id: number): void {
    const entry = this.toastTimers.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.toastTimers.delete(id);
    }
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  clearAuditLog(): void {
    this.auditLog.set([]);
  }

  isWeakPassword(password: string | undefined): boolean {
    return checkWeakPassword(password);
  }

  generateStrongPassword(length = this.passwordLength()): string {
    return createStrongPassword(length);
  }

  private pushHistory(): void {
    const current = this.vaultData();
    if (!current) return;
    this.historyStack.update((s) => [...s, JSON.stringify(current)].slice(-MAX_HISTORY_ENTRIES));
    this.redoStack.set([]);
  }

  private resetVaultScopedState(): void {
    this.loadRequest++;
    this.vaultGeneration.update((n) => n + 1);
    this.historyStack.set([]);
    this.redoStack.set([]);
    this.revealedIds.set(new Set());
    this.compromisedIds.set(new Set());
    this.redirectFindings.set([]);
    this.deadLinkFindings.set([]);
    this.mobileUriFindings.set([]);
    this.aiDuplicateGroups.set([]);
    this.aiUriSuggestions.set([]);
    this.aiHygieneFindings.set([]);
    this.aiOrganizeSummary.set(null);
    this.roundTripCoverage.set([]);
    // In-flight operations check the generation and no longer own these flags once it changes.
    this.checkingHibp.set(false);
    this.checkingLinks.set(false);
    this.checkingMobileUris.set(false);
    this.checkingFormatCoverage.set(false);
    this.aiRunning.set(false);
    this.aiActiveTask.set(null);
    this.compromisedPasswords = new Map();
    this.aiSuggestionFingerprints = new Map();
    this.activeVendorProvider.set(null);
    this.vendorOriginalVault.set(null);
    this.vendorPushPlan = null;
  }

  private applyParsedVault(
    data: VaultData,
    format: VaultFormatId,
    formatName: string,
    sourceName: string,
    rawMeta?: Record<string, unknown>,
  ): void {
    this.vaultData.set(structuredClone(data));
    this.sourceName = sourceName;
    this.sourceFormat.set(format);
    this.sourceFormatName.set(formatName);
    this.exportFormat.set(format);
    this.sourceRawMeta = rawMeta;
    this.resetVaultScopedState();
    this.notify(`Loaded ${data.items.length} items from ${sourceName} (${formatName}).`);
  }

  async loadVaultInput(
    input: string | Uint8Array | Record<string, unknown>,
    sourceName = "vault.json",
    formatOverride?: VaultFormatId,
  ): Promise<void> {
    const request = ++this.loadRequest;
    try {
      const { parseVaultAsync } = await import("@vaultlint/vault-formats");
      const parsed = await parseVaultAsync(input, { fileName: sourceName, format: formatOverride });
      // A newer load superseded this one while it was parsing; never overwrite the newer vault.
      if (request !== this.loadRequest) return;
      this.applyParsedVault(
        parsed.vault,
        parsed.format,
        parsed.formatName,
        sourceName,
        parsed.rawMeta,
      );
    } catch (err) {
      if (request === this.loadRequest) this.notify(parseErrorMessage(err));
    }
  }

  async loadVaultObject(parsed: unknown, sourceName = "vault.json"): Promise<void> {
    const request = ++this.loadRequest;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.notify('Invalid vault JSON: missing "items" array.');
      return;
    }
    try {
      const { parseVault } = await import("@vaultlint/vault-formats");
      if (request !== this.loadRequest) return;
      const result = parseVault(parsed as Record<string, unknown>, { fileName: sourceName });
      this.applyParsedVault(
        result.vault,
        result.format,
        result.formatName,
        sourceName,
        result.rawMeta,
      );
    } catch (err) {
      this.notify(parseErrorMessage(err));
    }
  }

  async loadSampleVault(): Promise<void> {
    await this.loadVaultObject(
      {
        folders: [
          { id: "f-work", name: "Work" },
          { id: "f-social", name: "Social" },
          { id: "f-media", name: "Entertainment" },
        ],
        items: [
          {
            id: "1",
            name: "Google",
            folderId: "f-work",
            lastModified: "2024-01-10T10:00:00Z",
            login: {
              uris: [{ uri: "https://mail.google.com/mail" }],
              username: "user@gmail.com",
              password: "password",
            },
          },
          {
            id: "2",
            name: "google",
            folderId: "f-work",
            lastModified: "2025-02-15T12:00:00Z",
            login: {
              uris: [{ uri: "https://drive.google.com" }],
              username: "user@gmail.com",
              password: "Strong!Password99",
            },
          },
          {
            id: "3",
            name: "GitHub",
            folderId: "f-work",
            login: {
              uris: [{ uri: "https://github.com/login" }],
              username: "dev@github.com",
              password: "123456",
            },
          },
          {
            id: "4",
            name: "Netflix",
            folderId: "f-media",
            login: {
              uris: ["https://netflix.com"],
              username: "stream@example.com",
              password: "VeryStrong$Pass2025",
              fido: { credentialId: "demo-key" },
            },
          },
        ],
      },
      "Sample Vault",
    );
  }

  undo(): void {
    const stack = this.historyStack();
    const current = this.vaultData();
    if (stack.length === 0 || !current) return;

    const prev = JSON.parse(stack[stack.length - 1]) as VaultData;
    this.historyStack.set(stack.slice(0, -1));
    this.redoStack.update((r) => [...r, JSON.stringify(current)]);
    this.vaultData.set(prev);
    this.notify("Undid last action.");
  }

  redo(): void {
    const stack = this.redoStack();
    const current = this.vaultData();
    if (stack.length === 0 || !current) return;

    const next = JSON.parse(stack[stack.length - 1]) as VaultData;
    this.redoStack.set(stack.slice(0, -1));
    this.historyStack.update((h) => [...h, JSON.stringify(current)].slice(-MAX_HISTORY_ENTRIES));
    this.vaultData.set(next);
    this.notify("Redid action.");
  }

  toggleReveal(key: string): void {
    this.revealedIds.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  createFolder(name: string): string | null {
    const trimmed = name.trim();
    const current = this.vaultData();
    if (!trimmed || !current) return null;

    const existing = (current.folders ?? []).find(
      (f) => f.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) return existing.id;

    this.pushHistory();
    const next = structuredClone(current);
    next.folders = next.folders ?? [];
    const id =
      typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `folder_${Date.now()}`;
    next.folders.push({ id, name: trimmed });
    this.vaultData.set(next);
    this.notify(`Created folder "${trimmed}".`);
    return id;
  }

  suggestDomainMappings(): number {
    const current = this.vaultData();
    if (!current) return 0;

    const existing = this.domainMappings();
    const suggestions = suggestSubdomainMappings(current, existing);
    const added = Object.keys(suggestions).length;

    if (added > 0) {
      const nextMappings = { ...existing, ...suggestions };
      this.domainMappings.set(nextMappings);
      this.saveMappings(nextMappings);
      this.notify(`Suggested ${added} subdomain mapping(s) from vault URIs.`);
    } else {
      this.notify("No new subdomain mappings detected.");
    }
    return added;
  }

  clearVault(): void {
    this.vaultData.set(null);
    this.sourceRawMeta = undefined;
    this.resetVaultScopedState();
    this.notify("Cleared current vault from workspace.");
  }

  createItem(patch: {
    name: string;
    folderId?: string | null;
    username: string;
    password: string;
    urisText: string;
    notes: string;
  }): void {
    const current = this.vaultData();
    if (!current) return;
    this.pushHistory();

    const next = structuredClone(current);
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `item_${Date.now()}`;
    next.items.unshift({
      id,
      name: patch.name.trim(),
      folderId: patch.folderId || null,
      notes: patch.notes,
      lastModified: new Date().toISOString(),
      login: {
        username: patch.username,
        password: patch.password,
        uris: patch.urisText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((uri) => ({ uri })),
      },
    });

    this.vaultData.set(next);
    this.notify(`Added "${patch.name.trim() || "item"}".`);
  }

  updateItem(
    index: number,
    patch: {
      name: string;
      folderId?: string | null;
      username: string;
      password: string;
      urisText: string;
      notes: string;
    },
  ): void {
    const current = this.vaultData();
    if (!current || !current.items[index]) return;
    this.pushHistory();

    const next = structuredClone(current);
    const item = next.items[index];
    item.name = patch.name.trim();
    if (patch.folderId !== undefined) {
      item.folderId = patch.folderId || null;
    }
    item.notes = patch.notes;
    item.lastModified = new Date().toISOString();
    // Notes, cards and identities carry no login; saving a rename must not attach an empty one.
    const hasLoginInput = Boolean(patch.username || patch.password || patch.urisText.trim());
    if (item.login || inferItemType(item) === 1 || hasLoginInput) {
      item.login = item.login ?? {};
      item.login.username = patch.username;
      item.login.password = patch.password;
      item.login.uris = patch.urisText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((uri) => ({ uri }));
    }

    this.vaultData.set(next);
    this.notify(`Updated "${item.name || "item"}".`);
  }

  deleteItem(index: number): void {
    const current = this.vaultData();
    if (!current || !current.items[index]) return;
    this.pushHistory();

    const next = structuredClone(current);
    const [removed] = next.items.splice(index, 1);
    this.vaultData.set(next);
    this.notify(`Deleted "${removed?.name || "item"}".`);
  }

  deleteItems(indices: number[]): void {
    const current = this.vaultData();
    if (!current || indices.length === 0) return;
    this.pushHistory();

    const removeSet = new Set(indices);
    const next = structuredClone(current);
    next.items = next.items.filter((_, idx) => !removeSet.has(idx));
    this.vaultData.set(next);
    this.notify(`Deleted ${removeSet.size} selected item(s).`);
  }

  regeneratePasswordsForIndices(indices: number[]): void {
    const current = this.vaultData();
    if (!current || indices.length === 0) return;
    // Notes, cards and identities have no password; adding a login to them would corrupt the item.
    const loginIndices = indices.filter((idx) => {
      const item = current.items[idx];
      return item !== undefined && inferItemType(item) === 1;
    });
    if (loginIndices.length === 0) {
      this.notify("No login items selected; nothing to regenerate.");
      return;
    }
    this.pushHistory();

    const next = structuredClone(current);
    let count = 0;
    for (const idx of loginIndices) {
      const item = next.items[idx];
      if (!item) continue;
      item.login = item.login ?? {};
      item.login.password = this.generateStrongPassword();
      count++;
    }
    this.vaultData.set(next);
    this.notify(`Regenerated passwords for ${count} selected item(s).`);
  }

  toggleFavorite(index: number): void {
    const current = this.vaultData();
    if (!current || !current.items[index]) return;
    this.pushHistory();

    const next = structuredClone(current);
    const item = next.items[index];
    item.favorite = !item.favorite;
    this.vaultData.set(next);
    this.notify(`${item.favorite ? "Starred" : "Unstarred"} "${item.name || "item"}".`);
  }

  moveItemsToFolder(indices: number[], folderId: string | null): void {
    const current = this.vaultData();
    if (!current || indices.length === 0) return;
    this.pushHistory();

    const next = structuredClone(current);
    for (const idx of indices) {
      if (next.items[idx]) {
        next.items[idx].folderId = folderId || null;
      }
    }
    const folderLabel = folderId ? this.folderNameById().get(folderId) || "folder" : "No folder";
    this.vaultData.set(next);
    this.notify(`Moved ${indices.length} item(s) to "${folderLabel}".`);
  }

  exportAuditReport(): void {
    const data = this.vaultData();
    if (!data) return;
    const report = {
      generatedAt: new Date().toISOString(),
      totalItems: this.totalItems(),
      passwordHealthScore: this.passwordHealthScore(),
      duplicateGroups: this.duplicateGroups().length,
      weakPasswordsCount: this.weakItems().length,
      reusedPasswordGroups: this.reusedGroups().length,
      fidoKeysCount: this.fidoCount(),
      recentActions: this.auditLog(),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    downloadBlob(blob, "vaultlint-audit-report.json");
    this.notify("Exported vault audit report (JSON).");
  }

  exportMarkdownReport(): void {
    const data = this.vaultData();
    if (!data) return;

    const lines: string[] = [
      "# vaultlint Audit Report",
      "",
      `- **Generated:** ${new Date().toISOString()}`,
      `- **Total Items:** ${this.totalItems()}`,
      `- **Password Health Score:** ${this.passwordHealthScore()}%`,
      `- **Duplicate Groups:** ${this.duplicateGroups().length}`,
      `- **Weak Passwords:** ${this.weakItems().length}`,
      `- **Reused Password Groups:** ${this.reusedGroups().length}`,
      `- **Invalid / Malformed URIs:** ${this.invalidUriItems().length}`,
      `- **FIDO2 Keys:** ${this.fidoCount()}`,
      "",
    ];

    if (this.weakItems().length > 0) {
      lines.push("## Weak Passwords (masked)", "");
      for (const w of this.weakItems().slice(0, 50)) {
        lines.push(
          `- **${w.item.name || "Unnamed"}** (${w.item.login?.username || "no username"}) — ${w.reasons.join(", ")}`,
        );
      }
      lines.push("");
    }

    if (this.reusedGroups().length > 0) {
      lines.push("## Reused Passwords", "");
      this.reusedGroups().forEach((g, idx) => {
        const names = g.items.map((e) => e.item.name || "Unnamed").join(", ");
        lines.push(`- **Group ${idx + 1}** (${g.items.length} items): ${names}`);
      });
      lines.push("");
    }

    if (this.auditLog().length > 0) {
      lines.push("## Session Activity Log", "");
      for (const entry of this.auditLog()) {
        lines.push(`- \`${entry.timestamp}\` — ${entry.action}`);
      }
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, "vaultlint-audit-report.md");
    this.notify("Exported vault audit report (Markdown).");
  }

  mergeGroup(group: DuplicateGroup): void {
    const current = this.vaultData();
    if (!current || group.items.length < 2) return;
    const stillCurrent = group.items.every(({ item, index }) => {
      const latestItem = current.items[index];
      return latestItem && JSON.stringify(item) === JSON.stringify(latestItem);
    });
    if (!stillCurrent) {
      this.notify(
        "Those entries changed after duplicate detection; refresh the list before merging.",
      );
      return;
    }
    this.pushHistory();

    const next = structuredClone(current);
    mergeDuplicateIndices(
      next,
      group.items.map((e) => e.index),
    );
    this.vaultData.set(next);
    this.notify(`Merged ${group.items.length} entries for "${group.name}".`);
  }

  mergeAllDuplicates(): void {
    const groups = this.duplicateGroups();
    const current = this.vaultData();
    if (!current || groups.length === 0) return;
    this.pushHistory();

    const next = structuredClone(current);
    const before = next.items.length;
    mergeAllDuplicateGroups(next);
    const mergedCount = before - next.items.length;
    this.vaultData.set(next);
    this.notify(`Merged ${mergedCount} duplicate entry(s).`);
  }

  regeneratePassword(index: number): void {
    const current = this.vaultData();
    if (!current || !current.items[index]) return;
    this.pushHistory();

    const next = structuredClone(current);
    next.items[index].login = next.items[index].login ?? {};
    next.items[index].login!.password = this.generateStrongPassword();
    this.vaultData.set(next);
    this.notify(`Generated strong password for "${next.items[index].name || "item"}".`);
  }

  regenerateAllWeak(): void {
    const current = this.vaultData();
    if (!current) return;
    this.pushHistory();

    const next = structuredClone(current);
    const count = regenerateWeakPasswordsInVault(next, this.passwordLength());
    this.vaultData.set(next);
    this.notify(`Regenerated ${count} weak password(s).`);
  }

  setLintRuleset(preset: LintPresetName): void {
    this.lintRuleset.set(preset);
    this.lintRuleOverrides.set({});
    this.saveLintProfile();
  }

  setLintRuleSeverity(ruleId: LintRuleId, severity: LintSeverity): void {
    this.lintRuleOverrides.update((prev) => ({ ...prev, [ruleId]: severity }));
    this.saveLintProfile();
  }

  resetLintRules(): void {
    this.lintRuleOverrides.set({});
    this.saveLintProfile();
  }

  loadLintProfile(config: VaultLintConfig, announce = true): void {
    this.lintRuleset.set(config.extends ?? "recommended");
    this.lintRuleOverrides.set(config.rules ?? {});
    this.saveLintProfile();
    if (announce) this.notify("Lint profile loaded and saved in this browser.");
  }

  runLintAutofix(unsafe = false, ruleIds?: LintRuleId[]): void {
    const current = this.vaultData();
    if (!current) return;
    const preview = applyLintFixes(current, {
      config: this.lintConfig(),
      unsafe,
      ruleIds,
      dryRun: true,
      passwordLength: this.passwordLength(),
    });
    if (preview.appliedCount === 0) {
      this.notify("No applicable autofixes found for current ruleset.");
      return;
    }

    this.pushHistory();
    const next = structuredClone(current);
    const result = applyLintFixes(next, {
      config: this.lintConfig(),
      unsafe,
      ruleIds,
      passwordLength: this.passwordLength(),
    });
    this.vaultData.set(next);
    this.notify(
      `Applied ${result.appliedCount} lint autofix(es)${unsafe ? " (including unsafe)" : ""}.`,
    );
  }

  async checkCompromisedHibp(): Promise<void> {
    const current = this.vaultData();
    if (!current || this.checkingHibp()) return;

    this.checkingHibp.set(true);
    const generation = this.vaultGeneration();
    try {
      const foundIds = await checkVaultPasswordsHibp(current);
      if (generation !== this.vaultGeneration()) return;
      // Tie each flag to the password that was checked so later edits clear it.
      const itemRefs = buildVaultItemRefs(current);
      this.compromisedPasswords = new Map(
        current.items.flatMap((item, index) => {
          const key = itemRefs[index];
          return foundIds.has(key) ? [[key, item.login?.password ?? ""] as const] : [];
        }),
      );
      this.compromisedIds.set(foundIds);
      const latest = this.vaultData();
      if (latest) this.pruneCompromised(latest);
      this.notify(`HIBP check complete: ${this.compromisedIds().size} breached password(s) found.`);
    } catch (err) {
      if (generation === this.vaultGeneration()) {
        this.notify(`HIBP check failed: ${errorMessage(err)}`);
      }
    } finally {
      if (generation === this.vaultGeneration()) this.checkingHibp.set(false);
    }
  }

  async checkLinksAndRedirects(): Promise<void> {
    const data = this.vaultData();
    if (!data || this.checkingLinks()) return;

    this.checkingLinks.set(true);
    const generation = this.vaultGeneration();
    const targets: Array<{
      itemIndex: number;
      itemId?: string;
      itemName: string;
      itemFingerprint: string;
      uri: string;
    }> = [];
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const itemName = item.name || "Unnamed";
      for (const entry of item.login?.uris ?? []) {
        const uri = getUriString(entry);
        if (/^https?:\/\//i.test(uri)) {
          targets.push({
            itemIndex: i,
            itemId: item.id || undefined,
            itemName,
            itemFingerprint: fingerprintItem(item),
            uri,
          });
        }
      }
    }

    type LinkOutcome = { redirect?: WebRedirectFinding; dead?: WebDeadLinkFinding };
    const outcomes: LinkOutcome[] = Array.from({ length: targets.length }, () => ({}));
    let nextTarget = 0;

    try {
      const worker = async (): Promise<void> => {
        while (nextTarget < targets.length) {
          const targetIndex = nextTarget++;
          const { itemIndex, itemId, itemName, itemFingerprint, uri } = targets[targetIndex];
          let outcome: LinkOutcome = {};
          try {
            const res = await fetch(uri, {
              method: "HEAD",
              redirect: "follow",
              signal: AbortSignal.timeout(5000),
            });

            if (res.redirected && res.url && res.url !== uri) {
              outcome.redirect = {
                itemIndex,
                itemId,
                itemName,
                itemFingerprint,
                originalUri: uri,
                redirectedUri: res.url,
                status: res.status,
              };
            } else if (res.status >= 400 && res.status !== 405) {
              outcome.dead = {
                itemIndex,
                itemId,
                itemName,
                itemFingerprint,
                uri,
                reason: `HTTP ${res.status}`,
              };
            }
          } catch {
            outcome.dead = {
              itemIndex,
              itemId,
              itemName,
              itemFingerprint,
              uri,
              reason: "Unreachable or blocked by CORS",
            };
          }
          outcomes[targetIndex] = outcome;
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, () => worker()));
      if (generation !== this.vaultGeneration()) return;

      // Items may have been edited/deleted/reordered while requests were in flight; re-locate them.
      const latest = this.vaultData();
      if (!latest) return;
      const redirects: WebRedirectFinding[] = [];
      const deadLinks: WebDeadLinkFinding[] = [];
      for (const outcome of outcomes) {
        if (outcome.redirect) redirects.push(outcome.redirect);
        if (outcome.dead) deadLinks.push(outcome.dead);
      }
      const liveRedirects = this.remapFindings(redirects, latest, (f) => f.originalUri);
      const liveDeadLinks = this.remapFindings(deadLinks, latest, (f) => f.uri);

      this.redirectFindings.set(liveRedirects);
      this.deadLinkFindings.set(liveDeadLinks);
      this.notify(
        `Link check complete: ${liveRedirects.length} redirect(s), ${liveDeadLinks.length} unreachable/CORS.`,
      );
    } finally {
      if (generation === this.vaultGeneration()) this.checkingLinks.set(false);
    }
  }

  applyRedirect(finding: WebRedirectFinding, replaceOriginal = false): void {
    const current = this.vaultData();
    if (!current) return;
    const index = this.locateFindingItem(current, finding, finding.originalUri);
    if (index < 0) {
      this.redirectFindings.update((list) => list.filter((r) => r !== finding));
      this.notify("That item changed after the link check; the redirect finding was discarded.");
      return;
    }
    if (!current.items[index]?.login?.uris) return;

    this.pushHistory();
    const next = structuredClone(current);
    const targetItem = next.items[index];
    const uris = targetItem.login?.uris ?? [];

    if (replaceOriginal) {
      targetItem.login!.uris = uris.map((u) =>
        getUriString(u) === finding.originalUri ? withUpdatedUri(u, finding.redirectedUri) : u,
      );
    } else if (!uris.some((u) => getUriString(u) === finding.redirectedUri)) {
      const usesObjects = uris.some((u) => typeof u === "object" && u !== null && "uri" in u);
      uris.push(usesObjects ? { uri: finding.redirectedUri } : finding.redirectedUri);
    }

    this.vaultData.set(next);
    this.redirectFindings.update((list) => list.filter((r) => r !== finding));
    this.notify(
      `${replaceOriginal ? "Replaced" : "Added"} redirected URI for "${finding.itemName}".`,
    );
  }

  removeDeadUri(finding: WebDeadLinkFinding): void {
    const current = this.vaultData();
    if (!current) return;
    const index = this.locateFindingItem(current, finding, finding.uri);
    if (index < 0) {
      this.deadLinkFindings.update((list) => list.filter((d) => d !== finding));
      this.notify("That item changed after the link check; the dead-link finding was discarded.");
      return;
    }
    if (!current.items[index]?.login?.uris) return;

    this.pushHistory();
    const next = structuredClone(current);
    const targetItem = next.items[index];
    targetItem.login!.uris = (targetItem.login?.uris ?? []).filter(
      (u) => getUriString(u) !== finding.uri,
    );

    this.vaultData.set(next);
    this.deadLinkFindings.update((list) => list.filter((d) => d !== finding));
    this.notify(`Removed URI for "${finding.itemName}" (${getSafeUriDisplayLabel(finding.uri)}).`);
  }

  previewBatchEdit(
    field: string,
    pattern: string,
    replacement: string,
    targetMode: BatchEditTargetMode = "all",
  ): BatchMatchPreview[] {
    const current = this.vaultData();
    return current ? previewBatchEditOnVault(current, field, pattern, replacement, targetMode) : [];
  }

  applyBatchEdit(
    field: string,
    pattern: string,
    replacement: string,
    targetMode: BatchEditTargetMode = "all",
  ): void {
    const current = this.vaultData();
    if (!current) return;
    if (!pattern) {
      // An empty regex matches every position of every value; the CLI refuses it too.
      this.notify("Enter a pattern before applying a batch edit.");
      return;
    }

    const next = structuredClone(current);
    let count: number;
    try {
      count = applyBatchEditToVault(next, field, pattern, replacement, targetMode);
    } catch (err) {
      this.notify(`Invalid regex: ${errorMessage(err)}`);
      return;
    }

    if (count === 0) {
      this.notify("Batch edit matched no items; nothing changed.");
      return;
    }
    this.pushHistory();
    this.vaultData.set(next);
    this.notify(`Applied ${count} batch edit(s).`);
  }

  normalizeAll(): void {
    const current = this.vaultData();
    if (!current) return;
    this.pushHistory();

    const next = structuredClone(current);
    normalizeVaultItems(next);
    this.vaultData.set(next);
    this.notify("Normalized all item names and URIs.");
  }

  addDomainMapping(fromHost: string, toHost: string): void {
    const from = fromHost.trim();
    const to = toHost.trim();
    if (!from || !to) return;
    this.domainMappings.update((m) => {
      const next = { ...m, [from]: to };
      this.saveMappings(next);
      return next;
    });
  }

  removeDomainMapping(fromHost: string): void {
    this.domainMappings.update((m) => {
      const next = { ...m };
      delete next[fromHost];
      this.saveMappings(next);
      return next;
    });
  }

  applyDomainMappings(): void {
    const current = this.vaultData();
    if (!current) return;
    this.pushHistory();

    const next = structuredClone(current);
    const updated = applyDomainMappingsToVault(next, this.domainMappings());
    this.vaultData.set(next);
    this.notify(`Applied ${updated} domain mapping(s).`);
  }

  importAegisFido(parsed: unknown): number {
    const current = this.vaultData();
    if (!current || !parsed || typeof parsed !== "object") return 0;

    this.pushHistory();
    const next = structuredClone(current);
    const updated = importAegisFidoKeys(next, parsed);
    this.vaultData.set(next);
    this.notify(`Imported FIDO credentials (${updated} item(s) updated).`);
    return updated;
  }

  mergeIncomingVault(incoming: VaultData, options: VaultMigrationOptions = {}): void {
    const current = this.vaultData();
    if (!current) return;
    const next = mergeVaultMigration(current, incoming, options);
    const added = next.items.length - current.items.length;
    const matchedChanged = JSON.stringify(next.items) !== JSON.stringify(current.items);
    if (added === 0 && !matchedChanged) {
      this.notify("The selected migration choices produced no vault changes.");
      return;
    }
    this.pushHistory();
    this.vaultData.set(next);
    this.notify(`Added ${added} unmatched item(s) and applied the reviewed migration choices.`);
  }

  async exportVault(targetFormat?: VaultFormatId): Promise<void> {
    const data = this.vaultData();
    if (!data) return;
    const format = targetFormat ?? this.exportFormat();
    try {
      const { exportVault } = await import("@vaultlint/vault-formats");
      if (this.vaultData() !== data) {
        this.notify(
          "The vault changed while preparing the export. Export again to include the latest edits.",
        );
        return;
      }
      const exported = exportVault(data, format, {
        rawMeta: format === this.sourceFormat() ? this.sourceRawMeta : undefined,
      });
      const blobPart: BlobPart =
        typeof exported.content === "string" ? exported.content : new Uint8Array(exported.content);
      const blob = new Blob([blobPart], { type: exported.mimeType });
      downloadBlob(blob, `vaultlint-enhanced-${format}.${exported.extension}`);
      const warnings = exported.warnings.length > 0 ? ` ${exported.warnings.join(" ")}` : "";
      this.notify(`Exported enhanced vault (${format}).${warnings}`);
    } catch (err) {
      this.notify(`Export failed: ${errorMessage(err)}`);
    }
  }

  private clearAiResults(taskId: string): void {
    if (taskId === "duplicates") this.aiDuplicateGroups.set([]);
    else if (taskId === "suggest-uris") {
      this.aiUriSuggestions.set([]);
      this.aiSuggestionFingerprints = new Map();
    } else if (taskId === "hygiene") this.aiHygieneFindings.set([]);
    else if (taskId === "organize") this.aiOrganizeSummary.set(null);
  }

  /** The default container, code-split and loaded on first AI use (AI is opt-in). */
  private loadAiContainer(): Promise<AiProviderContainer> {
    this.aiContainerPromise ??= loadDefaultAiContainer().catch((err: unknown) => {
      this.aiContainerPromise = null;
      throw err;
    });
    return this.aiContainerPromise;
  }

  private async runAiOperation(
    taskId: string,
    label: string,
    config: AiProviderConfig,
    fn: (
      provider: ReturnType<AiProviderContainer["resolve"]>,
      current: NonNullable<ReturnType<typeof this.vaultData>>,
      sanitized: ReturnType<typeof sanitizeVaultItemsForAi>,
      latestVault: () => VaultData | null,
    ) => Promise<void>,
  ): Promise<void> {
    const current = this.vaultData();
    if (!current || this.aiRunning()) return;

    this.aiRunning.set(true);
    this.aiActiveTask.set(taskId);
    // A rerun replaces the previous result; a failed or empty rerun must not leave stale results.
    this.clearAiResults(taskId);
    const generation = this.vaultGeneration();
    // The vault a response was generated for may have been replaced or cleared mid-run; results for
    // a different vault must never be applied (item ids / positions would not line up).
    const latestVault = (): VaultData | null => {
      if (generation === this.vaultGeneration()) return this.vaultData();
      this.notify(`The open vault changed while ${label} was running; results were discarded.`);
      return null;
    };
    try {
      // An injected container is used synchronously so the request starts in the same task.
      const container = this.providedAiContainer ?? (await this.loadAiContainer());
      const provider = container.resolve(config.provider);
      const snapshot = structuredClone(current);
      const sanitized = sanitizeVaultItemsForAi(snapshot);
      await fn(provider, snapshot, sanitized, latestVault);
    } catch (err) {
      if (generation === this.vaultGeneration()) {
        this.notify(`${label} failed: ${errorMessage(err)}`);
      }
    } finally {
      if (generation === this.vaultGeneration()) {
        this.aiRunning.set(false);
        this.aiActiveTask.set(null);
      }
    }
  }

  /**
   * Item keys whose item is byte-identical in both vaults. Keys that are ambiguous in either vault
   * (duplicate ids, or an id equal to another item's position) are never considered unchanged.
   */
  private unchangedAiItemIds(original: VaultData, latest: VaultData): Set<string> {
    const latestById = this.aiKeyedItems(latest);
    return new Set(
      [...this.aiKeyedItems(original)].flatMap(([id, item]) => {
        const latestItem = latestById.get(id);
        return latestItem && JSON.stringify(item) === JSON.stringify(latestItem) ? [id] : [];
      }),
    );
  }

  async categorizeWithAi(config: AiProviderConfig): Promise<void> {
    await this.runAiOperation(
      "categorize",
      "AI categorization",
      config,
      async (provider, current, sanitized, latestVault) => {
        const categories = restoreAiItemIdRecord(
          await provider.categorize(sanitized, config),
          current,
        );
        const latest = latestVault();
        if (!latest) return;
        const unchangedIds = this.unchangedAiItemIds(current, latest);
        const applicableCategories = Object.fromEntries(
          Object.entries(categories).filter(([id]) => unchangedIds.has(id)),
        );
        if (Object.keys(applicableCategories).length === 0) {
          this.notify(
            Object.keys(categories).length > 0
              ? "Vault items changed while AI was running; rerun categorization to avoid overwriting edits."
              : `AI (${provider.meta.displayName}) returned no folder suggestions.`,
          );
          return;
        }

        this.pushHistory();
        const next = structuredClone(latest);
        const { categorizedCount, createdFolders } = applyCategorySuggestions(
          next,
          applicableCategories,
        );
        this.vaultData.set(next);
        this.notify(
          `AI (${provider.meta.displayName}) categorized ${categorizedCount} item(s) (${createdFolders} new folder(s)).`,
        );
      },
    );
  }

  async organizeWithAi(config: AiProviderConfig): Promise<void> {
    await this.runAiOperation(
      "organize",
      "AI organize",
      config,
      async (provider, current, sanitized, latestVault) => {
        const aiResult = await provider.organize(sanitized, config);
        const result = {
          ...aiResult,
          categories: restoreAiItemIdRecord(aiResult.categories, current),
          renames: restoreAiItemIdRecord(aiResult.renames, current),
        };
        const latest = latestVault();
        if (!latest) return;
        const unchangedIds = this.unchangedAiItemIds(current, latest);
        const applicableResult = {
          ...result,
          categories: Object.fromEntries(
            Object.entries(result.categories).filter(([id]) => unchangedIds.has(id)),
          ),
          renames: Object.fromEntries(
            Object.entries(result.renames).filter(([id]) => unchangedIds.has(id)),
          ),
        };
        const hasChanges =
          Object.keys(applicableResult.categories).length > 0 ||
          Object.keys(applicableResult.renames).length > 0;
        if (!hasChanges) {
          this.notify(
            Object.keys(result.categories).length > 0 || Object.keys(result.renames).length > 0
              ? "Vault items changed while AI was running; rerun organize to avoid overwriting edits."
              : `AI (${provider.meta.displayName}) found nothing to reorganize.`,
          );
          return;
        }

        this.pushHistory();
        const next = structuredClone(latest);
        const { categorizedCount, createdFolders, renamedCount } = applyOrganizeSuggestions(
          next,
          applicableResult,
        );
        this.vaultData.set(next);
        this.aiOrganizeSummary.set(
          result.summary ??
            `Categorized ${categorizedCount} item(s), created ${createdFolders} folder(s), renamed ${renamedCount} item(s).`,
        );
        this.notify(
          `AI (${provider.meta.displayName}) organized ${categorizedCount} item(s), created ${createdFolders} folder(s), renamed ${renamedCount} item(s).`,
        );
      },
    );
  }

  async detectDuplicatesWithAi(config: AiProviderConfig): Promise<void> {
    await this.runAiOperation(
      "duplicates",
      "AI duplicate detection",
      config,
      async (provider, current, sanitized, latestVault) => {
        const suggestions = (await provider.detectDuplicates(sanitized, config)).map(
          (suggestion) => ({
            ...suggestion,
            itemIds: restoreAiItemIds(suggestion.itemIds, current),
          }),
        );
        const latest = latestVault();
        if (!latest) return;
        const unchangedIds = this.unchangedAiItemIds(current, latest);
        const resolved: AiResolvedDuplicateGroup[] = [];
        suggestions
          .filter((suggestion) => suggestion.itemIds.every((id) => unchangedIds.has(id)))
          .forEach((s, idx) => {
            const group = buildDuplicateGroupFromIds(
              latest,
              s.itemIds,
              s.suggestedName,
              `ai-dup-${idx}-${s.itemIds.join("-")}`,
            );
            if (group) {
              resolved.push({ group, reason: s.reason, confidence: s.confidence });
            }
          });

        this.aiDuplicateGroups.set(resolved);
        this.notify(
          resolved.length > 0
            ? `AI (${provider.meta.displayName}) detected ${resolved.length} semantic duplicate group(s).`
            : `AI (${provider.meta.displayName}) found no additional semantic duplicates.`,
        );
      },
    );
  }

  mergeAiDuplicateGroup(resolved: AiResolvedDuplicateGroup): void {
    const current = this.vaultData();
    if (!current) return;
    const latestByRef = this.aiKeyedItems(current);
    const entries = resolved.group.items.map(({ item, index }) => ({
      item,
      ref: item.id && latestByRef.has(item.id) ? item.id : `index:${index}`,
    }));
    const itemIds = entries.map((entry) => entry.ref);
    const unchanged = entries.every(({ item, ref }) => {
      const latestItem = latestByRef.get(ref);
      return Boolean(latestItem && JSON.stringify(item) === JSON.stringify(latestItem));
    });
    const currentGroup = unchanged
      ? buildDuplicateGroupFromIds(current, itemIds, resolved.group.name, resolved.group.key)
      : null;
    if (!currentGroup) {
      this.aiDuplicateGroups.update((list) =>
        list.filter(
          (entry) =>
            (entry.group.groupKey ?? entry.group.key) !==
            (resolved.group.groupKey ?? resolved.group.key),
        ),
      );
      this.notify(
        "Those entries changed after AI detection; rerun duplicate detection before merging.",
      );
      return;
    }
    this.mergeGroup(currentGroup);
    this.aiDuplicateGroups.update((list) =>
      list.filter(
        (entry) =>
          (entry.group.groupKey ?? entry.group.key) !==
          (resolved.group.groupKey ?? resolved.group.key),
      ),
    );
  }

  async suggestUrisWithAi(config: AiProviderConfig): Promise<void> {
    await this.runAiOperation(
      "suggest-uris",
      "AI URI suggestion",
      config,
      async (provider, current, sanitized, latestVault) => {
        const suggestions = (await provider.suggestUris(sanitized, config)).flatMap(
          (suggestion) => {
            const [itemId] = restoreAiItemIds([suggestion.itemId], current);
            return itemId ? [{ ...suggestion, itemId }] : [];
          },
        );
        const latest = latestVault();
        if (!latest) return;
        const unchangedIds = this.unchangedAiItemIds(current, latest);
        const aiRefs = buildAiItemRefs(latest);
        const itemsWithoutUris = new Set(
          latest.items.flatMap((item, index) => {
            const id = aiRefs[index];
            return unchangedIds.has(id) && (item.login?.uris?.length ?? 0) === 0 ? [id] : [];
          }),
        );
        const currentSuggestions = suggestions.filter((suggestion) =>
          itemsWithoutUris.has(suggestion.itemId),
        );
        const latestKeyed = this.aiKeyedItems(latest);
        this.aiSuggestionFingerprints = new Map(
          currentSuggestions.flatMap((suggestion) => {
            const item = latestKeyed.get(suggestion.itemId);
            return item ? [[suggestion.itemId, JSON.stringify(item)] as const] : [];
          }),
        );
        this.aiUriSuggestions.set(currentSuggestions);
        this.notify(
          currentSuggestions.length > 0
            ? `AI (${provider.meta.displayName}) suggested ${currentSuggestions.length} missing login URI(s).`
            : `AI (${provider.meta.displayName}) found no missing URIs to suggest.`,
        );
      },
    );
  }

  /** A suggestion only applies to the exact item snapshot it was generated for. */
  private isAiSuggestionCurrent(current: VaultData, suggestion: AiUriSuggestion): boolean {
    const fingerprint = this.aiSuggestionFingerprints.get(suggestion.itemId);
    const item = this.aiKeyedItems(current).get(suggestion.itemId);
    return fingerprint !== undefined && item !== undefined && JSON.stringify(item) === fingerprint;
  }

  applyAiUriSuggestion(suggestion: AiUriSuggestion): void {
    const current = this.vaultData();
    if (!current) return;
    const next = structuredClone(current);
    const { updatedCount } = this.isAiSuggestionCurrent(current, suggestion)
      ? applyUriSuggestions(next, [suggestion])
      : { updatedCount: 0 };
    if (updatedCount === 0) {
      this.aiUriSuggestions.update((list) => list.filter((s) => s.itemId !== suggestion.itemId));
      this.notify("That item already has a URI or no longer exists; the suggestion was discarded.");
      return;
    }
    this.pushHistory();
    this.vaultData.set(next);
    this.aiUriSuggestions.update((list) => list.filter((s) => s.itemId !== suggestion.itemId));
    this.notify(`Added suggested URI ${suggestion.suggestedUri}.`);
  }

  applyAllAiUriSuggestions(): void {
    const current = this.vaultData();
    const suggestions = this.aiUriSuggestions();
    if (!current || suggestions.length === 0) return;
    const next = structuredClone(current);
    const applicable = suggestions.filter((s) => this.isAiSuggestionCurrent(current, s));
    const { updatedCount } = applyUriSuggestions(next, applicable);
    this.aiUriSuggestions.set([]);
    if (updatedCount > 0) {
      this.pushHistory();
      this.vaultData.set(next);
      this.notify(`Applied ${updatedCount} AI-suggested login URI(s).`);
    } else {
      this.notify("No URI suggestions could be applied because the items changed.");
    }
  }

  async analyzeHygieneWithAi(config: AiProviderConfig): Promise<void> {
    await this.runAiOperation(
      "hygiene",
      "AI hygiene audit",
      config,
      async (provider, current, sanitized, latestVault) => {
        const findings = (await provider.analyzeHygiene(sanitized, config)).map((finding) => ({
          ...finding,
          itemIds: restoreAiItemIds(finding.itemIds, current),
        }));
        const latest = latestVault();
        if (!latest) return;
        const unchangedIds = this.unchangedAiItemIds(current, latest);
        const currentFindings = findings
          .map((finding) => ({
            ...finding,
            itemIds: finding.itemIds.filter((id) => unchangedIds.has(id)),
          }))
          .filter(
            (finding, index) => findings[index].itemIds.length === 0 || finding.itemIds.length > 0,
          );
        this.aiHygieneFindings.set(currentFindings);
        this.notify(
          currentFindings.length > 0
            ? `AI (${provider.meta.displayName}) found ${currentFindings.length} hygiene insight(s).`
            : `AI (${provider.meta.displayName}) found no hygiene issues.`,
        );
      },
    );
  }

  async checkMobileAppUris(): Promise<void> {
    const data = this.vaultData();
    if (!data || this.checkingMobileUris()) return;

    const KNOWN_MOBILE_APPS: Record<string, string> = {
      "github.com": "androidapp://com.github.android",
      "google.com": "androidapp://com.google.android.gm",
      "reddit.com": "androidapp://com.reddit.frontpage",
      "discord.com": "androidapp://com.discord",
      "slack.com": "androidapp://com.Slack",
      "spotify.com": "androidapp://com.spotify.music",
      "amazon.com": "androidapp://com.amazon.mShop.android.shopping",
      "netflix.com": "androidapp://com.netflix.mediaclient",
    };

    this.checkingMobileUris.set(true);
    const generation = this.vaultGeneration();
    const findings: WebMobileUriFinding[] = [];
    const iosAppIds = new Set<string>();
    for (const item of data.items) {
      for (const entry of item.login?.uris ?? []) {
        const uri = getUriString(entry);
        if (!uri.startsWith("iosapp://")) continue;
        const appId = uri.slice("iosapp://".length);
        if (/^\d+$/.test(appId)) iosAppIds.add(appId);
      }
    }

    const iosLookupResults = new Map<
      string,
      { status: "valid" | "invalid" | "unverified"; detail: string }
    >();

    try {
      const appIds = [...iosAppIds];
      let nextAppId = 0;
      const lookupWorker = async (): Promise<void> => {
        while (nextAppId < appIds.length) {
          const appId = appIds[nextAppId++];
          try {
            const res = await fetch(
              `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}`,
              { signal: AbortSignal.timeout(5000) },
            );
            // A rate limit or outage says nothing about the app; only a successful lookup can.
            if (!res.ok) throw new Error(`App Store lookup failed (HTTP ${res.status})`);
            const json = (await res.json()) as { resultCount?: number };
            const valid = (json.resultCount ?? 0) > 0;
            iosLookupResults.set(appId, {
              status: valid ? "valid" : "invalid",
              detail: valid ? "Verified in Apple App Store" : "Not found in Apple App Store",
            });
          } catch {
            iosLookupResults.set(appId, {
              status: "unverified",
              detail: "Valid iOS App ID format (lookup unavailable)",
            });
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, appIds.length) }, () => lookupWorker()));
      if (generation !== this.vaultGeneration()) return;

      for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        const itemName = item.name || "Unnamed";
        const itemId = item.id || undefined;
        const itemFingerprint = fingerprintItem(item);
        const uris = (item.login?.uris ?? []).map(getUriString).filter(Boolean);

        for (const uri of uris) {
          if (uri.startsWith("androidapp://")) {
            const pkg = uri.slice("androidapp://".length);
            const validPkg = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(pkg);
            findings.push({
              itemIndex: i,
              itemId,
              itemName,
              itemFingerprint,
              uri,
              status: validPkg ? "valid" : "invalid",
              detail: validPkg
                ? "Valid Android package format"
                : "Malformed Android package identifier",
            });
          } else if (uri.startsWith("iosapp://")) {
            const appId = uri.slice("iosapp://".length);
            if (!/^\d+$/.test(appId)) {
              findings.push({
                itemIndex: i,
                itemId,
                itemName,
                itemFingerprint,
                uri,
                status: "invalid",
                detail: "Malformed iOS numeric App Store ID",
              });
            } else {
              const result = iosLookupResults.get(appId);
              findings.push({
                itemIndex: i,
                itemId,
                itemName,
                itemFingerprint,
                uri,
                status: result?.status ?? "unverified",
                detail: result?.detail ?? "Valid iOS App ID format (lookup unavailable)",
              });
            }
          }
        }

        for (const uri of uris) {
          const { domainTld } = extractDomainParts(uri);
          const suggested = KNOWN_MOBILE_APPS[domainTld];
          if (suggested && !uris.includes(suggested)) {
            findings.push({
              itemIndex: i,
              itemId,
              itemName,
              itemFingerprint,
              uri: suggested,
              sourceUri: uri,
              status: "suggested",
              detail: `Suggested for ${domainTld}`,
            });
            break;
          }
        }
      }

      // Items may have been edited/deleted/reordered while lookups were in flight; re-locate them.
      const latest = this.vaultData();
      if (!latest) return;
      const live = this.remapFindings(findings, latest, (f) =>
        f.status === "suggested" ? f.sourceUri : f.uri,
      );
      this.mobileUriFindings.set(live);
      const suggestedCount = live.filter((f) => f.status === "suggested").length;
      const invalidCount = live.filter((f) => f.status === "invalid").length;
      this.notify(
        `Mobile URI check: ${live.length} finding(s) (${suggestedCount} suggested, ${invalidCount} invalid).`,
      );
    } finally {
      if (generation === this.vaultGeneration()) this.checkingMobileUris.set(false);
    }
  }

  applySuggestedMobileUri(finding: WebMobileUriFinding): void {
    const current = this.vaultData();
    if (!current) return;
    const index = this.locateFindingItem(
      current,
      finding,
      finding.status === "suggested" ? finding.sourceUri : finding.uri,
    );
    if (index < 0) {
      this.mobileUriFindings.update((list) => list.filter((f) => f !== finding));
      this.notify("That item changed after the mobile URI check; the finding was discarded.");
      return;
    }

    this.pushHistory();
    const next = structuredClone(current);
    const target = next.items[index];
    target.login = target.login ?? {};
    target.login.uris = target.login.uris ?? [];
    const exists = target.login.uris.some((u) => getUriString(u) === finding.uri);
    if (!exists) {
      const usesObjects = target.login.uris.some(
        (u) => typeof u === "object" && u !== null && "uri" in u,
      );
      target.login.uris.push(usesObjects ? { uri: finding.uri } : finding.uri);
    }
    this.vaultData.set(next);
    this.mobileUriFindings.update((list) => list.filter((f) => f !== finding));
    this.notify(`Added URI for "${finding.itemName}" (${getSafeUriDisplayLabel(finding.uri)}).`);
  }

  async probeVendorCliBridge(): Promise<void> {
    if (typeof fetch !== "function") return;
    try {
      const res = await fetch("/api/vendor-cli/providers", { cache: "no-store" });
      if (!res.ok) return;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return;
      const data = (await res.json()) as {
        available?: boolean;
        providers?: VendorCliProviderInfo[];
      };
      if (data.available && Array.isArray(data.providers)) {
        this.vendorBridgeAvailable.set(true);
        this.vendorProviders.set(data.providers);
      }
    } catch {
      // Bridge is only present when served by `vaultlint --ui`.
    }
  }

  async loadFromVendorCli(providerId: VendorCliId): Promise<void> {
    if (this.vendorBusy()) return;
    this.vendorBusy.set(true);
    const request = ++this.loadRequest;
    try {
      const res = await fetch("/api/vendor-cli/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      const body = (await res.json()) as {
        format?: VaultFormatId;
        content?: string;
        error?: string;
      };
      if (!res.ok || !body.content || !body.format) {
        throw new Error(body.error || `Failed to read from ${providerId} CLI.`);
      }
      const { parseVault } = await import("@vaultlint/vault-formats");
      if (request !== this.loadRequest) return;
      const parsed = parseVault(body.content, { format: body.format });
      const label =
        this.vendorProviders().find((p) => p.id === providerId)?.displayName ?? providerId;
      this.applyParsedVault(
        parsed.vault,
        parsed.format,
        parsed.formatName,
        `${label} CLI`,
        parsed.rawMeta,
      );
      this.activeVendorProvider.set(providerId);
      this.vendorOriginalVault.set(structuredClone(parsed.vault));
    } catch (err) {
      this.notify(errorMessage(err));
    } finally {
      this.vendorBusy.set(false);
    }
  }

  async planVendorCliPush(): Promise<VendorPlanSummary | null> {
    const providerId = this.activeVendorProvider();
    const original = this.vendorOriginalVault();
    const updated = this.vaultData();
    if (!providerId || !original || !updated || this.vendorBusy()) return null;
    this.vendorPushPlan = null;
    const originalSnapshot = JSON.stringify(original);
    const updatedSnapshot = JSON.stringify(updated);

    this.vendorBusy.set(true);
    try {
      const res = await fetch("/api/vendor-cli/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, original, updated }),
      });
      const body = (await res.json()) as VendorPlanSummary & { error?: string };
      if (!res.ok) {
        throw new Error(body.error || "Failed to compute vendor CLI push plan.");
      }
      if (
        this.activeVendorProvider() !== providerId ||
        JSON.stringify(this.vendorOriginalVault()) !== originalSnapshot ||
        JSON.stringify(this.vaultData()) !== updatedSnapshot
      ) {
        this.notify(
          "The vault changed while preparing the push preview. Review a new preview before pushing.",
        );
        return null;
      }
      this.vendorPushPlan = { providerId, originalSnapshot, updatedSnapshot };
      return body;
    } catch (err) {
      this.notify(errorMessage(err));
      return null;
    } finally {
      this.vendorBusy.set(false);
    }
  }

  async pushToVendorCli(): Promise<void> {
    const providerId = this.activeVendorProvider();
    const original = this.vendorOriginalVault();
    const updated = this.vaultData();
    if (!providerId || !original || !updated || this.vendorBusy()) return;
    const plan = this.vendorPushPlan;
    this.vendorPushPlan = null;
    if (
      !plan ||
      plan.providerId !== providerId ||
      plan.originalSnapshot !== JSON.stringify(original) ||
      plan.updatedSnapshot !== JSON.stringify(updated)
    ) {
      this.notify("The vault changed after the push preview. Review a new preview before pushing.");
      return;
    }

    this.vendorBusy.set(true);
    try {
      const res = await fetch("/api/vendor-cli/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, original, updated }),
      });
      const body = (await res.json()) as VendorPushResult & { error?: string };
      if (!res.ok) {
        throw new Error(body.error || "Failed to push changes to vendor CLI.");
      }
      if (
        this.activeVendorProvider() === providerId &&
        JSON.stringify(this.vendorOriginalVault()) === plan.originalSnapshot
      ) {
        this.vendorOriginalVault.set(structuredClone(updated));
      }
      const label =
        this.vendorProviders().find((p) => p.id === providerId)?.displayName ?? providerId;
      this.notify(
        `Pushed to ${label}: ${body.updated} updated, ${body.created} created, ${body.removed} moved to trash, ${body.newFolders} folder(s) created, ${body.updatedFolders} renamed, ${body.removedFolders} permanently deleted.`,
      );
    } catch (err) {
      this.notify(errorMessage(err));
    } finally {
      this.vendorBusy.set(false);
    }
  }
}

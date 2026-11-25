import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  runInInjectionContext,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmAlertImports } from "@spartan-ng/helm/alert";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmKbdImports } from "@spartan-ng/helm/kbd";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";
import { ConfirmDialogComponent, ConfirmDialogData } from "@ui/blocks/confirm-dialog";
import {
  BRAND_LICENSE,
  BRAND_LINKS,
  BRAND_TAGLINE,
  SUPPORTED_MANAGERS,
  TRADEMARK_NOTICE,
} from "@vaultlint/brand";
import type { VaultFormatId } from "@vaultlint/vault-formats";
import { type BatchEditTargetMode } from "@vaultlint/vault-ops";
import {
  buildVaultItemRefs,
  getUriString,
  hasFidoCredentials,
  inferItemType,
} from "@vaultlint/vault-schema";

import pkg from "../../../../package.json";
import { ChangelogService } from "./core/changelog.service";
import { ThemeService } from "./core/theme.service";
import type { VaultDraftService } from "./core/vault-draft.service";
import { type FormatCoverageResult, VaultStoreService } from "./core/vault-store.service";
import type {
  ExplorerFilterMode,
  ExplorerRow,
  ExplorerTypeFilter,
  ThemeMode,
  VaultTabId,
} from "./core/vault.models";
import { ActivityLogPanelComponent } from "./features/activity-log-panel/activity-log-panel.component";
import { AegisImportPanelComponent } from "./features/aegis-import-panel/aegis-import-panel.component";
import { AiAssistantPanelComponent } from "./features/ai-assistant-panel/ai-assistant-panel.component";
import {
  BatchEditPanelComponent,
  type BatchEditRequest,
} from "./features/batch-edit-panel/batch-edit-panel.component";
import { ChangelogDialogComponent } from "./features/changelog-dialog/changelog-dialog.component";
import { DuplicatesPanelComponent } from "./features/duplicates-panel/duplicates-panel.component";
import {
  EditItemDialogComponent,
  type EditItemResult,
} from "./features/edit-item-dialog/edit-item-dialog.component";
import {
  GuidedTourComponent,
  type GuidedTourAction,
} from "./features/guided-tour/guided-tour.component";
import { LintPanelComponent } from "./features/lint-panel/lint-panel.component";
import { MigrationPanelComponent } from "./features/migration-panel/migration-panel.component";
import { SecurityPanelComponent } from "./features/security-panel/security-panel.component";
import { VaultExplorerComponent } from "./features/vault-explorer/vault-explorer.component";
import { VaultHeaderComponent } from "./features/vault-header/vault-header.component";
import {
  type StatJumpEvent,
  VaultStatsComponent,
} from "./features/vault-stats/vault-stats.component";
import {
  type VaultFilePayload,
  VaultUploadComponent,
} from "./features/vault-upload/vault-upload.component";
import { ToastRegionComponent } from "./shared/toast-region/toast-region.component";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True when the element takes typed text, so global shortcuts must not hijack its keystrokes. */
function isTextEntryTarget(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface IndexedExplorerRow extends ExplorerRow {
  searchText: string;
}

function isLosslessCoverage(result: FormatCoverageResult): boolean {
  if (!result.ok) return false;
  const r = result.report;
  return (
    r.changedItemCount === 0 &&
    r.missingItemCount === 0 &&
    r.addedItemCount === 0 &&
    r.fieldChanges.length === 0 &&
    r.warnings.length === 0
  );
}

@Component({
  selector: "app-root",
  imports: [
    NgIcon,
    ...HlmAlertImports,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmKbdImports,
    ...HlmTabsImports,
    ConfirmDialogComponent,
    VaultHeaderComponent,
    VaultUploadComponent,
    VaultStatsComponent,
    VaultExplorerComponent,
    LintPanelComponent,
    MigrationPanelComponent,
    DuplicatesPanelComponent,
    GuidedTourComponent,
    SecurityPanelComponent,
    BatchEditPanelComponent,
    AiAssistantPanelComponent,
    AegisImportPanelComponent,
    ActivityLogPanelComponent,
    ChangelogDialogComponent,
    EditItemDialogComponent,
    ToastRegionComponent,
  ],
  templateUrl: "./app.html",
  host: {
    "(document:keydown)": "onGlobalKeydown($event)",
    "(window:storage)": "onStorage($event)",
    "(window:beforeunload)": "onBeforeUnload($event)",
  },
})
export class App {
  protected readonly store = inject(VaultStoreService);
  private readonly themeService = inject(ThemeService);
  private readonly changelogService = inject(ChangelogService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly vaultHeader = viewChild.required(VaultHeaderComponent);
  protected readonly drafts = signal<VaultDraftService | null>(null);
  protected readonly appVersion = pkg.version;
  protected readonly brandLinks = BRAND_LINKS;
  protected readonly brandLicense = BRAND_LICENSE;
  protected readonly brandTagline = BRAND_TAGLINE;
  protected readonly supportedManagers = SUPPORTED_MANAGERS;
  protected readonly trademarkNotice = TRADEMARK_NOTICE;
  protected readonly currentYear = new Date().getFullYear();

  protected readonly isLosslessCoverage = isLosslessCoverage;
  protected readonly activeTab = signal<VaultTabId>("explorer");
  protected readonly reviewTab = signal<"lint" | "duplicates" | "security">("lint");
  protected readonly organizeTab = signal<"batch" | "migration" | "aegis">("batch");
  protected readonly coverageOpen = signal(false);
  protected readonly summaryOpen = signal(false);
  protected readonly coverageFilter = signal<"all" | "lossless" | "changes">("all");
  protected readonly coverageCounts = computed(() => {
    const results = this.store.roundTripCoverage();
    let lossless = 0;
    for (const r of results) {
      if (isLosslessCoverage(r)) lossless++;
    }
    return { total: results.length, lossless, changes: results.length - lossless };
  });
  protected readonly filteredRoundTripCoverage = computed(() => {
    const results = this.store.roundTripCoverage();
    const filter = this.coverageFilter();
    if (filter === "lossless") return results.filter((r) => isLosslessCoverage(r));
    if (filter === "changes") return results.filter((r) => !isLosslessCoverage(r));
    return results;
  });
  protected readonly navigationSections: Array<{
    id: "items" | "review" | "organize" | "ai" | "activity";
    label: string;
    icon: string;
    description: string;
    tabs: Array<{ id: VaultTabId; label: string }>;
  }> = [
    {
      id: "items",
      label: "Items",
      icon: "matListAltRound",
      description: "Search, filter, and edit entries.",
      tabs: [{ id: "explorer", label: "All items" }],
    },
    {
      id: "review",
      label: "Review",
      icon: "matFactCheckRound",
      description: "Lint checks, duplicates, and security.",
      tabs: [
        { id: "lint", label: "Vault checks" },
        { id: "duplicates", label: "Duplicates" },
        { id: "security", label: "Security & links" },
      ],
    },
    {
      id: "organize",
      label: "Organize",
      icon: "matTuneRound",
      description: "Batch edits, domains, and imports.",
      tabs: [
        { id: "batch", label: "Batch & domains" },
        { id: "migration", label: "Merge vault" },
        { id: "aegis", label: "FIDO import" },
      ],
    },
    {
      id: "ai",
      label: "AI",
      icon: "matSmartToyRound",
      description: "Opt-in folder, URI, and pattern help.",
      tabs: [{ id: "ai", label: "AI assistant" }],
    },
    {
      id: "activity",
      label: "Activity",
      icon: "matHistoryRound",
      description: "Session history and audit reports.",
      tabs: [{ id: "activity", label: "Change history" }],
    },
  ];
  protected readonly activeSection = computed(() =>
    this.navigationSections.find((section) =>
      section.tabs.some((tab) => tab.id === this.activeTab()),
    )!,
  );
  protected readonly securityIssueCount = computed(
    () =>
      this.store.weakItems().length +
      this.store.reusedGroups().length +
      this.store.invalidUriItems().length,
  );
  protected readonly searchQuery = signal("");
  protected readonly filterMode = signal<ExplorerFilterMode>("all");
  protected readonly typeFilter = signal<ExplorerTypeFilter>("all");
  protected readonly folderFilter = signal("all");
  protected readonly theme = this.themeService.theme;
  protected readonly hasNewChangelog = this.changelogService.hasNewChangelog;

  protected readonly editDialog = viewChild<EditItemDialogComponent>("editDialog");
  protected readonly changelogDialog = viewChild.required(ChangelogDialogComponent);
  protected readonly guidedTour = viewChild.required(GuidedTourComponent);
  protected readonly aegisPanel = viewChild(AegisImportPanelComponent);
  protected readonly confirmData = signal<ConfirmDialogData | null>(null);
  private pendingDeleteItems: Array<{ key: string; snapshot: string }> = [];
  private pendingVendorPush = false;
  private pendingVaultAction: (() => void) | null = null;
  private readonly pendingEditDialogActions: Array<(dialog: EditItemDialogComponent) => void> = [];

  protected readonly previewBatchFn = (
    field: string,
    pattern: string,
    replacement: string,
    targetMode: BatchEditTargetMode,
  ) => this.store.previewBatchEdit(field, pattern, replacement, targetMode);

  private readonly indexedRows = computed<IndexedExplorerRow[]>(() => {
    const data = this.store.vaultData();
    if (!data) return [];

    const dupKeys = new Set(this.store.duplicateGroups().map((g) => g.groupKey));
    const folderNames = this.store.folderNameById();
    const reusedIndices = this.store.reusedItemIndices();
    const compromised = this.store.compromisedIds();
    const itemRefs = buildVaultItemRefs(data);

    const rows: IndexedExplorerRow[] = [];
    data.items.forEach((item, index) => {
      const name = item.name || "(Unnamed)";
      const folderName = item.folderId ? folderNames.get(item.folderId) || "" : "";
      const username = item.login?.username || "";
      const password = item.login?.password || "";
      const uris = (item.login?.uris ?? []).map(getUriString).filter(Boolean);
      const itemType = inferItemType(item);
      const isMobileApp = uris.some(
        (u) => u.startsWith("androidapp://") || u.startsWith("iosapp://"),
      );
      const itemKey = itemRefs[index];
      const key = itemKey;
      const isWeak = this.store.isWeakPassword(password);
      const isReused = reusedIndices.has(index);
      const isDup = dupKeys.has(JSON.stringify([itemType, (item.name || "").trim().toLowerCase()]));
      const isBreached = compromised.has(itemKey);
      const hasFido = hasFidoCredentials(item);
      const isFavorite = Boolean(item.favorite);

      rows.push({
        item,
        index,
        key,
        name,
        folderName,
        username,
        password,
        uris,
        itemType,
        isMobileApp,
        isWeak,
        isReused,
        isDup,
        isBreached,
        hasFido,
        isFavorite,
        searchText: `${name} ${folderName} ${username} ${uris.join(" ")}`.toLowerCase(),
      });
    });

    return rows;
  });

  protected readonly filteredRows = computed<ExplorerRow[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const filter = this.filterMode();
    const typeFilter = this.typeFilter();
    const folderId = this.folderFilter();

    return this.indexedRows().filter((row) => {
      if (folderId !== "all" && row.item.folderId !== folderId) return false;

      if (typeFilter === "login" && row.itemType !== 1) return false;
      if (typeFilter === "note" && row.itemType !== 2) return false;
      if (typeFilter === "card" && row.itemType !== 3) return false;
      if (typeFilter === "identity" && row.itemType !== 4) return false;
      if (typeFilter === "app" && !row.isMobileApp) return false;

      if (filter === "weak" && !row.isWeak) return false;
      if (filter === "reused" && !row.isReused) return false;
      if (filter === "duplicate" && !row.isDup) return false;
      if (filter === "fido" && !row.hasFido) return false;
      if (filter === "favorite" && !row.isFavorite) return false;

      return !query || row.searchText.includes(query);
    });
  });

  constructor() {
    effect(() => {
      this.store.vaultGeneration();
      untracked(() => {
        this.searchQuery.set("");
        this.filterMode.set("all");
        this.typeFilter.set("all");
        this.folderFilter.set("all");
      });
    });
    effect(() => {
      const dialog = this.editDialog();
      if (!dialog || this.pendingEditDialogActions.length === 0) return;
      for (const action of this.pendingEditDialogActions.splice(0)) action(dialog);
    });
    afterNextRender(() => {
      void this.store.probeVendorCliBridge();
      void this.loadDraftService();
    });
    const updateNotice = this.changelogService.checkForUpdate(this.appVersion);
    if (updateNotice) {
      this.store.notify(updateNotice);
    }
  }

  private async loadDraftService(): Promise<void> {
    const { VaultDraftService } = await import("./core/vault-draft.service");
    // The root component may be destroyed while the chunk loads (HMR, tests, teardown).
    if (this.destroyRef.destroyed) return;
    const drafts = runInInjectionContext(this.injector, () => inject(VaultDraftService));
    this.drafts.set(drafts);
    await drafts.checkForDraft();
  }

  protected onChangelogOpened(): void {
    this.changelogService.markAsRead();
  }

  protected onThemeChange(mode: ThemeMode): void {
    this.themeService.setTheme(mode);
  }

  protected onStorage(event: StorageEvent): void {
    this.themeService.syncFromStorageEvent(event);
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.vaultData() && this.drafts()?.saveState() === "saving") {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  protected onGlobalKeydown(e: KeyboardEvent): void {
    // Some browsers (autofill, IME) dispatch keydown events without a `key`.
    const pressed = typeof e.key === "string" ? e.key.toLowerCase() : "";
    if (!pressed || e.altKey || e.isComposing) return;
    const target = document.activeElement as HTMLElement | null;
    if (target && isTextEntryTarget(target)) return;
    // Do not rewrite the vault underneath an open dialog (item editor, confirmations, changelog):
    // the dialog may hold item indexes or unsaved input that the undo would invalidate.
    if (document.querySelector("dialog[open], [role='dialog'], [role='alertdialog']")) return;

    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && this.store.vaultData()) {
      const section = this.navigationSections[Number(pressed) - 1];
      if (/^[1-9]$/.test(pressed) && section) {
        e.preventDefault();
        this.onSectionSelected(section.id);
        this.scrollWorkspaceIntoView();
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && pressed === "z" && !e.shiftKey) {
      if (this.store.canUndo()) {
        e.preventDefault();
        this.store.undo();
      }
    } else if ((e.ctrlKey || e.metaKey) && (pressed === "y" || (pressed === "z" && e.shiftKey))) {
      if (this.store.canRedo()) {
        e.preventDefault();
        this.store.redo();
      }
    }
  }

  protected onFileLoaded(payload: VaultFilePayload): void {
    this.requestVaultChange("Replace current vault?", () => {
      if (payload.raw !== undefined) {
        void this.store.loadVaultInput(payload.raw, payload.fileName);
      } else if (payload.parsed !== undefined) {
        this.store.loadVaultObject(payload.parsed, payload.fileName);
      }
    });
  }

  protected onLoadSampleRequested(): void {
    this.requestVaultChange("Load the sample vault?", () => this.store.loadSampleVault());
  }

  protected onLoadVendorCliRequested(
    provider: Parameters<VaultStoreService["loadFromVendorCli"]>[0],
  ): void {
    this.requestVaultChange("Load vault from provider?", () =>
      this.store.loadFromVendorCli(provider),
    );
  }

  protected onClearVaultRequested(): void {
    this.requestVaultChange("Clear this vault?", () => this.store.clearVault(), true);
  }

  private requestVaultChange(title: string, action: () => void, clearing = false): void {
    if (!this.store.vaultData()) {
      action();
      return;
    }
    this.pendingVaultAction = action;
    this.pendingDeleteItems = [];
    this.pendingVendorPush = false;
    this.confirmData.set({
      title,
      copy: this.vaultChangeCopy(clearing),
      confirmLabel: clearing ? "Clear vault" : "Continue",
      cancelLabel: "Cancel",
      confirmColor: clearing ? "destructive" : undefined,
    });
  }

  private vaultChangeCopy(clearing: boolean): string {
    const keepsCopy = this.drafts()?.enabled() === true;
    if (clearing) {
      return keepsCopy
        ? "This removes the open vault and its encrypted recovery copy from this browser."
        : "This removes the open vault. Export it first if you still need a copy.";
    }
    return keepsCopy
      ? "This replaces the open vault. Its recovery copy is also replaced when the new vault is loaded."
      : "This replaces the open vault. Export it first if you still need a copy.";
  }

  protected async onResumeDraft(): Promise<void> {
    const drafts = this.drafts();
    if (!drafts || !(await drafts.restoreDraft())) {
      this.store.notify("Could not restore the local recovery draft.");
    }
  }

  protected async onRecoveryToggle(event: Event): Promise<void> {
    const drafts = this.drafts();
    if (!drafts) return;
    const checkbox = event.target as HTMLInputElement;
    await drafts.setEnabled(checkbox.checked);
    // Keep the checkbox truthful even if the service refused the change.
    checkbox.checked = drafts.enabled();
    this.store.notify(
      drafts.enabled()
        ? "Encrypted local recovery copy turned on."
        : "Encrypted local recovery copy turned off and removed.",
    );
  }

  protected async onDiscardDraft(): Promise<void> {
    const drafts = this.drafts();
    if (!drafts) return;
    await drafts.discardDraft();
    if (drafts.saveState() === "empty") {
      this.store.notify("Removed the saved local recovery draft.");
    } else {
      this.store.notify("Could not remove the saved recovery draft.");
    }
  }

  protected recoverySavedAt(): string {
    const savedAt = this.drafts()?.savedAt() ?? null;
    return savedAt
      ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(savedAt),
        )
      : "recently";
  }

  protected sectionBadge(sectionId: string): number | null {
    if (sectionId === "review") {
      const count = this.store.lintResult()?.counts?.total ?? 0;
      return count > 0 ? count : null;
    }
    if (sectionId === "activity") {
      const count = this.store.auditLog().length;
      return count > 0 ? count : null;
    }
    return null;
  }

  protected activateTab(tab: VaultTabId): void {
    this.activeTab.set(tab);
    if (tab === "lint" || tab === "duplicates" || tab === "security") {
      this.reviewTab.set(tab);
    } else if (tab === "batch" || tab === "migration" || tab === "aegis") {
      this.organizeTab.set(tab);
    }
  }

  protected onJumpTo(event: StatJumpEvent): void {
    if (event.filter) this.filterMode.set(event.filter);
    this.activateTab(event.tab);
    this.scrollWorkspaceIntoView();
  }

  protected toggleCoverage(): void {
    const open = !this.coverageOpen();
    this.coverageOpen.set(open);
    if (open) void this.store.inspectAllFormatCoverage();
  }

  protected openCoverage(): void {
    this.coverageOpen.set(true);
    void this.store.inspectAllFormatCoverage();
    requestAnimationFrame(() => {
      document
        .getElementById("export-coverage-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  protected selectExportFormat(format: VaultFormatId, name: string): void {
    this.store.exportFormat.set(format);
    this.store.notify(`Export format set to ${name}.`);
  }

  protected onGuidedTourAction(action: GuidedTourAction): void {
    if (action === "upload") {
      const fileInput = document.querySelector<HTMLInputElement>(
        "#upload-vault input[type='file']",
      );
      fileInput?.click();
      return;
    }

    if (action === "export") {
      this.vaultHeader().focusExport();
      return;
    }

    this.activateTab(action);
    this.scrollWorkspaceIntoView();
  }

  protected onTabActivated(tab: string): void {
    this.activateTab(tab as VaultTabId);
  }

  protected onSectionSelected(sectionId: string): void {
    const section = this.navigationSections.find((candidate) => candidate.id === sectionId);
    if (!section) return;
    if (section.id === "review") {
      this.activateTab(this.reviewTab());
      return;
    }
    if (section.id === "organize") {
      this.activateTab(this.organizeTab());
      return;
    }
    const nextTab = section.tabs[0]?.id;
    if (nextTab) {
      this.activateTab(nextTab);
    }
  }

  private scrollWorkspaceIntoView(): void {
    requestAnimationFrame(() => {
      document
        .getElementById("vault-workspace")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  protected onEditSaved(result: EditItemResult): void {
    const patch = {
      name: result.name,
      folderId: result.folderId,
      username: result.username,
      password: result.password,
      urisText: result.urisText,
      notes: result.notes,
    };
    if (result.index === -1) {
      this.store.createItem(patch);
      return;
    }
    // The vault can change while the dialog is open (AI results, link checks); re-locate the item
    // being edited instead of trusting the index it had when the dialog opened.
    const index = this.locateEditedItem(result);
    if (index < 0) {
      this.store.notify("That item changed or was removed while editing; the edit was not saved.");
      return;
    }
    this.store.updateItem(index, patch);
  }

  private locateEditedItem(result: EditItemResult): number {
    const items = this.store.vaultData()?.items ?? [];
    const original = result.original;
    if (!original) return items[result.index] ? result.index : -1;
    const fingerprint = JSON.stringify(original);
    if (original.id) {
      const candidates = items.flatMap((item, index) => (item.id === original.id ? [index] : []));
      if (candidates.length <= 1) return candidates[0] ?? -1;
      // Duplicate ids: never guess; only an unchanged copy (preferring the opened position).
      if (
        candidates.includes(result.index) &&
        JSON.stringify(items[result.index]) === fingerprint
      ) {
        return result.index;
      }
      return candidates.find((index) => JSON.stringify(items[index]) === fingerprint) ?? -1;
    }
    if (items[result.index] && JSON.stringify(items[result.index]) === fingerprint) {
      return result.index;
    }
    return items.findIndex((item) => !item.id && JSON.stringify(item) === fingerprint);
  }

  protected async onCopyValue(event: { label: string; value: string }): Promise<void> {
    try {
      await navigator.clipboard.writeText(event.value);
      this.store.notify(`Copied ${event.label} to clipboard.`);
    } catch {
      this.store.notify(`Could not copy ${event.label} to clipboard.`);
    }
  }

  protected onGenerateEditPassword(): void {
    const password = this.store.generateStrongPassword();
    this.withEditDialog((dialog) => dialog.setPassword(password));
  }

  protected onCreateFolder(name: string): void {
    const id = this.store.createFolder(name);
    if (id) {
      this.withEditDialog((dialog) => dialog.selectFolder(id));
    }
  }

  protected onAddItemRequested(): void {
    this.withEditDialog((dialog) => dialog.openCreate());
  }

  protected onEditRowRequested(row: ExplorerRow): void {
    this.onEditItemByIndex(row.index);
  }

  private withEditDialog(action: (dialog: EditItemDialogComponent) => void): void {
    const dialog = this.editDialog();
    if (dialog) action(dialog);
    else this.pendingEditDialogActions.push(action);
  }

  protected onEditItemByIndex(index: number): void {
    const data = this.store.vaultData();
    const item = data?.items[index];
    if (!data || !item) return;
    const uris = (item.login?.uris ?? []).map(getUriString).filter(Boolean);
    this.withEditDialog((dialog) =>
      dialog.open({
        item,
        index,
        key: buildVaultItemRefs(data)[index],
        name: item.name || "(Unnamed)",
        folderName: item.folderId ? this.store.folderNameById().get(item.folderId) || "" : "",
        username: item.login?.username || "",
        password: item.login?.password || "",
        uris,
        itemType: inferItemType(item),
        isMobileApp: uris.some((u) => u.startsWith("androidapp://") || u.startsWith("iosapp://")),
        isWeak: false,
        isReused: false,
        isDup: false,
        isBreached: false,
        hasFido: false,
        isFavorite: Boolean(item.favorite),
      }),
    );
  }

  protected onDeleteRequested(row: ExplorerRow): void {
    const data = this.store.vaultData();
    if (
      !data ||
      buildVaultItemRefs(data)[row.index] !== row.key ||
      JSON.stringify(data.items[row.index]) !== JSON.stringify(row.item)
    ) {
      this.store.notify(
        "That item changed before deletion could be confirmed. Review the list and try again.",
      );
      return;
    }
    this.pendingDeleteItems = [{ key: row.key, snapshot: JSON.stringify(row.item) }];
    this.confirmData.set({
      title: "Delete Vault Item?",
      copy: `Delete "${row.name}"? You can undo this later with Undo.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      confirmColor: "destructive",
    });
  }

  protected onBulkDeleteRequested(indices: number[]): void {
    if (indices.length === 0) return;
    this.pendingDeleteItems = this.capturePendingDeleteItems(indices);
    this.confirmData.set({
      title: "Delete Selected Items?",
      copy: `Delete ${plural(indices.length, "selected item")}? You can undo this later with Undo.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      confirmColor: "destructive",
    });
  }

  protected async onPushToVendorRequested(): Promise<void> {
    const plan = await this.store.planVendorCliPush();
    if (!plan) return;
    const total =
      plan.creates +
      plan.updates +
      plan.removes +
      plan.newFolders +
      plan.updatedFolders +
      plan.removedFolders;
    if (total === 0) {
      this.store.notify("No changes to push to the vendor CLI.");
      return;
    }
    this.pendingDeleteItems = [];
    this.pendingVendorPush = true;
    const preview = plan.lines.slice(0, 8).join("\n");
    const extra = plan.lines.length > 8 ? `\n...and ${plan.lines.length - 8} more.` : "";
    this.confirmData.set({
      title: this.store.activeVendorPushLabel() || "Push Changes to CLI?",
      copy: `${plural(plan.updates, "update")}, ${plural(plan.creates, "create")}, ${plural(plan.removes, "move")} to trash, ${plural(plan.newFolders, "new folder")}, ${plural(plan.updatedFolders, "folder rename")}, ${plural(plan.removedFolders, "permanent folder deletion")}.\n\n${preview}${extra}`,
      confirmLabel: "Push Changes",
      cancelLabel: "Cancel",
    });
  }

  protected onConfirmResolved(confirmed: boolean): void {
    this.confirmData.set(null);
    if (this.pendingVaultAction) {
      const action = this.pendingVaultAction;
      this.pendingVaultAction = null;
      if (confirmed) action();
      return;
    }
    if (confirmed && this.pendingVendorPush) {
      this.pendingVendorPush = false;
      void this.store.pushToVendorCli();
      return;
    }
    this.pendingVendorPush = false;
    const pendingDeleteItems = this.pendingDeleteItems;
    this.pendingDeleteItems = [];
    if (confirmed && pendingDeleteItems.length > 0) {
      const data = this.store.vaultData();
      if (!data) return;
      const refs = buildVaultItemRefs(data);
      const indexByKey = new Map(refs.map((key, index) => [key, index]));
      const indices: number[] = [];
      for (const pending of pendingDeleteItems) {
        const index = indexByKey.get(pending.key);
        if (index === undefined || JSON.stringify(data.items[index]) !== pending.snapshot) {
          this.store.notify(
            "Selected items changed while confirming deletion. Review the selection and try again.",
          );
          return;
        }
        indices.push(index);
      }
      this.store.deleteItems(indices);
    }
  }

  private capturePendingDeleteItems(indices: number[]): Array<{ key: string; snapshot: string }> {
    const data = this.store.vaultData();
    if (!data) return [];
    const refs = buildVaultItemRefs(data);
    return [...new Set(indices)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < data.items.length)
      .map((index) => ({ key: refs[index], snapshot: JSON.stringify(data.items[index]) }));
  }

  protected onApplyBatch(req: BatchEditRequest): void {
    this.store.applyBatchEdit(req.field, req.pattern, req.replacement, req.targetMode);
  }

  protected onAegisLoaded(parsed: unknown): void {
    const count = this.store.importAegisFido(parsed);
    this.aegisPanel()?.setStatus(`Updated FIDO2 keys on ${plural(count, "vault item")}.`);
  }
}

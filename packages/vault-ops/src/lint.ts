import {
  getUriString,
  getSafeUriDisplayLabel,
  inferItemType,
  withUpdatedUri,
  type VaultUri,
  type VaultData,
  type VaultItem,
} from "@vaultlint/vault-schema";

import { groupDuplicatesByName, mergeAllDuplicateGroups } from "./duplicates";
import {
  findReusedPasswordGroupFindings,
  getWeakPasswordReasons,
  isWeakPassword,
  regenerateReusedPasswordsInVault,
  regenerateWeakPasswordsInVault,
} from "./password";

export type LintSeverity = "error" | "warning" | "hint" | "off";
export type ActiveLintSeverity = Exclude<LintSeverity, "off">;
export type LintCategory = "security" | "hygiene" | "uri" | "duplicates";
export type LintPresetName = "recommended" | "strict" | "minimal";
export type LintFixMode = false | "safe" | "unsafe";

export type LintRuleId =
  | "weak-password"
  | "reused-password"
  | "malformed-uri"
  | "insecure-http-uri"
  | "duplicate-items"
  | "duplicate-uris"
  | "whitespace-in-fields"
  | "empty-folder-ref"
  | "missing-password"
  | "missing-item-name"
  | "missing-uri"
  | "missing-username"
  | "missing-totp"
  | "stale-password";

export interface LintRuleDefinition {
  id: LintRuleId;
  title: string;
  description: string;
  category: LintCategory;
  defaultSeverity: LintSeverity;
  fixable: LintFixMode;
  fixDescription?: string;
}

export const LINT_RULES: readonly LintRuleDefinition[] = [
  {
    id: "weak-password",
    title: "Weak Password",
    description: "Password is shorter than 12 characters or missing a digit/special character.",
    category: "security",
    defaultSeverity: "error",
    fixable: "unsafe",
    fixDescription: "Generate a new strong random password (requires unsafe autofix).",
  },
  {
    id: "reused-password",
    title: "Reused Password",
    description: "Same password is shared across multiple vault items.",
    category: "security",
    defaultSeverity: "error",
    fixable: "unsafe",
    fixDescription:
      "Regenerate unique strong passwords for duplicate occurrences (unsafe autofix).",
  },
  {
    id: "malformed-uri",
    title: "Malformed URI",
    description: "Login URI is missing a scheme or cannot be parsed as a valid URL.",
    category: "uri",
    defaultSeverity: "error",
    fixable: "safe",
    fixDescription: "Trim whitespace and prepend https:// to schemeless hostnames.",
  },
  {
    id: "insecure-http-uri",
    title: "Insecure HTTP URI",
    description: "Non-local login URI uses plaintext http:// instead of https://.",
    category: "uri",
    defaultSeverity: "warning",
    fixable: "safe",
    fixDescription: "Upgrade http:// to https:// for non-local hostnames.",
  },
  {
    id: "duplicate-items",
    title: "Duplicate Items",
    description: "Multiple vault items of the same type share the same normalized name.",
    category: "duplicates",
    defaultSeverity: "warning",
    fixable: "unsafe",
    fixDescription: "Merge duplicate item groups into single consolidated items.",
  },
  {
    id: "duplicate-uris",
    title: "Duplicate URIs",
    description: "A single item lists the same URI more than once.",
    category: "uri",
    defaultSeverity: "warning",
    fixable: "safe",
    fixDescription: "Remove duplicate URI entries from the item.",
  },
  {
    id: "whitespace-in-fields",
    title: "Leading/Trailing Whitespace",
    description: "Item name, username, or URI has leading or trailing whitespace.",
    category: "hygiene",
    defaultSeverity: "hint",
    fixable: "safe",
    fixDescription: "Trim leading and trailing whitespace from name, username, and URIs.",
  },
  {
    id: "empty-folder-ref",
    title: "Dangling Folder Reference",
    description: "Item references a folderId that does not exist in vault folders.",
    category: "hygiene",
    defaultSeverity: "warning",
    fixable: "safe",
    fixDescription: "Clear dangling folderId reference.",
  },
  {
    id: "missing-password",
    title: "Missing Password",
    description: "Login item has neither a password nor a FIDO2 passkey.",
    category: "security",
    defaultSeverity: "warning",
    fixable: false,
  },
  {
    id: "missing-item-name",
    title: "Missing Item Name",
    description: "Vault item has an empty or placeholder name.",
    category: "hygiene",
    defaultSeverity: "warning",
    fixable: false,
  },
  {
    id: "missing-uri",
    title: "Missing Login URI",
    description: "Login item has credentials but no associated URI.",
    category: "uri",
    defaultSeverity: "hint",
    fixable: false,
  },
  {
    id: "missing-username",
    title: "Missing Username",
    description: "Login item has a password but no username.",
    category: "hygiene",
    defaultSeverity: "hint",
    fixable: false,
  },
  {
    id: "missing-totp",
    title: "Missing 2FA (TOTP / Passkey)",
    description: "Login item with a password has no TOTP secret or FIDO2 passkey.",
    category: "security",
    defaultSeverity: "hint",
    fixable: false,
  },
  {
    id: "stale-password",
    title: "Stale Password (>365 Days)",
    description: "Login item password has not been updated in over 365 days.",
    category: "security",
    defaultSeverity: "hint",
    fixable: false,
  },
];

export const LINT_RULE_MAP: ReadonlyMap<LintRuleId, LintRuleDefinition> = new Map(
  LINT_RULES.map((r) => [r.id, r]),
);

export const VALID_LINT_SEVERITIES: readonly LintSeverity[] = ["error", "warning", "hint", "off"];
export const VALID_LINT_PRESETS: readonly LintPresetName[] = ["recommended", "strict", "minimal"];

export const LINT_PRESETS: Record<LintPresetName, Record<LintRuleId, LintSeverity>> = {
  recommended: {
    "weak-password": "error",
    "reused-password": "error",
    "malformed-uri": "error",
    "insecure-http-uri": "warning",
    "duplicate-items": "warning",
    "duplicate-uris": "warning",
    "whitespace-in-fields": "hint",
    "empty-folder-ref": "warning",
    "missing-password": "warning",
    "missing-item-name": "warning",
    "missing-uri": "hint",
    "missing-username": "hint",
    "missing-totp": "hint",
    "stale-password": "hint",
  },
  strict: {
    "weak-password": "error",
    "reused-password": "error",
    "malformed-uri": "error",
    "insecure-http-uri": "error",
    "duplicate-items": "error",
    "duplicate-uris": "error",
    "whitespace-in-fields": "warning",
    "empty-folder-ref": "error",
    "missing-password": "error",
    "missing-item-name": "error",
    "missing-uri": "warning",
    "missing-username": "warning",
    "missing-totp": "warning",
    "stale-password": "warning",
  },
  minimal: {
    "weak-password": "error",
    "reused-password": "error",
    "malformed-uri": "error",
    "insecure-http-uri": "off",
    "duplicate-items": "off",
    "duplicate-uris": "off",
    "whitespace-in-fields": "off",
    "empty-folder-ref": "off",
    "missing-password": "off",
    "missing-item-name": "off",
    "missing-uri": "off",
    "missing-username": "off",
    "missing-totp": "off",
    "stale-password": "off",
  },
};

export interface VaultLintConfig {
  extends?: LintPresetName;
  rules?: Partial<Record<LintRuleId, LintSeverity>>;
}

export interface LintFinding {
  ruleId: LintRuleId;
  severity: ActiveLintSeverity;
  category: LintCategory;
  message: string;
  itemIndex: number;
  itemId?: string;
  itemName: string;
  fixable: LintFixMode;
  fixDescription?: string;
}

export interface LintResult {
  ruleset: LintPresetName;
  effectiveRules: Record<LintRuleId, LintSeverity>;
  findings: LintFinding[];
  counts: {
    error: number;
    warning: number;
    hint: number;
    total: number;
    fixableSafe: number;
    fixableUnsafe: number;
  };
  byRule: Record<string, { severity: ActiveLintSeverity; count: number; fixable: LintFixMode }>;
}

export interface LintFixOptions {
  config?: VaultLintConfig;
  unsafe?: boolean;
  ruleIds?: LintRuleId[];
  dryRun?: boolean;
  passwordLength?: number;
}

export interface LintFixResult {
  appliedCount: number;
  fixedByRule: Partial<Record<LintRuleId, number>>;
  skippedUnsafeCount: number;
  lintBefore: LintResult;
  lintAfter: LintResult;
}

const PRIVATE_OR_LOCAL_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|.*\.local)$/i;
const SCHEMELESS_HOST_RE =
  /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i;
const STALE_PASSWORD_MS = 365 * 24 * 60 * 60 * 1000;

/** Resolve effective rule severities from a preset and optional per-rule overrides. */
export function resolveLintConfig(config?: VaultLintConfig): {
  ruleset: LintPresetName;
  rules: Record<LintRuleId, LintSeverity>;
} {
  const ruleset: LintPresetName = config?.extends ?? "recommended";
  if (!VALID_LINT_PRESETS.includes(ruleset)) {
    throw new Error(
      `Invalid lint ruleset "${String(ruleset)}". Valid presets: ${VALID_LINT_PRESETS.join(", ")}`,
    );
  }
  const base: Record<LintRuleId, LintSeverity> = { ...LINT_PRESETS[ruleset] };
  if (config?.rules) {
    for (const [rawId, sev] of Object.entries(config.rules)) {
      if (!LINT_RULE_MAP.has(rawId as LintRuleId)) {
        throw new Error(`Unknown lint rule "${rawId}".`);
      }
      if (!sev || !VALID_LINT_SEVERITIES.includes(sev)) {
        throw new Error(
          `Invalid severity "${String(sev)}" for rule "${rawId}". Valid: ${VALID_LINT_SEVERITIES.join(", ")}`,
        );
      }
      base[rawId as LintRuleId] = sev;
    }
  }
  return { ruleset, rules: base };
}

/** Parse a CLI `--rule <ruleId>=<severity>` override string. */
export function parseRuleOverride(spec: string): { ruleId: LintRuleId; severity: LintSeverity } {
  const eqIdx = spec.indexOf("=");
  if (eqIdx <= 0) {
    throw new Error(
      `Invalid --rule format "${spec}". Expected <rule-id>=<error|warning|hint|off>.`,
    );
  }
  const ruleId = spec.slice(0, eqIdx).trim();
  const severity = spec.slice(eqIdx + 1).trim() as LintSeverity;
  if (!LINT_RULE_MAP.has(ruleId as LintRuleId)) {
    throw new Error(`Unknown lint rule "${ruleId}".`);
  }
  if (!VALID_LINT_SEVERITIES.includes(severity)) {
    throw new Error(
      `Invalid severity "${severity}" for rule "${ruleId}". Valid: ${VALID_LINT_SEVERITIES.join(", ")}`,
    );
  }
  return { ruleId: ruleId as LintRuleId, severity };
}

/** Parse and validate a JSON lint config string (e.g. from `vaultlint.config.json`). */
export function parseLintConfigJson(raw: string): VaultLintConfig {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Lint config must be a JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  const config: VaultLintConfig = {};
  const rawExtends = obj["extends"];
  if (rawExtends !== undefined) {
    if (
      typeof rawExtends !== "string" ||
      !VALID_LINT_PRESETS.includes(rawExtends as LintPresetName)
    ) {
      throw new Error(
        `Invalid "extends" preset "${String(rawExtends)}". Valid: ${VALID_LINT_PRESETS.join(", ")}`,
      );
    }
    config.extends = rawExtends as LintPresetName;
  }
  const rawRules = obj["rules"];
  if (rawRules !== undefined) {
    if (!rawRules || typeof rawRules !== "object" || Array.isArray(rawRules)) {
      throw new Error('Lint config "rules" must be an object mapping rule IDs to severities.');
    }
    config.rules = rawRules as Partial<Record<LintRuleId, LintSeverity>>;
  }
  resolveLintConfig(config);
  return config;
}

function isLoginItem(item: VaultItem): boolean {
  return inferItemType(item) === 1;
}

function uriDuplicateKey(uri: VaultUri): string {
  const match = typeof uri === "string" ? null : (uri.match ?? null);
  return JSON.stringify([getUriString(uri).trim(), match]);
}

function hasPasskey(item: VaultItem): boolean {
  return Boolean(
    item.login?.fido ||
    (Array.isArray(item.login?.fido2Credentials) && item.login.fido2Credentials.length > 0),
  );
}

function isUriMalformed(str: string): boolean {
  if (!str) return false;
  if (str !== str.trim()) return true;
  if (str.startsWith("androidapp://") || str.startsWith("iosapp://")) {
    const prefix = str.startsWith("androidapp://") ? "androidapp://" : "iosapp://";
    return str.length <= prefix.length;
  }
  try {
    const parsed = new URL(str);
    return !parsed.hostname;
  } catch {
    return true;
  }
}

function isInsecureHttpUri(str: string): boolean {
  if (!str) return false;
  try {
    const parsed = new URL(str.trim());
    return parsed.protocol === "http:" && !PRIVATE_OR_LOCAL_HOST_RE.test(parsed.hostname);
  } catch {
    return false;
  }
}

function tryFixMalformedUri(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("androidapp://") || trimmed.startsWith("iosapp://")) {
    return trimmed !== raw && trimmed.length > "iosapp://".length ? trimmed : null;
  }
  let hasHost = false;
  try {
    hasHost = Boolean(new URL(trimmed).hostname);
  } catch {
    hasHost = false;
  }
  if (hasHost) return trimmed !== raw ? trimmed : null;
  // "example.com:8080" and "localhost:3000" parse as opaque schemes with no hostname.
  if (SCHEMELESS_HOST_RE.test(trimmed)) {
    const candidate = `https://${trimmed}`;
    try {
      if (new URL(candidate).hostname) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

function tryUpgradeHttpUri(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isInsecureHttpUri(trimmed)) return null;
  // An explicit :80 is http's default port; keeping it on https would point at the wrong port.
  return trimmed
    .replace(/^http:\/\/([^/?#@]*@)?([^/?#:@]+|\[[^\]]+\]):80(?=[/?#]|$)/i, "http://$1$2")
    .replace(/^http:\/\//i, "https://");
}

/** Run the rule-based linter on a vault and classify findings into error, warning, and hint. */
export function lintVault(
  vaultData: VaultData,
  config?: VaultLintConfig,
  nowMs: number = Date.now(),
): LintResult {
  const { ruleset, rules } = resolveLintConfig(config);
  const findings: LintFinding[] = [];

  const pushFinding = (
    ruleId: LintRuleId,
    item: VaultItem,
    itemIndex: number,
    message: string,
    /** Narrows the rule default when this particular finding cannot be autofixed. */
    canFix = true,
  ) => {
    const severity = rules[ruleId];
    if (severity === "off") return;
    const def = LINT_RULE_MAP.get(ruleId)!;
    findings.push({
      ruleId,
      severity,
      category: def.category,
      message,
      itemIndex,
      itemId: item.id,
      itemName: item.name || "(unnamed)",
      fixable: canFix ? def.fixable : false,
      fixDescription: canFix ? def.fixDescription : undefined,
    });
  };

  const folderIds = new Set((vaultData.folders ?? []).map((f) => f.id));

  // Reused passwords
  if (rules["reused-password"] !== "off") {
    const reusedGroups = findReusedPasswordGroupFindings(vaultData);
    for (const group of reusedGroups) {
      for (const entry of group.items) {
        pushFinding(
          "reused-password",
          entry.item,
          entry.index,
          `Password is reused across ${group.items.length} items.`,
        );
      }
    }
  }

  // Duplicate items
  if (rules["duplicate-items"] !== "off") {
    const dupGroups = groupDuplicatesByName(vaultData);
    for (const group of dupGroups) {
      for (const entry of group.items) {
        pushFinding(
          "duplicate-items",
          entry.item,
          entry.index,
          `Duplicate item "${entry.item.name}" (${group.items.length} entries in group).`,
        );
      }
    }
  }

  // Per-item rules
  vaultData.items.forEach((item, index) => {
    const pw = item.login?.password;
    const uris = item.login?.uris ?? [];
    const login = isLoginItem(item);

    if (rules["weak-password"] !== "off" && pw && isWeakPassword(pw)) {
      const reasons = getWeakPasswordReasons(pw);
      pushFinding("weak-password", item, index, `Weak password: ${reasons.join(", ")}.`);
    }

    if (rules["missing-item-name"] !== "off") {
      const trimmedName = (item.name ?? "").trim();
      if (!trimmedName || trimmedName.toLowerCase() === "untitled") {
        pushFinding("missing-item-name", item, index, "Item has an empty or placeholder name.");
      }
    }

    if (rules["empty-folder-ref"] !== "off" && item.folderId && !folderIds.has(item.folderId)) {
      pushFinding(
        "empty-folder-ref",
        item,
        index,
        `Item references missing folderId "${item.folderId}".`,
      );
    }

    // Whitespace check
    if (rules["whitespace-in-fields"] !== "off") {
      const issues: string[] = [];
      if (item.name && item.name !== item.name.trim()) issues.push("name");
      if (item.login?.username && item.login.username !== item.login.username.trim()) {
        issues.push("username");
      }
      if (
        uris.some((u) => {
          const s = getUriString(u);
          return s !== s.trim();
        })
      ) {
        issues.push("URI");
      }
      if (issues.length > 0) {
        pushFinding(
          "whitespace-in-fields",
          item,
          index,
          `Leading/trailing whitespace in ${issues.join(", ")}.`,
        );
      }
    }

    // URI rules
    const seenUris = new Set<string>();
    let hasDuplicateUri = false;
    for (const u of uris) {
      const str = getUriString(u);
      if (!str) continue;
      if (rules["malformed-uri"] !== "off" && isUriMalformed(str)) {
        pushFinding(
          "malformed-uri",
          item,
          index,
          `Malformed URI "${getSafeUriDisplayLabel(str)}".`,
          tryFixMalformedUri(str) !== null,
        );
      }
      if (rules["insecure-http-uri"] !== "off" && isInsecureHttpUri(str)) {
        pushFinding(
          "insecure-http-uri",
          item,
          index,
          `Insecure HTTP URI for "${getSafeUriDisplayLabel(str)}".`,
        );
      }
      const norm = uriDuplicateKey(u);
      if (seenUris.has(norm)) hasDuplicateUri = true;
      seenUris.add(norm);
    }
    if (rules["duplicate-uris"] !== "off" && hasDuplicateUri) {
      pushFinding("duplicate-uris", item, index, "Item contains duplicate URI entries.");
    }

    // Login-specific rules
    if (login) {
      if (rules["missing-password"] !== "off" && !pw && !hasPasskey(item)) {
        pushFinding("missing-password", item, index, "Login item has no password or passkey.");
      }
      if (rules["missing-uri"] !== "off" && uris.length === 0 && (pw || item.login?.username)) {
        pushFinding("missing-uri", item, index, "Login item has no URIs.");
      }
      if (rules["missing-username"] !== "off" && pw && !item.login?.username?.trim()) {
        pushFinding("missing-username", item, index, "Login item has a password but no username.");
      }
      if (rules["missing-totp"] !== "off" && pw && !item.login?.totp && !hasPasskey(item)) {
        pushFinding(
          "missing-totp",
          item,
          index,
          "Login item has no TOTP 2FA secret or FIDO2 passkey.",
        );
      }
      if (rules["stale-password"] !== "off" && pw) {
        const revStr = item["passwordRevisionDate"] ?? item.revisionDate;
        if (typeof revStr === "string") {
          const revMs = Date.parse(revStr);
          if (Number.isFinite(revMs) && nowMs - revMs > STALE_PASSWORD_MS) {
            const days = Math.floor((nowMs - revMs) / (24 * 60 * 60 * 1000));
            pushFinding(
              "stale-password",
              item,
              index,
              `Password has not been rotated in ${days} days.`,
            );
          }
        }
      }
    }
  });

  const severityOrder: Record<ActiveLintSeverity, number> = { error: 0, warning: 1, hint: 2 };
  findings.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.itemIndex - b.itemIndex ||
      a.ruleId.localeCompare(b.ruleId),
  );

  const counts = {
    error: 0,
    warning: 0,
    hint: 0,
    total: findings.length,
    fixableSafe: 0,
    fixableUnsafe: 0,
  };
  const byRule: LintResult["byRule"] = {};

  for (const f of findings) {
    counts[f.severity]++;
    if (f.fixable === "safe") counts.fixableSafe++;
    else if (f.fixable === "unsafe") counts.fixableUnsafe++;

    if (!byRule[f.ruleId]) {
      byRule[f.ruleId] = {
        severity: f.severity,
        count: 0,
        fixable: LINT_RULE_MAP.get(f.ruleId)!.fixable,
      };
    }
    byRule[f.ruleId].count++;
  }

  return { ruleset, effectiveRules: rules, findings, counts, byRule };
}

/**
 * Automatically fix lint findings in `vaultData`. By default, only applies `"safe"` fixes
 * (whitespace, schemeless URIs, HTTP->HTTPS, duplicate URIs, dangling folder references). Pass
 * `unsafe: true` to also apply `"unsafe"` fixes (weak/reused password regeneration, duplicate item
 * merging).
 */
export function applyLintFixes(vaultData: VaultData, options: LintFixOptions = {}): LintFixResult {
  const targetVault = options.dryRun ? structuredClone(vaultData) : vaultData;
  const lintBefore = lintVault(targetVault, options.config);
  const { rules } = resolveLintConfig(options.config);
  const allowUnsafe = Boolean(options.unsafe);
  const allowedRules = options.ruleIds ? new Set(options.ruleIds) : null;
  const pwLength = options.passwordLength ?? 16;

  const isRuleEnabledAndAllowed = (id: LintRuleId): boolean => {
    if (rules[id] === "off") return false;
    if (allowedRules && !allowedRules.has(id)) return false;
    const def = LINT_RULE_MAP.get(id)!;
    if (!def.fixable) return false;
    if (def.fixable === "unsafe" && !allowUnsafe) return false;
    return true;
  };

  const fixedByRule: Partial<Record<LintRuleId, number>> = {};
  const recordFix = (id: LintRuleId, count: number) => {
    if (count > 0) fixedByRule[id] = (fixedByRule[id] ?? 0) + count;
  };

  const folderIds = new Set((targetVault.folders ?? []).map((f) => f.id));

  // 1. Safe per-item fixes
  for (const item of targetVault.items) {
    if (isRuleEnabledAndAllowed("whitespace-in-fields")) {
      let trimmedAny = false;
      if (item.name && item.name !== item.name.trim()) {
        item.name = item.name.trim();
        trimmedAny = true;
      }
      if (item.login?.username && item.login.username !== item.login.username.trim()) {
        item.login.username = item.login.username.trim();
        trimmedAny = true;
      }
      if (item.login?.uris) {
        item.login.uris = item.login.uris.map((u) => {
          const s = getUriString(u);
          if (s !== s.trim()) {
            trimmedAny = true;
            return withUpdatedUri(u, s.trim());
          }
          return u;
        });
      }
      if (trimmedAny) recordFix("whitespace-in-fields", 1);
    }

    if (
      isRuleEnabledAndAllowed("empty-folder-ref") &&
      item.folderId &&
      !folderIds.has(item.folderId)
    ) {
      item.folderId = null;
      recordFix("empty-folder-ref", 1);
    }

    if (isRuleEnabledAndAllowed("malformed-uri") && item.login?.uris) {
      let fixedUris = 0;
      item.login.uris = item.login.uris.map((u) => {
        const s = getUriString(u);
        const fixed = tryFixMalformedUri(s);
        if (fixed) {
          fixedUris++;
          return withUpdatedUri(u, fixed);
        }
        return u;
      });
      recordFix("malformed-uri", fixedUris);
    }

    if (isRuleEnabledAndAllowed("insecure-http-uri") && item.login?.uris) {
      let upgradedUris = 0;
      item.login.uris = item.login.uris.map((u) => {
        const s = getUriString(u);
        const upgraded = tryUpgradeHttpUri(s);
        if (upgraded) {
          upgradedUris++;
          return withUpdatedUri(u, upgraded);
        }
        return u;
      });
      recordFix("insecure-http-uri", upgradedUris);
    }

    if (
      isRuleEnabledAndAllowed("duplicate-uris") &&
      item.login?.uris &&
      item.login.uris.length > 1
    ) {
      const seen = new Set<string>();
      const deduped = item.login.uris.filter((u) => {
        const key = uriDuplicateKey(u);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (deduped.length < item.login.uris.length) {
        item.login.uris = deduped;
        recordFix("duplicate-uris", 1);
      }
    }
  }

  // 2. Unsafe fixes (explicit opt-in)
  if (isRuleEnabledAndAllowed("duplicate-items")) {
    const mergedCount = mergeAllDuplicateGroups(targetVault);
    recordFix("duplicate-items", mergedCount);
  }
  if (isRuleEnabledAndAllowed("weak-password")) {
    recordFix("weak-password", regenerateWeakPasswordsInVault(targetVault, pwLength));
  }
  if (isRuleEnabledAndAllowed("reused-password")) {
    recordFix("reused-password", regenerateReusedPasswordsInVault(targetVault, pwLength));
  }

  const appliedCount = Object.values(fixedByRule).reduce((sum, n) => sum + (n ?? 0), 0);
  const lintAfter = lintVault(targetVault, options.config);
  const skippedUnsafeCount = allowUnsafe ? 0 : lintBefore.counts.fixableUnsafe;

  return {
    appliedCount,
    fixedByRule,
    skippedUnsafeCount,
    lintBefore,
    lintAfter,
  };
}

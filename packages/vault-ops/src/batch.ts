import {
  extractDomainParts,
  getUriString,
  withUpdatedUri,
  type VaultData,
  type VaultItem,
} from "@vaultlint/vault-schema";

export type BatchEditTargetMode = "all" | "non-empty" | "empty" | "clear";

export interface BatchEditPreviewMatch {
  label: string;
  before: string;
  after: string;
}

/**
 * Expand batch-edit template variables (`{{name}}`, `{{username}}`, `{{hostname}}`,
 * `{{domain.tld}}`, `{{sub.domain.tld}}`) using the item's metadata and optional current URI.
 */
export function expandBatchVariables(
  template: string,
  item: VaultItem,
  currentUri?: string,
): string {
  if (!template.includes("{{")) return template;
  const fallbackUri = currentUri ?? getUriString(item.login?.uris?.[0]);
  const { hostname, domainTld, subDomain } = extractDomainParts(fallbackUri);
  const values: Record<string, string> = {
    "{{name}}": item.name ?? "",
    "{{username}}": item.login?.username ?? "",
    "{{hostname}}": hostname,
    "{{domain.tld}}": domainTld,
    "{{sub.domain.tld}}": subDomain,
  };
  // Single pass so substituted values (e.g. a name containing "{{username}}") are never re-expanded.
  return template.replace(
    /\{\{(?:name|username|hostname|domain\.tld|sub\.domain\.tld)\}\}/g,
    (token) => values[token],
  );
}

/** Expand template values while keeping `$` sequences literal in the replacement text. */
function expandBatchReplacement(template: string, item: VaultItem, currentUri?: string): string {
  if (!template.includes("{{")) return template;
  const fallbackUri = currentUri ?? getUriString(item.login?.uris?.[0]);
  const { hostname, domainTld, subDomain } = extractDomainParts(fallbackUri);
  const values: Record<string, string> = {
    "{{name}}": item.name ?? "",
    "{{username}}": item.login?.username ?? "",
    "{{hostname}}": hostname,
    "{{domain.tld}}": domainTld,
    "{{sub.domain.tld}}": subDomain,
  };
  return template.replace(
    /\{\{(?:name|username|hostname|domain\.tld|sub\.domain\.tld)\}\}/g,
    (token) => values[token].replaceAll("$", () => "$$"),
  );
}

/**
 * Compute the next value for a batch-edited field according to `targetMode`, or `null` if the field
 * should not be modified.
 */
export function computeBatchFieldValue(
  current: string,
  regex: RegExp,
  replacement: string,
  item: VaultItem,
  targetMode: BatchEditTargetMode = "all",
  currentUri?: string,
): string | null {
  const isEmpty = current.trim().length === 0;
  if (targetMode === "empty" && !isEmpty) return null;
  if (targetMode === "non-empty" && isEmpty) return null;

  if (targetMode === "clear") {
    if (current.length === 0) return null;
    regex.lastIndex = 0;
    if (!regex.test(current)) return null;
    return "";
  }

  if (targetMode === "empty") {
    regex.lastIndex = 0;
    if (!regex.test(current)) return null;
    const expanded = expandBatchVariables(replacement, item, currentUri);
    return expanded !== current ? expanded : null;
  }

  const expanded = expandBatchReplacement(replacement, item, currentUri);
  regex.lastIndex = 0;
  const next = current.replace(regex, expanded);
  return next !== current ? next : null;
}

/** Preview regex-based batch edits across a vault without mutating it. */
export function previewBatchEditOnVault(
  vaultData: VaultData,
  field: string,
  pattern: string,
  replacement: string,
  targetMode: BatchEditTargetMode = "all",
): BatchEditPreviewMatch[] {
  const effectivePattern =
    pattern || (targetMode === "empty" || targetMode === "clear" ? ".*" : "");
  if (!effectivePattern) return [];
  const regex = new RegExp(effectivePattern, "g");
  const matches: BatchEditPreviewMatch[] = [];

  for (const item of vaultData.items) {
    const label = item.name || item.id || "Item";
    if (field === "name") {
      const cur = typeof item.name === "string" ? item.name : "";
      const after = computeBatchFieldValue(cur, regex, replacement, item, targetMode);
      if (after !== null) matches.push({ label, before: cur, after });
    } else if (field === "username" && item.login) {
      const cur = typeof item.login.username === "string" ? item.login.username : "";
      const after = computeBatchFieldValue(cur, regex, replacement, item, targetMode);
      if (after !== null) matches.push({ label, before: cur, after });
    } else if (field === "notes") {
      const cur = typeof item.notes === "string" ? item.notes : "";
      const after = computeBatchFieldValue(cur, regex, replacement, item, targetMode);
      if (after !== null) matches.push({ label, before: cur, after });
    } else if (field === "uri" && item.login?.uris) {
      for (const u of item.login.uris) {
        const cur = getUriString(u);
        const after = computeBatchFieldValue(cur, regex, replacement, item, targetMode, cur);
        if (after !== null) matches.push({ label, before: cur, after });
      }
    }
  }
  return matches;
}

/** Apply regex-based batch edits to `vaultData` in-place. Returns number of modifications. */
export function applyBatchEditToVault(
  vaultData: VaultData,
  field: string,
  pattern: string,
  replacement: string,
  targetMode: BatchEditTargetMode = "all",
): number {
  const effectivePattern =
    pattern || (targetMode === "empty" || targetMode === "clear" ? ".*" : "");
  if (!effectivePattern) return 0;
  const regex = new RegExp(effectivePattern, "g");
  let count = 0;

  for (const item of vaultData.items) {
    if (field === "name") {
      const cur = typeof item.name === "string" ? item.name : "";
      const updated = computeBatchFieldValue(cur, regex, replacement, item, targetMode);
      if (updated !== null) {
        item.name = updated;
        count++;
      }
    } else if (field === "username" && item.login) {
      const cur = typeof item.login.username === "string" ? item.login.username : "";
      const updated = computeBatchFieldValue(cur, regex, replacement, item, targetMode);
      if (updated !== null) {
        item.login.username = updated;
        count++;
      }
    } else if (field === "notes") {
      const cur = typeof item.notes === "string" ? item.notes : "";
      const updated = computeBatchFieldValue(cur, regex, replacement, item, targetMode);
      if (updated !== null) {
        item.notes = updated;
        count++;
      }
    } else if (field === "uri" && item.login?.uris) {
      item.login.uris = item.login.uris.map((u) => {
        const cur = getUriString(u);
        const updated = computeBatchFieldValue(cur, regex, replacement, item, targetMode, cur);
        if (updated !== null) {
          count++;
          return withUpdatedUri(u, updated);
        }
        return u;
      });
    }
  }
  return count;
}

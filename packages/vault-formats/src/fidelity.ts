import type { VaultData, VaultItem } from "@vaultlint/vault-schema";

import { exportVault, parseVaultAsync, VAULT_FORMATS } from "./registry";
import type { ExportVaultOptions, VaultFormatId } from "./types";

export interface RoundTripFieldChange {
  /** Canonical schema path only; values are never returned. */
  field: string;
  affectedItems: number;
  missingAfterRoundTrip: number;
  changedAfterRoundTrip: number;
}

export interface VaultRoundTripReport {
  format: VaultFormatId;
  formatName: string;
  status: "complete";
  sourceItemCount: number;
  returnedItemCount: number;
  missingItemCount: number;
  addedItemCount: number;
  changedItemCount: number;
  unchangedItemCount: number;
  fieldChanges: RoundTripFieldChange[];
  warnings: string[];
  /** Fields checked by structural comparison. This intentionally contains labels, never values. */
  checkedFields: string[];
}

export interface FormatConformanceEntry {
  id: VaultFormatId;
  name: string;
  provider: string;
  extensions: readonly string[];
  canImport: true;
  canExport: true;
  canInspectRoundTrip: true;
  roundTripCheckFields: string[];
}

const ROUND_TRIP_FIELDS = [
  "id",
  "name",
  "type",
  "folderId",
  "collectionIds",
  "favorite",
  "reprompt",
  "notes",
  "creationDate",
  "deletedDate",
  "lastModified",
  "revisionDate",
  "passwordHistory",
  "secureNote",
  "login.username",
  "login.password",
  "login.uris",
  "login.totp",
  "login.fido",
  "login.fido2Credentials",
  "card",
  "identity",
  "fields",
  "providerData",
] as const;

function hasContent(value: unknown): boolean {
  // `false`/`0` are the defaults for favorite/reprompt; adapters that cannot store them return
  // `false`/undefined interchangeably, which is not data loss.
  if (value === undefined || value === null || value === "" || value === false || value === 0) {
    return false;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function readPath(item: VaultItem, path: string): unknown {
  if (path === "providerData") return item._providerData;
  let value: unknown = item;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

const DATE_FIELDS = new Set(["creationDate", "deletedDate", "lastModified", "revisionDate"]);

/** Canonicalize values whose representation legitimately differs between formats. */
function comparable(field: string, value: unknown): unknown {
  if (field === "login.uris" && Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === "string") return { uri: entry };
      const { uri, match } = (entry ?? {}) as { uri?: unknown; match?: unknown };
      return match === undefined || match === null ? { uri } : { uri, match };
    });
  }
  if (DATE_FIELDS.has(field) && typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : new Date(ms).toISOString();
  }
  return value;
}

function itemIdentities(item: VaultItem): string[] {
  const keys: string[] = [];
  if (item.id) keys.push(`id:${item.id}`);
  const username = item.login?.username?.trim().toLowerCase() ?? "";
  const name = item.name?.trim().toLowerCase() ?? "";
  const uri = item.login?.uris?.[0];
  const uriValue = typeof uri === "string" ? uri : (uri?.uri ?? "");
  const identity = [name, username, uriValue.trim().toLowerCase()].join("\u0000");
  if (name && (username || uriValue.trim())) keys.push(`content:${identity}`);
  return keys;
}

function pairItems(source: VaultItem[], returned: VaultItem[]): Array<[number, number]> {
  const outputByIdentity = new Map<string, number[]>();
  returned.forEach((item, index) => {
    for (const key of itemIdentities(item)) {
      outputByIdentity.set(key, [...(outputByIdentity.get(key) ?? []), index]);
    }
  });
  const consumed = new Set<number>();
  const pairs: Array<[number, number]> = [];
  source.forEach((item, index) => {
    const exact = itemIdentities(item)
      .map((key) => outputByIdentity.get(key)?.find((candidate) => !consumed.has(candidate)))
      .find((candidate) => candidate !== undefined);
    const fallback =
      exact === undefined && source.length === returned.length && !consumed.has(index)
        ? index
        : undefined;
    const returnedIndex = exact ?? fallback;
    if (returnedIndex !== undefined) {
      consumed.add(returnedIndex);
      pairs.push([index, returnedIndex]);
    }
  });
  return pairs;
}

/**
 * Export and parse a vault in the target format, then compare canonical values in memory. The
 * returned report contains field names and counts only, never item or credential values.
 */
export async function inspectVaultRoundTrip(
  vault: VaultData,
  format: VaultFormatId,
  options?: ExportVaultOptions,
): Promise<VaultRoundTripReport> {
  const exported = exportVault(vault, format, options);
  const parsed = await parseVaultAsync(exported.content, {
    format,
    fileName: `roundtrip.${exported.extension}`,
  });
  const returned = parsed.vault.items;
  const pairs = pairItems(vault.items, returned);
  const pairedSource = new Set(pairs.map(([sourceIndex]) => sourceIndex));
  const pairedOutput = new Set(pairs.map(([, outputIndex]) => outputIndex));
  const counts = new Map<string, { affected: Set<number>; missing: number; changed: number }>();
  const changedItems = new Set<number>();
  const unchangedItems = new Set<number>();

  for (const [sourceIndex, outputIndex] of pairs) {
    const sourceItem = vault.items[sourceIndex];
    const returnedItem = returned[outputIndex];
    let itemChanged = false;
    for (const field of ROUND_TRIP_FIELDS) {
      const before = readPath(sourceItem, field);
      if (!hasContent(before)) continue;
      const after = readPath(returnedItem, field);
      if (
        hasContent(after) &&
        stableJson(comparable(field, before)) === stableJson(comparable(field, after))
      ) {
        continue;
      }
      const entry = counts.get(field) ?? { affected: new Set<number>(), missing: 0, changed: 0 };
      entry.affected.add(sourceIndex);
      if (!hasContent(after)) entry.missing++;
      else entry.changed++;
      counts.set(field, entry);
      itemChanged = true;
    }
    (itemChanged ? changedItems : unchangedItems).add(sourceIndex);
  }

  for (let index = 0; index < vault.items.length; index++) {
    if (!pairedSource.has(index)) changedItems.add(index);
  }

  const fieldChanges = [...counts.entries()]
    .map(([field, count]) => ({
      field,
      affectedItems: count.affected.size,
      missingAfterRoundTrip: count.missing,
      changedAfterRoundTrip: count.changed,
    }))
    .sort(
      (left, right) =>
        right.affectedItems - left.affectedItems || left.field.localeCompare(right.field),
    );

  const info = VAULT_FORMATS.find((entry) => entry.id === format)!;
  return {
    format,
    formatName: info.name,
    status: "complete",
    sourceItemCount: vault.items.length,
    returnedItemCount: returned.length,
    missingItemCount: Math.max(0, vault.items.length - pairedSource.size),
    addedItemCount: Math.max(0, returned.length - pairedOutput.size),
    changedItemCount: changedItems.size,
    unchangedItemCount: unchangedItems.size,
    fieldChanges,
    warnings: exported.warnings,
    checkedFields: [...ROUND_TRIP_FIELDS],
  };
}

/** Metadata describing the registered import/export and in-memory round-trip capabilities. */
export function getFormatConformanceMatrix(): FormatConformanceEntry[] {
  return VAULT_FORMATS.map((format) => ({
    id: format.id,
    name: format.name,
    provider: format.provider,
    extensions: format.extensions,
    canImport: true,
    canExport: true,
    canInspectRoundTrip: true,
    roundTripCheckFields: [...ROUND_TRIP_FIELDS],
  }));
}

/** Returns registered source/target pairs available through the canonical schema. */
export function getFormatPairCoverage(): Array<{ source: VaultFormatId; target: VaultFormatId }> {
  return VAULT_FORMATS.flatMap((source) =>
    VAULT_FORMATS.map((target) => ({ source: source.id, target: target.id })),
  );
}

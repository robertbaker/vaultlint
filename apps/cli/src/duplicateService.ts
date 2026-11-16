import { type DuplicateConflictSummary, analyzeDuplicateGroup } from "@vaultlint/vault-ops";
import {
  type VaultData,
  type VaultItem,
  type VaultUri,
  getUriString,
  inferItemType,
} from "@vaultlint/vault-schema";

/** Find duplicate entries in the vault by normalized item name. */
export function findDuplicates(vaultData: VaultData): VaultItem[] {
  const duplicates: VaultItem[] = [];
  const seen = new Map<string, VaultItem>();

  for (const item of vaultData.items) {
    const name = item.name?.trim().toLowerCase();
    if (name) {
      const key = JSON.stringify([inferItemType(item), name]);
      if (seen.has(key)) {
        duplicates.push(item);
      } else {
        seen.set(key, item);
      }
    }
  }

  return duplicates;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mergeUniqueValues<T>(primary: T[] | undefined, dup: T[] | undefined): T[] | undefined {
  if (!dup?.length) return primary;
  const merged = [...(primary ?? [])];
  const seen = new Set(merged.map((value) => JSON.stringify(value)));
  for (const value of dup) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(structuredClone(value));
  }
  return merged;
}

function mergeMissingFields<T extends object>(
  primary: T | undefined,
  dup: T | undefined,
): T | undefined {
  if (!dup) return primary;
  if (!primary) return structuredClone(dup);
  const merged = { ...primary } as Record<string, unknown>;
  for (const [key, value] of Object.entries(dup)) {
    if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
      merged[key] = structuredClone(value);
    }
  }
  return merged as T;
}

/** Merge two duplicate entries into existingItem. */
function mergeEntries(existingItem: VaultItem, newItem: VaultItem): void {
  const existingMs = parseTimestamp(existingItem.lastModified ?? existingItem.revisionDate);
  const newMs = parseTimestamp(newItem.lastModified ?? newItem.revisionDate);
  const newIsNewer = newMs !== null && (existingMs === null || newMs > existingMs);

  const existingUris = existingItem.login?.uris ?? [];
  const newUris = newItem.login?.uris ?? [];
  const combinedRaw = [...existingUris, ...newUris];

  const prefersObjectUris = combinedRaw.some(
    (u) => typeof u === "object" && u !== null && "uri" in u,
  );

  const seenUris = new Set<string>();
  const mergedUris: VaultUri[] = [];

  for (const entry of combinedRaw) {
    const rawStr = getUriString(entry);
    const match = typeof entry === "object" && entry !== null ? entry.match : undefined;
    const uriKey = `${rawStr}\u0000${match ?? ""}`;
    if (!rawStr || seenUris.has(uriKey)) continue;
    seenUris.add(uriKey);

    if (prefersObjectUris) {
      if (typeof entry === "object" && entry !== null) {
        mergedUris.push({ ...entry, uri: rawStr });
      } else {
        mergedUris.push({ uri: rawStr });
      }
    } else {
      mergedUris.push(rawStr);
    }
  }

  if (mergedUris.length > 0) {
    existingItem.login = existingItem.login ?? {};
    existingItem.login.uris = mergedUris;
  }

  // Merge login credentials safely
  if (newItem.login) {
    existingItem.login = existingItem.login ?? {};
    if (newItem.login.username && (!existingItem.login.username || newIsNewer)) {
      existingItem.login.username = newItem.login.username;
    }
    if (newItem.login.password) {
      const history = existingItem.passwordHistory ?? [];
      const historyKeys = new Set(
        history.map((entry) => JSON.stringify([entry.password, entry.lastUsedDate])),
      );
      const addToHistory = (password: string, lastUsedDate: string | null) => {
        const key = JSON.stringify([password, lastUsedDate]);
        if (password && !historyKeys.has(key)) {
          historyKeys.add(key);
          history.push({ password, lastUsedDate });
        }
      };
      if (!existingItem.login.password) {
        existingItem.login.password = newItem.login.password;
      } else if (existingItem.login.password !== newItem.login.password) {
        if (newIsNewer) {
          addToHistory(
            existingItem.login.password,
            existingItem.lastModified ?? existingItem.revisionDate ?? null,
          );
          existingItem.login.password = newItem.login.password;
        } else {
          addToHistory(
            newItem.login.password,
            newItem.lastModified ?? newItem.revisionDate ?? null,
          );
        }
      }
      if (history.length) existingItem.passwordHistory = history;
    }
    if (newItem.login.fido && (!existingItem.login.fido || newIsNewer)) {
      existingItem.login.fido = newItem.login.fido;
    }
    if (newItem.login.totp && (!existingItem.login.totp || newIsNewer)) {
      existingItem.login.totp = newItem.login.totp;
    }
    if (newItem.login.fido2Credentials?.length) {
      const existing = existingItem.login.fido2Credentials ?? [];
      const keys = new Set(
        existing.map((credential) => credential.credentialId ?? JSON.stringify(credential)),
      );
      const added = newItem.login.fido2Credentials.filter(
        (credential) => !keys.has(credential.credentialId ?? JSON.stringify(credential)),
      );
      if (added.length)
        existingItem.login.fido2Credentials = [...existing, ...structuredClone(added)];
    }
  }

  // Update lastModified only when at least one valid timestamp exists
  if (existingMs !== null || newMs !== null) {
    const latestMs = Math.max(existingMs ?? 0, newMs ?? 0);
    existingItem.lastModified = new Date(latestMs).toISOString();
  }

  if (newItem.notes) {
    if (!existingItem.notes) existingItem.notes = newItem.notes;
    else if (!existingItem.notes.includes(newItem.notes)) {
      existingItem.notes = `${existingItem.notes}\n\n${newItem.notes}`;
    }
  }

  if (newItem.passwordHistory?.length) {
    existingItem.passwordHistory = mergeUniqueValues(
      existingItem.passwordHistory,
      newItem.passwordHistory,
    );
  }
  if (newItem.fields?.length) {
    const existing = existingItem.fields ?? [];
    const keys = new Set(existing.map((field) => JSON.stringify([field.name, field.value])));
    const added = newItem.fields.filter(
      (field) => !keys.has(JSON.stringify([field.name, field.value])),
    );
    if (added.length) existingItem.fields = [...existing, ...structuredClone(added)];
  }
  existingItem.card = mergeMissingFields(existingItem.card, newItem.card);
  existingItem.identity = mergeMissingFields(existingItem.identity, newItem.identity);
  if (newItem.secureNote && !existingItem.secureNote) {
    existingItem.secureNote = structuredClone(newItem.secureNote);
  }
  if (!existingItem.folderId && newItem.folderId) existingItem.folderId = newItem.folderId;
  if (newItem.collectionIds?.length) {
    existingItem.collectionIds = [
      ...new Set([...(existingItem.collectionIds ?? []), ...newItem.collectionIds]),
    ];
  }

  if (newItem.favorite !== undefined) {
    existingItem.favorite = Boolean(existingItem.favorite || newItem.favorite);
  }
}

/** Detects and merges duplicate entries in the vault. Returns the number of duplicates merged. */
export async function findAndMergeDuplicates(vaultData: VaultData): Promise<number> {
  const uniqueItems = new Map<string | symbol, VaultItem>();
  let mergedCount = 0;

  vaultData.items.forEach((item, index) => {
    const rawName = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
    // Keep unnamed items distinct instead of collapsing them all under ""
    const key: string | symbol = rawName
      ? JSON.stringify([inferItemType(item), rawName])
      : Symbol(`unnamed-${item.id ?? index}`);
    const existingItem = uniqueItems.get(key);

    if (existingItem) {
      try {
        mergeEntries(existingItem, item);
        mergedCount++;
      } catch (error) {
        console.error(`Error merging entry for ${item.name ?? String(key)}:`, error);
        uniqueItems.set(Symbol(`unmerged-${item.id ?? index}`), item);
      }
    } else {
      uniqueItems.set(key, item);
    }
  });

  vaultData.items = [...uniqueItems.values()];
  return mergedCount;
}

/** Run duplicate detection and merge duplicates. */
export async function runDuplicateDetection(vaultData: VaultData): Promise<number> {
  console.log("Running duplicate detection...");
  const mergedCount = await findAndMergeDuplicates(vaultData);
  console.log(`Duplicate detection complete. Merged ${mergedCount} duplicate(s).`);
  return mergedCount;
}

/** Merge duplicate entries in-place. */
export function mergeDuplicates(vaultData: VaultData): number {
  const firstByName = new Map<string, VaultItem>();
  const retained: VaultItem[] = [];
  let mergedCount = 0;

  for (const item of vaultData.items) {
    const name = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
    if (!name) {
      // Unnamed items stay distinct, matching findAndMergeDuplicates.
      retained.push(item);
      continue;
    }

    const key = JSON.stringify([inferItemType(item), name]);
    const original = firstByName.get(key);
    if (original) {
      mergeEntries(original, item);
      mergedCount++;
    } else {
      firstByName.set(key, item);
      retained.push(item);
    }
  }

  vaultData.items = retained;
  console.log(`${mergedCount} duplicate entries merged.`);
  return mergedCount;
}

export interface DuplicateGroup {
  key: string;
  name: string;
  items: VaultItem[];
  conflicts: DuplicateConflictSummary;
}

/** Group duplicate vault items by normalized item name (only groups with 2+ items). */
export function findDuplicateGroups(vaultData: VaultData): DuplicateGroup[] {
  const groups = new Map<string, VaultItem[]>();

  for (const item of vaultData.items) {
    const name = item.name?.trim().toLowerCase();
    if (!name) continue;
    // Same identity the merge uses (item type + normalized name) so reports match what merging does.
    const key = JSON.stringify([inferItemType(item), name]);
    const list = groups.get(key);
    if (list) {
      list.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  const result: DuplicateGroup[] = [];
  for (const [key, items] of groups.entries()) {
    if (items.length > 1) {
      result.push({
        key,
        name: items[0].name?.trim() || key,
        items,
        conflicts: analyzeDuplicateGroup(items),
      });
    }
  }
  return result;
}

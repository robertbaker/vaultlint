import {
  buildVaultItemRefs,
  extractDomainParts,
  getUriString,
  inferItemType,
  type VaultData,
  type VaultItem,
} from "@vaultlint/vault-schema";

export interface DuplicateConflictSummary {
  hasDifferentUsernames: boolean;
  hasDifferentPasswords: boolean;
  hasDifferentSubdomains: boolean;
  distinctUsernames: string[];
  distinctHostnames: string[];
}

export interface VaultDuplicateGroup {
  /** Normalized (trimmed, lower-cased) item name. Not unique across item types. */
  key: string;
  /** Unique group identity: item type + normalized name. Use for list tracking. */
  groupKey?: string;
  /** Provider item category shared by every item in the group. */
  type?: number;
  name: string;
  items: Array<{ item: VaultItem; index: number }>;
  uris: string[];
  conflicts: DuplicateConflictSummary;
}

/** Analyze a group of duplicate items for account or subdomain differences before merging. */
export function analyzeDuplicateGroup(items: readonly VaultItem[]): DuplicateConflictSummary {
  const usernames = new Set<string>();
  const passwords = new Set<string>();
  const hostnames = new Set<string>();
  const baseDomains = new Set<string>();

  for (const item of items) {
    const username = item.login?.username?.trim();
    if (username) usernames.add(username);

    const password = item.login?.password;
    if (password) passwords.add(password);

    for (const entry of item.login?.uris ?? []) {
      const uri = getUriString(entry);
      const { hostname, domainTld } = extractDomainParts(uri);
      if (hostname) hostnames.add(hostname);
      if (domainTld) baseDomains.add(domainTld);
    }
  }

  return {
    hasDifferentUsernames: usernames.size > 1,
    hasDifferentPasswords: passwords.size > 1,
    hasDifferentSubdomains: baseDomains.size === 1 && hostnames.size > 1,
    distinctUsernames: [...usernames],
    distinctHostnames: [...hostnames],
  };
}

const getMergeType = inferItemType;

function toVaultDuplicateGroup(
  key: string,
  name: string,
  entries: Array<{ item: VaultItem; index: number }>,
): VaultDuplicateGroup {
  const uris = [
    ...new Set(
      entries.flatMap((e) => (e.item.login?.uris ?? []).map(getUriString)).filter(Boolean),
    ),
  ];
  return {
    key,
    name,
    items: entries,
    uris,
    conflicts: analyzeDuplicateGroup(entries.map((e) => e.item)),
  };
}

/** Normalized item name used for duplicate detection (empty when unnamed). */
function normalizedName(item: VaultItem): string {
  return (item.name || "").trim().toLowerCase();
}

/**
 * Single source of truth for duplicate grouping: items sharing item type AND normalized name. Used
 * by both detection (`groupDuplicatesByName`) and auto-fix (`mergeAllDuplicateGroups`). Only groups
 * with 2+ items are returned, in first-seen order.
 */
function collectDuplicateEntries(
  vaultData: VaultData,
): Array<{ type: number; name: string; entries: Array<{ item: VaultItem; index: number }> }> {
  const groups = new Map<
    string,
    { type: number; name: string; entries: Array<{ item: VaultItem; index: number }> }
  >();
  vaultData.items.forEach((item, index) => {
    const name = normalizedName(item);
    if (!name) return;
    const type = getMergeType(item);
    const key = JSON.stringify([type, name]);
    const group = groups.get(key) ?? { type, name, entries: [] };
    group.entries.push({ item, index });
    groups.set(key, group);
  });
  return [...groups.values()].filter((g) => g.entries.length >= 2);
}

/** Group duplicate vault items by item type + normalized name (only groups with 2+ items). */
export function groupDuplicatesByName(vaultData: VaultData): VaultDuplicateGroup[] {
  return collectDuplicateEntries(vaultData).map(({ type, name, entries }) => ({
    ...toVaultDuplicateGroup(name, entries[0].item.name || name, entries),
    groupKey: JSON.stringify([type, name]),
    type,
  }));
}

/**
 * Resolve a list of item IDs (matching `item.id || String(index)`) into a `VaultDuplicateGroup`
 * with full local conflict analysis. Returns `null` if fewer than 2 items resolve.
 */
export function buildDuplicateGroupFromIds(
  vaultData: VaultData,
  itemIds: readonly string[],
  suggestedName: string,
  key: string,
): VaultDuplicateGroup | null {
  const idSet = new Set(itemIds);
  const refs = buildVaultItemRefs(vaultData);
  const persistentIds = new Set(vaultData.items.flatMap((item) => (item.id ? [item.id] : [])));
  const entries: Array<{ item: VaultItem; index: number }> = [];
  vaultData.items.forEach((item, index) => {
    if (
      idSet.has(refs[index]) ||
      (!item.id && idSet.has(String(index)) && !persistentIds.has(String(index)))
    ) {
      entries.push({ item, index });
    }
  });
  if (entries.length < 2) return null;
  return toVaultDuplicateGroup(key, suggestedName || entries[0].item.name || key, entries);
}

function mergeIntoPrimary(primary: VaultItem, dup: VaultItem): void {
  const primaryMs = new Date(primary.lastModified ?? primary.revisionDate ?? 0).getTime() || 0;
  const dupMs = new Date(dup.lastModified ?? dup.revisionDate ?? 0).getTime() || 0;
  const dupNewer = dupMs > primaryMs;

  // Work on a detached login so notes/cards/identities are not given an empty `login` object.
  const login = primary.login ?? {};
  const allUris = [...(login.uris ?? []), ...(dup.login?.uris ?? [])];
  const seen = new Set<string>();
  const mergedUris: NonNullable<typeof login.uris> = [];
  for (const u of allUris) {
    const str = getUriString(u);
    const match = typeof u === "object" && u !== null ? u.match : undefined;
    const uriKey = `${str}\u0000${match ?? ""}`;
    if (!str || seen.has(uriKey)) continue;
    seen.add(uriKey);
    mergedUris.push(typeof u === "string" ? { uri: str } : u);
  }

  if (dup.login?.username && (!login.username || dupNewer)) {
    login.username = dup.login.username;
  }
  const history = [...(primary.passwordHistory ?? [])];
  const historyKey = (entry: { password: string; lastUsedDate: string | null }) =>
    JSON.stringify([entry.password, entry.lastUsedDate]);
  const historySeen = new Set(history.map(historyKey));
  const pushHistory = (entry: { password: string; lastUsedDate: string | null }) => {
    if (!entry.password || historySeen.has(historyKey(entry))) return;
    historySeen.add(historyKey(entry));
    history.push(entry);
  };
  if (dup.login?.password) {
    if (!login.password) {
      login.password = dup.login.password;
    } else if (login.password !== dup.login.password) {
      // Keep the losing password in history rather than silently discarding it.
      if (dupNewer) {
        pushHistory({
          password: login.password,
          lastUsedDate: primary.lastModified ?? primary.revisionDate ?? null,
        });
        login.password = dup.login.password;
      } else {
        pushHistory({
          password: dup.login.password,
          lastUsedDate: dup.lastModified ?? dup.revisionDate ?? null,
        });
      }
    }
  }
  for (const entry of dup.passwordHistory ?? []) pushHistory(structuredClone(entry));
  if (history.length) primary.passwordHistory = history;
  if (dup.login?.fido && (!login.fido || dupNewer)) {
    login.fido = dup.login.fido;
  }
  if (dup.login?.totp && (!login.totp || dupNewer)) {
    login.totp = dup.login.totp;
  }
  if (dup.login?.fido2Credentials?.length) {
    const existing = login.fido2Credentials ?? [];
    const keys = new Set(existing.map((c) => c.credentialId ?? JSON.stringify(c)));
    const added = dup.login.fido2Credentials.filter((credential) => {
      const key = credential.credentialId ?? JSON.stringify(credential);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    if (added.length) login.fido2Credentials = [...existing, ...structuredClone(added)];
  }
  if (dup.notes) {
    if (!primary.notes) primary.notes = dup.notes;
    else {
      const noteBlock = (value: string) => `\n\n${value.replace(/\r\n/g, "\n")}\n\n`;
      if (!noteBlock(primary.notes).includes(noteBlock(dup.notes))) {
        primary.notes = `${primary.notes}

${dup.notes}`;
      }
    }
  }
  if (dup.fields?.length) {
    const existing = primary.fields ?? [];
    const keys = new Set(existing.map((f) => JSON.stringify([f.name, f.value])));
    const added = dup.fields.filter((field) => {
      const key = JSON.stringify([field.name, field.value]);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    if (added.length) primary.fields = [...existing, ...structuredClone(added)];
  }
  if (dup.card && !primary.card) primary.card = structuredClone(dup.card);
  if (dup.identity && !primary.identity) primary.identity = structuredClone(dup.identity);
  if (dup.secureNote && !primary.secureNote) primary.secureNote = structuredClone(dup.secureNote);
  if (dup.favorite) primary.favorite = true;
  if (!primary.folderId && dup.folderId) primary.folderId = dup.folderId;
  if (dup.collectionIds?.length) {
    primary.collectionIds = [...new Set([...(primary.collectionIds ?? []), ...dup.collectionIds])];
  }
  if (dup.creationDate && (!primary.creationDate || dup.creationDate < primary.creationDate)) {
    primary.creationDate = dup.creationDate;
  }
  login.uris = mergedUris;
  const hasLoginData = mergedUris.length > 0 || Object.keys(login).some((k) => k !== "uris");
  if (primary.login || hasLoginData || getMergeType(primary) === 1) primary.login = login;
  if (dupMs > primaryMs) {
    primary.lastModified = new Date(dupMs).toISOString();
  }
}

/** Merge the specified item indices into `indices[0]` and remove the rest in-place. */
export function mergeDuplicateIndices(vaultData: VaultData, indices: number[]): void {
  if (indices.length < 2) return;
  const primary = vaultData.items[indices[0]];
  if (!primary) return;
  // Never remove the primary itself if its index is repeated in the list.
  const removeSet = new Set(indices.slice(1));
  removeSet.delete(indices[0]);

  for (const idx of removeSet) {
    const dup = vaultData.items[idx];
    if (dup && getMergeType(dup) !== getMergeType(primary)) removeSet.delete(idx);
    else if (dup) mergeIntoPrimary(primary, dup);
  }

  vaultData.items = vaultData.items.filter((_, idx) => !removeSet.has(idx));
}

/** Merge all duplicate groups in `vaultData` in-place. Returns the number of groups merged. */
export function mergeAllDuplicateGroups(vaultData: VaultData): number {
  const groups = collectDuplicateEntries(vaultData);
  const toRemove = new Set<VaultItem>();
  for (const { entries } of groups) {
    const primary = entries[0].item;
    for (const { item: dup } of entries.slice(1)) {
      toRemove.add(dup);
      mergeIntoPrimary(primary, dup);
    }
  }
  if (toRemove.size > 0) {
    vaultData.items = vaultData.items.filter((item) => !toRemove.has(item));
  }
  return groups.length;
}

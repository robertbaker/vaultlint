import {
  getUriString,
  type VaultData,
  type VaultFolder,
  type VaultItem,
} from "@vaultlint/vault-schema";

export class FolderRegistry {
  private readonly byName = new Map<string, string>();
  private readonly folders: VaultFolder[] = [];

  getOrCreate(name: string | undefined | null): string | null {
    const trimmed = name?.trim();
    if (!trimmed) return null;
    const existing = this.byName.get(trimmed);
    if (existing) return existing;
    const id = `folder-${this.folders.length + 1}`;
    this.byName.set(trimmed, id);
    this.folders.push({ id, name: trimmed });
    return id;
  }

  list(): VaultFolder[] {
    return this.folders;
  }
}

export function buildFolderNameMap(vault: VaultData): Map<string, string> {
  const map = new Map<string, string>();
  for (const folder of vault.folders ?? []) {
    map.set(folder.id, folder.name);
  }
  return map;
}

export function getItemFolderName(item: VaultItem, folderMap: Map<string, string>): string {
  if (!item.folderId) return "";
  return folderMap.get(item.folderId) ?? "";
}

export function getPrimaryUri(item: VaultItem): string {
  return getUriString(item.login?.uris?.[0]);
}

export function getAllUris(item: VaultItem): string[] {
  return (item.login?.uris ?? []).map(getUriString).filter(Boolean);
}

export function makeLoginItem(params: {
  id?: string;
  name: string;
  username?: string;
  password?: string;
  uris?: string[];
  totp?: string;
  notes?: string;
  folderId?: string | null;
  favorite?: boolean;
  lastModified?: string;
  type?: number;
  providerData?: Record<string, unknown>;
}): VaultItem {
  const cleanUris = (params.uris ?? []).map((u) => u.trim()).filter(Boolean);
  const itemType = params.type ?? 1;
  const item: VaultItem = {
    id: params.id,
    name: params.name,
    type: itemType,
    folderId: params.folderId ?? null,
    favorite: params.favorite ?? false,
    notes: params.notes || undefined,
    lastModified: params.lastModified || undefined,
  };

  if (itemType === 1 || params.username || params.password || cleanUris.length > 0 || params.totp) {
    item.login = {
      username: params.username ?? "",
      password: params.password ?? "",
      uris: cleanUris.map((uri) => ({ uri })),
      totp: params.totp || undefined,
    };
  }

  if (params.providerData) {
    item["_providerData"] = params.providerData;
  }

  return item;
}

export function deriveNameFromUrl(url: string, fallback = "Untitled"): string {
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return parsed.hostname || trimmed;
  } catch {
    return trimmed;
  }
}

export function stripInternalProviderData(item: VaultItem): VaultItem {
  if (!("_providerData" in item)) return item;
  const { _providerData: _ignored, ...rest } = item;
  return rest;
}

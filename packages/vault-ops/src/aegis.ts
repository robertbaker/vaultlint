import type { VaultData } from "@vaultlint/vault-schema";

/**
 * Import passkey/FIDO credentials from unencrypted JSON exports into matching vault items. Supports
 * Aegis `fidoKeys` and common `credentials`, `fido2Credentials`, or `keys` arrays. Array entries
 * match by item ID first, then by a unique username; ambiguous usernames are skipped.
 */
export function importAegisFidoKeys(vaultData: VaultData, parsedAegis: unknown): number {
  if (!parsedAegis || typeof parsedAegis !== "object") return 0;

  const source = parsedAegis as Record<string, unknown>;
  const keys =
    source["fidoKeys"] ??
    source["credentials"] ??
    source["fido2Credentials"] ??
    source["keys"] ??
    [];
  let updated = 0;

  if (Array.isArray(keys)) {
    const itemsByUsername = new Map<string, typeof vaultData.items>();
    for (const item of vaultData.items) {
      const username = item.login?.username?.trim().toLowerCase();
      if (!username) continue;
      const matches = itemsByUsername.get(username) ?? [];
      matches.push(item);
      itemsByUsername.set(username, matches);
    }

    for (const entry of keys) {
      if (!entry || typeof entry !== "object") continue;
      const credential = entry as {
        id?: string;
        itemId?: string;
        username?: string;
        userName?: string;
        fido2Credentials?: unknown;
      };
      const itemId = credential.itemId;
      const match =
        (itemId && vaultData.items.find((item) => item.id === itemId)) ||
        (() => {
          const username = (credential.username ?? credential.userName)?.trim().toLowerCase();
          const matches = username ? itemsByUsername.get(username) : undefined;
          return matches?.length === 1 ? matches[0] : undefined;
        })();
      if (match) {
        match.login = match.login ?? {};
        match.login.fido = credential.fido2Credentials ?? entry;
        updated++;
      }
    }
  } else if (typeof keys === "object" && keys !== null) {
    const dict = keys as Record<string, unknown>;
    for (const item of vaultData.items) {
      if (item.id && Object.hasOwn(dict, item.id) && dict[item.id] !== undefined) {
        item.login = item.login ?? {};
        item.login.fido = dict[item.id];
        updated++;
      }
    }
  }

  return updated;
}

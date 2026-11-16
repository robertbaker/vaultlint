import fs from "fs";

import type { VaultData, VaultItem } from "@vaultlint/vault-schema";

import { readUtf8Text } from "./safeWrite";

export interface AegisFidoEntry {
  username?: string;
  fido2Credentials?: unknown;
  [key: string]: unknown;
}

/** Import FIDO keys from an unencrypted Aegis JSON export. */
export async function importFidoKeys(
  aegisFilePath: string,
): Promise<AegisFidoEntry[] | Record<string, unknown>> {
  if (!fs.existsSync(aegisFilePath)) {
    throw new Error(`Aegis export file not found: ${aegisFilePath}`);
  }
  let aegisData: unknown;
  try {
    aegisData = JSON.parse(readUtf8Text(aegisFilePath));
  } catch {
    // Parser diagnostics may echo credential/FIDO material from the malformed input.
    throw new Error(`Could not parse Aegis export "${aegisFilePath}": invalid JSON.`);
  }
  if (!aegisData || typeof aegisData !== "object" || Array.isArray(aegisData)) {
    throw new Error(`Aegis export "${aegisFilePath}" must be a JSON object.`);
  }
  const fidoKeys = (aegisData as Record<string, unknown>)["fidoKeys"];
  if (fidoKeys === undefined) return [];
  if (Array.isArray(fidoKeys)) {
    if (
      fidoKeys.every(
        (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry),
      )
    ) {
      return fidoKeys as AegisFidoEntry[];
    }
  } else if (fidoKeys !== null && typeof fidoKeys === "object") {
    return fidoKeys as Record<string, unknown>;
  }
  throw new Error(
    `Aegis export "${aegisFilePath}" has an invalid "fidoKeys" value; expected an array or object.`,
  );
}

/**
 * Replace existing FIDO keys in the vault or add them if not yet present. Supports both map format
 * ({ [itemId]: fidoKey }) and Aegis array format ([{ username, fido2Credentials }]).
 */
export function replaceExistingFidoKeys(
  newFidoKeys: Record<string, unknown> | AegisFidoEntry[],
  vaultData: VaultData,
): number {
  let updatedCount = 0;

  if (Array.isArray(newFidoKeys)) {
    const itemByUsername = new Map<string, VaultItem>();
    for (const item of vaultData.items) {
      const username = item.login?.username;
      if (username && !itemByUsername.has(username)) itemByUsername.set(username, item);
    }

    for (const fidoKey of newFidoKeys) {
      const match = fidoKey.username ? itemByUsername.get(fidoKey.username) : undefined;
      if (match) {
        match.login = match.login ?? {};
        const nextCred = fidoKey.fido2Credentials ?? fidoKey;
        match.login.fido = nextCred;
        updatedCount++;
        console.log(`Updated FIDO key for item: ${match.name || match.id || match.login.username}`);
      }
    }
    return updatedCount;
  }

  if (newFidoKeys && typeof newFidoKeys === "object") {
    for (const item of vaultData.items) {
      if (!item.id) continue;
      if (!Object.hasOwn(newFidoKeys, item.id)) continue;
      const newFidoKey = newFidoKeys[item.id];
      if (newFidoKey !== undefined) {
        item.login = item.login ?? {};
        item.login.fido = newFidoKey;
        updatedCount++;
        console.log(`Updated FIDO key for item: ${item.name || item.id}`);
      }
    }
  }

  return updatedCount;
}

/** Find the corresponding vault entry for the given FIDO key based on username. */
export function findVaultEntry(
  fidoKey: AegisFidoEntry,
  vaultData: VaultData,
): VaultItem | undefined {
  if (!fidoKey.username) return undefined;
  return vaultData.items.find((item) => item.login?.username === fidoKey.username);
}

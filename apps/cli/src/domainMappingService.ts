import fs from "fs";

import { applyDomainMappingsToVault } from "@vaultlint/vault-ops";
import type { VaultData } from "@vaultlint/vault-schema";

import { readUtf8Text } from "./safeWrite";

export type DomainMappings = Record<string, string>;

/** Load domain mappings from a JSON config file (throws if missing or not a string map). */
export function loadDomainMappings(configFilePath: string): DomainMappings {
  if (!fs.existsSync(configFilePath)) {
    throw new Error(`Domain mappings file not found: ${configFilePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readUtf8Text(configFilePath));
  } catch (error) {
    throw new Error(
      `Could not parse domain mappings "${configFilePath}": ${(error as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Domain mappings "${configFilePath}" must be a JSON object of host -> host.`);
  }
  const mappings: DomainMappings = Object.create(null) as DomainMappings;
  for (const [from, to] of Object.entries(parsed)) {
    if (typeof to !== "string") {
      throw new Error(`Domain mapping for "${from}" must be a string.`);
    }
    mappings[from] = to;
  }
  return mappings;
}

/**
 * Apply domain mappings to vault item URIs (matching exact hostnames, not arbitrary substrings).
 * Returns the number of updated URIs.
 */
export function applyDomainMappings(vaultData: VaultData, mappings: DomainMappings): number {
  return applyDomainMappingsToVault(vaultData, mappings);
}

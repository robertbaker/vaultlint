import { describe, expect, test } from "bun:test";

import type { VaultData } from "@vaultlint/vault-schema";

import { mergeVaultMigration, previewVaultMigration } from "../src/migration";

function makeVault(count: number, offset = 0): VaultData {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      id: `id-${i + offset}`,
      type: 1,
      name: `Site ${i + offset}`,
      login: {
        username: `user${i + offset}`,
        password: `pw-${i + offset}`,
        uris: [`https://site${i + offset}.example.com/login`],
      },
    })),
  };
}

describe("migration scales with vault size", () => {
  test("previewing/merging two overlapping 4000-item vaults does not compare every pair", () => {
    // Half of the incoming vault matches existing items, half is new.
    const current = makeVault(4000);
    const incoming = makeVault(4000, 2000);
    const started = performance.now();
    const preview = previewVaultMigration(current, incoming);
    const merged = mergeVaultMigration(current, incoming);
    const elapsed = performance.now() - started;
    expect(preview.matches).toHaveLength(2000);
    expect(preview.additions).toHaveLength(2000);
    expect(merged.items).toHaveLength(6000);
    expect(elapsed).toBeLessThan(2000);
  }, 120_000);
});

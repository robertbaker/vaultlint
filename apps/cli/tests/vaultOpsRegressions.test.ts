import { describe, expect, test } from "bun:test";

import {
  generateStrongPassword,
  mergeAllDuplicateGroups,
  mergeDuplicateIndices,
  previewVaultMigration,
  normalizeVaultItems,
} from "@vaultlint/vault-ops";
import type { VaultData } from "@vaultlint/vault-schema";

describe("vault-ops regressions", () => {
  test("normalizeVaultItems leaves hostless URIs untouched", () => {
    const vault = {
      items: [
        {
          name: "x",
          login: { uris: [{ uri: "mailto:a@b.com" }, { uri: "https://Example.com/path?q=1" }] },
        },
      ],
    } as unknown as VaultData;
    normalizeVaultItems(vault);
    expect(vault.items[0].login?.uris).toEqual([
      { uri: "mailto:a@b.com" },
      { uri: "https://example.com" },
    ]);
  });

  test("mergeDuplicateIndices keeps the primary when its index repeats", () => {
    const vault = {
      items: [{ name: "a", login: { username: "u" } }, { name: "a" }],
    } as unknown as VaultData;
    mergeDuplicateIndices(vault, [0, 0, 1]);
    expect(vault.items).toHaveLength(1);
    expect(vault.items[0].login?.username).toBe("u");
  });

  test("automatic duplicate merging preserves same-name items with different types", () => {
    const vault: VaultData = {
      items: [
        { id: "login", name: "Work", type: 1, login: { username: "alice" } },
        { id: "card", name: "work", type: 3, card: { number: "4111111111111111" } },
      ],
    };

    expect(mergeAllDuplicateGroups(vault)).toBe(0);
    expect(vault.items).toHaveLength(2);
    expect(vault.items[1].card?.number).toBe("4111111111111111");
  });

  test("manual duplicate merging leaves incompatible item types intact", () => {
    const vault: VaultData = {
      items: [
        { id: "login", name: "Work", type: 1, login: { username: "alice" } },
        { id: "card", name: "work", type: 3, card: { number: "4111111111111111" } },
      ],
    };

    mergeDuplicateIndices(vault, [0, 1]);
    expect(vault.items).toHaveLength(2);
    expect(vault.items[1].card?.number).toBe("4111111111111111");
  });

  test("migration does not auto-match records across item types", () => {
    const current: VaultData = {
      items: [{ id: "note", name: "Work", type: 2, login: { username: "alice" } }],
    };
    const incoming: VaultData = {
      items: [{ id: "login", name: "work", type: 1, login: { username: "alice" } }],
    };

    const preview = previewVaultMigration(current, incoming);

    expect(preview.matches).toHaveLength(0);
    expect(preview.candidates).toHaveLength(0);
    expect(preview.additions).toHaveLength(1);
  });

  test("duplicate merges retain distinct URI match modes", () => {
    const uri = "https://example.com";
    const vault: VaultData = {
      items: [
        { name: "Example", login: { uris: [{ uri, match: 3 }] } },
        { name: "example", login: { uris: [{ uri, match: 0 }] } },
      ],
    };

    mergeAllDuplicateGroups(vault);
    expect(vault.items[0].login?.uris).toEqual([
      { uri, match: 3 },
      { uri, match: 0 },
    ]);
  });

  test("generateStrongPassword meets length and class requirements", () => {
    const pw = generateStrongPassword(20);
    expect(pw).toHaveLength(20);
    expect(/\d/.test(pw) && /[A-Z]/.test(pw) && /[a-z]/.test(pw)).toBe(true);
  });
});

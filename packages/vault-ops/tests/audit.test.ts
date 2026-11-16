import { describe, expect, test } from "bun:test";

import { inferItemType } from "@vaultlint/vault-schema";

import { groupDuplicatesByName } from "../src/duplicates";
import { applyLintFixes } from "../src/lint";
import { previewVaultMigration } from "../src/migration";

describe("item type inference is shared", () => {
  test("untyped items with no login classify the same in migration and duplicates", () => {
    const bare = { name: "Thing", notes: "n" };
    expect(inferItemType(bare)).toBe(1);
    expect(inferItemType({ name: "c", card: {} })).toBe(3);
    expect(inferItemType({ name: "i", identity: {} })).toBe(4);
    expect(inferItemType({ name: "n", secureNote: { type: 0 } })).toBe(2);

    const groups = groupDuplicatesByName({ items: [bare, { ...bare }] });
    expect(groups[0]?.type).toBe(1);

    // Migration matching needs account evidence (username/URI/etc.), so items with no login data are
    // intentionally never matched; this test only covers the shared type inference.
    const preview = previewVaultMigration(
      { items: [{ name: "Thing", login: { username: "u" } }] },
      { items: [{ name: "Thing", login: { username: "u" } }, { name: "Plain" }] },
    );
    expect(preview.matches).toHaveLength(1);
  });
});

describe("lint autofix", () => {
  test("http upgrade drops an explicit :80 instead of producing https on port 80", () => {
    const vault = {
      items: [
        {
          name: "A",
          login: {
            username: "u",
            password: "Str0ng!Passw0rd#1",
            uris: [
              "http://example.com:80/login",
              "http://user@example.org:80",
              "http://example.net:8080/x",
            ],
          },
        },
      ],
    };
    applyLintFixes(vault);
    expect(vault.items[0].login.uris).toEqual([
      "https://example.com/login",
      "https://user@example.org",
      "https://example.net:8080/x",
    ]);
  });
});

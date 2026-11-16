import { describe, expect, test } from "bun:test";

import type { VaultData } from "@vaultlint/vault-schema";

import { applyBatchEditToVault, expandBatchVariables, previewBatchEditOnVault } from "../src/batch";
import {
  buildDuplicateGroupFromIds,
  groupDuplicatesByName,
  mergeAllDuplicateGroups,
  mergeDuplicateIndices,
} from "../src/duplicates";
import { computeVaultBreakdown } from "../src/health";
import { applyLintFixes, lintVault } from "../src/lint";
import { mergeVaultMigration, previewVaultMigration } from "../src/migration";
import { applyDomainMappingsToVault, findInvalidUriFindings } from "../src/uri";

describe("duplicate merging keeps data", () => {
  const makeVault = (): VaultData => ({
    items: [
      {
        id: "a",
        name: "Site",
        type: 1,
        notes: "first",
        lastModified: "2024-01-01T00:00:00Z",
        login: { username: "u", password: "old-Pass1!", uris: [{ uri: "https://a.example" }] },
        fields: [{ name: "pin", value: "1" }],
      },
      {
        id: "b",
        name: "site",
        type: 1,
        notes: "second",
        favorite: true,
        lastModified: "2025-01-01T00:00:00Z",
        login: {
          username: "u",
          password: "new-Pass2!",
          uris: [{ uri: "https://b.example" }],
          fido2Credentials: [{ credentialId: "c1" }],
        },
        fields: [
          { name: "pin", value: "1" },
          { name: "q", value: "a" },
        ],
        card: { number: "4111" },
      },
    ],
  });

  test("merging non-login items does not invent an empty login object", () => {
    const vault: VaultData = {
      items: [
        { id: "1", type: 2, name: "Note", notes: "a", secureNote: { type: 0 } },
        { id: "2", type: 2, name: "Note", notes: "b", secureNote: { type: 0 } },
        { id: "3", type: 3, name: "Card", card: { number: "4111" } },
        { id: "4", type: 3, name: "Card", card: { number: "4111" } },
      ],
    };
    expect(mergeAllDuplicateGroups(vault)).toBe(2);
    expect(vault.items).toHaveLength(2);
    for (const item of vault.items) expect("login" in item).toBe(false);

    const logins: VaultData = {
      items: [
        { id: "1", type: 1, name: "L", login: { username: "u", uris: ["https://a.example"] } },
        { id: "2", type: 1, name: "L", login: { username: "u", uris: ["https://b.example"] } },
      ],
    };
    mergeDuplicateIndices(logins, [0, 1]);
    expect(logins.items[0].login?.uris).toEqual([
      { uri: "https://a.example" },
      { uri: "https://b.example" },
    ]);
  });

  test("mergeDuplicateIndices preserves custom fields, notes, history, passkeys, favorite", () => {
    const vault = makeVault();
    mergeDuplicateIndices(vault, [0, 1]);
    expect(vault.items).toHaveLength(1);
    const merged = vault.items[0];
    expect(merged.login?.password).toBe("new-Pass2!");
    expect(merged.passwordHistory?.map((h) => h.password)).toEqual(["old-Pass1!"]);
    expect(merged.fields).toEqual([
      { name: "pin", value: "1" },
      { name: "q", value: "a" },
    ]);
    expect(merged.notes).toContain("first");
    expect(merged.notes).toContain("second");
    expect(merged.login?.fido2Credentials).toEqual([{ credentialId: "c1" }]);
    expect(merged.favorite).toBe(true);
    expect(merged.card).toEqual({ number: "4111" });
    expect(merged.login?.uris).toHaveLength(2);
  });

  test("older duplicate password is kept in history, not dropped", () => {
    const vault = makeVault();
    vault.items.reverse();
    mergeAllDuplicateGroups(vault);
    expect(vault.items[0].login?.password).toBe("new-Pass2!");
    expect(vault.items[0].passwordHistory?.map((h) => h.password)).toEqual(["old-Pass1!"]);
  });

  test("does not mistake a note substring for a duplicate note", () => {
    const vault = makeVault();
    vault.items[0].notes = "The tokenization rule is documented here.";
    vault.items[1].notes = "token";

    mergeDuplicateIndices(vault, [0, 1]);

    expect(vault.items[0].notes).toBe("The tokenization rule is documented here.\n\ntoken");
  });

  test("duplicate values repeated within one source item are merged only once", () => {
    const vault = makeVault();
    vault.items[0].fields = [];
    vault.items[1].fields = [
      { name: "q", value: "a" },
      { name: "q", value: "a" },
    ];
    vault.items[0].login!.fido2Credentials = [];
    vault.items[1].login!.fido2Credentials = [{ credentialId: "same" }, { credentialId: "same" }];

    mergeDuplicateIndices(vault, [0, 1]);

    expect(vault.items[0].fields).toEqual([{ name: "q", value: "a" }]);
    expect(vault.items[0].login?.fido2Credentials).toEqual([{ credentialId: "same" }]);
  });
});

describe("batch variables", () => {
  test("substituted values are not re-expanded", () => {
    const item = { name: "{{username}}", login: { username: "secret", uris: [] } };
    expect(expandBatchVariables("{{name}}/{{username}}", item)).toBe("{{username}}/secret");
  });

  test("replacement variables stay literal while regex capture references still work", () => {
    const vault: VaultData = {
      items: [{ name: "$& $1", notes: "item-123" }],
    };

    expect(applyBatchEditToVault(vault, "notes", "item-(\\d+)", "{{name}}-$1")).toBe(1);
    expect(vault.items[0].notes).toBe("$& $1-123");
  });

  test("empty-target variable values are assigned literally", () => {
    const vault: VaultData = {
      items: [{ name: "$& $1", notes: "" }],
    };

    expect(applyBatchEditToVault(vault, "notes", "^$", "{{name}}", "empty")).toBe(1);
    expect(vault.items[0].notes).toBe("$& $1");
  });

  test("empty target mode still requires the regex to match", () => {
    const vault: VaultData = {
      items: [
        { name: "", notes: "already filled" },
        { name: "keep", notes: "" },
      ],
    };

    expect(previewBatchEditOnVault(vault, "notes", "nomatch", "value", "empty")).toEqual([]);
    expect(previewBatchEditOnVault(vault, "notes", "^$", "value", "empty")).toEqual([
      { label: "keep", before: "", after: "value" },
    ]);
    expect(applyBatchEditToVault(vault, "notes", "nomatch", "value", "empty")).toBe(0);
    expect(vault.items[1].notes).toBe("");
    expect(applyBatchEditToVault(vault, "notes", "^$", "value", "empty")).toBe(1);
    expect(vault.items[1].notes).toBe("value");
  });
});

describe("domain mappings", () => {
  test("preserves root-path query and fragment while changing hostname", () => {
    const vault: VaultData = {
      items: [
        {
          login: {
            uris: [
              "https://old.example?tenant=1#login",
              "https://old.example/?tenant=2",
              "https://old.example",
            ],
          },
        },
      ],
    };

    expect(applyDomainMappingsToVault(vault, { "old.example": "new.example" })).toBe(3);
    expect(vault.items[0].login?.uris).toEqual([
      "https://new.example/?tenant=1#login",
      "https://new.example/?tenant=2",
      "https://new.example",
    ]);
  });

  test("maps scheme-less hostnames and preserves their path and suffix", () => {
    const vault: VaultData = {
      items: [
        {
          login: {
            uris: [
              "api.old.example/path?tenant=1#login",
              { uri: "api.old.example:8443/health", match: 2 },
            ],
          },
        },
      ],
    };

    expect(applyDomainMappingsToVault(vault, { "api.old.example": "old.example" })).toBe(2);
    expect(vault.items[0].login?.uris).toEqual([
      "old.example/path?tenant=1#login",
      { uri: "old.example:8443/health", match: 2 },
    ]);
  });
});

describe("health", () => {
  test("infers card/identity types when type is missing", () => {
    const stats = computeVaultBreakdown({
      items: [
        { name: "c", card: { number: "1" } },
        { name: "i", identity: { firstName: "a" } },
        { name: "untyped" },
        { name: "secure note", secureNote: { type: 0 } },
      ],
    });
    expect(stats.cardCount).toBe(1);
    expect(stats.identityCount).toBe(1);
    expect(stats.loginCount).toBe(1);
    expect(stats.noteCount).toBe(1);
  });
});

describe("lint autofix", () => {
  test("host:port and IP URIs get a scheme", () => {
    const vault: VaultData = {
      items: [
        {
          name: "x",
          type: 1,
          login: {
            username: "u",
            password: "p",
            uris: [
              { uri: "example.com:8080" },
              { uri: "localhost:3000" },
              { uri: "10.0.0.1:80/x" },
            ],
          },
        },
      ],
    };
    expect(lintVault(vault).byRule["malformed-uri"]?.count).toBe(3);
    applyLintFixes(vault);
    expect(vault.items[0].login?.uris).toEqual([
      { uri: "https://example.com:8080" },
      { uri: "https://localhost:3000" },
      { uri: "https://10.0.0.1:80/x" },
    ]);
  });

  test("only labels malformed-uri findings fixable when the fix can actually apply", () => {
    const vault: VaultData = {
      items: [
        {
          name: "Mixed",
          type: 1,
          login: { username: "u", password: "p", uris: ["nourl", "example.com:8080"] },
        },
      ],
    };
    const before = lintVault(vault);
    const malformed = before.findings.filter((f) => f.ruleId === "malformed-uri");
    expect(malformed).toHaveLength(2);
    expect(malformed.map((f) => f.fixable).sort()).toEqual([false, "safe"]);
    expect(before.counts.fixableSafe).toBe(1);

    const result = applyLintFixes(vault);
    expect(result.fixedByRule["malformed-uri"]).toBe(1);
    // After autofix nothing safe is left over to apply again.
    expect(result.lintAfter.counts.fixableSafe).toBe(0);
    expect(result.lintAfter.findings.filter((f) => f.ruleId === "malformed-uri")[0]?.fixable).toBe(
      false,
    );
  });

  test("flags incomplete Android and iOS app URI schemes", () => {
    const vault: VaultData = {
      items: [
        {
          name: "Mobile apps",
          type: 1,
          login: { uris: ["androidapp://", "iosapp://"] },
        },
      ],
    };

    expect(findInvalidUriFindings(vault)[0]?.invalidUris).toEqual(["androidapp://", "iosapp://"]);
    expect(lintVault(vault).byRule["malformed-uri"]?.count).toBe(2);
  });
});

describe("migration", () => {
  const current: VaultData = {
    folders: [{ id: "f1", name: "Work" }],
    items: [
      { id: "1", name: "A", type: 1, folderId: "f1", login: { username: "u", password: "p" } },
    ],
  };

  test("same-named folders with different IDs are not reported as conflicts", () => {
    const incoming: VaultData = {
      folders: [{ id: "other", name: "Work" }],
      items: [
        { id: "9", name: "A", type: 1, folderId: "other", login: { username: "u", password: "p" } },
      ],
    };
    const preview = previewVaultMigration(current, incoming);
    expect(preview.matches[0].conflicts).not.toContain("folder");
  });

  test("incoming folders reuse an existing folder with the same name", () => {
    const incoming: VaultData = {
      folders: [{ id: "other", name: "Work" }],
      items: [
        { id: "9", name: "B", type: 1, folderId: "other", login: { username: "x", password: "y" } },
      ],
    };
    const merged = mergeVaultMigration(current, incoming);
    expect(merged.folders).toHaveLength(1);
    expect(merged.items[1].folderId).toBe("f1");
  });

  test("ignores invalid candidate selections without dropping incoming items", () => {
    const existing: VaultData = {
      items: [
        {
          id: "shared",
          name: "Account",
          type: 1,
          login: { username: "alice", uris: ["https://example.com"] },
        },
      ],
    };
    const incoming: VaultData = {
      items: [
        {
          id: "shared",
          name: "Account",
          type: 1,
          login: { username: "bob", uris: ["https://example.com"] },
        },
        { id: "new", name: "New account", type: 1, login: { username: "charlie" } },
      ],
    };

    const merged = mergeVaultMigration(existing, incoming, { mergeCandidateIndices: [1] });

    expect(merged.items.map((item) => item.name)).toEqual(["Account", "Account", "New account"]);
  });
});

describe("duplicate detection matches auto-merge", () => {
  test("same name but different type is neither reported nor merged", () => {
    const vault = {
      folders: [],
      items: [
        { id: "a", name: "Acme", type: 1, login: { username: "u", password: "p" } },
        { id: "b", name: "acme ", type: 3, card: { number: "4111" } },
        { id: "c", name: "ACME", type: 1, login: { username: "u2", password: "p2" } },
      ],
    } as unknown as VaultData;
    const groups = groupDuplicatesByName(vault);
    expect(groups.length).toBe(1);
    expect(groups[0].items.map((e) => e.item.id)).toEqual(["a", "c"]);
    expect(groups[0].key).toBe("acme");
    expect(mergeAllDuplicateGroups(vault)).toBe(groups.length);
    expect(vault.items.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("buildDuplicateGroupFromIds refs", () => {
  test("resolves index refs for duplicate and missing ids", () => {
    const vault = {
      items: [{ id: "x", name: "a" }, { id: "x", name: "a" }, { name: "a" }],
    } as unknown as VaultData;
    const group = buildDuplicateGroupFromIds(vault, ["index:0", "index:1", "index:2"], "a", "a");
    expect(group?.items.map((e) => e.index)).toEqual([0, 1, 2]);
  });

  test("does not alias a reserved-prefix item ID with another item's positional ref", () => {
    const vault = {
      items: [
        { id: "index:1", name: "Unselected" },
        { name: "Selected" },
        { id: "other", name: "Selected" },
      ],
    } as unknown as VaultData;

    const group = buildDuplicateGroupFromIds(vault, ["index:1", "other"], "Selected", "selected");

    expect(group?.items.map((entry) => entry.index)).toEqual([1, 2]);
  });

  test("prefers a numeric persistent ID over an ambiguous legacy index reference", () => {
    const vault = {
      items: [
        { id: "1", name: "Persistent ID" },
        { name: "Legacy numeric index" },
        { id: "other", name: "Other selected item" },
      ],
    } as unknown as VaultData;

    const group = buildDuplicateGroupFromIds(vault, ["1", "other"], "Selected", "selected");

    expect(group?.items.map((entry) => entry.index)).toEqual([0, 2]);
  });
});

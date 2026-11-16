import { expect, test } from "bun:test";

import { parseVault } from "../src/index";

// Shape from bitwarden/clients libs/importer/src/importers/protonpass/types/protonpass-json-type.ts
// and protonpass-json-importer.ts: username = itemUsername, falling back to itemEmail; alias items
// carry the address in the item-level `aliasEmail`.
function protonExport(items: unknown[]): string {
  return JSON.stringify({
    version: "1.21.0",
    userId: "u",
    encrypted: false,
    vaults: {
      shareA: { name: "Personal", description: "", display: { color: 0, icon: 0 }, items },
    },
  });
}

test("Proton Pass login with only itemEmail keeps the email as username", () => {
  const item = parseVault(
    protonExport([
      {
        itemId: "i1",
        shareId: "shareA",
        data: {
          metadata: { name: "Site", note: "", itemUuid: "x" },
          extraFields: [],
          type: "login",
          content: {
            itemEmail: "me@example.com",
            itemUsername: "",
            password: "pw",
            urls: ["https://example.com"],
            totpUri: "",
            passkeys: [],
          },
        },
        state: 1,
        aliasEmail: null,
        contentFormatVersion: 6,
        createTime: 1700000000,
        modifyTime: 1700000001,
        pinned: false,
      },
    ]),
  ).vault.items[0];
  expect(item.login?.username).toBe("me@example.com");
});

test("Proton Pass alias item exposes aliasEmail as username", () => {
  const item = parseVault(
    protonExport([
      {
        itemId: "a1",
        shareId: "shareA",
        data: {
          metadata: { name: "Alias", note: "", itemUuid: "x" },
          extraFields: [],
          type: "alias",
          content: {},
        },
        state: 1,
        aliasEmail: "foo.bar@passmail.net",
        contentFormatVersion: 6,
        createTime: 1700000000,
        modifyTime: 1700000001,
        pinned: false,
      },
    ]),
  ).vault.items[0];
  expect(item.login?.username).toBe("foo.bar@passmail.net");
});

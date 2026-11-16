import { expect, test } from "bun:test";

import { parseVault } from "../src/index";

// Real Bitwarden exports write `null` for empty login fields (e.g. `"totp": null`).
test("Bitwarden JSON with null login username/password/totp parses", () => {
  const text = JSON.stringify({
    encrypted: false,
    folders: [],
    items: [
      {
        id: "1",
        type: 1,
        name: "x",
        notes: null,
        login: { uris: [], username: null, password: "pw", totp: null },
      },
    ],
  });
  const login = parseVault(text).vault.items[0].login!;
  expect(login.password).toBe("pw");
  expect(login.totp).toBeUndefined();
  expect(login.username).toBeUndefined();
});

// Shape from bitwarden/sdk-internal crates/bitwarden-exporters/src/json.rs (test_convert_login):
// `"passwordHistory": null` and linked custom fields `{ "value": null, "type": 3, "linkedId": 101 }`.
test("Bitwarden JSON with null passwordHistory and linked custom field (null value) parses", () => {
  const text = JSON.stringify({
    encrypted: false,
    folders: [],
    items: [
      {
        passwordHistory: null,
        revisionDate: "2024-01-30T14:09:33.753Z",
        creationDate: "2024-01-30T11:23:54.416Z",
        deletedDate: null,
        id: "25c8c414-b446-48e9-a1bd-b10700bbd740",
        organizationId: null,
        folderId: null,
        type: 1,
        reprompt: 0,
        name: "Bitwarden",
        notes: "My note",
        favorite: true,
        fields: [
          { name: "Text", value: "A", type: 0, linkedId: null },
          { name: "Linked", value: null, type: 3, linkedId: 101 },
        ],
        login: {
          fido2Credentials: [],
          uris: [{ match: null, uri: "https://vault.bitwarden.com" }],
          username: "test@bitwarden.com",
          password: "asdfasdfasdf",
          totp: "ABC",
        },
        collectionIds: null,
      },
    ],
  });
  const item = parseVault(text).vault.items[0];
  expect(item.fields?.length).toBe(2);
});

// Official importer guards `fields`, `passwordHistory` and `login.uris` with `!= null`
// (bitwarden/clients libs/common/src/models/export/cipher.export.ts, login.export.ts).
test("Bitwarden JSON with null fields / uris parses", () => {
  const text = JSON.stringify({
    encrypted: false,
    items: [{ id: "1", type: 1, name: "x", fields: null, login: { uris: null, password: "p" } }],
  });
  expect(parseVault(text).vault.items.length).toBe(1);
});

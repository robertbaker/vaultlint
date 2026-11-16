import { expect, test } from "bun:test";

import { parseVault } from "@vaultlint/vault-formats";

import { filterVaultItems } from "../src/vaultManager";
import { computeVaultHealth } from "../src/vaultService";

// Real Bitwarden exports write `"fido2Credentials": []` on every login.
const bw = JSON.stringify({
  encrypted: false,
  folders: [],
  items: [
    {
      id: "1",
      type: 1,
      name: "plain",
      login: {
        username: "a",
        password: "x",
        uris: [{ uri: "https://a.com", match: null }],
        totp: null,
        fido2Credentials: [],
      },
    },
    {
      id: "2",
      type: 1,
      name: "passkey",
      login: {
        username: "b",
        password: "y",
        uris: [],
        totp: null,
        fido2Credentials: [{ credentialId: "c", rpId: "b.com" }],
      },
    },
  ],
});

test("empty fido2Credentials arrays do not count as FIDO keys", () => {
  const vault = parseVault(bw).vault;
  expect(filterVaultItems(vault, undefined, "fido").items.map((i) => i.name)).toEqual(["passkey"]);
  expect(computeVaultHealth(vault).fidoCount).toBe(1);
});

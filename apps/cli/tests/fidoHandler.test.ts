import fs from "fs";
import os from "os";
import path from "path";

import { importAegisFidoKeys } from "@vaultlint/vault-ops";
import { VaultData } from "@vaultlint/vault-schema";

import { importFidoKeys, replaceExistingFidoKeys } from "../src/fidoHandler";

describe("FIDO Key Replacement", () => {
  let vaultDataMock: VaultData;

  beforeEach(() => {
    vaultDataMock = {
      items: [
        { id: "1", name: "Site 1", login: { username: "alice@example.com", fido: "oldFidoKey" } },
        { id: "2", name: "Site 2", login: { username: "bob@example.com" } },
      ],
    };
  });

  it("should replace old FIDO keys with new ones", () => {
    replaceExistingFidoKeys({ "1": "newFidoKey" }, vaultDataMock);
    expect(vaultDataMock.items[0].login!.fido).toBe("newFidoKey");
  });

  it("should add FIDO key when not already present", () => {
    replaceExistingFidoKeys({ "2": "addedFidoKey" }, vaultDataMock);
    expect(vaultDataMock.items[1].login!.fido).toBe("addedFidoKey");
  });

  it("should support Aegis array format matched by username", () => {
    replaceExistingFidoKeys(
      [{ username: "bob@example.com", fido2Credentials: { credentialId: "abc" } }],
      vaultDataMock,
    );
    expect(vaultDataMock.items[1].login!.fido).toEqual({ credentialId: "abc" });
  });

  it("should not replace FIDO key if no new key exists", () => {
    replaceExistingFidoKeys({}, vaultDataMock);
    expect(vaultDataMock.items[0].login!.fido).toBe("oldFidoKey");
  });

  it("does not treat inherited properties as FIDO keys", () => {
    const vault: VaultData = { items: [{ id: "constructor", name: "Site" }] };
    replaceExistingFidoKeys({}, vault);
    expect(vault.items[0].login?.fido).toBeUndefined();
  });

  it("does not import inherited dictionary properties as FIDO keys", () => {
    const vault: VaultData = { items: [{ id: "constructor", name: "Site" }] };
    const updated = importAegisFidoKeys(vault, { fidoKeys: {} });
    expect(updated).toBe(0);
    expect(vault.items[0].login?.fido).toBeUndefined();
  });

  it("rejects a malformed fidoKeys value instead of reporting an empty import", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultlint-aegis-"));
    const file = path.join(directory, "aegis.json");
    try {
      fs.writeFileSync(file, JSON.stringify({ fidoKeys: "not-an-array-or-map" }));
      await expect(importFidoKeys(file)).rejects.toThrow(/invalid "fidoKeys" value/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not echo FIDO material from malformed JSON diagnostics", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultlint-aegis-"));
    const file = path.join(directory, "aegis.json");
    try {
      fs.writeFileSync(file, '{"fidoKeys":[{"credentialId":"secret-fido-material"}');
      const error = await importFidoKeys(file).catch((err: unknown) => err as Error);
      expect(error.message).toContain("invalid JSON");
      expect(error.message).not.toContain("secret-fido-material");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

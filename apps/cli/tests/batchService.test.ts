import { VaultData } from "@vaultlint/vault-schema";

import { applyBatchEdits, runBatchEditing } from "../src/batchService";

describe("Batch Editing Service", () => {
  let vaultDataMock: VaultData;

  beforeEach(() => {
    vaultDataMock = {
      items: [
        {
          name: "example.com",
          login: { uris: [{ uri: "https://example.com" }] },
        },
        { name: "test.com", login: { uris: [{ uri: "https://test.com" }] } },
      ],
    };
  });

  it("should replace the name using regex", async () => {
    await applyBatchEdits(vaultDataMock, "example", "sample", "name");
    expect(vaultDataMock.items[0].name).toBe("sample.com");
  });

  it("should replace the URI using regex", async () => {
    await applyBatchEdits(vaultDataMock, "example", "sample", "uri");
    expect((vaultDataMock.items[0].login!.uris![0] as { uri: string }).uri).toBe(
      "https://sample.com",
    );
  });

  it("should not replace anything if the pattern does not match", async () => {
    await applyBatchEdits(vaultDataMock, "nomatch", "replace", "name");
    expect(vaultDataMock.items[0].name).toBe("example.com");
  });

  it("should preserve URI object shape when normalizing in runBatchEditing", async () => {
    vaultDataMock.items[0].login!.uris = [{ uri: "https://example.com/login?ref=1" }];
    await runBatchEditing(vaultDataMock);
    expect(vaultDataMock.items[0].login!.uris![0]).toEqual({
      uri: "https://example.com",
    });
  });

  it("should throw a clear error on invalid regex", async () => {
    await expect(applyBatchEdits(vaultDataMock, "[unclosed", "x", "name")).rejects.toThrow(
      /Invalid regex pattern/,
    );
  });

  it("should expand template variables and respect empty/non-empty/clear target modes", async () => {
    vaultDataMock.items[0].login!.uris = [{ uri: "https://mail.google.com/inbox" }];
    vaultDataMock.items[0].notes = "";

    await applyBatchEdits(
      vaultDataMock,
      ".*",
      "{{domain.tld}} ({{sub.domain.tld}})",
      "notes",
      "empty",
    );
    expect(vaultDataMock.items[0].notes).toBe("google.com (mail)");

    // Empty mode should not overwrite a now non-empty field
    await applyBatchEdits(vaultDataMock, ".*", "overwritten", "notes", "empty");
    expect(vaultDataMock.items[0].notes).toBe("google.com (mail)");

    // Clear mode should empty matching fields
    await applyBatchEdits(vaultDataMock, "google\\.com", "", "notes", "clear");
    expect(vaultDataMock.items[0].notes).toBe("");
  });
});

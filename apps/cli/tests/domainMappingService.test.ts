import { VaultData } from "@vaultlint/vault-schema";

import { applyDomainMappings } from "../src/domainMappingService";

describe("Domain Mapping Service", () => {
  let vaultDataMock: VaultData;

  const mappingsMock = {
    "mail.google.com": "google.com",
    "drive.google.com": "google.com",
    "google.com": "example.org",
  };

  beforeEach(() => {
    vaultDataMock = {
      items: [
        { login: { uris: [{ uri: "https://mail.google.com" }] } },
        { login: { uris: [{ uri: "https://drive.google.com" }] } },
        { login: { uris: [{ uri: "https://notgoogle.com" }] } },
      ],
    };
  });

  it("should map subdomains to the main domain", () => {
    applyDomainMappings(vaultDataMock, mappingsMock);
    expect((vaultDataMock.items[0].login!.uris![0] as { uri: string }).uri).toBe(
      "https://google.com",
    );
    expect((vaultDataMock.items[1].login!.uris![0] as { uri: string }).uri).toBe(
      "https://google.com",
    );
  });

  it("should not match partial domain substrings like notgoogle.com", () => {
    applyDomainMappings(vaultDataMock, mappingsMock);
    expect((vaultDataMock.items[2].login!.uris![0] as { uri: string }).uri).toBe(
      "https://notgoogle.com",
    );
  });

  it("should not modify URIs if no mapping is available", () => {
    applyDomainMappings(vaultDataMock, {});
    expect((vaultDataMock.items[0].login!.uris![0] as { uri: string }).uri).toBe(
      "https://mail.google.com",
    );
  });

  it("does not treat inherited object properties as domain mappings", () => {
    const vault: VaultData = {
      items: [{ login: { uris: ["https://constructor", "https://toString"] } }],
    };

    expect(applyDomainMappings(vault, {})).toBe(0);
    expect(vault.items[0].login?.uris).toEqual(["https://constructor", "https://toString"]);
  });
});

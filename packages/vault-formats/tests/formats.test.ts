import { describe, expect, test } from "bun:test";

import {
  exportVault,
  parseVault,
  parseVaultAsync,
  VAULT_FORMATS,
  type VaultFormatId,
} from "../src/index";
import { createZipArchive, readZipEntriesSync } from "../src/zip";

function csv0(vault: Parameters<typeof exportVault>[0]) {
  return exportVault(vault, "keepass-csv");
}

describe("@vaultlint/vault-formats", () => {
  test("registers all 20 supported formats", () => {
    expect(VAULT_FORMATS.length).toBe(20);
  });

  test("rejects encrypted Bitwarden JSON and encrypted Proton Pass JSON and .kdbx", () => {
    expect(() => parseVault(JSON.stringify({ encrypted: true, data: "ciphertext" }))).toThrow(
      /Encrypted Bitwarden/,
    );

    expect(() =>
      parseVault(
        JSON.stringify({ encrypted: true, vaults: { v1: { name: "Personal", items: [] } } }),
      ),
    ).toThrow(/Encrypted Proton Pass/);

    const kdbxBytes = new Uint8Array([0x03, 0xd9, 0xa2, 0x9a, 0x00]);
    expect(() => parseVault(kdbxBytes)).toThrow(/Encrypted KeePass/);
  });

  test("auto-detects and round-trips LastPass CSV", () => {
    const csv = [
      "url,username,password,totp,extra,name,grouping,fav",
      'https://github.com,octocat,Str0ng!Pass99,,"Some ""quoted"" note",GitHub,Dev,1',
      "http://sn,,, ,Secret note body,My Note,Notes,0",
    ].join("\n");

    const parsed = parseVault(csv);
    expect(parsed.format).toBe("lastpass-csv");
    expect(parsed.providerName).toBe("LastPass");
    expect(parsed.vault.items.length).toBe(2);
    expect(parsed.vault.items[0].name).toBe("GitHub");
    expect(parsed.vault.items[0].favorite).toBe(true);
    expect(parsed.vault.items[0].notes).toBe('Some "quoted" note');
    expect(parsed.vault.items[1].type).toBe(2);

    const exported = exportVault(parsed.vault, "lastpass-csv");
    expect(exported.extension).toBe("csv");
    const reparsed = parseVault(exported.content as string);
    expect(reparsed.format).toBe("lastpass-csv");
    expect(reparsed.vault.items.length).toBe(2);
    expect(reparsed.vault.items[0].login?.username).toBe("octocat");
  });

  test("auto-detects and round-trips 1Password 1PUX (ZIP) and 1Password CSV", () => {
    const csv = [
      "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes",
      "GitLab,https://gitlab.com,dev@example.com,P@ssw0rd1234,otpauth://totp/GitLab,true,false,Work,Work account",
    ].join("\n");

    const parsedCsv = parseVault(csv);
    expect(parsedCsv.format).toBe("1password-csv");
    expect(parsedCsv.vault.items[0].login?.totp).toBe("otpauth://totp/GitLab");

    const exported1pux = exportVault(parsedCsv.vault, "1password-1pux");
    expect(exported1pux.extension).toBe("1pux");
    expect(exported1pux.content).toBeInstanceOf(Uint8Array);

    const reparsed1pux = parseVault(exported1pux.content as Uint8Array);
    expect(reparsed1pux.format).toBe("1password-1pux");
    expect(reparsed1pux.vault.items[0].name).toBe("GitLab");
    expect(reparsed1pux.vault.items[0].login?.username).toBe("dev@example.com");
    expect(reparsed1pux.vault.items[0].login?.totp).toBe("otpauth://totp/GitLab");
    expect(reparsed1pux.vault.folders?.[0].name).toBe("Work");
  });

  test("parses a spec-shaped 1PUX export.data (fallback fields, history, custom fields, dates)", () => {
    const exportData = {
      accounts: [
        {
          attrs: {
            accountName: "Wendy",
            name: "Wendy",
            uuid: "ACC",
            domain: "https://my.1password.com/",
          },
          vaults: [
            {
              attrs: { uuid: "v1", desc: "", avatar: "", name: "Personal", type: "P" },
              items: [
                {
                  uuid: "i1",
                  favIndex: 1,
                  createdAt: 1614298956,
                  updatedAt: 1635346445,
                  state: "active",
                  categoryUuid: "001",
                  details: {
                    loginFields: [
                      { value: "wendy", id: "", name: "username", fieldType: "T" },
                      { value: "s3cret!", id: "", name: "pw", fieldType: "P" },
                    ],
                    notesPlain: "note",
                    sections: [
                      {
                        title: "Security",
                        name: "Section_1",
                        fields: [
                          { title: "PIN", id: "A", value: { concealed: "12345" } },
                          { title: "otp", id: "B", value: { totp: "otpauth://totp/x" } },
                        ],
                      },
                    ],
                    passwordHistory: [{ value: "old", time: 1458322355 }],
                  },
                  overview: { title: "Dropbox", url: "https://www.dropbox.com/", urls: [] },
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parseVault(JSON.stringify(exportData));
    expect(parsed.format).toBe("1password-1pux");
    const item = parsed.vault.items[0];
    expect(item.login?.username).toBe("wendy");
    expect(item.login?.password).toBe("s3cret!");
    expect(item.login?.totp).toBe("otpauth://totp/x");
    expect(item.creationDate).toBe(new Date(1614298956 * 1000).toISOString());
    expect(item.passwordHistory?.[0].password).toBe("old");
    expect(item.fields).toEqual([{ name: "Security: PIN", value: "12345", type: 1 }]);
  });

  test("ignores out-of-range 1PUX item timestamps", () => {
    const data = {
      accounts: [
        {
          vaults: [
            {
              items: [
                {
                  updatedAt: 1e100,
                  overview: { title: "Item" },
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseVault(JSON.stringify(data), { format: "1password-1pux" });
    expect(parsed.vault.items[0].lastModified).toBeUndefined();
  });

  test("exports 1PUX matching the documented attributes and loginFields shape", () => {
    const exported = exportVault(
      {
        items: [
          {
            id: "a",
            name: "Site",
            type: 1,
            creationDate: "2021-01-01T00:00:00.000Z",
            fields: [{ name: "Recovery", value: "abc", type: 1 }],
            passwordHistory: [{ password: "old", lastUsedDate: "2020-01-01T00:00:00.000Z" }],
            login: { username: "u", password: "p", uris: [{ uri: "https://site.example" }] },
          },
        ],
      },
      "1password-1pux",
    );
    const entries = readZipEntriesSync(exported.content as Uint8Array);
    const attrs = JSON.parse(new TextDecoder().decode(entries.get("export.attributes")));
    expect(attrs.version).toBe(3);
    expect(attrs.description).toBe("1Password Unencrypted Export");
    expect(typeof attrs.createdAt).toBe("number");

    const data = JSON.parse(new TextDecoder().decode(entries.get("export.data")));
    const vault = data.accounts[0].vaults[0];
    expect(vault.attrs.type).toBe("P");
    const item = vault.items[0];
    expect(item.state).toBe("active");
    expect(item.createdAt).toBe(1609459200);
    expect(item.details.loginFields[0]).toMatchObject({
      name: "username",
      designation: "username",
    });
    expect(item.details.loginFields[1]).toMatchObject({
      name: "password",
      fieldType: "P",
      designation: "password",
    });
    expect(item.details.passwordHistory).toEqual([{ value: "old", time: 1577836800 }]);

    const roundTrip = parseVault(exported.content as Uint8Array);
    expect(roundTrip.vault.items[0].fields?.[0].value).toBe("abc");
    expect(roundTrip.vault.items[0].passwordHistory?.[0].password).toBe("old");
  });

  test("maps non-login 1PUX categories and bare-string section values", () => {
    const mk = (uuid: string, categoryUuid: string, extra: Record<string, unknown> = {}) => ({
      uuid,
      categoryUuid,
      state: "active",
      overview: { title: `item-${categoryUuid}` },
      details: { sections: [{ title: "S", fields: [{ title: "Key", value: "plain" }] }] },
      ...extra,
    });
    const parsed = parseVault(
      JSON.stringify({
        accounts: [
          {
            vaults: [
              {
                attrs: { name: "V" },
                items: [mk("a", "001"), mk("b", "106"), mk("c", "114"), mk("d", "110")],
              },
            ],
          },
        ],
      }),
    );
    const [login, passport, ssh, server] = parsed.vault.items;
    expect(login.type).toBe(1);
    expect(server.type).toBe(1);
    expect(passport.type).toBe(2);
    expect(ssh.type).toBe(2);
    expect(passport.fields).toEqual([{ name: "S: Key", value: "plain", type: 0 }]);
  });

  test("keeps generated IDs distinct from explicit 1PUX item UUIDs", () => {
    const data = {
      accounts: [
        {
          vaults: [
            {
              attrs: { uuid: "personal" },
              items: [
                { overview: { title: "Generated" }, details: {} },
                { uuid: "1p-1", overview: { title: "Explicit" }, details: {} },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseVault(JSON.stringify(data), { format: "1password-1pux" });

    expect(parsed.vault.items.map((item) => item.id)).toEqual(["1p-1", "personal:1p-1"]);
    expect(new Set(parsed.vault.items.map((item) => item.id)).size).toBe(2);
  });

  test("warns on an unrecognized 1PUX export.attributes version", () => {
    const exported = exportVault({ items: [{ id: "a", name: "x", type: 1 }] }, "1password-1pux");
    const entries = readZipEntriesSync(exported.content as Uint8Array);
    const zip = createZipArchive({
      "export.attributes": JSON.stringify({ version: 9, description: "x", createdAt: 1 }),
      "export.data": new TextDecoder().decode(entries.get("export.data")),
    });
    expect(parseVault(zip).warnings.join(" ")).toContain("version 9");
  });

  test("warns when 1Password exports omit vault metadata", () => {
    const vault = {
      items: [
        {
          id: "card-1",
          type: 3,
          card: { number: "4111111111111111", brand: "Visa" },
          fields: [{ name: "PIN", value: "1234" }],
          passwordHistory: [{ password: "old-secret", lastUsedDate: null }],
          login: {
            uris: ["https://primary.example", "https://secondary.example"],
            fido2Credentials: [{ credentialId: "credential-1" }],
          },
        },
        { id: "note-1", type: 2, notes: "Preserve this note category" },
      ],
    };

    const onePux = exportVault(vault, "1password-1pux");
    expect(onePux.warnings.join(" ")).toContain("card and identity details");

    const csv = exportVault(vault, "1password-csv");
    expect(csv.warnings.join(" ")).toContain("card and identity details");
    expect(csv.warnings.join(" ")).toContain("only the primary URI");
    expect(csv.warnings.join(" ")).toContain("does not preserve item types");
    expect(csv.warnings.join(" ")).toContain("item IDs and dates");
  });

  test("auto-detects and round-trips KeePass XML and KeePass CSV", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<KeePassFile>
  <Root>
    <Group>
      <Name>Root</Name>
      <Group>
        <Name>Finance</Name>
        <Entry>
          <UUID>uuid-1</UUID>
          <String><Key>Title</Key><Value>Bank &amp; Co</Value></String>
          <String><Key>UserName</Key><Value>alice</Value></String>
          <String><Key>Password</Key><Value>Secur3!Pass99</Value></String>
          <String><Key>URL</Key><Value>https://bank.example.com</Value></String>
          <String><Key>Notes</Key><Value>Pin &lt;1234&gt;</Value></String>
        </Entry>
      </Group>
    </Group>
  </Root>
</KeePassFile>`;

    const parsedXml = parseVault(xml);
    expect(parsedXml.format).toBe("keepass-xml");
    expect(parsedXml.vault.items[0].name).toBe("Bank & Co");
    expect(parsedXml.vault.items[0].notes).toBe("Pin <1234>");
    expect(parsedXml.vault.folders?.[0].name).toBe("Finance");

    const exportedXml = exportVault(parsedXml.vault, "keepass-xml");
    expect(exportedXml.extension).toBe("xml");
    const reparsedXml = parseVault(exportedXml.content as string);
    expect(reparsedXml.format).toBe("keepass-xml");
    expect(reparsedXml.vault.items[0].name).toBe("Bank & Co");
  });

  test("cross-format conversion works across all 20 formats", () => {
    const source = parseVault(
      JSON.stringify({
        encrypted: false,
        folders: [{ id: "f1", name: "Work" }],
        items: [
          {
            id: "1",
            name: "Example",
            type: 1,
            folderId: "f1",
            favorite: true,
            notes: "My note",
            login: {
              username: "user@example.com",
              password: "SuperStrong!Password1",
              uris: [{ uri: "https://example.com" }],
              totp: "JBSWY3DPEHPK3PXP",
            },
          },
        ],
      }),
    );

    const allFormats: VaultFormatId[] = VAULT_FORMATS.map((f) => f.id);
    for (const targetFormat of allFormats) {
      const exported = exportVault(source.vault, targetFormat);
      const reparsed = parseVault(exported.content);
      expect(reparsed.format).toBe(targetFormat);
      expect(reparsed.vault.items.length).toBe(1);
      expect(reparsed.vault.items[0].login?.username).toBe("user@example.com");
      expect(reparsed.vault.items[0].login?.password).toBe("SuperStrong!Password1");
    }
  });

  test("browser CSV exports warn when vault fields would be dropped", () => {
    const vault = {
      folders: [{ id: "folder-1", name: "Work" }],
      items: [
        {
          id: "login-1",
          name: "Work Portal",
          type: 1,
          folderId: "folder-1",
          favorite: true,
          notes: "Recovery instructions",
          fields: [{ name: "PIN", value: "1234" }],
          login: {
            username: "alice",
            password: "Strong!Password123",
            uris: [{ uri: "https://example.com", match: 2 }, { uri: "https://example.com/admin" }],
            totp: "JBSWY3DPEHPK3PXP",
          },
        },
      ],
    };

    const chrome = exportVault(vault, "chrome-csv");
    expect(chrome.warnings.join(" ")).toContain("only the primary URI");
    expect(chrome.warnings.join(" ")).toContain("URI match settings");
    expect(chrome.warnings.join(" ")).toContain("TOTP secrets");
    expect(chrome.warnings.join(" ")).toContain("item IDs");

    const firefox = exportVault(vault, "firefox-csv");
    expect(firefox.warnings.join(" ")).toContain("item names");
    expect(firefox.warnings.join(" ")).toContain("notes or TOTP secrets");

    const safari = exportVault(vault, "safari-csv");
    expect(safari.warnings.join(" ")).toContain("only the primary URI");
    expect(safari.warnings.join(" ")).not.toContain("TOTP secrets");
  });

  test("Firefox CSV keeps item IDs and password-change dates without a loss warning", () => {
    const vault = {
      items: [
        {
          id: "firefox-guid",
          type: 1,
          lastModified: "2024-05-06T07:08:09.000Z",
          login: {
            username: "alice",
            password: "Strong!Password123",
            uris: ["https://example.com"],
          },
        },
      ],
    };
    const exported = exportVault(vault, "firefox-csv");
    const reparsed = parseVault(exported.content as string);

    expect(exported.warnings).toEqual([]);
    expect(reparsed.vault.items[0].id).toBe("firefox-guid");
    expect(reparsed.vault.items[0].lastModified).toBe("2024-05-06T07:08:09.000Z");
  });

  test("Firefox CSV avoids collisions between generated IDs and GUIDs", () => {
    const csv = [
      "url,username,password,httpRealm,formActionOrigin,guid",
      "https://one.example,alice,secret,,,",
      "https://two.example,bob,secret,,,firefox-1",
    ].join("\n");
    const parsed = parseVault(csv, { format: "firefox-csv" });

    expect(parsed.vault.items.map((item) => item.id)).toEqual(["firefox-1", "firefox:firefox-1"]);
    expect(new Set(parsed.vault.items.map((item) => item.id)).size).toBe(2);
  });

  test("Firefox CSV ignores out-of-range password-change timestamps", () => {
    const csv = [
      "url,username,password,httpRealm,formActionOrigin,guid,timePasswordChanged",
      "https://example.com,alice,secret,,,guid,1e100",
    ].join("\n");
    const parsed = parseVault(csv, { format: "firefox-csv" });

    expect(parsed.vault.items[0].lastModified).toBeUndefined();
  });

  test("Dashlane exports preserve secure note types and warn about unsupported details", () => {
    const vault = {
      folders: [{ id: "home", name: "Home" }],
      items: [
        { id: "note-1", name: "WiFi", type: 2, folderId: "home", notes: "secret phrase" },
        {
          id: "card-1",
          name: "Travel card",
          type: 3,
          card: { number: "4111111111111111" },
        },
      ],
    };

    const json = exportVault(vault, "dashlane-json");
    const parsedJson = parseVault(json.content as string);
    expect(parsedJson.vault.items.find((item) => item.name === "WiFi")).toMatchObject({
      type: 2,
      notes: "secret phrase",
    });
    expect(json.warnings.join(" ")).toContain("card");

    const csv = exportVault(vault, "dashlane-csv");
    const parsedCsv = parseVault(csv.content as string);
    expect(parsedCsv.vault.items.find((item) => item.name === "WiFi")).toMatchObject({
      type: 2,
      notes: "secret phrase",
    });
    expect(csv.warnings.join(" ")).toContain("item IDs");
  });

  test("Keeper exports warn about omitted data and keep note types in JSON", () => {
    const vault = {
      items: [
        { id: "note-1", name: "Recovery", type: 2, notes: "recovery phrase" },
        {
          id: "login-1",
          name: "Portal",
          type: 1,
          favorite: true,
          fields: [{ name: "PIN", value: "1234", type: 1 }],
          login: {
            username: "alice",
            password: "Strong!Password123",
            uris: [{ uri: "https://one.example", match: 3 }, { uri: "https://two.example" }],
            totp: "JBSWY3DPEHPK3PXP",
          },
        },
      ],
    };

    const json = exportVault(vault, "keeper-json");
    const parsedJson = parseVault(json.content as string);
    expect(parsedJson.vault.items.find((item) => item.name === "Recovery")).toMatchObject({
      type: 2,
      notes: "recovery phrase",
    });
    expect(json.warnings.join(" ")).toContain("URI match settings");
    expect(json.warnings.join(" ")).toContain("item IDs");
    expect(json.warnings.join(" ")).toContain("custom-field types");

    const csv = exportVault(vault, "keeper-csv");
    expect(csv.warnings.join(" ")).toContain("item types");
    expect(csv.warnings.join(" ")).toContain("TOTP secrets");
    expect(csv.warnings.join(" ")).toContain("custom fields");
  });

  test("NordPass CSV warns about fields it cannot round-trip", () => {
    const exported = exportVault(
      {
        items: [
          {
            id: "item-1",
            type: 1,
            fields: [{ name: "Recovery code", value: "hidden" }],
            login: {
              uris: [
                { uri: "https://example.com", match: 2 },
                { uri: "https://example.com/admin" },
              ],
            },
          },
          {
            type: 3,
            card: { brand: "Visa", number: "4111111111111111" },
            identity: { company: "Example Corp", firstName: "Alice" },
          },
        ],
      },
      "nordpass-csv",
    );

    expect(exported.warnings.join(" ")).toContain("only the primary URI");
    expect(exported.warnings.join(" ")).toContain("URI match settings");
    expect(exported.warnings.join(" ")).toContain("card brand");
    expect(exported.warnings.join(" ")).toContain("custom fields");
  });

  test("Enpass JSON round-trips supported identity and card fields", () => {
    const exported = exportVault(
      {
        items: [
          {
            id: "identity-1",
            name: "Alice",
            type: 4,
            identity: {
              firstName: "Alice",
              lastName: "Example",
              email: "alice@example.com",
              phone: "+1 555 0100",
              address1: "1 Main St",
              city: "Phoenix",
              state: "AZ",
              postalCode: "85001",
              country: "US",
            },
          },
          {
            name: "Travel",
            type: 3,
            card: { brand: "Visa", number: "4111111111111111", expMonth: "12", expYear: "2030" },
          },
        ],
      },
      "enpass-json",
    );
    const parsed = parseVault(exported.content as string);

    expect(parsed.vault.items[0].identity).toMatchObject({
      firstName: "Alice",
      lastName: "Example",
      email: "alice@example.com",
      phone: "+1 555 0100",
      address1: "1 Main St",
      city: "Phoenix",
      state: "AZ",
      postalCode: "85001",
      country: "US",
    });
    expect(parsed.vault.items[1].card).toMatchObject({
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "12",
      expYear: "2030",
    });
  });

  test("Enpass JSON avoids collisions between generated IDs and UUIDs", () => {
    const parsed = parseVault(
      JSON.stringify({
        items: [{ uuid: "enpass-2", title: "Explicit" }, { title: "Generated" }],
      }),
      { format: "enpass-json" },
    );

    expect(parsed.vault.items.map((item) => item.id)).toEqual(["enpass-2", "enpass:enpass-2"]);
  });

  test("KeePass exports warn when they omit vault data", () => {
    const vault = {
      items: [
        {
          id: "login-1",
          type: 1,
          favorite: true,
          fields: [{ name: "Recovery code", value: "secret" }],
          login: {
            username: "alice",
            password: "Strong!Password123",
            uris: [{ uri: "https://example.com", match: 2 }, { uri: "https://example.com/admin" }],
            totp: "JBSWY3DPEHPK3PXP",
          },
        },
      ],
    };

    const xml = exportVault(vault, "keepass-xml");
    // XML preserves extra URIs and custom fields but must normalize non-KeePass IDs to UUIDs.
    expect(xml.warnings.join(" ")).not.toContain("primary URI");
    expect(xml.warnings.join(" ")).not.toContain("custom fields");
    expect(xml.warnings.join(" ")).toContain("URI match settings");
    expect(xml.warnings.join(" ")).toContain("stable 16-byte UUIDs");
    expect(csv0(vault).warnings.join(" ")).toContain("primary URI");
    expect(csv0(vault).warnings.join(" ")).toContain("custom fields");

    const csv = exportVault(vault, "keepass-csv");
    expect(csv.warnings.join(" ")).toContain("item IDs");
    expect(csv.warnings.join(" ")).toContain("URI match settings");
  });

  test("LastPass CSV warns about fields it cannot preserve", () => {
    const exported = exportVault(
      {
        items: [
          {
            id: "login-1",
            type: 1,
            favorite: true,
            fields: [{ name: "Recovery code", value: "secret" }],
            login: {
              uris: [
                { uri: "https://example.com", match: 3 },
                { uri: "https://example.com/admin" },
              ],
            },
          },
        ],
      },
      "lastpass-csv",
    );

    expect(exported.warnings.join(" ")).toContain("only the primary URI");
    expect(exported.warnings.join(" ")).toContain("URI match settings");
    expect(exported.warnings.join(" ")).toContain("custom fields");
    expect(exported.warnings.join(" ")).not.toContain("favorites");
  });

  test("handles Bitwarden CSV custom fields, reprompt, and multi-URI", () => {
    const csv = [
      "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
      'Work,1,login,Portal,Note,"PIN: 1234\nEnv: Prod",1,"https://a.com,https://b.com",alice,Str0ng!Pass99,TOTP1',
    ].join("\n");
    const parsed = parseVault(csv);
    expect(parsed.format).toBe("bitwarden-csv");
    const item = parsed.vault.items[0];
    expect(item.reprompt).toBe(1);
    expect(item.fields?.length).toBe(2);
    expect(item.fields?.[0]).toEqual({ name: "PIN", value: "1234", type: 0 });
    expect(item.login?.uris?.length).toBe(2);

    const exported = exportVault(parsed.vault, "bitwarden-csv");
    const reparsed = parseVault(exported.content as string);
    expect(reparsed.vault.items[0].fields?.length).toBe(2);
    expect(reparsed.vault.items[0].reprompt).toBe(1);
  });

  test("preserves Bitwarden CSV custom-field whitespace and warns about metadata loss", () => {
    const vault = {
      items: [
        {
          name: "CSV fields",
          fields: [
            { name: "Padded", value: "  keep spaces  ", type: 0 },
            { name: "Hidden", value: "field-value", type: 1, linkedId: 7 },
          ],
        },
      ],
    };
    const exported = exportVault(vault, "bitwarden-csv");
    expect(exported.warnings).toHaveLength(1);

    const reparsed = parseVault(exported.content as string);
    expect(reparsed.vault.items[0].fields?.[0]).toEqual({
      name: "Padded",
      value: "  keep spaces  ",
      type: 0,
    });
    expect(reparsed.vault.items[0].fields?.[1]?.type).toBe(0);
  });

  test("warns when Bitwarden CSV drops JSON-only card or FIDO metadata", () => {
    const exported = exportVault(
      {
        items: [
          {
            id: "card-item",
            type: 3,
            card: { number: "0000", brand: "Visa" },
            login: { uris: [{ uri: "https://example.test/?value=a,b", match: 2 }] },
          },
        ],
      },
      "bitwarden-csv",
    );
    expect(exported.warnings.join(" ")).toContain("card and identity details");
    expect(exported.warnings.join(" ")).toContain("URI match settings");
    expect(exported.warnings.join(" ")).toContain("inside a URI");
  });

  test("preserves Bitwarden organization collections in JSON and CSV exports", () => {
    const organization = {
      collections: [{ id: "collection-1", name: "Engineering", organizationId: "org-1" }],
      items: [
        {
          id: "item-1",
          name: "Portal",
          type: 1,
          favorite: false,
          reprompt: 0,
          collectionIds: ["collection-1"],
          organizationId: "org-1",
          fields: [],
          passwordHistory: [],
          creationDate: "2025-01-01T00:00:00.000Z",
          revisionDate: "2025-01-02T00:00:00.000Z",
          login: { username: "person", password: "secret", uris: [], fido2Credentials: [] },
        },
      ],
    };
    const parsed = parseVault(JSON.stringify(organization));
    expect(parsed.vault.collections).toEqual(organization.collections);
    expect(parsed.vault.items[0].collectionIds).toEqual(["collection-1"]);

    const jsonExport = exportVault(parsed.vault, "bitwarden-json");
    const jsonRoundTrip = parseVault(jsonExport.content as string);
    expect(jsonRoundTrip.vault.collections).toEqual(organization.collections);
    expect(jsonRoundTrip.vault.items[0].organizationId).toBe("org-1");

    const csvExport = exportVault(parsed.vault, "bitwarden-csv");
    expect(csvExport.content).toContain("collections,type,name");
    const csvRoundTrip = parseVault(csvExport.content as string);
    expect(csvRoundTrip.vault.collections?.[0]?.name).toBe("Engineering");
    expect(csvRoundTrip.vault.items[0].collectionIds).toEqual(["collection-1"]);
  });

  test("warns when Bitwarden CSV cannot map item collection IDs", () => {
    const exported = exportVault(
      {
        collections: [{ id: "known", name: "Engineering" }],
        items: [{ name: "Unmapped", collectionIds: ["missing"] }],
      },
      "bitwarden-csv",
    );

    expect(exported.warnings.join(" ")).toContain(
      "collection assignments with unknown collection IDs",
    );
  });

  test("accepts Bitwarden JSON exports without an encrypted flag", () => {
    const parsed = parseVault(JSON.stringify({ folders: [], items: [] }));
    expect(parsed.format).toBe("bitwarden-json");
    expect(parsed.vault.encrypted).toBeUndefined();
  });

  test("rejects malformed Bitwarden item and nested array shapes cleanly", () => {
    expect(() => parseVault(JSON.stringify({ items: [null] }))).toThrow(
      /"items" must be an array of objects/,
    );
    expect(() => parseVault(JSON.stringify({ items: [{ fields: {} }] }))).toThrow(
      /item 0 "fields" must be an array/,
    );
    expect(() => parseVault(JSON.stringify({ items: [{ login: { uris: {} } }] }))).toThrow(
      /login "uris" must be an array/,
    );
    expect(() => parseVault(JSON.stringify({ items: [{ fields: [null] }] }))).toThrow(
      /"fields" must contain objects/,
    );
    expect(() => parseVault(JSON.stringify({ items: [{ login: { uris: [null] } }] }))).toThrow(
      /"uris" must contain strings or URI objects/,
    );
  });

  test("handles Proton Pass JSON (itemUsername, extraFields, trashed) and 9-col CSV", () => {
    const json = JSON.stringify({
      encrypted: false,
      vaults: {
        v1: {
          name: "Main",
          items: [
            {
              itemId: "p1",
              state: 1,
              data: {
                type: "login",
                metadata: { name: "Proton", note: "n" },
                content: {
                  itemUsername: "puser",
                  password: "Str0ng!Password1",
                  urls: ["https://proton.me"],
                },
                extraFields: [{ fieldName: "Recovery", type: "text", data: { content: "abc" } }],
              },
            },
            {
              itemId: "p2",
              state: 2,
              data: { type: "login", metadata: { name: "Trashed" }, content: {} },
            },
          ],
        },
      },
    });
    const parsedJson = parseVault(json);
    expect(parsedJson.format).toBe("protonpass-json");
    expect(parsedJson.vault.items.length).toBe(1);
    expect(parsedJson.vault.items[0].login?.username).toBe("puser");
    expect(parsedJson.vault.items[0].fields?.[0].name).toBe("Recovery");

    const exportedJson = exportVault(parsedJson.vault, "protonpass-json");
    const roundTrippedJson = parseVault(exportedJson.content as string);
    expect(roundTrippedJson.vault.items[0].fields?.[0]).toEqual({
      name: "Recovery",
      value: "abc",
      type: 0,
    });

    const csv9 = [
      "type,name,url,email,username,password,totp,note,vault",
      "note,My Note,,,,Secret,,body,Personal",
    ].join("\n");
    const parsedCsv = parseVault(csv9);
    expect(parsedCsv.format).toBe("protonpass-csv");
    expect(parsedCsv.vault.items[0].type).toBe(2);
  });

  test("round-trips native Proton Pass ZIP payloads and preserves extended item data", async () => {
    const source = {
      version: "2.3.3",
      userId: "synthetic-user",
      vaults: {
        share: {
          name: "Personal",
          folders: [{ folderId: "nested", parentFolderId: null, name: "Nested" }],
          items: [
            {
              itemId: "login",
              shareId: "share",
              folderId: "nested",
              state: 1,
              createTime: 10,
              modifyTime: 20,
              data: {
                type: "login",
                metadata: { name: "Synthetic", note: "note" },
                content: {
                  itemUsername: "user",
                  itemEmail: "email@example.invalid",
                  password: "synthetic-secret",
                  urls: ["https://example.test"],
                  autofillUrls: [
                    { url: "https://example.test", mode: 0 },
                    { url: "https://other.test", mode: 1 },
                  ],
                  totpUri: "otpauth://totp/synthetic",
                },
                extraFields: [
                  { fieldName: "Token", type: "totp", data: { totpUri: "synthetic-otp" } },
                ],
              },
            },
            {
              itemId: "card",
              state: 1,
              data: {
                type: "creditCard",
                metadata: { name: "Card", note: "" },
                content: { number: "0000", expirationDate: "2030-01", verificationNumber: "123" },
              },
            },
            {
              itemId: "wifi",
              state: 1,
              data: {
                type: "wifi",
                metadata: { name: "Network", note: "" },
                content: { ssid: "Synthetic network", password: "synthetic-wifi-secret" },
              },
            },
          ],
        },
        shared: {
          name: "Shared",
          items: [
            {
              itemId: "login",
              state: 1,
              data: {
                type: "login",
                metadata: { name: "Other vault", note: "" },
                content: { itemUsername: "other", urls: [] },
              },
            },
          ],
        },
      },
    };
    const zip = createZipArchive({ "Proton Pass/data.json": JSON.stringify(source) });
    const parsed = await parseVaultAsync(zip, { fileName: "proton-export.zip" });
    expect(parsed.format).toBe("protonpass-json");
    expect(parsed.vault.items[0].login?.username).toBe("user");
    expect(parsed.vault.items[0]._providerData).toBeDefined();
    const exported = exportVault(parsed.vault, "protonpass-json");
    const roundTrip = parseVault(exported.content as string);
    const raw = JSON.parse(exported.content as string);
    const outputItems = Object.values(raw.vaults).flatMap((vault: any) => vault.items);
    const outputLogin = outputItems.find((item: any) => item.itemId === "login");
    expect(outputLogin.data.content.autofillUrls).toHaveLength(2);
    expect(outputLogin.data.content.itemEmail).toBe("email@example.invalid");
    expect(outputLogin.data.extraFields[0].data.totpUri).toBe("synthetic-otp");
    expect(roundTrip.vault.items).toHaveLength(4);
    expect(new Set(outputItems.map((item: any) => item.itemId)).size).toBe(3);
    expect(outputItems.find((item: any) => item.data.type === "wifi").data.content.ssid).toBe(
      "Synthetic network",
    );
    expect(raw.vaults.shared.name).toBe("Shared");
    expect(raw.vaults.shared.items[0].itemId).toBe("login");
  });

  test("round-trips current Proton Pass CSV columns", () => {
    const csv =
      'type,name,url,autofillUrls,email,username,password,note,totp,vault,createTime,modifyTime\nlogin,Example,https://example.test,"[{""url"":""https://example.test"",""mode"":0}]",email@example.invalid,user,synthetic-secret,,otpauth://totp/example,Personal,10,20';
    const parsed = parseVault(csv);
    expect(parsed.vault.items[0].login?.username).toBe("user");
    const exported = exportVault(parsed.vault, "protonpass-csv");
    expect(exported.content).toContain("autofillUrls");
    expect(exported.content).toContain("email@example.invalid");
  });

  test("exports Proton Pass vaults with prototype-like folder names", () => {
    const exported = exportVault(
      {
        folders: [{ id: "constructor-folder", name: "constructor" }],
        items: [{ id: "item-1", name: "Admin", folderId: "constructor-folder" }],
      },
      "protonpass-json",
    );
    const parsed = parseVault(exported.content as string);
    expect(parsed.vault.items[0].name).toBe("Admin");
    expect(parsed.vault.folders?.[0].name).toBe("constructor");
  });

  test("keeps generated IDs distinct from explicit Proton Pass IDs", () => {
    const parsed = parseVault(
      JSON.stringify({
        vaults: {
          personal: {
            items: [
              { data: { type: "login", metadata: { name: "Generated" }, content: {} } },
              {
                itemId: "proton-1",
                data: { type: "login", metadata: { name: "Explicit" }, content: {} },
              },
            ],
          },
        },
      }),
      { format: "protonpass-json" },
    );

    expect(parsed.vault.items.map((item) => item.id)).toEqual(["proton-1", "personal:proton-1"]);
    expect(new Set(parsed.vault.items.map((item) => item.id)).size).toBe(2);
  });

  test("keeps distinct Proton Pass folder names with colliding slugs separate", () => {
    const exported = exportVault(
      {
        folders: [
          { id: "folder-space", name: "A B" },
          { id: "folder-hyphen", name: "A-B" },
        ],
        items: [
          { id: "item-space", name: "Space folder item", folderId: "folder-space" },
          { id: "item-hyphen", name: "Hyphen folder item", folderId: "folder-hyphen" },
        ],
      },
      "protonpass-json",
    );
    const parsed = parseVault(exported.content as string);

    expect(parsed.vault.items).toHaveLength(2);
    expect(parsed.vault.folders?.map((folder) => folder.name).sort()).toEqual(["A B", "A-B"]);
    expect(parsed.vault.items.map((item) => item.folderId)).toHaveLength(2);
    expect(new Set(parsed.vault.items.map((item) => item.folderId)).size).toBe(2);
  });

  test("warns about metadata omitted from Proton Pass exports", () => {
    const vault = {
      items: [
        {
          id: "card-1",
          type: 3,
          favorite: true,
          card: { number: "4111111111111111" },
          fields: [{ name: "PIN", value: "1234" }],
          login: { uris: ["https://one.example", "https://two.example"] },
        },
      ],
    };

    const json = exportVault(vault, "protonpass-json");
    expect(json.warnings.join(" ")).toContain("card and identity details");
    expect(json.warnings.join(" ")).toContain("favorites");

    const csv = exportVault(vault, "protonpass-csv");
    expect(csv.warnings.join(" ")).toContain("custom fields");
    expect(csv.warnings.join(" ")).toContain("only the primary URI");
    expect(csv.warnings.join(" ")).toContain("item types");
  });

  test("handles KeePass 2.x CSV, KeePass XML History/TimeOtp, Dashlane NOTE, and NordPass cards", () => {
    const kp2Csv = [
      "Account,Login Name,Password,Web Site,Comments",
      "Server,root,Str0ng!Pass99,https://srv.local,ssh",
    ].join("\n");
    expect(parseVault(kp2Csv).format).toBe("keepass-csv");

    const kpXml = `<KeePassFile><Root><Group><Name>Root</Name>
      <Entry>
        <String><Key>Title</Key><Value>Active</Value></String>
        <String><Key>UserName</Key><Value>u</Value></String>
        <String><Key>Password</Key><Value>p</Value></String>
        <String><Key>TimeOtp-Secret-Base32</Key><Value>BASE32SECRET</Value></String>
        <History><Entry><String><Key>Title</Key><Value>Old</Value></String></Entry></History>
      </Entry>
    </Group></Root></KeePassFile>`;
    const parsedKp = parseVault(kpXml);
    expect(parsedKp.vault.items.length).toBe(1);
    expect(parsedKp.vault.items[0].login?.totp).toBe("BASE32SECRET");

    const dashlane = JSON.stringify({
      AUTHENTIFIANT: [],
      NOTE: [{ title: "WiFi", content: "pass123", category: "Home" }],
    });
    const parsedDash = parseVault(dashlane);
    expect(parsedDash.format).toBe("dashlane-json");
    expect(parsedDash.vault.items[0].type).toBe(2);

    const nordCsv = [
      "name,url,username,password,note,cardholdername,cardnumber,cvc,expirydate,zipcode,folder,full_name,phone_number,email,address1,address2,city,country,state,type",
      "Visa,,,,,Alice,4111,123,12/28,90210,Cards,,,,,,,,,credit_card",
    ].join("\n");
    const parsedNord = parseVault(nordCsv);
    expect(parsedNord.format).toBe("nordpass-csv");
    expect(parsedNord.vault.items[0].type).toBe(3);
    expect(parsedNord.vault.items[0].card?.number).toBe("4111");
  });
});

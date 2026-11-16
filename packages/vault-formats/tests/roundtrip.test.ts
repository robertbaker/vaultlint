import { describe, expect, test } from "bun:test";

import { encodeOnePasswordTag, splitOnePasswordTags } from "../src/adapters/onepassword";
import { parseVault, parseVaultAsync } from "../src/index";
import { exportVault } from "../src/registry";
import { escapeXml, parseXml } from "../src/xml";
import { createZipArchive } from "../src/zip";

describe("xml robustness", () => {
  test("escapeXml strips XML-invalid control characters and lone surrogates", () => {
    expect(escapeXml("a\u0000b\u0008c\u000Bd\u001Fe\uFFFEf")).toBe("abcdef");
    expect(escapeXml("tab\tnl\ncr\r")).toBe("tab\tnl\ncr\r");
    expect(escapeXml("x\uD800y")).toBe("xy");
    expect(escapeXml("ok \u{1F600}")).toBe("ok \u{1F600}");
  });

  test("stray closing tag does not unwind the stack", () => {
    const doc = parseXml("<a><b>one</b></x><c>two</c></a>");
    expect(doc?.children.map((c) => c.tag)).toEqual(["b", "c"]);
    expect(doc?.children[1].text).toBe("two");
  });

  test("'>' inside an attribute value does not end the tag", () => {
    const doc = parseXml("<a><v note=\"x > y\" other='1>2'>val</v><w/></a>");
    const v = doc?.children[0];
    expect(v?.attributes["note"]).toBe("x > y");
    expect(v?.attributes["other"]).toBe("1>2");
    expect(v?.text).toBe("val");
    expect(doc?.children.map((c) => c.tag)).toEqual(["v", "w"]);
  });

  test("processing instructions inside the document are skipped", () => {
    const doc = parseXml("<a><?pi data?><b/></a>");
    expect(doc?.children.map((c) => c.tag)).toEqual(["b"]);
  });
});

describe("keepass xml", () => {
  test("round-trips custom fields, extra URIs, card and identity details", () => {
    const vault = {
      items: [
        {
          id: "1",
          name: "Site",
          type: 1,
          login: {
            username: "u",
            password: "p",
            uris: [{ uri: "https://a.example" }, { uri: "https://b.example" }, "https://c.example"],
            totp: "JBSWY3DPEHPK3PXP",
          },
          fields: [
            { name: "Recovery", value: "abc", type: 1 },
            { name: "Title", value: "collides", type: 0 },
          ],
        },
        {
          id: "2",
          name: "Card",
          type: 3,
          card: { number: "4111111111111111", expMonth: "12", expYear: "2030", brand: "Visa" },
        },
        { id: "3", name: "Person", type: 4, identity: { firstName: "Al", city: "Phoenix" } },
      ],
    };
    const out = exportVault(vault, "keepass-xml");
    expect(out.warnings.join(" ")).not.toContain("custom fields");
    expect(out.warnings.join(" ")).not.toContain("primary URI");
    const parsed = parseVault(out.content as string);
    const [login, card, person] = parsed.vault.items;
    expect(login.login?.uris?.map((u) => (typeof u === "string" ? u : u.uri))).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
    expect(login.fields).toEqual([
      { name: "Recovery", value: "abc", type: 1 },
      { name: "Title", value: "collides", type: 0 },
    ]);
    expect(login.login?.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(card.type).toBe(3);
    expect(card.card).toMatchObject({ number: "4111111111111111", expMonth: "12", brand: "Visa" });
    expect(person.type).toBe(4);
    expect(person.identity).toMatchObject({ firstName: "Al", city: "Phoenix" });
  });

  test("export with control characters in values stays parseable", () => {
    const out = exportVault(
      {
        items: [
          { id: "1", name: "a\u0001b", type: 1, login: { username: "u", password: "p\u0000q" } },
        ],
      },
      "keepass-xml",
    );
    const parsed = parseVault(out.content as string);
    expect(parsed.vault.items[0].name).toBe("ab");
    expect(parsed.vault.items[0].login?.password).toBe("pq");
  });
});

describe("1password csv tags", () => {
  test("folder names with commas survive a round trip", () => {
    const vault = {
      folders: [{ id: "f1", name: "Work, Personal" }],
      items: [
        { id: "1", name: "A", type: 1, folderId: "f1", login: { username: "u", password: "p" } },
      ],
    };
    const out = exportVault(vault, "1password-csv");
    const parsed = parseVault(out.content as string, { format: "1password-csv" });
    expect(parsed.vault.folders?.map((f) => f.name)).toEqual(["Work, Personal"]);
  });

  test("tag escaping helpers are inverse and leave plain names untouched", () => {
    for (const name of ["Plain", "a,b", "a\\b", "a\\,b", "a\\\\b", "tail\\", "x,\\,y"]) {
      expect(splitOnePasswordTags(encodeOnePasswordTag(name))).toEqual([name]);
    }
    expect(encodeOnePasswordTag("a\\b")).toBe("a\\b");
    expect(splitOnePasswordTags("one, two ,three")).toEqual(["one", "two", "three"]);
  });

  test("extra plain tags warn on import", () => {
    const csv =
      'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nA,,u,p,,false,false,"x,y",\n';
    const parsed = parseVault(csv);
    expect(parsed.vault.folders?.map((f) => f.name)).toEqual(["x"]);
    expect(parsed.warnings.join(" ")).toContain("tag");
  });
});

describe("roboform quoting", () => {
  const header = "Name,Url,MatchUrl,Login,Pwd,Note,Folder,RfFieldsV2\n";

  test("guard quote is stripped only before formula characters", () => {
    const csv = `${header}A,https://a.example,https://a.example,'=user,'abc,,,\n`;
    const item = parseVault(csv, { format: "roboform-csv" }).vault.items[0];
    expect(item.login?.username).toBe("=user");
    // A genuine leading apostrophe is kept.
    expect(item.login?.password).toBe("'abc");
  });

  test("export re-adds the guard so values round-trip losslessly", () => {
    const values = ["=SUM(1)", "+1", "-x", "@me", "'abc", "'=x", "''x", "plain"];
    for (const value of values) {
      const vault = {
        items: [
          {
            id: "1",
            name: "A",
            type: 1,
            login: { username: value, password: value, uris: [{ uri: "https://a.example" }] },
            fields: [{ name: "f,1", value }],
          },
        ],
      };
      const out = exportVault(vault, "roboform-csv");
      const item = parseVault(out.content as string, { format: "roboform-csv" }).vault.items[0];
      expect(item.login?.username).toBe(value);
      expect(item.login?.password).toBe(value);
    }
  });

  test("export warns when nested custom-field names lose commas", () => {
    const out = exportVault(
      {
        items: [
          {
            name: "Account",
            type: 1,
            fields: [{ name: "Security, PIN", value: "1234" }],
          },
        ],
      },
      "roboform-csv",
    );

    expect(out.warnings.join(" ")).toContain(
      "replaces commas in custom-field names with semicolons",
    );
  });
});

describe("enpass", () => {
  test("JSON export writes login fields for items with a missing type", () => {
    const out = exportVault(
      {
        items: [
          {
            id: "1",
            name: "No type",
            login: { username: "u", password: "p", uris: [{ uri: "https://a.example" }] },
          },
        ],
      },
      "enpass-json",
    );
    const exported = JSON.parse(out.content as string);
    expect(exported.items[0].template_type).toBe("login.default");
    expect(exported.items[0].fields.map((f: { type: string }) => f.type)).toEqual([
      "username",
      "password",
      "url",
    ]);
    const parsed = parseVault(out.content as string);
    expect(parsed.vault.items[0].login?.password).toBe("p");
    expect(parsed.vault.items[0].id).toBe("1");
  });

  test("CSV export warns about dropped custom fields and extra URIs", () => {
    const out = exportVault(
      {
        items: [
          {
            name: "A",
            type: 1,
            login: {
              username: "u",
              password: "p",
              uris: [{ uri: "https://a" }, { uri: "https://b" }],
            },
            fields: [
              { name: "one", value: "1" },
              { name: "two", value: "2" },
              { name: "three", value: "3" },
            ],
          },
        ],
      },
      "enpass-csv",
    );
    const warnings = out.warnings.join(" ");
    expect(warnings).toContain("two custom fields");
    expect(warnings).toContain("custom field names");
    expect(warnings).toContain("primary URI");
  });

  test("CSV nested tag paths stay in one folder name", () => {
    const csv =
      "Title,Username,Email,Password,Website,TOTP Secret Key,Custom Field 1,*Custom Field 2,Note,Tags\nA,u,,p,,,,,,Work/Email\n";
    expect(parseVault(csv).vault.folders?.map((f) => f.name)).toEqual(["Work/Email"]);
  });
});

describe("keeper csv", () => {
  const rows = [
    'Personal,Bank,alice,"p,w",https://bank.example,note one,,Question,Answer',
    "Personal,Mail,bob,pw2,,,,,",
  ].join("\n");

  test("detects and parses headerless exports", () => {
    const parsed = parseVault(rows);
    expect(parsed.format).toBe("keeper-csv");
    expect(parsed.vault.items).toHaveLength(2);
    expect(parsed.vault.items[0]).toMatchObject({ name: "Bank", notes: "note one" });
    expect(parsed.vault.items[0].login).toMatchObject({ username: "alice", password: "p,w" });
    expect(parsed.vault.items[0].fields).toEqual([{ name: "Question", value: "Answer", type: 0 }]);
    expect(parsed.vault.folders?.map((f) => f.name)).toEqual(["Personal"]);
  });

  test("preserves both regular and shared folders in headerless Keeper CSV", () => {
    const parsed = parseVault(
      "Personal,Bank,alice,password,https://bank.example,note,Shared Team#edit#reshare\n",
    );
    const item = parsed.vault.items[0];
    expect(parsed.vault.folders?.map((folder) => folder.name)).toEqual([
      "Shared Team#edit#reshare",
    ]);
    expect(item.fields).toEqual([{ name: "Keeper folders", value: "Personal", type: 0 }]);
  });

  test("does not mis-detect other headerless or unknown CSVs", () => {
    expect(() => parseVault("name,url,username,password,note,extra\na,b,c,d,e,f\n")).toThrow();
    expect(() => parseVault("a,b,c\n1,2,3\n")).toThrow();
    // Short rows or non-URL fifth column are rejected.
    expect(() => parseVault("a,b,c,d,notaurl,f\n")).toThrow();
  });

  test("headered Keeper CSV still wins", () => {
    const csv = "Folder,Title,Login,Password,Website Address,Notes\nF,T,u,p,https://x.example,n\n";
    expect(parseVault(csv).vault.items[0].name).toBe("T");
  });

  test("JSON export writes login fields for items with a missing type", () => {
    const out = exportVault(
      { items: [{ name: "A", login: { username: "u", password: "p" } }] },
      "keeper-json",
    );
    expect(JSON.parse(out.content as string).records[0].login).toBe("u");
  });
});

describe("zip handling", () => {
  const onePux = JSON.stringify({ accounts: [{ attrs: { accountName: "a" }, vaults: [] }] });
  const proton = JSON.stringify({
    encrypted: false,
    vaults: { v1: { name: "V", items: [] } },
  });

  test("sync parseVault reads Proton ZIP archives", () => {
    const zip = createZipArchive({ "Proton Pass/data.json": proton });
    expect(parseVault(zip).format).toBe("protonpass-json");
  });

  test("encrypted Proton ZIP is rejected (sync and async)", async () => {
    const zip = createZipArchive({ "Proton Pass/data.pgp": "-----BEGIN PGP MESSAGE-----" });
    expect(() => parseVault(zip)).toThrow(/Encrypted Proton Pass/);
    await expect(parseVaultAsync(zip)).rejects.toThrow(/Encrypted Proton Pass/);
  });

  test("user-supplied format must match the archive contents", async () => {
    const zip = createZipArchive({ "export.data": onePux, "Proton Pass/data.json": proton });
    expect((await parseVaultAsync(zip, { format: "protonpass-json" })).format).toBe(
      "protonpass-json",
    );
    expect((await parseVaultAsync(zip, { format: "1password-1pux" })).format).toBe(
      "1password-1pux",
    );
    await expect(parseVaultAsync(zip, { format: "bitwarden-json" })).rejects.toThrow(
      /ZIP archives/,
    );
    const protonOnly = createZipArchive({ "Proton Pass/data.json": proton });
    await expect(parseVaultAsync(protonOnly, { format: "1password-1pux" })).rejects.toThrow(
      /export\.data/,
    );
    const onePuxOnly = createZipArchive({ "export.data": onePux });
    await expect(parseVaultAsync(onePuxOnly, { format: "protonpass-json" })).rejects.toThrow(
      /Proton Pass\/data\.json/,
    );
  });
});

import { describe, expect, test } from "bun:test";

import {
  exportVault,
  inspectVaultRoundTrip,
  parseVault,
  parseVaultAsync,
  VAULT_FORMATS,
} from "../src/index";
import { createZipArchive, readZipEntries, readZipEntriesSync } from "../src/zip";

const rich = {
  folders: [
    { id: "f1", name: 'Work, "Main"' },
    { id: "f2", name: "Ünï ✓" },
  ],
  items: [
    {
      id: "a1",
      name: 'Site, "quoted"',
      type: 1,
      folderId: "f1",
      favorite: true,
      notes: 'line1\nline2, "q"',
      login: {
        username: "me@x.com",
        password: 'p@ss,w"ord\n1',
        uris: [{ uri: "https://a.example/path?x=1&y=2" }, { uri: "https://b.example" }],
        totp: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP",
      },
      fields: [
        { name: "Recovery", value: "abc", type: 1 },
        { name: "Plain", value: "v", type: 0 },
      ],
    },
    { id: "a2", name: "Note", type: 2, folderId: "f2", notes: "secret body" },
    {
      id: "a3",
      name: "Card",
      type: 3,
      card: {
        cardholderName: "Al B",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "12",
        expYear: "2030",
        code: "123",
      },
    },
    {
      id: "a4",
      name: "Person",
      type: 4,
      identity: {
        title: "Mr",
        firstName: "Al",
        middleName: "Q",
        lastName: "Public",
        email: "a@b.c",
        phone: "555",
        address1: "1 Main",
        city: "Phoenix",
        state: "AZ",
        postalCode: "85001",
        country: "US",
      },
    },
  ],
};

const signature = (item: {
  name?: string;
  type?: number;
  login?: { username?: string; password?: string };
  fields?: unknown[];
}) =>
  JSON.stringify([
    item.name,
    item.type,
    item.login?.username ?? "",
    item.login?.password ?? "",
    (item.fields ?? []).length,
  ]);

describe("cross-format conversion harness", () => {
  const ids = VAULT_FORMATS.map((f) => f.id);

  test("every adapter pair converts without crashing and a second cycle is stable", async () => {
    for (const a of ids) {
      const parsedA = await parseVaultAsync(exportVault(rich, a).content, { format: a });
      for (const b of ids) {
        const first = await parseVaultAsync(exportVault(parsedA.vault, b).content, { format: b });
        const second = await parseVaultAsync(exportVault(first.vault, b).content, { format: b });
        // Repeated export/import must be a fixed point: no growing custom fields, no lost items.
        expect(second.vault.items.map(signature), `${a} -> ${b}`).toEqual(
          first.vault.items.map(signature),
        );
      }
    }
  });

  test("login credentials survive conversion between every pair of formats", async () => {
    const login = { items: [rich.items[0]] };
    for (const a of ids) {
      for (const b of ids) {
        const parsedA = await parseVaultAsync(exportVault(login, a).content, { format: a });
        const parsedB = await parseVaultAsync(exportVault(parsedA.vault, b).content, {
          format: b,
        });
        const item = parsedB.vault.items[0];
        expect(item?.login?.password, `${a} -> ${b}`).toBe(rich.items[0].login.password);
        expect(item?.login?.username, `${a} -> ${b}`).toBe("me@x.com");
      }
    }
  });
});

describe("1Password 1PUX fidelity", () => {
  test("card and identity sections are not duplicated as custom fields on re-import", async () => {
    let vault = (await parseVaultAsync(exportVault(rich, "1password-1pux").content)).vault;
    for (let i = 0; i < 3; i++) {
      vault = (await parseVaultAsync(exportVault(vault, "1password-1pux").content)).vault;
    }
    const card = vault.items[2];
    const person = vault.items[3];
    expect(card.fields).toBeUndefined();
    expect(person.fields).toBeUndefined();
    expect(card.card?.expMonth).toBe("12");
    expect(card.card?.expYear).toBe("2030");
    expect(person.identity?.title).toBe("Mr");
    expect(person.identity?.middleName).toBe("Q");
  });

  test("reads numeric monthYear/date values and address objects from real exports", () => {
    const pux = {
      accounts: [
        {
          vaults: [
            {
              attrs: { name: "Personal" },
              items: [
                {
                  uuid: "c",
                  categoryUuid: "002",
                  overview: { title: "Visa" },
                  details: {
                    sections: [
                      {
                        fields: [
                          { id: "ccnum", title: "number", value: { creditCardNumber: "4111" } },
                          { id: "expiry", title: "expiry date", value: { monthYear: 203112 } },
                          { id: "valid", title: "valid from", value: { monthYear: 202501 } },
                          { id: "d", title: "Issued", value: { date: 1700000000 } },
                        ],
                      },
                    ],
                  },
                },
                {
                  uuid: "i",
                  categoryUuid: "004",
                  overview: { title: "Me", tags: ["x"] },
                  details: {
                    sections: [
                      {
                        fields: [
                          { id: "firstname", title: "first name", value: { string: "Al" } },
                          { id: "initial", title: "initial", value: { string: "Q" } },
                          {
                            id: "address",
                            title: "address",
                            value: {
                              address: {
                                street: "1 Main",
                                city: "Phoenix",
                                zip: "85001",
                                country: "us",
                              },
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseVault(JSON.stringify(pux), { format: "1password-1pux" });
    const card = parsed.vault.items[0];
    const person = parsed.vault.items[1];
    expect(card.card).toMatchObject({ number: "4111", expMonth: "12", expYear: "2031" });
    expect(card.fields?.map((f) => f.value)).toEqual(["01/2025", "2023-11-14"]);
    expect(person.identity).toMatchObject({
      firstName: "Al",
      middleName: "Q",
      address1: "1 Main",
      city: "Phoenix",
      postalCode: "85001",
    });
    expect(person.fields).toBeUndefined();
    expect(parsed.warnings.join(" ")).toContain("1Password tags");
  });

  test("exports card expiry as a YYYYMM number", async () => {
    const out = exportVault(rich, "1password-1pux");
    const entries = await readZipEntries(out.content as Uint8Array);
    const data = new TextDecoder().decode(entries.get("export.data"));
    expect(data).toContain('"monthYear": 203012');
  });
});

describe("other adapter fixes", () => {
  test("NordPass export keeps the identity middle name in full_name", () => {
    const csv = exportVault(
      {
        items: [
          { name: "P", type: 4, identity: { firstName: "Al", middleName: "Q", lastName: "P" } },
        ],
      },
      "nordpass-csv",
    );
    expect(csv.content as string).toContain("Al Q P");
    const back = parseVault(csv.content as string, { format: "nordpass-csv" }).vault.items[0];
    expect(`${back.identity?.firstName} ${back.identity?.lastName}`).toBe("Al Q P");
  });

  test("LastPass keeps a type-2 item with a password as a note on re-import", () => {
    const out = exportVault(
      { items: [{ name: "N", type: 2, notes: "x", login: { username: "u", password: "pw" } }] },
      "lastpass-csv",
    );
    expect(out.warnings.join(" ")).toContain("secure notes");
    const back = parseVault(out.content as string, { format: "lastpass-csv" }).vault.items[0];
    expect(back.type).toBe(2);
    expect(back.login?.password).toBe("pw");
  });

  test("Enpass identity phone/address are not duplicated into custom fields", async () => {
    const id = { items: [rich.items[3]] };
    let vault = (await parseVaultAsync(exportVault(id, "enpass-json").content)).vault;
    vault = (await parseVaultAsync(exportVault(vault, "enpass-json").content)).vault;
    expect(vault.items[0].fields).toBeUndefined();
    expect(vault.items[0].identity?.phone).toBe("555");
  });

  test("armored PGP input is rejected when supplied as bytes", () => {
    const bytes = new TextEncoder().encode("-----BEGIN PGP MESSAGE-----\nabc");
    expect(() => parseVault(bytes)).toThrow(/PGP/);
  });
});

describe("round-trip report", () => {
  test("does not flag favorite:false, string-vs-object URIs or reformatted dates", async () => {
    const report = await inspectVaultRoundTrip(
      {
        items: [
          {
            id: "x",
            name: "Site",
            favorite: false,
            reprompt: 0,
            lastModified: "2024-01-02T03:04:05Z",
            login: { username: "u", password: "p", uris: ["https://example.com"] },
          },
        ],
      },
      "bitwarden-json",
    );
    expect(report.fieldChanges).toEqual([]);
  });
});

describe("zip hardening", () => {
  const centralOffset = (view: DataView, length: number) => view.getUint32(length - 22 + 16, true);

  test("accepts entries described by a data descriptor (zero local sizes)", () => {
    const copy = createZipArchive({ "export.data": "hello" }).slice();
    const view = new DataView(copy.buffer);
    // Streaming writers set bit 3 and zero the local crc/sizes; the central directory keeps them.
    view.setUint16(6, 0x0808, true);
    view.setUint32(14, 0, true);
    view.setUint32(18, 0, true);
    view.setUint32(22, 0, true);
    view.setUint16(centralOffset(view, copy.length) + 8, 0x0808, true);
    expect(new TextDecoder().decode(readZipEntriesSync(copy).get("export.data"))).toBe("hello");
  });

  test("rejects zip64 markers and multi-disk archives", () => {
    const base = createZipArchive({ a: "x" });
    const patched = (fn: (view: DataView, eocd: number) => void) => {
      const copy = base.slice();
      fn(new DataView(copy.buffer), copy.length - 22);
      return copy;
    };
    expect(() =>
      readZipEntriesSync(patched((v, e) => v.setUint16(e + 10, 0xffff, true))),
    ).toThrow();
    expect(() =>
      readZipEntriesSync(patched((v, e) => v.setUint32(e + 16, 0xffffffff, true))),
    ).toThrow();
    expect(() => readZipEntriesSync(patched((v, e) => v.setUint16(e + 4, 1, true)))).toThrow();
  });

  test("decodes legacy non-UTF-8 entry names instead of rejecting the archive", () => {
    const copy = createZipArchive({ "abc.txt": "x" }).slice();
    const view = new DataView(copy.buffer);
    const cd = centralOffset(view, copy.length);
    // Drop the UTF-8 flag and make the first name byte an invalid UTF-8 sequence (Latin-1 0xE9).
    view.setUint16(6, 0, true);
    view.setUint16(cd + 8, 0, true);
    copy[30] = 0xe9;
    copy[cd + 46] = 0xe9;
    expect([...readZipEntriesSync(copy).keys()]).toEqual(["ébc.txt"]);
  });

  test("sync reads of the same archive are cached", () => {
    const zip = createZipArchive({ a: "x" });
    expect(readZipEntriesSync(zip)).toBe(readZipEntriesSync(zip));
  });
});

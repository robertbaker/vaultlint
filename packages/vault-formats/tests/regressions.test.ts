import { describe, expect, test } from "bun:test";
import * as zlib from "node:zlib";

import { getRecordField } from "../src/csv";
import { exportVault, parseVault } from "../src/index";
import { unescapeXml } from "../src/xml";
import { readZipEntries } from "../src/zip";

function buildDeflateZip(name: string, data: Uint8Array): Uint8Array {
  const comp = zlib.deflateRawSync(data);
  const nameBytes = new TextEncoder().encode(name);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const lfh = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(lfh.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x0800, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  lfh.set(nameBytes, 30);
  const cd = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cd.set(nameBytes, 46);
  const eo = new Uint8Array(22);
  const ev = new DataView(eo.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, lfh.length + comp.length, true);
  const out = new Uint8Array(lfh.length + comp.length + cd.length + 22);
  out.set(lfh, 0);
  out.set(comp, lfh.length);
  out.set(cd, lfh.length + comp.length);
  out.set(eo, lfh.length + comp.length + cd.length);
  return out;
}

describe("vault-formats regressions", () => {
  test("async ZIP inflate does not hang on entries larger than the stream buffer", async () => {
    const data = new TextEncoder().encode("abcdefg".repeat(300_000));
    const entries = await readZipEntries(buildDeflateZip("f", data));
    expect(entries.get("f")?.length).toBe(data.length);
  }, 5000);

  test("getRecordField falls back to later candidates when the first column is empty", () => {
    const rec = Object.assign(Object.create(null), { username: "", Email: "me@x.com" });
    expect(getRecordField(rec, "username", "email")).toBe("me@x.com");
    expect(getRecordField(rec, "missing")).toBe("");
  });

  test("Proton Pass CSV keeps the email as username when username is empty", () => {
    const csv =
      "type,name,url,email,username,password,note,totp,createTime,modifyTime,vault\nlogin,a,http://x,e@x.com,,pw,,,,,V\n";
    expect(parseVault(csv).vault.items[0].login?.username).toBe("e@x.com");
  });

  test("KeePass CSV only strips a whole 'Root' group segment", () => {
    const csv =
      "Group,Title,Username,Password,URL\nRootkit,a,b,c,d\nRoot/Sub,e,f,g,h\nRoot,i,j,k,l\n";
    const { vault } = parseVault(csv, { format: "keepass-csv" });
    expect(vault.folders?.map((f) => f.name)).toEqual(["Rootkit", "Sub"]);
  });

  test("XML entities are decoded in a single pass", () => {
    expect(unescapeXml("&#38;lt;")).toBe("&lt;");
    expect(unescapeXml("&amp;#65;")).toBe("&#65;");
    expect(unescapeXml("&#x110000;&#xD800;")).toBe("&#x110000;&#xD800;");
    expect(unescapeXml("&lt;a&gt;&#65;&#x42;")).toBe("<a>AB");
  });

  test("Keeper JSON with non-string folder metadata parses", () => {
    const json = JSON.stringify({
      records: [
        {
          title: "T",
          login: "u",
          password: "p",
          folders: [{ shared_folder: "Shared", can_edit: true, can_share: false }],
        },
      ],
    });
    const { vault } = parseVault(json, { format: "keeper-json" });
    expect(vault.folders?.[0]?.name).toBe("Shared");
  });

  test("Proton Pass JSON tolerates null entries", () => {
    const json = JSON.stringify({
      vaults: {
        v: {
          name: "V",
          items: [null, { itemId: "1", data: { metadata: { name: "x" } } }],
          folders: [null],
        },
      },
    });
    expect(parseVault(json, { format: "protonpass-json" }).vault.items.length).toBe(1);
  });

  test("Proton Pass JSON tolerates null folders and extra fields", () => {
    const json = JSON.stringify({
      vaults: {
        v: {
          name: "V",
          folders: [null, { folderId: "f", name: "Personal" }],
          items: [
            {
              itemId: "1",
              folderId: "f",
              data: {
                metadata: { name: "x" },
                extraFields: [null, { fieldName: "Recovery", data: { content: "code" } }],
              },
            },
          ],
        },
      },
    });
    const item = parseVault(json, { format: "protonpass-json" }).vault.items[0];
    expect(item.folderId).toBe("folder-1");
    expect(item.fields).toEqual([{ name: "Recovery", value: "code", type: 0 }]);
  });

  test("Proton Pass JSON ignores out-of-range timestamps", () => {
    const json = JSON.stringify({
      vaults: {
        v: { items: [{ itemId: "1", modifyTime: 1e100, data: { metadata: { name: "x" } } }] },
      },
    });
    expect(
      parseVault(json, { format: "protonpass-json" }).vault.items[0].lastModified,
    ).toBeUndefined();
  });

  test("encrypted inputs are rejected by file name or PGP armor", () => {
    expect(() => parseVault("garbage", { fileName: "db.kdbx" })).toThrow(/kdbx/i);
    expect(() => parseVault("-----BEGIN PGP MESSAGE-----\nabc")).toThrow(/PGP/);
  });

  test("KeePass XML: user strings named card.* / identity.* stay custom fields", () => {
    const vault = {
      folders: [],
      items: [
        {
          id: "1",
          name: "Site",
          type: 1,
          login: { username: "u", password: "p", uris: [] },
          fields: [
            { name: "card.number", value: "not-a-card", type: 0 },
            { name: "identity.email", value: "x@y.z", type: 0 },
          ],
        },
        { id: "2", name: "Visa", type: 3, card: { number: "4111111111111111", brand: "Visa" } },
      ],
    } as never;
    const xml = exportVault(vault, "keepass-xml").content;
    const back = parseVault(xml, { format: "keepass-xml" }).vault;
    expect(back.items[0].type).toBe(1);
    expect(back.items[0].card).toBeUndefined();
    expect(back.items[0].fields?.map((f) => [f.name, f.value])).toEqual([
      ["card.number", "not-a-card"],
      ["identity.email", "x@y.z"],
    ]);
    expect(back.items[1].type).toBe(3);
    expect(back.items[1].card).toMatchObject({ number: "4111111111111111", brand: "Visa" });
  });

  test("KeePass XML: encrypted inner-stream values are rejected", () => {
    const xml = `<?xml version="1.0"?><KeePassFile><Root><Group><Name>Root</Name><Entry>
      <String><Key>Title</Key><Value>T</Value></String>
      <String><Key>Password</Key><Value Protected="True">aGVsbG8gY2lwaGVydGV4dA==</Value></String>
    </Entry></Group></Root></KeePassFile>`;
    expect(() => parseVault(xml, { format: "keepass-xml" })).toThrow(/encrypted/i);
  });

  test("NordPass identity email does not leak into login username", () => {
    const vault = {
      folders: [],
      items: [{ id: "1", name: "Me", identity: { firstName: "A", lastName: "B", email: "a@b.c" } }],
    } as never;
    const csv = exportVault(vault, "nordpass-csv").content;
    const back = parseVault(csv, { format: "nordpass-csv" }).vault.items[0];
    expect(back.type).toBe(4);
    expect(back.login?.username ?? "").toBe("");
    expect(back.identity?.email).toBe("a@b.c");
  });
});

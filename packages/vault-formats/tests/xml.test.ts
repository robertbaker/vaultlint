import { describe, expect, test } from "bun:test";

import { exportVault, parseVault } from "../src/registry";
import { findChild, parseXml } from "../src/xml";

describe("XML parser text handling", () => {
  test("preserves comment-shaped content inside CDATA while removing actual comments", () => {
    const root = parseXml(
      "<Root><!-- remove this --><Value><![CDATA[left <!-- keep --> right]]></Value></Root>",
    );
    expect(root && findChild(root, "Value")?.text).toBe("left <!-- keep --> right");
  });

  test("rejects unterminated comments", () => {
    expect(() => parseXml("<Root><!-- missing end</Root>")).toThrow(/unterminated comment/);
  });

  test("strict mode rejects truncated or mismatched XML without changing tolerant parsing", () => {
    expect(() => parseXml("<KeePassFile><Root><Group><Entry>", { strict: true })).toThrow(
      /unclosed <Entry>/,
    );
    expect(() => parseXml("<KeePassFile><Root></Group></KeePassFile>", { strict: true })).toThrow(
      /unexpected closing tag/,
    );
    expect(parseXml("<a><b>one</b></x><c>two</c></a>")?.children.map((c) => c.tag)).toEqual([
      "b",
      "c",
    ]);
    expect(() =>
      parseVault("<KeePassFile><Root><Group><Entry>", { format: "keepass-xml" }),
    ).toThrow(/unclosed <Entry>/);
  });

  test("preserves prototype-like attribute names without changing the attribute prototype", () => {
    const root = parseXml('<Root __proto__="payload" constructor="value"/>');
    expect(root?.attributes["__proto__"]).toBe("payload");
    expect(root?.attributes.constructor).toBe("value");
    expect(Object.getPrototypeOf(root?.attributes)).toBeNull();
  });
});

describe("KeePass XML IDs", () => {
  test("exports valid stable Base64 UUIDs and preserves already valid KeePass UUIDs", () => {
    const keePassUuid = "AAECAwQFBgcICQoLDA0ODw==";
    const vault = {
      items: [
        { id: keePassUuid, name: "Existing KeePass UUID" },
        { id: "bitwarden-id-1", name: "Converted ID" },
        { id: "bitwarden-id-1", name: "Duplicate source ID" },
      ],
    };

    const exported = exportVault(vault, "keepass-xml");
    const reparsed = parseVault(exported.content as string, { format: "keepass-xml" });
    const uuids = reparsed.vault.items.map((item) => item.id!);
    const repeatedExport = exportVault(vault, "keepass-xml");
    const repeatedIds = parseVault(repeatedExport.content as string, {
      format: "keepass-xml",
    }).vault.items.map((item) => item.id!);

    expect(uuids[0]).toBe(keePassUuid);
    expect(uuids).toEqual(repeatedIds);
    expect(new Set(uuids).size).toBe(uuids.length);
    for (const uuid of uuids) {
      expect(uuid).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(uuid, "base64")).toHaveLength(16);
    }
    expect(exported.warnings.join(" ")).toContain("converts non-KeePass item IDs");
  });

  test("converts hexadecimal UUIDs to the equivalent KeePass Base64 UUID without warning", () => {
    const vault = {
      items: [{ id: "000102030405060708090a0b0c0d0e0f", name: "Hex UUID" }],
    };

    const exported = exportVault(vault, "keepass-xml");
    const reparsed = parseVault(exported.content as string, { format: "keepass-xml" });

    expect(reparsed.vault.items[0]?.id).toBe("AAECAwQFBgcICQoLDA0ODw==");
    expect(exported.warnings.join(" ")).not.toContain("converts non-KeePass item IDs");
  });

  test("keeps generated fallback IDs distinct from entry UUIDs", () => {
    const xml = `<?xml version="1.0"?><KeePassFile><Root><Group><Name>Root</Name>
      <Entry><String><Key>Title</Key><Value>Generated</Value></String></Entry>
      <Entry><UUID>kp-xml-1</UUID><String><Key>Title</Key><Value>Explicit</Value></String></Entry>
    </Group></Root></KeePassFile>`;

    const parsed = parseVault(xml, { format: "keepass-xml" });
    expect(parsed.vault.items.map((item) => item.id)).toEqual(["kp-xml-1", "kp-xml:kp-xml-1"]);
    expect(new Set(parsed.vault.items.map((item) => item.id)).size).toBe(2);
  });
});

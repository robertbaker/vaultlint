import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { setupCLI } from "../src/cli";
import { loadDomainMappings } from "../src/domainMappingService";
import { findDuplicateGroups, mergeDuplicates } from "../src/duplicateService";
import { readUtf8Text } from "../src/safeWrite";
import { runVaultEnhancement } from "../src/vaultManager";
import { loadVaultWithMeta } from "../src/vaultService";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vl-rev-"));

describe("review regressions", () => {
  it("rejects invalid --port and --generate-password", () => {
    expect(() => setupCLI(["node", "x", "--port", "70000"])).toThrow(/--port/);
    expect(() => setupCLI(["node", "x", "--generate-password", "abc"])).toThrow(
      /--generate-password/,
    );
  });

  it("reads BOM-prefixed JSON config files", () => {
    const dir = tmp();
    const f = path.join(dir, "m.json");
    fs.writeFileSync(f, "﻿" + JSON.stringify({ "a.com": "b.com" }));
    expect(readUtf8Text(f).startsWith("{")).toBe(true);
    expect(loadDomainMappings(f)["a.com"]).toBe("b.com");
    fs.writeFileSync(
      f,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"a":"b"}', "utf16le")]),
    );
    expect(readUtf8Text(f)).toBe('{"a":"b"}');
  });

  it("loads UTF-16 vault exports and rejects armored PGP clearly", async () => {
    const dir = tmp();
    const f = path.join(dir, "v.json");
    const json = JSON.stringify({
      encrypted: false,
      folders: [],
      items: [{ id: "1", type: 1, name: "a", login: { username: "u", password: "p" } }],
    });
    fs.writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, "utf16le")]));
    expect((await loadVaultWithMeta(f)).vault.items).toHaveLength(1);
    fs.writeFileSync(f, "-----BEGIN PGP MESSAGE-----\n\nabc\n-----END PGP MESSAGE-----");
    await expect(loadVaultWithMeta(f)).rejects.toThrow(/PGP/);
  });

  it("duplicate grouping matches merge identity (type + name) and ignores blank names", () => {
    const vault = {
      items: [
        { name: "Visa", type: 1, login: {} },
        { name: "Visa", type: 3 },
        { name: "  ", type: 1 },
        { name: " ", type: 1 },
      ],
    };
    expect(findDuplicateGroups(vault)).toHaveLength(0);
    expect(mergeDuplicates(vault)).toBe(0);
    expect(vault.items).toHaveLength(4);
  });

  it("--json keeps stdout to the JSON payload only", async () => {
    const dir = tmp();
    const input = path.join(dir, "v.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        encrypted: false,
        folders: [],
        items: [
          { id: "1", type: 1, name: "a", login: { password: "x" } },
          { id: "2", type: 1, name: "A", login: { password: "y" } },
        ],
      }),
    );
    const out: string[] = [];
    const orig = console.log;
    const origErr = console.error;
    console.error = () => {};
    // Capture only what the pipeline emits through console.log while it is patched to stderr.
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    try {
      await runVaultEnhancement({
        input,
        json: true,
        autoMerge: true,
        output: path.join(dir, "o.json"),
      });
    } finally {
      console.log = orig;
      console.error = origErr;
    }
    expect(out).toHaveLength(1);
    expect(() => JSON.parse(out[0])).not.toThrow();
  });
});

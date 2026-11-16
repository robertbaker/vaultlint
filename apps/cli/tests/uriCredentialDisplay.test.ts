import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { createCliStyle } from "../src/cliUi";
import { renderVaultItemsTable, runVaultEnhancement } from "../src/vaultManager";

const VAULT = {
  encrypted: false,
  folders: [],
  items: [
    {
      id: "1",
      type: 1,
      name: "Acme",
      login: {
        username: "alice",
        password: "CANARY-PW-1",
        uris: [{ uri: "https://u:CANARY-URLPW@a.io/x?token=t" }],
      },
    },
    {
      id: "2",
      type: 1,
      name: "Bare",
      login: { username: "bob", password: "CANARY-PW-2", uris: [{ uri: "u:CANARY-URLPW@b.io/p" }] },
    },
  ],
};

describe("URI-embedded credentials are masked in CLI item listings", () => {
  it("masks user:password@ in the --list table", () => {
    const table = renderVaultItemsTable(VAULT as never, {}, createCliStyle(false));
    expect(table).not.toContain("CANARY-URLPW");
    expect(table).toContain("a.io");
  });

  it("masks user:password@ in --list --json output", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-uricred-"));
    const input = path.join(dir, "v.json");
    fs.writeFileSync(input, JSON.stringify(VAULT));
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      await runVaultEnhancement({ input, list: true, json: true, dryRun: true });
    } finally {
      console.log = originalLog;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const out = lines.join("\n");
    expect(out).toContain("a.io");
    expect(out).not.toContain("CANARY-URLPW");
    expect(out).not.toContain("CANARY-PW");
  });
});

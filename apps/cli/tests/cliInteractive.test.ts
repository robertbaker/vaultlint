import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { resolveInteractiveOutputFormat } from "../src/cliInteractive";

describe("interactive output format selection", () => {
  test("honors an explicit --output-format override", () => {
    expect(resolveInteractiveOutputFormat("vault.csv", "lastpass-csv", "bitwarden-json")).toBe(
      "bitwarden-json",
    );
  });

  test("otherwise infers the format from the output path and source", () => {
    expect(resolveInteractiveOutputFormat("vault.1pux", "lastpass-csv")).toBe("1password-1pux");
    expect(resolveInteractiveOutputFormat("vault.csv", "lastpass-csv")).toBe("lastpass-csv");
  });
});

describe("interactive save honors --dry-run and --backup", () => {
  const vault = { encrypted: false, folders: [], items: [{ id: "1", type: 1, name: "New" }] };

  test("--dry-run never writes the vault file", async () => {
    const { writeInteractiveSave } = await import("../src/cliInteractive");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-int-"));
    const target = path.join(dir, "vault.json");
    fs.writeFileSync(target, "ORIGINAL");
    const result = await writeInteractiveSave(vault, target, "bitwarden-json", undefined, {
      dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("ORIGINAL");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("--backup copies the existing file to .bak before overwriting", async () => {
    const { writeInteractiveSave } = await import("../src/cliInteractive");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-int-"));
    const target = path.join(dir, "vault.json");
    fs.writeFileSync(target, "ORIGINAL");
    const result = await writeInteractiveSave(vault, target, "bitwarden-json", undefined, {
      backup: true,
    });
    expect(result.written).toBe(true);
    expect(fs.readFileSync(`${target}.bak`, "utf8")).toBe("ORIGINAL");
    expect(fs.readFileSync(target, "utf8")).toContain("New");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

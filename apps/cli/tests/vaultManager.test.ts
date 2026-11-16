import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { previewBatchEdits } from "../src/batchService";
import {
  filterVaultItems,
  formatMarkdownReport,
  processVault,
  runVaultEnhancement,
} from "../src/vaultManager";

describe("Vault Manager", () => {
  it("processVault should load and return vault data", async () => {
    const vaultData = await processVault("./tests/fixtures/vault.json");
    expect(vaultData).toBeDefined();
    expect(vaultData.items).toHaveLength(10);
  });

  it("runVaultEnhancement --audit --dry-run should report findings without mutating", async () => {
    const report = await runVaultEnhancement({
      input: "./tests/fixtures/vault.json",
      audit: true,
      dryRun: true,
      quiet: true,
    });

    expect(report.totalItemsBefore).toBe(10);
    expect(report.totalItemsAfter).toBe(10);
    expect(report.duplicatesFound).toBe(1);
    expect(report.duplicatesMerged).toBe(0);
    expect(report.weakPasswordsFound).toBe(10);
    expect(report.healthScoreBefore).toBe(report.healthScoreAfter);
  });

  it("filterVaultItems should filter by search query and issue type", async () => {
    const vaultData = await processVault("./tests/fixtures/vault.json");
    const githubOnly = filterVaultItems(vaultData, "github");
    expect(githubOnly.items).toHaveLength(1);
    expect(githubOnly.items[0].name).toBe("GitHub");

    const dupOnly = filterVaultItems(vaultData, undefined, "duplicate");
    expect(dupOnly.items).toHaveLength(2);
  });

  it("previewBatchEdits should preview changes without mutating vault", async () => {
    const vaultData = await processVault("./tests/fixtures/vault.json");
    const previews = previewBatchEdits(vaultData, "^https://", "http://", "uri");
    expect(previews.length).toBeGreaterThan(0);
    expect(previews[0].before.startsWith("https://")).toBe(true);
    expect(previews[0].after.startsWith("http://")).toBe(true);
  });

  it("runVaultEnhancement --in-place --backup should create .bak and save, and export .md report", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-cli-test-"));
    const vaultCopy = path.join(tmpDir, "vault.json");
    const reportMd = path.join(tmpDir, "report.md");
    fs.copyFileSync("./tests/fixtures/vault.json", vaultCopy);

    try {
      const report = await runVaultEnhancement({
        input: vaultCopy,
        inPlace: true,
        backup: true,
        skipConfirmation: true,
        fixWeakPasswords: true,
        exportReport: reportMd,
        quiet: true,
      });

      expect(report.weakPasswordsUpdated).toBe(10);
      expect(fs.existsSync(`${vaultCopy}.bak`)).toBe(true);
      expect(fs.existsSync(reportMd)).toBe(true);
      const mdContent = fs.readFileSync(reportMd, "utf-8");
      expect(mdContent).toContain("# Vault Audit & Enhancement Report");
      expect(formatMarkdownReport(report, report.healthSummary!)).toContain("Health Score");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses in-place overwrite without confirmation in non-interactive mode", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-cli-confirm-test-"));
    const vaultCopy = path.join(tmpDir, "vault.json");
    fs.copyFileSync("./tests/fixtures/vault.json", vaultCopy);
    const original = fs.readFileSync(vaultCopy);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

    try {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
      await expect(
        runVaultEnhancement({
          input: vaultCopy,
          inPlace: true,
          fixWeakPasswords: true,
          quiet: true,
        }),
      ).rejects.toThrow(/Refusing to overwrite in-place without confirmation/);
      expect(fs.readFileSync(vaultCopy)).toEqual(original);
      expect(fs.existsSync(`${vaultCopy}.bak`)).toBe(false);
    } finally {
      if (isTtyDescriptor) Object.defineProperty(process.stdin, "isTTY", isTtyDescriptor);
      else Reflect.deleteProperty(process.stdin, "isTTY");
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("requires confirmation when --output aliases the input path", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-cli-output-alias-test-"));
    const vaultCopy = path.join(tmpDir, "vault.json");
    fs.copyFileSync("./tests/fixtures/vault.json", vaultCopy);
    const original = fs.readFileSync(vaultCopy);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

    try {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
      await expect(
        runVaultEnhancement({
          input: vaultCopy,
          output: vaultCopy,
          fixWeakPasswords: true,
          quiet: true,
        }),
      ).rejects.toThrow(/Refusing to overwrite in-place without confirmation/);
      expect(fs.readFileSync(vaultCopy)).toEqual(original);
    } finally {
      if (isTtyDescriptor) Object.defineProperty(process.stdin, "isTTY", isTtyDescriptor);
      else Reflect.deleteProperty(process.stdin, "isTTY");
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses to write a backup over the input vault", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-cli-backup-alias-test-"));
    const vaultPath = path.join(tmpDir, "vault.json.bak");
    const outputPath = path.join(tmpDir, "vault.json");
    fs.copyFileSync("./tests/fixtures/vault.json", vaultPath);
    fs.writeFileSync(outputPath, "existing output");
    const originalVault = fs.readFileSync(vaultPath);
    const originalOutput = fs.readFileSync(outputPath);

    try {
      await expect(
        runVaultEnhancement({
          input: vaultPath,
          output: outputPath,
          backup: true,
          skipConfirmation: true,
          fixWeakPasswords: true,
          quiet: true,
        }),
      ).rejects.toThrow(/vault backup over the input vault/);
      expect(fs.readFileSync(vaultPath)).toEqual(originalVault);
      expect(fs.readFileSync(outputPath)).toEqual(originalOutput);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("requires confirmation when output aliases the merge input", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-cli-merge-alias-test-"));
    const inputPath = path.join(tmpDir, "current.json");
    const mergePath = path.join(tmpDir, "incoming.json");
    fs.copyFileSync("./tests/fixtures/vault.json", inputPath);
    fs.copyFileSync("./tests/fixtures/vault.json", mergePath);
    const originalMergeInput = fs.readFileSync(mergePath);
    const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

    try {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
      await expect(
        runVaultEnhancement({
          input: inputPath,
          mergeInput: mergePath,
          output: mergePath,
          quiet: true,
        }),
      ).rejects.toThrow(/protected input \(merge input vault\)/);
      expect(fs.readFileSync(mergePath)).toEqual(originalMergeInput);
    } finally {
      if (isTtyDescriptor) Object.defineProperty(process.stdin, "isTTY", isTtyDescriptor);
      else Reflect.deleteProperty(process.stdin, "isTTY");
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runVaultEnhancement should auto-detect LastPass CSV and convert to 1Password 1PUX", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-multi-test-"));
    const lpCsv = path.join(tmpDir, "lastpass.csv");
    const out1pux = path.join(tmpDir, "converted.1pux");
    fs.writeFileSync(
      lpCsv,
      [
        "url,username,password,totp,extra,name,grouping,fav",
        "https://example.com,alice,weak,,note,Example,Work,1",
      ].join("\n"),
      "utf-8",
    );

    try {
      const report = await runVaultEnhancement({
        input: lpCsv,
        output: out1pux,
        fixWeakPasswords: true,
        quiet: true,
      });

      expect(report.sourceFormat).toBe("lastpass-csv");
      expect(report.outputFormat).toBe("1password-1pux");
      expect(report.weakPasswordsUpdated).toBe(1);
      expect(fs.existsSync(out1pux)).toBe(true);
      const reloaded = await processVault(out1pux);
      expect(reloaded.items.length).toBe(1);
      expect(reloaded.items[0].name).toBe("Example");
      expect(reloaded.items[0].login?.password).not.toBe("weak");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

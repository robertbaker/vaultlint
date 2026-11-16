import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import {
  applyLintFixes,
  lintVault,
  parseLintConfigJson,
  parseRuleOverride,
} from "@vaultlint/vault-ops";
import type { VaultData } from "@vaultlint/vault-schema";

import { runVaultEnhancement } from "../src/vaultManager";

function createSampleLintVault(): VaultData {
  return {
    folders: [{ id: "f1", name: "Work" }],
    items: [
      {
        id: "1",
        type: 1,
        name: "  Example Site  ",
        folderId: "missing-folder",
        login: {
          username: " alice@example.com ",
          password: "weak",
          uris: [
            { uri: "http://example.com" },
            { uri: "example.org" },
            { uri: "http://example.com" },
          ],
        },
      },
      {
        id: "2",
        type: 1,
        name: "Local Dev",
        folderId: "f1",
        login: {
          username: "dev",
          password: "VeryStrong$Password2026!",
          totp: "JBSWY3DPEHPK3PXP",
          uris: [{ uri: "http://localhost:3000" }],
        },
      },
      {
        id: "3",
        type: 1,
        name: "Stale Account",
        passwordRevisionDate: "2020-01-01T00:00:00.000Z",
        login: {
          username: "bob",
          password: "VeryStrong$Password2026!",
          uris: [{ uri: "https://stale.example.com" }],
        },
      },
    ],
  };
}

describe("Vault Linter, Rulesets, and Autofix", () => {
  test("does not expose URI credentials, paths, or query secrets in lint messages", () => {
    const secretUri = "http://alice:password@example.com/private?token=secret";
    const result = lintVault({
      items: [{ id: "private", name: "Account", login: { uris: [secretUri] } }],
    });
    const uriMessages = result.findings
      .filter((finding) => finding.ruleId === "insecure-http-uri")
      .map((finding) => finding.message);

    expect(uriMessages).toHaveLength(1);
    expect(uriMessages[0]).toContain("example.com");
    expect(uriMessages[0]).not.toContain("alice");
    expect(uriMessages[0]).not.toContain("password");
    expect(uriMessages[0]).not.toContain("private");
    expect(uriMessages[0]).not.toContain("secret");
  });

  test("classifies findings into error, warning, and hint under recommended ruleset", () => {
    const vault = createSampleLintVault();
    const res = lintVault(vault, { extends: "recommended" }, Date.parse("2026-11-16T00:00:00Z"));

    expect(res.ruleset).toBe("recommended");
    expect(res.counts.error).toBeGreaterThan(0);
    expect(res.counts.warning).toBeGreaterThan(0);
    expect(res.counts.hint).toBeGreaterThan(0);

    const ruleIds = new Set(res.findings.map((f) => f.ruleId));
    expect(ruleIds.has("weak-password")).toBe(true);
    expect(ruleIds.has("reused-password")).toBe(true);
    expect(ruleIds.has("malformed-uri")).toBe(true);
    expect(ruleIds.has("insecure-http-uri")).toBe(true);
    expect(ruleIds.has("duplicate-uris")).toBe(true);
    expect(ruleIds.has("whitespace-in-fields")).toBe(true);
    expect(ruleIds.has("empty-folder-ref")).toBe(true);
    expect(ruleIds.has("stale-password")).toBe(true);
    expect(ruleIds.has("missing-totp")).toBe(true);

    // Localhost http:// should not be flagged as insecure-http-uri
    const httpFindings = res.findings.filter((f) => f.ruleId === "insecure-http-uri");
    expect(httpFindings.every((f) => f.itemId !== "2")).toBe(true);
  });

  test("supports strict and minimal presets plus per-rule overrides", () => {
    const vault = createSampleLintVault();
    const strict = lintVault(vault, { extends: "strict" });
    const minimal = lintVault(vault, { extends: "minimal" });

    expect(strict.counts.error).toBeGreaterThan(
      lintVault(vault, { extends: "recommended" }).counts.error,
    );
    expect(minimal.counts.warning).toBe(0);
    expect(minimal.counts.hint).toBe(0);

    const overridden = lintVault(vault, {
      extends: "recommended",
      rules: {
        "insecure-http-uri": "error",
        "stale-password": "off",
      },
    });
    expect(overridden.findings.some((f) => f.ruleId === "stale-password")).toBe(false);
    expect(
      overridden.findings.some((f) => f.ruleId === "insecure-http-uri" && f.severity === "error"),
    ).toBe(true);
  });

  test("applies safe autofixes without touching passwords unless unsafe is enabled", () => {
    const vault = createSampleLintVault();
    const dry = applyLintFixes(vault, { dryRun: true });
    expect(dry.appliedCount).toBeGreaterThan(0);
    // Dry-run must not mutate original vault
    expect(vault.items[0].name).toBe("  Example Site  ");
    expect(vault.items[0].login?.password).toBe("weak");

    const safe = applyLintFixes(vault);
    expect(safe.appliedCount).toBeGreaterThan(0);
    expect(safe.skippedUnsafeCount).toBeGreaterThan(0);
    expect(vault.items[0].name).toBe("Example Site");
    expect(vault.items[0].folderId).toBeNull();
    expect(vault.items[0].login?.username).toBe("alice@example.com");
    expect(vault.items[0].login?.uris?.map((u) => u.uri)).toEqual([
      "https://example.com",
      "https://example.org",
    ]);
    // Safe mode leaves weak password untouched
    expect(vault.items[0].login?.password).toBe("weak");

    const unsafe = applyLintFixes(vault, { unsafe: true });
    expect(unsafe.appliedCount).toBeGreaterThan(0);
    expect(vault.items[0].login?.password).not.toBe("weak");
    expect(vault.items[1].login?.password).not.toBe(vault.items[2].login?.password);
  });

  test("duplicate URI lint autofix preserves distinct match modes", () => {
    const uri = "https://example.com";
    const vault: VaultData = {
      items: [
        {
          id: "matched-uri",
          type: 1,
          name: "Example",
          login: {
            uris: [
              { uri, match: 3 },
              { uri, match: 0 },
            ],
          },
        },
      ],
    };

    const result = applyLintFixes(vault, { ruleIds: ["duplicate-uris"] });

    expect(result.fixedByRule["duplicate-uris"]).toBeUndefined();
    expect(vault.items[0].login?.uris).toEqual([
      { uri, match: 3 },
      { uri, match: 0 },
    ]);
  });

  test("parses rule overrides and JSON lint config with validation", () => {
    expect(parseRuleOverride("insecure-http-uri=error")).toEqual({
      ruleId: "insecure-http-uri",
      severity: "error",
    });
    expect(() => parseRuleOverride("bad-format")).toThrow();
    expect(() => parseRuleOverride("unknown-rule=error")).toThrow();

    const cfg = parseLintConfigJson('{"extends":"strict","rules":{"missing-totp":"off"}}');
    expect(cfg.extends).toBe("strict");
    expect(cfg.rules?.["missing-totp"]).toBe("off");
  });

  test("CLI runVaultEnhancement supports --lint, --ruleset, --rule, --config, and --fix", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-lint-test-"));
    const vaultPath = path.join(tmpDir, "vault.json");
    const outPath = path.join(tmpDir, "fixed.json");
    const cfgPath = path.join(tmpDir, "vaultlint.config.json");

    fs.writeFileSync(vaultPath, JSON.stringify(createSampleLintVault(), null, 2), "utf-8");
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ extends: "recommended", rules: { "missing-totp": "off" } }),
      "utf-8",
    );

    const report = await runVaultEnhancement({
      input: vaultPath,
      output: outPath,
      lint: true,
      fix: true,
      config: cfgPath,
      ruleOverrides: ["insecure-http-uri=error"],
      quiet: true,
    });

    expect(report.lintFixesApplied).toBeGreaterThan(0);
    expect(report.lint).toBeDefined();
    expect(report.lint?.effectiveRules["missing-totp"]).toBe("off");
    expect(report.lint?.effectiveRules["insecure-http-uri"]).toBe("error");
    expect(fs.existsSync(outPath)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

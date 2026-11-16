import { describe, expect, test } from "bun:test";

import { runVaultEnhancement } from "../src/vaultManager";
import type { CommandRunner } from "../src/vendorCli";
import { lastpassProvider } from "../src/vendorCli/lastpass";

function lpassRunner(stdout: string): CommandRunner {
  return {
    async run() {
      return { code: 0, stdout, stderr: "" };
    },
  };
}

const LPASS_HEADER = "url,username,password,totp,extra,name,grouping,fav";

describe("lastpass export validation", () => {
  test("rejects empty output instead of importing an empty vault", async () => {
    await expect(lastpassProvider.fetch(lpassRunner(""))).rejects.toThrow(/not.*LastPass export/i);
    await expect(lastpassProvider.fetch(lpassRunner("  \r\n"))).rejects.toThrow(
      /not.*LastPass export/i,
    );
  });

  test("rejects non-CSV garbage", async () => {
    await expect(
      lastpassProvider.fetch(lpassRunner("Error: <html>session expired</html>")),
    ).rejects.toThrow(/not.*LastPass export/i);
  });

  test("accepts a header-only export as a legitimately empty vault", async () => {
    const result = await lastpassProvider.fetch(lpassRunner(`${LPASS_HEADER}\n`));
    expect(result.format).toBe("lastpass-csv");
  });

  test("accepts a BOM-prefixed header with rows", async () => {
    const result = await lastpassProvider.fetch(
      lpassRunner(`﻿${LPASS_HEADER}\nhttps://a.com,u,p,,,A,,0\n`),
    );
    expect(result.content).toContain("https://a.com");
  });

  test("--from-cli lastpass fails cleanly on garbage and does not write output", async () => {
    await expect(
      runVaultEnhancement({
        input: "unused.json",
        fromCli: "lastpass",
        vendorRunner: lpassRunner("garbage"),
        dryRun: true,
        quiet: true,
      }),
    ).rejects.toThrow(/LastPass export/i);
  });
});

describe("summary table for checks that did not run", () => {
  async function capture(fn: () => Promise<unknown>): Promise<string> {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      await fn();
    } finally {
      console.log = original;
    }
    return lines.join("\n");
  }

  const base = { input: "./tests/fixtures/vault.json", dryRun: true, noColor: true } as const;

  test("--list shows 'not checked' instead of computed-looking zeros", async () => {
    const out = await capture(() => runVaultEnhancement({ ...base, list: true }));
    expect(out).toMatch(/Weak passwords\s*│\s*not checked/);
    expect(out).toMatch(/Reused passwords\s*│\s*not checked/);
    expect(out).toMatch(/Malformed URIs\s*│\s*not checked/);
    expect(out).toMatch(/Compromised \(HIBP\)\s*│\s*not checked/);
    expect(out).not.toMatch(/Weak passwords\s*│\s*0 found/);
  });

  test("checks that ran still show their computed numbers", async () => {
    const out = await capture(() =>
      runVaultEnhancement({ ...base, checkWeakPasswords: true, checkReusedPasswords: true }),
    );
    expect(out).toMatch(/Weak passwords\s*│\s*10 found/);
    expect(out).toMatch(/Reused passwords\s*│\s*\d+ group\(s\)/);
    expect(out).toMatch(/Malformed URIs\s*│\s*not checked/);
  });
});

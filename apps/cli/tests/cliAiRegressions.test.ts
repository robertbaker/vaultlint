import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { type HttpRequest, type IHttpClient, createDefaultAiContainer } from "@vaultlint/ai";

import { resolveAiConfig } from "../src/aiService";
import { loadDomainMappings } from "../src/domainMappingService";
import { formatMarkdownReport, runVaultEnhancement } from "../src/vaultManager";
import type { CommandRunner } from "../src/vendorCli";
import { dashlaneProvider } from "../src/vendorCli/dashlane";

function dashlaneRunner(rows: Record<string, string>): CommandRunner {
  return {
    async run(_bin, args) {
      const out = rows[args[0]] ?? "[]";
      return { code: 0, stdout: out, stderr: "" };
    },
  };
}

describe("dashlane fetch", () => {
  test("rejects a status envelope instead of treating it as a vault row", async () => {
    const runner = dashlaneRunner({ password: JSON.stringify({ status: "locked" }) });
    await expect(dashlaneProvider.fetch(runner)).rejects.toThrow(/did not return password list/);
  });

  test("still accepts a single real entry object", async () => {
    const runner = dashlaneRunner({
      password: JSON.stringify({ id: "1", title: "Site", login: "a", password: "p" }),
    });
    const result = await dashlaneProvider.fetch(runner);
    expect(JSON.parse(result.content).AUTHENTIFIANT).toHaveLength(1);
  });
});

describe("AI request hardening", () => {
  test("redacts the API key from provider error text", async () => {
    const http: IHttpClient = {
      async request(_req: HttpRequest) {
        throw new Error("Incorrect API key provided: sk-secret-key-123");
      },
    };
    const provider = createDefaultAiContainer(http).resolve("openai");
    const error = await provider
      .categorize([{ id: "0", name: "a", uris: [] }], {
        provider: "openai",
        apiKey: "sk-secret-key-123",
      })
      .catch((e: Error) => e);
    expect((error as Error).message).not.toContain("sk-secret-key-123");
    expect((error as Error).message).toContain("[redacted API key]");
  });

  test("adds a scheme to a bare OLLAMA_HOST value", () => {
    const previous = process.env["OLLAMA_HOST"];
    process.env["OLLAMA_HOST"] = "127.0.0.1:11434";
    try {
      expect(resolveAiConfig({ provider: "ollama" }).baseUrl).toBe("http://127.0.0.1:11434");
    } finally {
      if (previous === undefined) delete process.env["OLLAMA_HOST"];
      else process.env["OLLAMA_HOST"] = previous;
    }
  });
});

describe("domain mappings", () => {
  test("missing or malformed files fail loudly", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultlint-dm-"));
    try {
      expect(() => loadDomainMappings(path.join(dir, "nope.json"))).toThrow(/not found/);
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(bad, "[1,2]");
      expect(() => loadDomainMappings(bad)).toThrow(/must be a JSON object/);
      const ok = path.join(dir, "ok.json");
      fs.writeFileSync(ok, '{"a.com":"b.com"}');
      expect(loadDomainMappings(ok)["a.com"]).toBe("b.com");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("vault manager guards", () => {
  test("--in-place is refused with --from-cli", async () => {
    await expect(
      runVaultEnhancement({
        input: "vault.json",
        fromCli: "bitwarden",
        inPlace: true,
        quiet: true,
        vendorRunner: dashlaneRunner({}),
      }),
    ).rejects.toThrow(/--in-place cannot be used with --from-cli/);
  });

  test("markdown report keeps the linter row inside the table", () => {
    const md = formatMarkdownReport(
      {
        totalItemsBefore: 1,
        totalItemsAfter: 1,
        duplicatesFound: 0,
        duplicatesMerged: 0,
        batchEditsApplied: 0,
        domainMappingsApplied: 0,
        weakPasswordsFound: 0,
        weakPasswordsUpdated: 0,
        reusedPasswordGroups: 0,
        reusedPasswordsFound: 0,
        reusedPasswordsUpdated: 0,
        malformedUrisFound: 0,
        redirectsFound: 0,
        deadLinksFound: 0,
        redirectsApplied: 0,
        compromisedPasswordsFound: 0,
        validMobileUris: [],
        invalidMobileUris: [],
        healthScoreBefore: 100,
        healthScoreAfter: 100,
        aiHygieneDisclaimer: "Unverified.",
        lint: {
          ruleset: "recommended",
          counts: { error: 0, warning: 1, hint: 0, fixableSafe: 0, fixableUnsafe: 0 },
          findings: [],
        },
      } as never,
      {
        totalItems: 1,
        loginItems: 1,
        foldersCount: 0,
        totpCount: 0,
        fidoCount: 0,
      } as never,
    );
    const lines = md.split("\n");
    const linter = lines.findIndex((l) => l.startsWith("| Linter"));
    const quote = lines.findIndex((l) => l.startsWith("> "));
    expect(linter).toBeGreaterThan(-1);
    expect(quote).toBeGreaterThan(linter);
  });
});

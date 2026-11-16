import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import * as batchService from "../src/batchService";
import { runCLI, setupCLI, getOptions } from "../src/cli";
import * as duplicateService from "../src/duplicateService";
import * as vaultService from "../src/vaultService";

describe("CLI Non-Interactive Mode", () => {
  let loadSpy: ReturnType<typeof spyOn>;
  let saveSpy: ReturnType<typeof spyOn>;
  let mergeSpy: ReturnType<typeof spyOn> | undefined;
  let batchSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    loadSpy = spyOn(vaultService, "loadVaultWithMeta").mockResolvedValue({
      vault: {
        items: [{ id: "1", name: "Test", login: { username: "u", password: "Strong!Password1" } }],
      },
      format: "bitwarden-json",
      providerName: "Bitwarden",
      formatName: "Bitwarden JSON",
      warnings: [],
    });
    saveSpy = spyOn(vaultService, "saveVault").mockResolvedValue(undefined);
  });

  afterEach(() => {
    loadSpy.mockRestore();
    saveSpy.mockRestore();
    mergeSpy?.mockRestore();
    batchSpy?.mockRestore();
    mergeSpy = undefined;
    batchSpy = undefined;
  });

  it("should trigger duplicate merging when --auto-merge is used", async () => {
    mergeSpy = spyOn(duplicateService, "mergeDuplicates").mockReturnValue(0);
    await runCLI(["node", "cli.js", "--auto-merge", "--skip-confirmation"]);
    expect(mergeSpy).toHaveBeenCalled();
  });

  it("passes --pattern, --replacement, --field and --target-mode to batch editing", async () => {
    batchSpy = spyOn(batchService, "applyBatchEdits").mockResolvedValue(0);
    await runCLI([
      "node",
      "cli.js",
      "--batch-edit",
      "--pattern",
      "^http://",
      "--replacement",
      "https://",
      "--field",
      "uri",
      "--target-mode",
      "non-empty",
      "--skip-confirmation",
    ]);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0].slice(1)).toEqual(["^http://", "https://", "uri", "non-empty"]);
  });

  it("rejects --batch-edit without --pattern/--replacement instead of using placeholders", async () => {
    batchSpy = spyOn(batchService, "applyBatchEdits").mockResolvedValue(0);
    const normalizeSpy = spyOn(batchService, "runBatchEditing").mockResolvedValue(undefined);
    try {
      await expect(
        runCLI(["node", "cli.js", "--batch-edit", "--skip-confirmation"]),
      ).rejects.toThrow(/--pattern.*--replacement/);
      await expect(
        runCLI(["node", "cli.js", "--batch-edit", "--pattern", "x", "--skip-confirmation"]),
      ).rejects.toThrow(/--replacement/);
      expect(batchSpy).not.toHaveBeenCalled();
      expect(normalizeSpy).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    } finally {
      normalizeSpy.mockRestore();
    }
  });

  it("rejects batch-edit modifiers given without --batch-edit", () => {
    for (const args of [
      ["--pattern", "x"],
      ["--replacement", "y"],
      ["--field", "uri"],
      ["--target-mode", "clear"],
    ]) {
      expect(() => setupCLI(["node", "cli.js", ...args])).toThrow(
        /only take effect with --batch-edit/,
      );
    }
    expect(() =>
      setupCLI(["node", "cli.js", "--batch-edit", "--pattern", "x", "--replacement", "y"]),
    ).not.toThrow();
    expect(() => setupCLI(["node", "cli.js", "--audit"])).not.toThrow();
  });

  it("rejects --export-report paths that are not .json or .md", () => {
    for (const bad of ["foo.txt", "report", "report.json.bak"]) {
      expect(() => setupCLI(["node", "cli.js", "--export-report", bad])).toThrow(
        /--export-report must end in \.json or \.md/,
      );
    }
    for (const ok of ["r.json", "r.md", "R.JSON", "R.MD"]) {
      expect(() => setupCLI(["node", "cli.js", "--export-report", ok])).not.toThrow();
    }
  });

  it("rejects --fix-unsafe without --fix", () => {
    expect(() => setupCLI(["node", "cli.js", "--lint", "--fix-unsafe"])).toThrow(
      /--fix-unsafe only takes effect with --fix/,
    );
    expect(() => setupCLI(["node", "cli.js", "--fix", "--fix-unsafe"])).not.toThrow();
    expect(() => setupCLI(["node", "cli.js", "--fix"])).not.toThrow();
  });

  it("should skip saving when --dry-run is used", async () => {
    saveSpy.mockClear();
    await runCLI(["node", "cli.js", "--dry-run"]);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("should parse --ui and --port options cleanly", () => {
    setupCLI(["node", "cli.js", "--ui", "--port", "8080"]);
    const opts = getOptions();
    expect(opts.ui).toBe(true);
    expect(opts.port).toBe(8080);
  });

  it("should parse new audit, list, search, filter, and formatting flags", () => {
    setupCLI([
      "node",
      "cli.js",
      "--audit",
      "--list",
      "--search",
      "github",
      "--filter",
      "weak",
      "--check-reused-passwords",
      "--fix-reused-passwords",
      "--check-uris",
      "--generate-password",
      "24",
      "--interactive",
      "--json",
      "--verbose",
      "--quiet",
      "--no-color",
    ]);
    const opts = getOptions();
    expect(opts.audit).toBe(true);
    expect(opts.list).toBe(true);
    expect(opts.search).toBe("github");
    expect(opts.filter).toBe("weak");
    expect(opts.checkReusedPasswords).toBe(true);
    expect(opts.fixReusedPasswords).toBe(true);
    expect(opts.checkUris).toBe(true);
    expect(opts.generatePassword).toBe(24);
    expect(opts.interactive).toBe(true);
    expect(opts.json).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.quiet).toBe(true);
    expect(opts.noColor).toBe(true);
  });

  it("should parse --normalize, --in-place, --backup, and --filter no-uri", () => {
    setupCLI(["node", "cli.js", "--normalize", "--in-place", "--backup", "--filter", "no-uri"]);
    const opts = getOptions();
    expect(opts.normalize).toBe(true);
    expect(opts.inPlace).toBe(true);
    expect(opts.backup).toBe(true);
    expect(opts.filter).toBe("no-uri");
  });

  it("rejects fractional generated-password lengths", () => {
    expect(() => setupCLI(["node", "cli.js", "--generate-password", "12.5"])).toThrow(
      /Expected a positive integer/,
    );
  });

  it("should throw a clear error for an invalid --filter value", () => {
    expect(() => setupCLI(["node", "cli.js", "--filter", "invalid-filter"])).toThrow(
      /Invalid --filter value/,
    );
  });

  it("rejects inherited property names as AI providers", () => {
    expect(() => setupCLI(["node", "cli.js", "--ai-provider", "constructor"])).toThrow(
      /Invalid --ai-provider value "constructor"/,
    );
  });

  it("should parse expanded AI task flags", () => {
    setupCLI([
      "node",
      "cli.js",
      "--ai-organize",
      "--ai-duplicates",
      "--ai-suggest-uris",
      "--ai-hygiene",
      "--ai-provider",
      "ollama",
    ]);
    const opts = getOptions();
    expect(opts.aiOrganize).toBe(true);
    expect(opts.aiDuplicates).toBe(true);
    expect(opts.aiSuggestUris).toBe(true);
    expect(opts.aiHygiene).toBe(true);
    expect(opts.aiProvider).toBe("ollama");
  });
});

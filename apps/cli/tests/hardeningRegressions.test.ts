import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { type HttpRequest, type IHttpClient, createDefaultAiContainer } from "@vaultlint/ai";

import { categorizeVaultWithAi } from "../src/aiService";
import { atomicWrite, writeReportFile } from "../src/safeWrite";
import { UndoRedoHistory, runTracked } from "../src/undoRedoManager";
import { runVaultEnhancement } from "../src/vaultManager";
import { bitwardenProvider } from "../src/vendorCli/bitwarden";
import { resolveSpawnTarget } from "../src/vendorCli/runner";
import type { CommandRunner } from "../src/vendorCli/types";

let dir: string;
let vaultPath: string;

const VAULT = {
  encrypted: false,
  folders: [],
  items: [
    {
      id: "1",
      type: 1,
      name: "GitHub",
      login: {
        username: "a",
        password: "Str0ng!Passw0rd#1",
        uris: [{ uri: "https://github.com" }],
      },
    },
  ],
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-hardening-"));
  vaultPath = path.join(dir, "vault.json");
  fs.writeFileSync(vaultPath, JSON.stringify(VAULT), "utf-8");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function trySymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "file");
    return true;
  } catch {
    return false;
  }
}

describe("batch edit requires explicit pattern and replacement", () => {
  test("does not fall back to lowercasing names or trimming URIs", async () => {
    const out = path.join(dir, "out.json");
    await expect(
      runVaultEnhancement({ input: vaultPath, output: out, batchEdit: true, quiet: true }),
    ).rejects.toThrow(/--pattern.*--replacement/);
    await expect(
      runVaultEnhancement({
        input: vaultPath,
        output: out,
        batchEdit: true,
        pattern: "x",
        quiet: true,
      }),
    ).rejects.toThrow(/--replacement/);
    expect(fs.existsSync(out)).toBe(false);
  });

  test("an explicit pattern/replacement still edits and --normalize stays separate", async () => {
    const out = path.join(dir, "out.json");
    const report = await runVaultEnhancement({
      input: vaultPath,
      output: out,
      batchEdit: true,
      pattern: "^GitHub$",
      replacement: "GH",
      targetMode: "all",
      quiet: true,
    });
    expect(report.batchEditsApplied).toBe(1);
    expect(JSON.parse(fs.readFileSync(out, "utf-8")).items[0].name).toBe("GH");
  });

  test("an unknown --field is rejected instead of silently doing nothing", async () => {
    await expect(
      runVaultEnhancement({
        input: vaultPath,
        batchEdit: true,
        pattern: "a",
        replacement: "b",
        field: "password",
        quiet: true,
      }),
    ).rejects.toThrow(/Invalid --field/);
  });
});

describe("AI dry-run and credential handling", () => {
  test("--dry-run sends nothing for any AI task", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("network used"));
    try {
      await runVaultEnhancement({
        input: vaultPath,
        dryRun: true,
        quiet: true,
        aiProvider: "ollama",
        aiBaseUrl: "http://127.0.0.1:9",
        enableAI: true,
        aiOrganize: true,
        aiSuggestUris: true,
        aiDuplicates: true,
        aiHygiene: true,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("--ai-api-key triggers a warning pointing at the env var", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await runVaultEnhancement({
        input: vaultPath,
        dryRun: true,
        quiet: true,
        aiProvider: "openai",
        aiApiKey: "sk-test-not-real",
        enableAI: true,
      });
      const text = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(text).toContain("OPENAI_API_KEY");
      expect(text).not.toContain("sk-test-not-real");
    } finally {
      warn.mockRestore();
    }
  });

  test("a truncated AI response fails loudly instead of reporting 0 categorized", async () => {
    const http: IHttpClient = {
      async request<T>(_req: HttpRequest) {
        return {
          status: 200,
          data: { message: { content: '{"categories": {"0": "Dev"' } },
        } as { status: number; data: T };
      },
    };
    const vault = structuredClone(VAULT) as never;
    await expect(
      categorizeVaultWithAi(vault, {
        provider: "ollama",
        container: createDefaultAiContainer(http),
      }),
    ).rejects.toThrow(/truncated/);
  });
});

describe("report writes", () => {
  test("SARIF fingerprints do not collide for findings on duplicate item IDs", async () => {
    const duplicateIds = path.join(dir, "duplicate-ids.json");
    const baselinePath = path.join(dir, "baseline.sarif.json");
    const sarifPath = path.join(dir, "findings.sarif.json");
    fs.writeFileSync(
      duplicateIds,
      JSON.stringify({
        items: [
          {
            id: "duplicated",
            name: "Work",
            login: { uris: ["http://work.example"] },
          },
        ],
      }),
      "utf-8",
    );
    await runVaultEnhancement({
      input: duplicateIds,
      lint: true,
      sarif: baselinePath,
      quiet: true,
    });

    fs.writeFileSync(
      duplicateIds,
      JSON.stringify({
        items: [
          {
            id: "duplicated",
            name: "Work",
            login: { uris: ["http://work.example"] },
          },
          {
            id: "duplicated",
            name: "Personal",
            login: { uris: ["http://personal.example"] },
          },
        ],
      }),
      "utf-8",
    );

    await runVaultEnhancement({
      input: duplicateIds,
      lint: true,
      sarif: sarifPath,
      sarifBaseline: baselinePath,
      quiet: true,
    });

    const sarif = JSON.parse(fs.readFileSync(sarifPath, "utf-8"));
    const results = sarif.runs[0].results;
    const fingerprints = results.map(
      (result: { fingerprints: Record<string, string> }) => result.fingerprints["vaultlint/v1"],
    );
    expect(results).toHaveLength(4);
    expect(new Set(fingerprints).size).toBe(4);
    expect(sarif.runs[0].properties.newFindingCount).toBe(2);
    expect(
      results.filter((result: { baselineState: string }) => result.baselineState === "unchanged"),
    ).toHaveLength(2);
  });

  test("report paths cannot overwrite the input vault or each other", async () => {
    const before = fs.readFileSync(vaultPath, "utf-8");
    await expect(
      runVaultEnhancement({ input: vaultPath, exportReport: vaultPath, quiet: true }),
    ).rejects.toThrow(/Refusing to write summary report over the input vault/);
    await expect(
      runVaultEnhancement({
        input: vaultPath,
        lint: true,
        sarif: vaultPath,
        quiet: true,
      }),
    ).rejects.toThrow(/Refusing to write SARIF report/);
    const same = path.join(dir, "same.json");
    await expect(
      runVaultEnhancement({
        input: vaultPath,
        exportReport: same,
        sarif: same,
        quiet: true,
      }),
    ).rejects.toThrow(/Refusing to write/);
    expect(fs.readFileSync(vaultPath, "utf-8")).toBe(before);
  });

  test("migration report is validated before the vault is modified or saved", async () => {
    const incoming = path.join(dir, "incoming.json");
    fs.writeFileSync(incoming, JSON.stringify(VAULT), "utf-8");
    const out = path.join(dir, "merged.json");
    await expect(
      runVaultEnhancement({
        input: vaultPath,
        mergeInput: incoming,
        migrationReport: incoming,
        output: out,
        quiet: true,
      }),
    ).rejects.toThrow(/over the merge input vault/);
    expect(fs.existsSync(out)).toBe(false);
  });

  test("reports are written atomically and refuse symlinks and directories", () => {
    const target = path.join(dir, "real.txt");
    fs.writeFileSync(target, "keep", "utf-8");
    const link = path.join(dir, "link.txt");
    if (trySymlink(target, link)) {
      expect(() => writeReportFile(link, "x", "report")).toThrow(/symbolic link/);
      expect(fs.readFileSync(target, "utf-8")).toBe("keep");
    }
    expect(() => writeReportFile(dir, "x", "report")).toThrow(/not a regular file/);
    const ok = path.join(dir, "ok.json");
    writeReportFile(ok, "one", "report");
    writeReportFile(ok, "two", "report");
    expect(fs.readFileSync(ok, "utf-8")).toBe("two");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("atomicWrite updates a symlink's target instead of replacing the link", () => {
    const target = path.join(dir, "real.json");
    fs.writeFileSync(target, "old", "utf-8");
    const link = path.join(dir, "vault-link.json");
    if (!trySymlink(target, link)) return;
    atomicWrite(link, "new");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe("new");
  });
});

describe("undo history only records successful changes", () => {
  test("a failing mutation leaves no entry and is rolled back", async () => {
    const history = new UndoRedoHistory<{ items: string[] }>();
    const state = { items: ["a"] };
    const result = await runTracked(
      state,
      (s) => {
        s.items.push("partial");
        throw new Error("boom");
      },
      history,
    );
    expect(result.error?.message).toBe("boom");
    expect(result.state).toEqual({ items: ["a"] });
    expect(history.canUndo).toBe(false);
  });

  test("a no-op leaves no entry, a real change records the previous state", async () => {
    const history = new UndoRedoHistory<{ items: string[] }>();
    const state = { items: ["a"] };
    expect((await runTracked(state, () => {}, history)).changed).toBe(false);
    expect(history.canUndo).toBe(false);
    const changed = await runTracked(state, (s) => void s.items.push("b"), history);
    expect(changed.changed).toBe(true);
    expect(history.undo(state)).toEqual({ items: ["a"] });
  });
});

describe("vendor CLI hardening", () => {
  test("bitwarden push stops with a clear error when folder creation output is not JSON", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      async run(_bin, args) {
        calls.push(args);
        if (args[0] === "list") return { code: 0, stdout: '[{"id":"i1"}]', stderr: "" };
        if (args[0] === "create" && args[1] === "folder") {
          return { code: 0, stdout: "Not logged in warning", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    await expect(
      bitwardenProvider.push!(
        runner,
        { items: [{ id: "i1", name: "A" }], folders: [] } as never,
        {
          items: [{ id: "i1", name: "A", folderId: "new" }],
          folders: [{ id: "new", name: "Work" }],
        } as never,
      ),
    ).rejects.toThrow(/unreadable output/);
    expect(calls.some((c) => c[0] === "edit")).toBe(false);
  });

  test("windows .cmd shims resolve through cmd.exe with validated arguments", () => {
    const env = { Path: "C:\\tools;C:\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD", ComSpec: "cmd.exe" };
    const exists = (p: string) => p.toLowerCase() === "c:\\npm\\bw.cmd";
    const target = resolveSpawnTarget("bw", ["status", "--nointeraction"], env, "win32", exists);
    expect(target.command).toBe("cmd.exe");
    expect(target.windowsVerbatimArguments).toBe(true);
    expect(target.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(target.args[3]).toContain("bw.cmd");
    expect(target.args[3]).toContain("status --nointeraction");
  });

  test("windows .exe binaries run directly and shell metacharacters are refused for shims", () => {
    const env = { PATH: "C:\\tools" };
    const exe = resolveSpawnTarget("op", ["x"], env, "win32", (p) => p === "C:\\tools\\op.exe");
    expect(exe.command).toBe("C:\\tools\\op.exe");
    expect(exe.windowsVerbatimArguments).toBeUndefined();
    expect(() =>
      resolveSpawnTarget("bw", ["get", "a&calc"], env, "win32", (p) => p === "C:\\tools\\bw.cmd"),
    ).toThrow(/metacharacters/);
  });

  test("non-windows platforms and unresolved binaries are left untouched", () => {
    expect(resolveSpawnTarget("bw", ["a"], {}, "linux")).toEqual({ command: "bw", args: ["a"] });
    expect(resolveSpawnTarget("bw", ["a"], { PATH: "C:\\x" }, "win32", () => false)).toEqual({
      command: "bw",
      args: ["a"],
    });
  });
});

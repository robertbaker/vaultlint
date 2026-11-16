import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { CommandOptions, CommandResult, CommandRunner } from "./types";

const DEFAULT_TIMEOUT_MS = 120_000;
/** Vaults can be large; refuse to buffer unbounded output. */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
/** CLI diagnostics should be small; retain a useful prefix without letting stderr exhaust memory. */
const MAX_STDERR_BYTES = 1024 * 1024;

/** Names of env vars whose values must never appear in error text. */
const SECRET_ENV_KEYS = [
  "BW_SESSION",
  "BW_PASSWORD",
  "BW_CLIENTSECRET",
  "DASHLANE_MASTER_PASSWORD",
  "DASHLANE_SERVICE_DEVICE_KEYS",
  "DASHLANE_ENROLLED_TEAM_DEVICE_KEYS",
  "MASTERPW",
  "ENP_PIN",
  "ENP_PIN_PEPPER",
];

/**
 * Other vendor CLIs pass credentials through differently named variables (`OP_SESSION_<account>`,
 * `OP_SERVICE_ACCOUNT_TOKEN`, `KEEPER_PASSWORD`, ...), so any variable whose underscore-delimited
 * name contains one of these words is treated as secret too. Short values are skipped so common
 * words cannot mangle error text.
 */
const SECRET_ENV_NAME =
  /(?:^|_)(?:SESSION|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PIN|PEPPER|KEY)S?(?:_|$)/i;
const MIN_PATTERN_SECRET_LENGTH = 8;

export function redactSecrets(text: string, env: Record<string, string | undefined>): string {
  let out = text;
  for (const key of SECRET_ENV_KEYS) {
    const value = env[key];
    if (value) out = out.split(value).join(`[redacted ${key}]`);
  }
  const extra = Object.entries(env)
    .filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        entry[1].length >= MIN_PATTERN_SECRET_LENGTH &&
        !SECRET_ENV_KEYS.includes(entry[0]) &&
        SECRET_ENV_NAME.test(entry[0]),
    )
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, value] of extra) out = out.split(value).join(`[redacted ${key}]`);
  return out;
}

export interface SpawnTarget {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

const CMD_SAFE_ARG = /^[A-Za-z0-9_.:/\\=+,@-]+$/;

function envLookup(env: Record<string, string | undefined>, name: string): string | undefined {
  // `{ ...process.env }` loses Windows' case-insensitive lookup ("Path" vs "PATH").
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * Work out what to actually spawn. Windows cannot launch `bw` when it is an npm `.cmd` shim (no
 * PATHEXT lookup without a shell, and Node refuses to spawn `.cmd`/`.bat` directly), so resolve it
 * and run shims through `cmd.exe` with strictly validated arguments.
 */
export function resolveSpawnTarget(
  binary: string,
  args: string[],
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  fileExists: (p: string) => boolean = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
): SpawnTarget {
  if (platform !== "win32") return { command: binary, args };

  const pathExt = (envLookup(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const hasExt = path.win32.extname(binary) !== "";
  const hasDir = /[\\/]/.test(binary);
  const dirs = hasDir
    ? [""]
    : (envLookup(env, "PATH") ?? "")
        .split(";")
        .map((dir) => dir.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);

  let resolved: string | undefined;
  for (const dir of dirs) {
    const base = dir ? path.win32.join(dir, binary) : binary;
    const candidates = hasExt ? [base] : pathExt.map((ext) => `${base}${ext}`);
    resolved = candidates.find(fileExists);
    if (resolved) break;
  }
  if (!resolved) return { command: binary, args };

  const ext = path.win32.extname(resolved).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return { command: resolved, args };

  if (/["%]/.test(resolved)) {
    throw new Error(`Cannot run \`${binary}\`: its path contains characters unsafe for cmd.exe.`);
  }
  const unsafe = args.find((arg) => !CMD_SAFE_ARG.test(arg));
  if (unsafe !== undefined) {
    throw new Error(
      `Refusing to pass an argument through the \`${binary}\` cmd.exe shim because it contains shell metacharacters. Install the native executable instead.`,
    );
  }
  return {
    command: envLookup(env, "ComSpec") || "cmd.exe",
    args: ["/d", "/s", "/c", `"${[`"${resolved}"`, ...args].join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Kill the child and everything it started. On Windows `child.kill()` only terminates the direct
 * child (`cmd.exe` for an npm `.cmd` shim), leaving the real vendor CLI running as an orphan.
 */
export function killProcessTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    if (result.status === 0) return;
  }
  child.kill();
}

const activeChildren = new Set<ChildProcess>();
let cleanupInstalled = false;

/** Kill every vendor CLI process tree that is still running. Safe to call from an exit hook. */
export function killActiveVendorProcesses(): void {
  for (const child of activeChildren) killProcessTree(child);
  activeChildren.clear();
}

/**
 * If vaultlint exits (Ctrl+C, SIGTERM, normal exit) while a vendor CLI is mid-run, take it down too
 * instead of leaving it, and anything it started, running as an orphan.
 */
function installCleanupHooks(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  process.on("exit", killActiveVendorProcesses);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGBREAK", 149],
    ["SIGHUP", 129],
  ] as const) {
    try {
      process.on(signal, () => process.exit(code));
    } catch {
      // Signal not supported on this platform.
    }
  }
}

/** Runs a binary without a shell (arguments are never interpreted), with a timeout. */
export const nodeCommandRunner: CommandRunner = {
  run(binary: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    const env = { ...process.env, ...options.env };
    return new Promise((resolve, reject) => {
      let target: SpawnTarget;
      try {
        target = resolveSpawnTarget(binary, args, env);
      } catch (error) {
        reject(error);
        return;
      }
      const child = spawn(target.command, target.args, {
        env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: target.windowsVerbatimArguments,
      });
      installCleanupHooks();
      activeChildren.add(child);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let stderrSize = 0;
      let stderrTruncated = false;
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        activeChildren.delete(child);
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        killProcessTree(child);
        finish(() => reject(new Error(`\`${binary}\` timed out.`)));
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) {
          killProcessTree(child);
          finish(() => reject(new Error(`\`${binary}\` produced too much output.`)));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrTruncated) return;
        const available = MAX_STDERR_BYTES - stderrSize;
        if (chunk.length > available) {
          if (available > 0) stderr.push(chunk.subarray(0, available));
          stderrSize = MAX_STDERR_BYTES;
          stderrTruncated = true;
          return;
        }
        stderr.push(chunk);
        stderrSize += chunk.length;
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(() =>
          reject(
            error.code === "ENOENT"
              ? new Error(`\`${binary}\` was not found on PATH. Install the vendor CLI first.`)
              : new Error(redactSecrets(error.message, env)),
          ),
        );
      });
      child.on("close", (code) => {
        finish(() =>
          resolve({
            code: code ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: redactSecrets(
              `${Buffer.concat(stderr).toString("utf8")}${stderrTruncated ? "\n[stderr truncated after 1 MiB]" : ""}`,
              env,
            ),
          }),
        );
      });

      // A CLI that exits before reading stdin would otherwise raise an unhandled EPIPE.
      child.stdin.on("error", () => {});
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
  },
};

/** Run and require exit code 0. The error carries stderr only, never stdout (it holds secrets). */
export async function runChecked(
  runner: CommandRunner,
  binary: string,
  args: string[],
  options?: CommandOptions,
): Promise<string> {
  const result = await runner.run(binary, args, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/)[0] || `exit code ${result.code}`;
    throw new Error(`\`${binary} ${args[0] ?? ""}\` failed: ${detail}`);
  }
  return result.stdout;
}

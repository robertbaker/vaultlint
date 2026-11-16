import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { nodeCommandRunner } from "../src/vendorCli/runner";

function listPing(marker: string): string {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.Name -eq 'PING.EXE' } | ForEach-Object { $_.ProcessId }`;
  return spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
  }).stdout.trim();
}

test.skipIf(process.platform !== "win32")(
  "timeout kills the whole process tree of a .cmd shim, not just cmd.exe",
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-tree-"));
    const marker = String(5000 + Math.floor(Math.random() * 4000));
    fs.writeFileSync(
      path.join(dir, "slowvendor.cmd"),
      `@echo off\r\nping -n ${marker} 127.0.0.1 >nul\r\n`,
    );
    try {
      await expect(
        nodeCommandRunner.run("slowvendor", [], {
          timeoutMs: 1500,
          env: { PATH: `${dir};${process.env["PATH"] ?? process.env["Path"]}` },
        }),
      ).rejects.toThrow(/timed out/);
      await Bun.sleep(1000);
      const survivors = listPing(` -n ${marker} `);
      if (survivors) spawnSync("taskkill", ["/PID", survivors.split(/\s+/)[0]!, "/T", "/F"]);
      expect(survivors).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  20_000,
);

test.skipIf(process.platform !== "win32")(
  "exiting the process while a vendor CLI is running kills its process tree",
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-exit-"));
    const marker = String(9000 + Math.floor(Math.random() * 4000));
    fs.writeFileSync(
      path.join(dir, "slowvendor.cmd"),
      `@echo off\r\nping -n ${marker} 127.0.0.1 >nul\r\n`,
    );
    const runnerPath = path
      .resolve(import.meta.dir, "../src/vendorCli/runner")
      .split(path.sep)
      .join("/");
    fs.writeFileSync(
      path.join(dir, "host.ts"),
      `import { nodeCommandRunner } from "${runnerPath}";
void nodeCommandRunner.run("slowvendor", [], { timeoutMs: 600000 }).catch(() => {});
setTimeout(() => process.exit(0), 1500);
`,
    );
    try {
      const host = spawnSync(process.execPath, [path.join(dir, "host.ts")], {
        env: { ...process.env, PATH: `${dir};${process.env["PATH"] ?? process.env["Path"]}` },
        timeout: 15_000,
      });
      expect(host.status).toBe(0);
      await Bun.sleep(1000);
      const survivors = listPing(` -n ${marker} `);
      if (survivors) spawnSync("taskkill", ["/PID", survivors.split(/\s+/)[0]!, "/T", "/F"]);
      expect(survivors).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);

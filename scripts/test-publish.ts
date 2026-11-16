/**
 * Smoke-tests `publish/` the way an installed package runs: no workspace, no repo paths. Packs the
 * tarball, unpacks it in a temp dir, and runs the CLI and Web UI server from there.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const publishDir = resolve(import.meta.dir, "..", "publish");
const fixture = resolve(import.meta.dir, "..", "apps/cli/tests/fixtures/vault.json");
if (!existsSync(resolve(publishDir, "package.json"))) {
  throw new Error("publish/ not found. Run `bun run build:publish` first.");
}

function run(cmd: string[], cwd: string): string {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const text = `${p.stdout}${p.stderr}`;
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (${p.exitCode})\n${text}`);
  return text;
}

const tmp = mkdtempSync(resolve(tmpdir(), "vaultlint-publish-"));
try {
  run(["npm", "pack", "--pack-destination", tmp], publishDir);
  const tgz = Bun.spawnSync([
    "node",
    "-e",
    `console.log(require("fs").readdirSync(${JSON.stringify(tmp)}).find(f=>f.endsWith(".tgz")))`,
  ])
    .stdout.toString()
    .trim();
  run(["tar", "-xzf", tgz], tmp);
  const pkg = resolve(tmp, "package");
  for (const f of ["dist/index.js", "web/index.html", "package.json", "README.md", "LICENSE"]) {
    if (!existsSync(resolve(pkg, f))) throw new Error(`Packed tarball is missing ${f}`);
  }
  run(["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], pkg);
  const version = run(["node", "dist/index.js", "--version"], pkg).trim();
  console.log(`CLI --version: ${version}`);
  run(
    [
      "node",
      "dist/index.js",
      "--input",
      fixture,
      "--detect-duplicates",
      "--check-weak-passwords",
      "--dry-run",
    ],
    pkg,
  );
  // Web UI must be found next to dist/ (no apps/web checkout is available here).
  const port = 41730 + Math.floor(Math.random() * 1000);
  const server = Bun.spawn(["node", "dist/index.js", "--ui", "--port", String(port)], {
    cwd: pkg,
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      await Bun.sleep(200);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        ok = res.ok && (await res.text()).includes("<html");
      } catch {}
    }
    if (!ok)
      throw new Error(`Web UI did not serve from the packed tarball
${await new Response(server.stderr).text()}`);
  } finally {
    server.kill();
  }
  console.log("publish/ smoke test passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

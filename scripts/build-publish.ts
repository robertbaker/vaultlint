/**
 * Assembles `publish/`, the exact tree that ships to npm:
 *
 * Publish/package.json manifest derived from apps/cli/package.json (runtime fields only)
 * publish/dist/ bundled CLI (apps/cli/dist) publish/web/ built Web UI served by `vaultlint --ui`
 * (apps/web/dist/web/browser) publish/README.md, LICENSE, CHANGELOG.md
 *
 * `publish/` is generated and gitignored. Run `bun run build:publish`, then `bun run test:publish`
 * to smoke-test it, and release with `npm publish ./publish`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const out = resolve(root, "publish");
const cliDir = resolve(root, "apps/cli");
const webBrowserDir = resolve(root, "apps/web/dist/web/browser");

function run(cmd: string[]): void {
  const proc = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed (${proc.exitCode})`);
}

if (!process.argv.includes("--no-build")) {
  run(["bun", "run", "build:cli"]);
  run(["bun", "run", "build:web"]);
}
for (const required of [resolve(cliDir, "dist/index.js"), resolve(webBrowserDir, "index.html")]) {
  if (!existsSync(required)) throw new Error(`Missing build output: ${required}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(cliDir, "dist"), resolve(out, "dist"), { recursive: true });
cpSync(webBrowserDir, resolve(out, "web"), { recursive: true });
for (const file of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  cpSync(resolve(root, file), resolve(out, file));
}

const cli = JSON.parse(readFileSync(resolve(cliDir, "package.json"), "utf8")) as Record<
  string,
  unknown
>;
const { scripts: _scripts, devDependencies: _dev, ...manifest } = cli;
manifest.files = ["dist/", "web/", "CHANGELOG.md"];
writeFileSync(resolve(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`publish/ ready: ${manifest.name}@${manifest.version}`);

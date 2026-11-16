/**
 * Writes the root package.json version into the Web UI's pre-boot HTML shell
 * (`apps/web/src/index.html`). Run by the release-it `after:bump` hook.
 */
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
  version: string;
};
const shellPath = new URL("apps/web/src/index.html", root);
const shell = readFileSync(shellPath, "utf8");
const updated = shell.replace(/(<span class="landing-version">v)[^<]+(<\/span>)/, `$1${version}$2`);
if (updated === shell && !shell.includes(`landing-version">v${version}<`)) {
  throw new Error("Could not find the landing-version span in apps/web/src/index.html");
}
writeFileSync(shellPath, updated);
console.log(`index.html shell version → v${version}`);

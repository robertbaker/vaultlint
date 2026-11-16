import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("brand assets", () => {
  // The apps serve the mark as a static favicon; keep every copy identical to the source of truth.
  test.each(["../../../apps/web/public/favicon.svg", "../../../apps/site/public/favicon.svg"])(
    "%s matches logo.svg",
    (copy) => {
      expect(read(copy)).toBe(read("../logo.svg"));
    },
  );

  // The Web UI's pre-boot HTML shell repeats a few app strings; keep them from drifting.
  test("web loading shell shows the current version and tagline", () => {
    const shell = read("../../../apps/web/src/index.html");
    const { version } = JSON.parse(read("../../../package.json")) as { version: string };
    expect(shell).toContain(`<span class="landing-version">v${version}</span>`);
    expect(shell).toContain("Lint your vault.<br /><span>Keep it local.</span>");
  });
});

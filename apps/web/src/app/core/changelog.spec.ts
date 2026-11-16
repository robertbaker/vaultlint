import { describe, expect, it } from "vitest";

import {
  compareVersions,
  countItems,
  filterReleases,
  findRelease,
  hasUnreadChangelog,
  isOlderThanLatest,
  parseChangelog,
  presentKinds,
  releasesSince,
  safeUrl,
  sectionKind,
} from "./changelog";

const SAMPLE = `# Changelog

## [1.1.0](https://github.com/robertbaker/vaultlint/compare/v1.0.0...v1.1.0) (2026-11-16)

### Features

* **web:** add changelog modal ([abc1234](https://github.com/robertbaker/vaultlint/commit/abc1234567890))

### Bug Fixes

* **cli:** handle empty vault ([def5678](https://github.com/robertbaker/vaultlint/commit/def5678901234))

## [1.0.0](https://github.com/robertbaker/vaultlint/compare/v0.9.0...v1.0.0) (2026-11-10)

### Features

* initial release ([1112223](https://github.com/robertbaker/vaultlint/commit/1112223334445))
`;

describe("changelog utilities", () => {
  it("parses conventional-changelog markdown into releases, sections, and items", () => {
    const releases = parseChangelog(SAMPLE);
    expect(releases).toHaveLength(2);
    expect(releases[0]?.version).toBe("1.1.0");
    expect(releases[0]?.date).toBe("2026-11-16");
    expect(releases[0]?.sections).toHaveLength(2);
    expect(releases[0]?.sections[0]?.items[0]).toEqual({
      scope: "web",
      text: "add changelog modal",
      commits: [
        {
          hash: "abc1234",
          url: "https://github.com/robertbaker/vaultlint/commit/abc1234567890",
        },
      ],
    });
    expect(countItems(releases[0]!)).toBe(2);
    expect(findRelease(releases, "1.0.0")?.version).toBe("1.0.0");
  });

  it("rejects non-https links and links with embedded credentials", () => {
    expect(safeUrl("https://github.com/robertbaker/vaultlint")).toBe(
      "https://github.com/robertbaker/vaultlint",
    );
    expect(safeUrl("http://github.com/robertbaker/vaultlint")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://user:pass@github.com/robertbaker/vaultlint")).toBeNull();

    const parsed = parseChangelog(
      `## [1.0.0](javascript:alert) (2026-11-16)\n\n### Features\n\n* test ([abc1234](http://insecure.test/c))\n`,
    );
    expect(parsed[0]?.url).toBeNull();
    expect(parsed[0]?.sections[0]?.items[0]?.commits[0]?.url).toBeNull();
  });

  it("compares versions and determines unread/update status", () => {
    const releases = parseChangelog(SAMPLE);
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(isOlderThanLatest(releases, "1.0.0")).toBe(true);
    expect(isOlderThanLatest(releases, "1.1.0")).toBe(false);
    expect(releasesSince(releases, "1.0.0").map((r) => r.version)).toEqual(["1.1.0"]);
    expect(releasesSince(releases, null)).toEqual([]);
    expect(hasUnreadChangelog("1.0.0", "1.1.0")).toBe(true);
    expect(hasUnreadChangelog("1.1.0", "1.1.0")).toBe(false);
  });

  it("filters releases by section kind and search query", () => {
    const releases = parseChangelog(SAMPLE);
    expect(presentKinds(releases)).toEqual(["features", "fixes"]);
    expect(sectionKind("Bug Fixes")).toBe("fixes");
    expect(sectionKind("Features")).toBe("features");

    const onlyFixes = filterReleases(releases, { kinds: ["fixes"] });
    expect(onlyFixes).toHaveLength(1);
    expect(onlyFixes[0]?.sections.map((s) => s.title)).toEqual(["Bug Fixes"]);

    const searched = filterReleases(releases, { query: "modal" });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.version).toBe("1.1.0");
  });
});

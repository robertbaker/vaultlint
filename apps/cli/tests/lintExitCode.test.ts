import { describe, expect, it } from "bun:test";

import type { LintResult } from "@vaultlint/vault-ops";

import { getLintExitCode } from "../src/vaultManager";

function lintWith(error: number, warning: number): LintResult {
  return {
    ruleset: "recommended",
    effectiveRules: {},
    findings: [],
    counts: {
      error,
      warning,
      hint: 0,
      total: error + warning,
      fixableSafe: 0,
      fixableUnsafe: 0,
    },
    byRule: {},
  } as unknown as LintResult;
}

describe("getLintExitCode", () => {
  it("fails --lint on error findings only", () => {
    expect(getLintExitCode({ lint: true }, { lint: lintWith(1, 0) })).toBe(1);
    expect(getLintExitCode({ lint: true }, { lint: lintWith(0, 5) })).toBe(0);
  });

  it("does not fail without --lint on error findings", () => {
    expect(getLintExitCode({}, { lint: lintWith(3, 0) })).toBe(0);
  });

  it("applies --max-warnings whenever the linter ran, not only with --lint", () => {
    expect(getLintExitCode({ maxWarnings: 0 }, { lint: lintWith(0, 1) })).toBe(1);
    expect(getLintExitCode({ maxWarnings: 1 }, { lint: lintWith(0, 1) })).toBe(0);
    expect(getLintExitCode({ maxWarnings: 0 }, {})).toBe(0);
  });

  it("with --fail-on-new, existing findings do not fail the run", () => {
    const report = { lint: lintWith(4, 8), sarifNewErrorCount: 0, sarifNewWarningCount: 0 };
    expect(getLintExitCode({ lint: true, failOnNew: true }, report)).toBe(0);
  });

  it("with --fail-on-new, new errors or warnings fail the run", () => {
    expect(
      getLintExitCode(
        { lint: true, failOnNew: true },
        { lint: lintWith(0, 0), sarifNewErrorCount: 0, sarifNewWarningCount: 1 },
      ),
    ).toBe(1);
  });
});

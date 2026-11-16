import { TestBed } from "@angular/core/testing";
import { provideIcons } from "@ng-icons/core";
import { matCheckCircleRound, matTuneRound } from "@ng-icons/material-symbols/round";
import { LINT_PRESETS, type LintResult } from "@vaultlint/vault-ops";
import { describe, expect, it } from "vitest";

import { LintPanelComponent } from "./lint-panel.component";

const SAMPLE_RESULT: LintResult = {
  ruleset: "recommended",
  effectiveRules: { ...LINT_PRESETS.recommended },
  findings: [
    {
      ruleId: "weak-password",
      severity: "error",
      category: "security",
      message: "Password is too short.",
      itemIndex: 0,
      itemName: "Site A",
      fixable: "unsafe",
    },
    {
      ruleId: "weak-password",
      severity: "error",
      category: "security",
      message: "Password is too short.",
      itemIndex: 1,
      itemName: "Site B",
      fixable: "unsafe",
    },
    {
      ruleId: "insecure-http-uri",
      severity: "warning",
      category: "uri",
      message: "Uses http:// instead of https://.",
      itemIndex: 2,
      itemName: "Site C",
      fixable: "safe",
    },
  ],
  counts: {
    error: 2,
    warning: 1,
    hint: 0,
    total: 3,
    fixableSafe: 1,
    fixableUnsafe: 2,
  },
  byRule: {
    "weak-password": { severity: "error", count: 2, fixable: "unsafe" },
    "insecure-http-uri": { severity: "warning", count: 1, fixable: "safe" },
  },
};

function setup() {
  TestBed.configureTestingModule({
    imports: [LintPanelComponent],
    providers: [provideIcons({ matCheckCircleRound, matTuneRound })],
  });
  const fixture = TestBed.createComponent(LintPanelComponent);
  fixture.componentRef.setInput("lintResult", SAMPLE_RESULT);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe("LintPanelComponent", () => {
  it("groups findings by rule by default and switches to flat view on toggle", () => {
    const { fixture, root } = setup();
    const groups = root.querySelectorAll("details.animated-details");
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain("weak-password");
    expect(groups[0].textContent).toContain("2 items");
    expect(groups[1].textContent).toContain("insecure-http-uri");
    expect(groups[1].textContent).toContain("Fix all (1)");

    const flatBtn = [...root.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "All findings",
    )!;
    flatBtn.click();
    fixture.detectChanges();
    expect(root.querySelectorAll("details.animated-details")).toHaveLength(0);
    expect(root.textContent).toContain("Site A");
    expect(root.textContent).toContain("Site C");
    fixture.destroy();
  });

  it("toggles the collapsible Profiles & Rules configuration drawer", () => {
    const { fixture, root } = setup();
    expect(root.querySelector("#lint-new-profile")).toBeNull();

    const toggleBtn = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Profiles & Rules"),
    )!;
    toggleBtn.click();
    fixture.detectChanges();
    expect(root.querySelector("#lint-new-profile")).not.toBeNull();
    expect(root.textContent).toContain("Rule Severities");

    const hideBtn = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Hide Settings"),
    )!;
    hideBtn.click();
    fixture.detectChanges();
    expect(root.querySelector("#lint-new-profile")).toBeNull();
    fixture.destroy();
  });
});

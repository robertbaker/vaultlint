import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { VaultStatsComponent } from "./vault-stats.component";

function renderStats(
  duplicateCount: number,
  weakCount: number,
  healthScore = 100,
  lintCount = 0,
): HTMLElement {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [VaultStatsComponent] });
  const fixture = TestBed.createComponent(VaultStatsComponent);
  fixture.componentRef.setInput("totalItems", 5);
  fixture.componentRef.setInput("duplicateCount", duplicateCount);
  fixture.componentRef.setInput("weakCount", weakCount);
  fixture.componentRef.setInput("fidoCount", 0);
  fixture.componentRef.setInput("healthScore", healthScore);
  fixture.componentRef.setInput("lintCount", lintCount);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function summary(duplicateCount: number, weakCount: number): string {
  const root = renderStats(duplicateCount, weakCount);
  const paragraph = root.querySelector("p.text-sm");
  return (paragraph?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("VaultStatsComponent next-step summary", () => {
  it("uses a singular verb when exactly one finding needs review", () => {
    expect(summary(1, 0)).toBe("1 duplicate group needs review. Choose a finding to start.");
    expect(summary(0, 1)).toBe("1 weak password needs review. Choose a finding to start.");
  });

  it("uses a plural verb for several findings", () => {
    expect(summary(2, 0)).toBe("2 duplicate groups need review. Choose a finding to start.");
    expect(summary(1, 1)).toBe(
      "1 duplicate group · 1 weak password need review. Choose a finding to start.",
    );
  });

  it("renders a native progress ring reflecting healthScore", () => {
    const root = renderStats(1, 1, 64, 3);
    const ring = root.querySelector<HTMLProgressElement>("progress.progress-ring");
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute("value")).toBe("64");
    expect(ring?.getAttribute("aria-valuetext")).toBe("64% password health");
    expect(root.textContent).toContain("64%");
    expect(root.textContent).toContain("Vault checks (3)");
  });
});

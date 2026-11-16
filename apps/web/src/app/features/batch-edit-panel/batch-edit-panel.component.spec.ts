import { TestBed } from "@angular/core/testing";
import { provideIcons } from "@ng-icons/core";
import { matAddRound, matSmartToyRound } from "@ng-icons/material-symbols/round";
import { describe, expect, it } from "vitest";

import { BatchEditPanelComponent } from "./batch-edit-panel.component";

function setup() {
  TestBed.configureTestingModule({
    imports: [BatchEditPanelComponent],
    providers: [provideIcons({ matAddRound, matSmartToyRound })],
  });
  const fixture = TestBed.createComponent(BatchEditPanelComponent);
  fixture.componentRef.setInput("mappings", { "mail.google.com": "google.com" });
  fixture.componentRef.setInput("previewFn", (_field: string, pattern: string) => {
    if (pattern === "(") throw new SyntaxError("Unterminated group");
    return [
      { label: "Google", before: "http://google.com", after: "https://google.com" },
      { label: "Example", before: "http://example.com", after: "https://example.com" },
    ];
  });
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe("BatchEditPanelComponent", () => {
  it("applies regex presets and shows match counts in preview", () => {
    const { fixture, root } = setup();
    const presetBtn = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Preset: HTTP"),
    )!;
    presetBtn.click();
    fixture.detectChanges();

    expect(root.textContent).toContain("Showing 2 of 2 match(es)");
    expect(root.textContent).toContain("https://google.com");
    fixture.destroy();
  });

  it("reports invalid regex errors cleanly during preview", () => {
    const { fixture, root } = setup();
    const patternInput = root.querySelector<HTMLInputElement>("#batch-pattern")!;
    patternInput.value = "(";
    patternInput.dispatchEvent(new Event("input"));
    const previewBtn = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Preview Matches"),
    )!;
    previewBtn.click();
    fixture.detectChanges();

    expect(root.textContent).toContain("Invalid regex:");
    fixture.destroy();
  });

  it("emits domain mapping add/remove and openAi navigation", () => {
    const { fixture, root } = setup();
    const added: Array<{ from: string; to: string }> = [];
    const removed: string[] = [];
    let openedAi = false;

    fixture.componentInstance.addMapping.subscribe((v) => added.push(v));
    fixture.componentInstance.removeMapping.subscribe((v) => removed.push(v));
    fixture.componentInstance.openAi.subscribe(() => (openedAi = true));

    const fromInput = root.querySelector<HTMLInputElement>("input[aria-label='Source domain']")!;
    const toInput = root.querySelector<HTMLInputElement>("input[aria-label='Target domain']")!;
    fromInput.value = "docs.github.com";
    fromInput.dispatchEvent(new Event("input"));
    toInput.value = "github.com";
    toInput.dispatchEvent(new Event("input"));
    const addBtn = [...root.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Add",
    )!;
    addBtn.click();
    expect(added).toEqual([{ from: "docs.github.com", to: "github.com" }]);

    const removeBtn = [...root.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Remove",
    )!;
    removeBtn.click();
    expect(removed).toEqual(["mail.google.com"]);

    const aiBtn = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Open AI Assistant"),
    )!;
    aiBtn.click();
    expect(openedAi).toBe(true);
    fixture.destroy();
  });
});

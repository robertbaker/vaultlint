import { TestBed } from "@angular/core/testing";
import { provideIcons } from "@ng-icons/core";
import {
  matCampaignRound,
  matCompareArrowsRound,
  matDarkModeRound,
  matDownloadRound,
  matHelpRound,
  matLightModeRound,
  matMenuRound,
  matMoreHorizRound,
  matRedoRound,
  matUndoRound,
} from "@ng-icons/material-symbols/round";
import { describe, expect, it } from "vitest";

import { VaultHeaderComponent } from "./vault-header.component";

function setup(hasVault: boolean) {
  TestBed.configureTestingModule({
    imports: [VaultHeaderComponent],
    providers: [
      provideIcons({
        matCampaignRound,
        matCompareArrowsRound,
        matDarkModeRound,
        matDownloadRound,
        matHelpRound,
        matLightModeRound,
        matMenuRound,
        matMoreHorizRound,
        matRedoRound,
        matUndoRound,
      }),
    ],
  });
  const fixture = TestBed.createComponent(VaultHeaderComponent);
  fixture.componentRef.setInput("canUndo", true);
  fixture.componentRef.setInput("canRedo", false);
  fixture.componentRef.setInput("hasVault", hasVault);
  fixture.componentRef.setInput("theme", "auto");
  fixture.componentRef.setInput("sourceFormatName", "Bitwarden JSON");
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe("VaultHeaderComponent", () => {
  it("renders landing navigation with mobile popover trigger when no vault is open", () => {
    const { fixture, root } = setup(false);
    expect(root.querySelector(".landing-nav")).not.toBeNull();
    const menuTrigger = root.querySelector("button[popovertarget='landing-mobile-menu']");
    expect(menuTrigger).not.toBeNull();
    expect(root.querySelector("#landing-mobile-menu")?.getAttribute("popover")).toBe("auto");
    fixture.destroy();
  });

  it("renders workspace header with native More popover and emits compareFormats & exportVault", () => {
    const { fixture, root } = setup(true);
    let compared = false;
    let exported = false;
    fixture.componentInstance.compareFormats.subscribe(() => (compared = true));
    fixture.componentInstance.exportVault.subscribe(() => (exported = true));

    expect(root.querySelector(".glass-nav-app")).not.toBeNull();
    const moreTrigger = root.querySelector("button[popovertarget='workspace-more-popover']");
    expect(moreTrigger).not.toBeNull();
    expect(moreTrigger?.getAttribute("aria-haspopup")).toBeNull();

    const compareBtn = [
      ...root.querySelectorAll<HTMLButtonElement>("#workspace-more-popover button"),
    ].find((b) => b.textContent?.includes("Compare export formats"))!;
    compareBtn.click();
    expect(compared).toBe(true);

    root.querySelector<HTMLButtonElement>("[data-export-vault]")!.click();
    expect(exported).toBe(true);
    fixture.destroy();
  });
});

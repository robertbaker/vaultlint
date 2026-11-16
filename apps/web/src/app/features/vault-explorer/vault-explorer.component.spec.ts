import { TestBed } from "@angular/core/testing";
import { provideIcons } from "@ng-icons/core";
import {
  matAddRound,
  matCheckRound,
  matCloseRound,
  matContentCopyRound,
  matDeleteRound,
  matEditRound,
  matFilterListRound,
  matRefreshRound,
  matSearchRound,
  matVisibilityOffRound,
  matVisibilityRound,
} from "@ng-icons/material-symbols/round";
import { describe, expect, it } from "vitest";

import type { ExplorerRow } from "../../core/vault.models";
import { VaultExplorerComponent } from "./vault-explorer.component";

function makeRows(count: number): ExplorerRow[] {
  return Array.from({ length: count }, (_, i) => {
    const name = `Item ${String(i + 1).padStart(2, "0")}`;
    return {
      item: { id: `id${i}`, name },
      index: i,
      key: `id${i}`,
      name,
      folderName: "",
      username: "",
      password: "",
      uris: [],
      itemType: 1,
      isMobileApp: false,
      isWeak: false,
      isReused: false,
      isDup: false,
      isBreached: false,
      hasFido: false,
      isFavorite: false,
    };
  });
}

function setup(rows: ExplorerRow[]) {
  TestBed.configureTestingModule({
    imports: [VaultExplorerComponent],
    providers: [
      provideIcons({
        matAddRound,
        matCheckRound,
        matCloseRound,
        matContentCopyRound,
        matDeleteRound,
        matEditRound,
        matFilterListRound,
        matRefreshRound,
        matSearchRound,
        matVisibilityOffRound,
        matVisibilityRound,
      }),
    ],
  });
  const fixture = TestBed.createComponent(VaultExplorerComponent);
  fixture.componentRef.setInput("rows", rows);
  fixture.componentRef.setInput("revealedIds", new Set<string>());
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const bodyNames = () =>
    [...root.querySelectorAll("tbody tr td:nth-child(2) span.font-medium")].map((el) =>
      el.textContent?.trim(),
    );
  const click = (label: string) => {
    const button = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith(label),
    );
    button!.click();
    fixture.detectChanges();
  };
  return { fixture, root, bodyNames, click };
}

describe("VaultExplorerComponent table row models", () => {
  it("renders only one page of rows and moves to the next page", () => {
    const { bodyNames, click, root } = setup(makeRows(25));
    expect(bodyNames()).toHaveLength(10);
    expect(bodyNames()[0]).toBe("Item 01");
    expect(root.textContent).toContain("Page 1 of 3");
    click("Next");
    expect(bodyNames()).toHaveLength(10);
    expect(bodyNames()[0]).toBe("Item 11");
  });

  it("sorts rows when a sortable column header is clicked", () => {
    const { bodyNames, click } = setup(makeRows(5));
    click("Name");
    expect(bodyNames()).toEqual(["Item 01", "Item 02", "Item 03", "Item 04", "Item 05"]);
    click("Name");
    expect(bodyNames()).toEqual(["Item 05", "Item 04", "Item 03", "Item 02", "Item 01"]);
  });

  it("sorts rows by Status risk severity when Status header is clicked", () => {
    const rows = makeRows(3);
    rows[0] = { ...rows[0], name: "Healthy" };
    rows[1] = { ...rows[1], name: "Weak", isWeak: true };
    rows[2] = { ...rows[2], name: "Breached", isBreached: true };
    const { bodyNames, click } = setup(rows);
    click("Status");
    expect(bodyNames()).toEqual(["Breached", "Weak", "Healthy"]);
  });

  it("exposes unified aria-pressed favorite buttons and active filter chips", () => {
    const rows = makeRows(2);
    rows[0] = { ...rows[0], isFavorite: true };
    const { fixture, root } = setup(rows);
    fixture.componentInstance.filterMode.set("weak");
    fixture.detectChanges();

    const desktopFav = root.querySelector<HTMLButtonElement>(
      "tbody button[aria-label='Unstar Item 01']",
    );
    const mobileFav = root.querySelector<HTMLButtonElement>(
      "article button[aria-label='Unstar Item 01']",
    );
    expect(desktopFav?.getAttribute("aria-pressed")).toBe("true");
    expect(mobileFav?.getAttribute("aria-pressed")).toBe("true");

    const chip = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Weak passwords ×"),
    )!;
    expect(chip).toBeDefined();
    chip.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.filterMode()).toBe("all");
  });

  it("selects only the visible page with the select-all checkbox", () => {
    const { fixture, root } = setup(makeRows(25));
    const all = root.querySelector<HTMLInputElement>("thead input[type=checkbox]")!;
    all.checked = true;
    all.dispatchEvent(new Event("change"));
    fixture.detectChanges();
    expect(root.textContent).toContain("10 item(s) selected");
  });

  it("uses a search landmark, compacts multi-URIs, and shows inline copy feedback without disabling", () => {
    const rows = makeRows(1);
    rows[0] = {
      ...rows[0],
      password: "StrongPassword!123",
      uris: ["https://one.example", "https://two.example", "https://three.example"],
    };
    const { fixture, root } = setup(rows);
    const copied: Array<{ label: string; value: string }> = [];
    fixture.componentInstance.copyValue.subscribe((ev) => copied.push(ev));

    expect(root.querySelector("search[aria-label='Filter vault items']")).not.toBeNull();
    expect(root.textContent).toContain("https://one.example");
    expect(root.textContent).toContain("+2");

    const mobileCopyBtn = root.querySelector<HTMLButtonElement>(
      "article button[aria-label='Copy password for Item 01']",
    )!;
    mobileCopyBtn.click();
    fixture.detectChanges();

    expect(copied).toEqual([{ label: "password", value: "StrongPassword!123" }]);
    expect(mobileCopyBtn.disabled).toBe(false);
    expect(mobileCopyBtn.textContent).toContain("Copied");
  });
});

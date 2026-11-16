import { TestBed } from "@angular/core/testing";
import { provideIcons } from "@ng-icons/core";
import { matCloseRound } from "@ng-icons/material-symbols/round";
import { describe, expect, it } from "vitest";

import { EditItemDialogComponent, type EditItemResult } from "./edit-item-dialog.component";

function setup() {
  TestBed.configureTestingModule({
    imports: [EditItemDialogComponent],
    providers: [provideIcons({ matCloseRound })],
  });
  const fixture = TestBed.createComponent(EditItemDialogComponent);
  fixture.detectChanges();

  const root = fixture.nativeElement as HTMLElement;
  const dialog = root.querySelector("dialog")!;
  if (typeof dialog.showModal !== "function") {
    dialog.showModal = () => {
      dialog.setAttribute("open", "");
    };
  }
  if (typeof dialog.close !== "function") {
    dialog.close = () => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    };
  }

  return { fixture, root, dialog };
}

describe("EditItemDialogComponent", () => {
  it("delays required name error until blur or submit and synchronizes ARIA state", () => {
    const { fixture, root } = setup();
    const savedEvents: EditItemResult[] = [];
    fixture.componentInstance.saved.subscribe((ev) => savedEvents.push(ev));

    fixture.componentInstance.openCreate();
    fixture.detectChanges();

    const nameInput = root.querySelector<HTMLInputElement>("#edit-name")!;
    const form = root.querySelector("form")!;

    expect(nameInput.getAttribute("aria-required")).toBe("true");
    expect(nameInput.getAttribute("aria-invalid")).toBeNull();
    expect(nameInput.getAttribute("aria-describedby")).toBeNull();
    expect(root.querySelector("#edit-name-error")).toBeNull();

    nameInput.dispatchEvent(new Event("blur"));
    fixture.detectChanges();

    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput.getAttribute("aria-describedby")).toBe("edit-name-error");
    expect(root.querySelector("#edit-name-error")?.textContent?.trim()).toBe("Name is required.");

    form.dispatchEvent(new Event("submit", { cancelable: true }));
    fixture.detectChanges();
    expect(savedEvents).toHaveLength(0);

    nameInput.value = "GitHub";
    nameInput.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    expect(nameInput.getAttribute("aria-invalid")).toBeNull();
    expect(nameInput.getAttribute("aria-describedby")).toBeNull();
    expect(root.querySelector("#edit-name-error")).toBeNull();

    form.dispatchEvent(new Event("submit", { cancelable: true }));
    fixture.detectChanges();
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].name).toBe("GitHub");
  });

  it("ignores IME confirming Enter events in the new-folder input", () => {
    const { fixture, root } = setup();
    const createdFolders: string[] = [];
    fixture.componentInstance.createFolder.subscribe((name) => createdFolders.push(name));

    fixture.componentInstance.openCreate();
    fixture.detectChanges();

    const folderInput = root.querySelector<HTMLInputElement>(
      "input[aria-label='New folder name']",
    )!;
    folderInput.value = "Work";
    folderInput.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    folderInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }),
    );
    folderInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }),
    );
    fixture.detectChanges();
    expect(createdFolders).toEqual([]);

    folderInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    fixture.detectChanges();
    expect(createdFolders).toEqual(["Work"]);
  });
});

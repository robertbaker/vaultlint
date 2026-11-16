import { TestBed } from "@angular/core/testing";
import type { VaultData } from "@vaultlint/vault-schema";
import { describe, expect, it, vi } from "vitest";

import { MigrationPanelComponent } from "./migration-panel.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function bitwardenJson(name: string): string {
  return JSON.stringify({
    encrypted: false,
    folders: [],
    items: [{ id: name, name, type: 1, login: { username: "", password: "", uris: [] } }],
  });
}

describe("MigrationPanelComponent", () => {
  it("keeps a slower earlier file parse from replacing the latest selection", async () => {
    TestBed.configureTestingModule({ imports: [MigrationPanelComponent] });
    const fixture = TestBed.createComponent(MigrationPanelComponent);
    fixture.componentRef.setInput("current", { items: [] } satisfies VaultData);
    fixture.detectChanges();

    const firstRead = deferred<ArrayBuffer>();
    const secondRead = deferred<ArrayBuffer>();
    const firstFile = new File([], "first.json");
    const secondFile = new File([], "second.json");
    vi.spyOn(firstFile, "arrayBuffer").mockReturnValue(firstRead.promise);
    vi.spyOn(secondFile, "arrayBuffer").mockReturnValue(secondRead.promise);
    const onFileSelected = (
      fixture.componentInstance as unknown as { onFileSelected(event: Event): Promise<void> }
    ).onFileSelected;
    const select = (file: File) => {
      const event = new Event("change");
      Object.defineProperty(event, "target", { value: { files: [file], value: "selected" } });
      return onFileSelected.call(fixture.componentInstance, event);
    };
    const asBuffer = (value: string): ArrayBuffer =>
      new TextEncoder().encode(value).buffer as ArrayBuffer;

    const firstSelection = select(firstFile);
    const secondSelection = select(secondFile);
    secondRead.resolve(asBuffer(bitwardenJson("Second")));
    await secondSelection;
    firstRead.resolve(asBuffer(bitwardenJson("First")));
    await firstSelection;

    const incoming = (
      fixture.componentInstance as unknown as { incoming: () => VaultData | null }
    ).incoming();
    expect(incoming?.items[0].name).toBe("Second");
    fixture.destroy();
  });
});

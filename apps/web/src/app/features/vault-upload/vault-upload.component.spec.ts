import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { VaultUploadComponent } from "./vault-upload.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("VaultUploadComponent", () => {
  it("keeps a slower earlier file read from replacing a newer selection", async () => {
    TestBed.configureTestingModule({ imports: [VaultUploadComponent] });
    const fixture = TestBed.createComponent(VaultUploadComponent);
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    const firstFile = new File([], "first.json");
    const secondFile = new File([], "second.json");
    vi.spyOn(firstFile, "text").mockReturnValue(firstRead.promise);
    vi.spyOn(secondFile, "text").mockReturnValue(secondRead.promise);
    const loaded: string[] = [];
    fixture.componentInstance.fileLoaded.subscribe(({ fileName }) => loaded.push(fileName));
    const onFileSelected = (
      fixture.componentInstance as unknown as { onFileSelected(event: Event): Promise<void> }
    ).onFileSelected;
    const select = (file: File) => {
      const event = new Event("change");
      Object.defineProperty(event, "target", { value: { files: [file], value: "selected" } });
      return onFileSelected.call(fixture.componentInstance, event);
    };

    const firstSelection = select(firstFile);
    const secondSelection = select(secondFile);
    secondRead.resolve("newer");
    await secondSelection;
    firstRead.resolve("older");
    await firstSelection;

    expect(loaded).toEqual(["second.json"]);
    fixture.destroy();
  });
});

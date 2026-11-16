import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { CHANGELOG_CACHE_KEY } from "../../core/changelog";
import { BROWSER_STORAGE, type StorageAdapter } from "../../core/storage.token";
import { ChangelogDialogComponent } from "./changelog-dialog.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("ChangelogDialogComponent", () => {
  it("does not let an older request overwrite a newer changelog cache", async () => {
    const values = new Map<string, string>();
    const storage: StorageAdapter = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
    };
    const older = deferred<Response>();
    const newer = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);
    TestBed.configureTestingModule({
      imports: [ChangelogDialogComponent],
      providers: [{ provide: BROWSER_STORAGE, useValue: storage }],
    });

    const fixture = TestBed.createComponent(ChangelogDialogComponent);
    fixture.componentRef.setInput("currentVersion", "1.0.0");
    fixture.detectChanges();
    const load = (fixture.componentInstance as unknown as { load: () => Promise<void> }).load;
    const olderRun = load.call(fixture.componentInstance);
    const newerRun = load.call(fixture.componentInstance);

    newer.resolve(new Response("## [2.0.0] (2026-11-17)\n"));
    await newerRun;
    older.resolve(new Response("## [1.0.0] (2026-11-16)\n"));
    await olderRun;

    expect(JSON.parse(values.get(CHANGELOG_CACHE_KEY) ?? "null").text).toContain("2.0.0");
    fixture.destroy();
    vi.unstubAllGlobals();
  });
});

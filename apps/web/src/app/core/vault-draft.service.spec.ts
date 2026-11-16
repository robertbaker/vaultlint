import { TestBed } from "@angular/core/testing";
import { vi } from "vitest";

import { BROWSER_STORAGE, type StorageAdapter } from "./storage.token";
import { RECOVERY_PREF_KEY, VaultDraftService } from "./vault-draft.service";
import { VaultStoreService } from "./vault-store.service";

interface DraftInternals {
  getRecord: () => Promise<unknown>;
  readDraft: () => Promise<{ snapshot: unknown; savedAt: string } | null>;
  deleteDraft: () => Promise<void>;
  enqueueSave: (snapshot: unknown, revision: number) => void;
}

function setup(initial: Record<string, string> = {}) {
  vi.stubGlobal("indexedDB", {});
  const values = new Map(Object.entries(initial));
  const storage: StorageAdapter = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
  TestBed.configureTestingModule({ providers: [{ provide: BROWSER_STORAGE, useValue: storage }] });
  const drafts = TestBed.inject(VaultDraftService);
  const internals = drafts as unknown as DraftInternals;
  const deleteDraft = vi.fn(async () => {});
  const enqueueSave = vi.fn();
  internals.deleteDraft = deleteDraft;
  internals.enqueueSave = enqueueSave;
  return { drafts, internals, values, deleteDraft, enqueueSave };
}

describe("opt-in local recovery copy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is off by default and offers no restore prompt when no draft exists", async () => {
    const { drafts, internals, values } = setup();
    internals.getRecord = async () => null;

    await drafts.checkForDraft();

    expect(drafts.enabled()).toBe(false);
    expect(drafts.hasDraft()).toBe(false);
    expect(drafts.saveState()).toBe("off");
    expect(values.size).toBe(0);
  });

  it("does not save the open vault while disabled, and saves once enabled", async () => {
    vi.useFakeTimers();
    const { drafts, internals, enqueueSave } = setup();
    internals.getRecord = async () => null;
    const store = TestBed.inject(VaultStoreService);
    await drafts.checkForDraft();
    await store.loadSampleVault();
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(enqueueSave).not.toHaveBeenCalled();

    await drafts.setEnabled(true);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(enqueueSave).toHaveBeenCalledTimes(1);
  });

  it("persists only a boolean flag and deletes the stored copy when turned off", async () => {
    const { drafts, internals, values, deleteDraft } = setup({ [RECOVERY_PREF_KEY]: "1" });
    internals.getRecord = async () => null;
    expect(drafts.enabled()).toBe(true);
    await drafts.checkForDraft();
    drafts.hasDraft.set(true);

    await drafts.setEnabled(false);

    expect(deleteDraft).toHaveBeenCalled();
    expect(drafts.enabled()).toBe(false);
    expect(drafts.hasDraft()).toBe(false);
    expect(drafts.saveState()).toBe("off");
    expect([...values.entries()]).toEqual([[RECOVERY_PREF_KEY, "0"]]);

    await drafts.setEnabled(true);
    expect(values.get(RECOVERY_PREF_KEY)).toBe("1");
  });

  it("cancels a pending save when turned off before the debounce fires", async () => {
    vi.useFakeTimers();
    const { drafts, internals, enqueueSave } = setup({ [RECOVERY_PREF_KEY]: "1" });
    internals.getRecord = async () => null;
    const store = TestBed.inject(VaultStoreService);
    await drafts.checkForDraft();
    await store.loadSampleVault();
    TestBed.tick();

    await drafts.setEnabled(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1000);

    expect(enqueueSave).not.toHaveBeenCalled();
  });

  it("treats an unreadable draft store as no draft while the preference is off", async () => {
    const { drafts, internals } = setup();
    internals.getRecord = async () => {
      throw new Error("unreadable");
    };
    await drafts.checkForDraft();
    expect(drafts.hasDraft()).toBe(false);
    expect(drafts.saveState()).toBe("off");
  });

  it("does not overwrite a vault loaded while the recovery draft is being read", async () => {
    const { drafts, internals } = setup({ [RECOVERY_PREF_KEY]: "1" });
    const store = TestBed.inject(VaultStoreService);
    let resolveDraft!: (draft: { snapshot: unknown; savedAt: string } | null) => void;
    internals.readDraft = () =>
      new Promise((resolve) => {
        resolveDraft = resolve;
      });

    const restoring = drafts.restoreDraft();
    await store.loadSampleVault();
    const loadedName = store.vaultData()!.items[0].name;
    resolveDraft({
      snapshot: {
        data: { items: [{ id: "old", name: "Old recovered vault" }] },
        format: "bitwarden-json",
        exportFormat: "bitwarden-json",
        formatName: "Bitwarden JSON",
        sourceName: "old.json",
      },
      savedAt: new Date().toISOString(),
    });

    expect(await restoring).toBe(false);
    expect(store.vaultData()!.items[0].name).toBe(loadedName);
  });
});

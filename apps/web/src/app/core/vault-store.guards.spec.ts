import { TestBed } from "@angular/core/testing";
import { AiResponseError, createDefaultAiContainer, type IHttpClient } from "@vaultlint/ai";
import { vi } from "vitest";

import { AI_CONTAINER } from "./ai-container.token";
import { DOWNLOAD_REVOKE_DELAY_MS, downloadBlob } from "./download";
import { DRAFT_TTL_MS, VaultDraftService } from "./vault-draft.service";
import { VaultStoreService } from "./vault-store.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("finding identity after vault mutations", () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it("re-keys redirect, dead-link and mobile findings when indices shift", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    // "3" (GitHub) is at index 2.
    store.redirectFindings.set([
      {
        itemIndex: 2,
        itemId: "3",
        itemName: "GitHub",
        originalUri: "https://github.com/login",
        redirectedUri: "https://github.com/",
        status: 200,
      },
    ]);
    store.deadLinkFindings.set([
      {
        itemIndex: 2,
        itemId: "3",
        itemName: "GitHub",
        uri: "https://github.com/login",
        reason: "x",
      },
    ]);
    store.mobileUriFindings.set([
      {
        itemIndex: 2,
        itemId: "3",
        itemName: "GitHub",
        uri: "androidapp://com.github.android",
        status: "suggested",
        detail: "",
      },
    ]);

    store.deleteItem(0);
    TestBed.tick();

    expect(store.redirectFindings()[0].itemIndex).toBe(1);
    expect(store.deadLinkFindings()[0].itemIndex).toBe(1);
    expect(store.mobileUriFindings()[0].itemIndex).toBe(1);

    store.undo();
    TestBed.tick();
    expect(store.redirectFindings()[0].itemIndex).toBe(2);
  });

  it("drops findings whose item was deleted and never edits another item", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const finding = {
      itemIndex: 2,
      itemId: "3",
      itemName: "GitHub",
      uri: "https://github.com/login",
      reason: "x",
    };
    store.deadLinkFindings.set([finding]);

    store.deleteItem(2);
    TestBed.tick();
    expect(store.deadLinkFindings()).toEqual([]);

    // A stale finding object (e.g. from an old render) must not touch the item now at index 2.
    const before = JSON.stringify(store.vaultData());
    store.removeDeadUri(finding);
    expect(JSON.stringify(store.vaultData())).toBe(before);
  });

  it("drops a link finding when its source URI changes on an identified item", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const finding = {
      itemIndex: 2,
      itemId: "3",
      itemName: "GitHub",
      uri: "https://github.com/login",
      reason: "x",
    };
    store.deadLinkFindings.set([finding]);

    const next = structuredClone(store.vaultData()!);
    next.items[2].login!.uris = ["https://new.example"];
    store.vaultData.set(next);
    TestBed.tick();

    expect(store.deadLinkFindings()).toEqual([]);
    store.removeDeadUri(finding);
    expect(store.canUndo()).toBe(false);
    expect(store.vaultData()!.items[2].login?.uris).toEqual(["https://new.example"]);
  });

  it("drops mobile app suggestions when their source site URI changes", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultObject(
      {
        items: [
          {
            id: "spotify",
            name: "Spotify",
            login: { uris: ["https://spotify.com"] },
          },
        ],
      },
      "spotify.json",
    );
    const finding = {
      itemIndex: 0,
      itemId: "spotify",
      itemName: "Spotify",
      uri: "androidapp://com.spotify.music",
      sourceUri: "https://spotify.com",
      status: "suggested" as const,
      detail: "Suggested for spotify.com",
    };
    store.mobileUriFindings.set([finding]);

    const next = structuredClone(store.vaultData()!);
    next.items[0].login!.uris = ["https://github.com"];
    store.vaultData.set(next);
    TestBed.tick();

    expect(store.mobileUriFindings()).toEqual([]);
    store.applySuggestedMobileUri(finding);
    expect(store.canUndo()).toBe(false);
    expect(store.vaultData()!.items[0].login?.uris).toEqual(["https://github.com"]);
  });

  it("locates id-less items by name and URI", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultObject(
      {
        items: [
          { name: "A", login: { uris: [{ uri: "https://a.example" }], password: "x" } },
          { name: "B", login: { uris: [{ uri: "https://b.example" }], password: "y" } },
        ],
      },
      "idless.json",
    );
    store.deadLinkFindings.set([
      { itemIndex: 1, itemName: "B", uri: "https://b.example", reason: "x" },
    ]);
    store.deleteItem(0);
    TestBed.tick();
    expect(store.deadLinkFindings()[0].itemIndex).toBe(0);

    store.removeDeadUri(store.deadLinkFindings()[0]);
    expect(store.vaultData()?.items[0].login?.uris).toEqual([]);
  });

  it("clears a breach flag when the flagged password changes", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const internals = store as unknown as { compromisedPasswords: Map<string, string> };
    internals.compromisedPasswords = new Map([["3", "123456"]]);
    store.compromisedIds.set(new Set(["3"]));
    TestBed.tick();
    expect(store.compromisedIds().has("3")).toBe(true);

    store.regeneratePassword(2);
    TestBed.tick();
    expect(store.compromisedIds().has("3")).toBe(false);
  });

  it("only keeps reveal state for items that have a stable id", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultObject({ items: [{ name: "B" }, { id: "a", name: "A" }] }, "mixed.json");
    store.toggleReveal("a");
    store.toggleReveal("0");
    TestBed.tick();
    store.createItem({ name: "New", username: "", password: "x", urisText: "", notes: "" });
    TestBed.tick();
    expect(store.revealedIds().has("a")).toBe(true);
    expect(store.revealedIds().has("0")).toBe(false);
  });
});

describe("in-flight guards", () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => vi.unstubAllGlobals());

  it("does not let a stale link finding for a duplicate ID edit its surviving sibling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultObject(
      {
        items: [
          {
            id: "duplicate",
            name: "First",
            login: { password: "a", uris: ["https://same.example"] },
          },
          {
            id: "duplicate",
            name: "Second",
            login: { password: "b", uris: ["https://same.example"] },
          },
        ],
      },
      "duplicates.json",
    );
    await store.checkLinksAndRedirects();
    const staleFinding = store.deadLinkFindings().find((finding) => finding.itemName === "First");
    expect(staleFinding).toBeDefined();

    store.deleteItem(0);
    TestBed.tick();
    store.removeDeadUri(staleFinding!);

    expect(store.vaultData()?.items[0].name).toBe("Second");
    expect(store.vaultData()?.items[0].login?.uris).toEqual(["https://same.example"]);
  });

  it("runs one HIBP check at a time and ignores results for a replaced vault", async () => {
    const gate = deferred<void>();
    const fetchMock = vi.fn(async () => {
      await gate.promise;
      return { ok: true, status: 200, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const first = store.checkCompromisedHibp();
    expect(store.checkingHibp()).toBe(true);
    await store.checkCompromisedHibp(); // re-entrant call is a no-op
    const callsWhileRunning = fetchMock.mock.calls.length;

    await store.loadSampleVault(); // replaces the vault mid-run
    expect(store.checkingHibp()).toBe(false);

    gate.resolve();
    await first;
    expect(store.compromisedIds().size).toBe(0);
    expect(store.checkingHibp()).toBe(false);
    expect(store.auditLog()[0]?.action).not.toContain("HIBP check complete");
    expect(callsWhileRunning).toBeLessThanOrEqual(1);
  });

  it("does not let a stale HIBP run clear the flag of a newer run", async () => {
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
        return { ok: true, status: 200, text: async () => "" };
      }),
    );
    const store = TestBed.inject(VaultStoreService);
    const single = { items: [{ id: "a", name: "A", login: { password: "pw-one" } }] };
    await store.loadVaultObject(single, "one.json");
    const stale = store.checkCompromisedHibp();
    await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));

    await store.loadVaultObject(single, "one.json");
    const fresh = store.checkCompromisedHibp();
    expect(store.checkingHibp()).toBe(true);

    for (const gate of gates.splice(0)) gate.resolve();
    await stale;
    expect(store.checkingHibp()).toBe(true);

    await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0));
    for (const gate of gates.splice(0)) gate.resolve();
    await fresh;
    expect(store.checkingHibp()).toBe(false);
  });

  it("link check: single-flight, and results for a cleared vault are discarded", async () => {
    const pending: Array<(v: unknown) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const run = store.checkLinksAndRedirects();
    expect(store.checkingLinks()).toBe(true);
    const callsAfterStart = fetchMock.mock.calls.length;
    await store.checkLinksAndRedirects();
    expect(fetchMock.mock.calls.length).toBe(callsAfterStart);

    store.clearVault();
    expect(store.checkingLinks()).toBe(false);
    for (const resolve of pending.splice(0)) {
      resolve({ redirected: true, url: "https://elsewhere.test/", status: 200 });
    }
    await run;
    expect(store.redirectFindings()).toEqual([]);
    expect(store.deadLinkFindings()).toEqual([]);
    expect(store.checkingLinks()).toBe(false);
  });

  it("link check: findings are re-located when the vault shifts mid-run", async () => {
    const pending: Array<{ uri: string; resolve: (v: unknown) => void }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (uri: string) =>
          new Promise((resolve) => {
            pending.push({ uri, resolve });
          }),
      ),
    );
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const run = store.checkLinksAndRedirects();
    store.deleteItem(0); // GitHub moves from index 2 to 1
    for (const { uri, resolve } of pending.splice(0)) {
      if (uri.includes("github.com")) resolve({ redirected: false, status: 404 });
      else resolve({ redirected: false, status: 200 });
    }
    await run;

    const dead = store.deadLinkFindings();
    expect(dead).toHaveLength(1);
    expect(dead[0].itemId).toBe("3");
    expect(dead[0].itemIndex).toBe(store.vaultData()!.items.findIndex((i) => i.id === "3"));
  });

  it("mobile check: single-flight, and results for a replaced vault are discarded", async () => {
    const pending: Array<(v: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            pending.push(resolve);
          }),
      ),
    );
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultObject(
      {
        items: [
          { id: "i1", name: "App", login: { uris: [{ uri: "iosapp://12345" }], password: "x" } },
        ],
      },
      "ios.json",
    );

    const run = store.checkMobileAppUris();
    expect(store.checkingMobileUris()).toBe(true);
    await vi.waitFor(() => expect(pending.length).toBe(1));
    await store.checkMobileAppUris();
    expect(pending.length).toBe(1);

    await store.loadSampleVault();
    expect(store.checkingMobileUris()).toBe(false);
    for (const resolve of pending.splice(0)) {
      resolve({ ok: true, json: async () => ({ resultCount: 1 }) });
    }
    await run;
    expect(store.mobileUriFindings()).toEqual([]);
    expect(store.checkingMobileUris()).toBe(false);
  });

  it("format coverage: discards results for a vault replaced mid-run", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const run = store.inspectAllFormatCoverage();
    expect(store.checkingFormatCoverage()).toBe(true);
    store.clearVault();
    await run;
    expect(store.roundTripCoverage()).toEqual([]);
    expect(store.checkingFormatCoverage()).toBe(false);
  });

  it("format coverage: discards results when the vault is edited mid-run", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const run = store.inspectAllFormatCoverage();
    const edited = structuredClone(store.vaultData()!);
    edited.items[0].name = "Edited while coverage was starting";
    store.vaultData.set(edited);

    await run;

    expect(store.roundTripCoverage()).toEqual([]);
    expect(store.checkingFormatCoverage()).toBe(false);
  });
});

describe("AI stale-result guards", () => {
  function setup() {
    const requests: Array<(r: { status: number; data: unknown }) => void> = [];
    const http: IHttpClient = {
      request<T>() {
        return new Promise<{ status: number; data: T }>((resolve) => {
          requests.push((r) => resolve({ status: r.status, data: r.data as T }));
        });
      },
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AI_CONTAINER, useValue: createDefaultAiContainer(http) }],
    });
    return { requests, store: TestBed.inject(VaultStoreService) };
  }

  it("does not apply categories when the vault was replaced during the run", async () => {
    const { requests, store } = setup();
    await store.loadSampleVault();
    const running = store.categorizeWithAi({ provider: "ollama" });
    await store.loadSampleVault(); // same ids, new generation
    const before = JSON.stringify(store.vaultData());

    requests[0]({
      status: 200,
      data: { message: { content: JSON.stringify({ categories: { "0": "Cloud" } }) } },
    });
    await running;

    expect(JSON.stringify(store.vaultData())).toBe(before);
    expect(store.aiRunning()).toBe(false);
    expect(store.auditLog()[0]?.action).toContain("results were discarded");
  });

  it("reports a truncated AI response clearly, releases the busy flag and leaves the vault alone", async () => {
    const { requests, store } = setup();
    await store.loadSampleVault();
    const before = JSON.stringify(store.vaultData());
    const running = store.categorizeWithAi({ provider: "ollama" });
    expect(store.aiRunning()).toBe(true);

    requests[0]({ status: 200, data: { message: { content: '{"categories": {"0": "Clo' } } });
    await running;

    expect(store.aiRunning()).toBe(false);
    expect(store.aiActiveTask()).toBeNull();
    expect(JSON.stringify(store.vaultData())).toBe(before);
    expect(store.canUndo()).toBe(false);
    expect(store.toasts().at(-1)?.message).toMatch(
      /AI categorization failed: .*nothing was applied/,
    );
  });

  it("surfaces AiResponseError batch context and non-Error throws", async () => {
    const { store } = setup();
    await store.loadSampleVault();
    const container = TestBed.inject(AI_CONTAINER);
    const provider = container.resolve("ollama");
    vi.spyOn(provider, "categorize").mockRejectedValueOnce(
      new AiResponseError("AI categorize response was truncated (batch 2 of 5)"),
    );
    await store.categorizeWithAi({ provider: "ollama" });
    expect(store.toasts().at(-1)?.message).toContain("batch 2 of 5");
    expect(store.aiRunning()).toBe(false);

    vi.spyOn(provider, "organize").mockRejectedValueOnce(undefined);
    await store.organizeWithAi({ provider: "ollama" });
    expect(store.toasts().at(-1)?.message).toBe("AI organize failed: Unexpected error.");
    expect(store.aiRunning()).toBe(false);
  });

  it("applies AI categories to id-less items (AI refs differ from explorer keys)", async () => {
    const { requests, store } = setup();
    await store.loadVaultObject(
      { items: [{ name: "Notion", login: { username: "u", password: "StrongPassword!123" } }] },
      "idless.json",
    );
    const running = store.categorizeWithAi({ provider: "ollama" });
    requests[0]({
      status: 200,
      data: { message: { content: JSON.stringify({ categories: { "0": "Work" } }) } },
    });
    await running;

    expect(store.vaultData()!.items[0].folderId).toBeTruthy();
    expect(store.vaultData()!.folders?.map((f) => f.name)).toContain("Work");
  });

  it("does not let a stale run release the busy flag of a newer run", async () => {
    const { requests, store } = setup();
    await store.loadSampleVault();
    const stale = store.categorizeWithAi({ provider: "ollama" });
    await store.loadSampleVault();
    const fresh = store.categorizeWithAi({ provider: "ollama" });
    expect(store.aiRunning()).toBe(true);

    requests[0]({ status: 200, data: { message: { content: "{}" } } });
    await stale;
    expect(store.aiRunning()).toBe(true);

    requests[1]({ status: 200, data: { message: { content: "{}" } } });
    await fresh;
    expect(store.aiRunning()).toBe(false);
  });

  it("applies URI suggestions only to the exact item they were generated for (id-less items)", async () => {
    const { requests, store } = setup();
    await store.loadVaultObject(
      {
        items: [
          { name: "Notion", login: { username: "u", password: "StrongPassword!123" } },
          { name: "Other", login: { username: "o", password: "StrongPassword!456" } },
        ],
      },
      "idless.json",
    );
    const running = store.suggestUrisWithAi({ provider: "ollama" });
    requests[0]({
      status: 200,
      data: {
        message: {
          content: JSON.stringify({
            suggestions: [{ itemIndex: "0", suggestedUri: "https://notion.so", reason: "r" }],
          }),
        },
      },
    });
    await running;
    console.log(
      "DBG",
      store.toasts().map((t) => t.message),
    );
    expect(store.aiUriSuggestions()).toHaveLength(1);

    // A new item inserted in front shifts the id-less "Notion" item to position 1.
    store.createItem({
      name: "Inserted",
      username: "i",
      password: "StrongPassword!789",
      urisText: "",
      notes: "",
    });
    const inserted = store.vaultData()!.items[0];
    store.applyAllAiUriSuggestions();

    expect(inserted.login?.uris).toEqual([]);
    expect(store.vaultData()!.items.every((item) => (item.login?.uris?.length ?? 0) === 0)).toBe(
      true,
    );
  });
});

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("revokes the object URL only after a delay", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "file.txt");

    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOWNLOAD_REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith("blob:test");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});

describe("vendor CLI push preview consistency", () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => vi.unstubAllGlobals());

  it("discards a push preview if the vault changes while it is being prepared", async () => {
    const response = deferred<{ ok: boolean; json: () => Promise<Record<string, number>> }>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response.promise),
    );

    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    store.activeVendorProvider.set("bitwarden");
    store.vendorOriginalVault.set(structuredClone(store.vaultData()!));

    const planPromise = store.planVendorCliPush();
    store.updateItem(0, {
      name: "Edited while previewing",
      username: "user",
      password: "password",
      urisText: "https://example.com",
      notes: "",
    });
    response.resolve({
      ok: true,
      json: async () => ({
        creates: 0,
        updates: 1,
        removes: 0,
        newFolders: 0,
        updatedFolders: 0,
        removedFolders: 0,
      }),
    });

    expect(await planPromise).toBeNull();
    expect(store.auditLog()[0]?.action).toContain("vault changed while preparing");
  });

  it("rejects a push if the vault changes after preview and before confirmation", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        creates: 0,
        updates: 1,
        removes: 0,
        newFolders: 0,
        updatedFolders: 0,
        removedFolders: 0,
      }),
    }));
    vi.stubGlobal("fetch", fetch);

    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    store.activeVendorProvider.set("bitwarden");
    store.vendorOriginalVault.set(structuredClone(store.vaultData()!));
    expect(await store.planVendorCliPush()).not.toBeNull();

    store.updateItem(0, {
      name: "Edited after preview",
      username: "user",
      password: "password",
      urisText: "https://example.com",
      notes: "",
    });
    await store.pushToVendorCli();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.auditLog()[0]?.action).toContain("changed after the push preview");
  });
});

describe("vault export consistency", () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it("does not download a snapshot if the vault changes while the exporter loads", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const exporting = store.exportVault();
    store.updateItem(0, {
      name: "Edited during export preparation",
      username: "user",
      password: "password",
      urisText: "https://example.com",
      notes: "",
    });

    await exporting;

    expect(click).not.toHaveBeenCalled();
    expect(store.auditLog()[0]?.action).toContain("vault changed while preparing the export");
    click.mockRestore();
  });
});

describe("recovery draft expiry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes and ignores a draft older than the TTL", async () => {
    vi.stubGlobal("indexedDB", {});
    TestBed.configureTestingModule({});
    const drafts = TestBed.inject(VaultDraftService);
    const internals = drafts as unknown as {
      getRecord: () => Promise<unknown>;
      deleteDraft: () => Promise<void>;
    };
    internals.getRecord = async () => ({
      key: {},
      iv: [],
      ciphertext: new ArrayBuffer(0),
      savedAt: new Date(Date.now() - DRAFT_TTL_MS - 1000).toISOString(),
    });
    const deleteDraft = vi.fn(async () => {});
    internals.deleteDraft = deleteDraft;

    await drafts.checkForDraft();

    expect(deleteDraft).toHaveBeenCalled();
    expect(drafts.hasDraft()).toBe(false);
    expect(drafts.saveState()).toBe("off");
  });
});

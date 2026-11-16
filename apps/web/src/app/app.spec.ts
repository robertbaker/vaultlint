import { TestBed } from "@angular/core/testing";
import { createDefaultAiContainer, type HttpRequest, type IHttpClient } from "@vaultlint/ai";
import { vi } from "vitest";

import { AI_CONTAINER } from "./core/ai-container.token";
import { VaultStoreService } from "./core/vault-store.service";

describe("VaultStoreService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it("should load sample vault and compute duplicates and weak passwords", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    expect(store.totalItems()).toBe(4);
    expect(store.duplicateGroups().length).toBe(1);
    expect(store.weakItems().length).toBe(2);
  });

  it("reports HIBP lookup failures instead of treating them as a clean check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "" }),
    );
    try {
      const store = TestBed.inject(VaultStoreService);
      await store.loadSampleVault();
      await store.checkCompromisedHibp();
      expect(store.auditLog()[0]?.action).toContain("HIBP check failed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports malformed successful HIBP responses as failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "upstream error page" }),
    );
    try {
      const store = TestBed.inject(VaultStoreService);
      await store.loadSampleVault();
      await store.checkCompromisedHibp();
      expect(store.auditLog()[0]?.action).toContain("HIBP check failed");
      expect(store.auditLog()[0]?.action).toContain("invalid range response");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resets findings, AI state and generation when a new vault is loaded or cleared", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const generation = store.vaultGeneration();
    store.aiOrganizeSummary.set("stale");
    store.aiUriSuggestions.set([{ itemId: "1", suggestedUri: "https://x.test" } as never]);
    store.redirectFindings.set([{ itemIndex: 0 } as never]);

    await store.loadSampleVault();
    expect(store.vaultGeneration()).toBeGreaterThan(generation);
    expect(store.aiOrganizeSummary()).toBeNull();
    expect(store.aiUriSuggestions()).toEqual([]);
    expect(store.redirectFindings()).toEqual([]);

    store.redirectFindings.set([{ itemIndex: 0 } as never]);
    store.clearVault();
    expect(store.redirectFindings()).toEqual([]);
  });

  it("does not record undo history for a batch edit with an invalid regex", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    store.applyBatchEdit("name", "(", "x");
    expect(store.canUndo()).toBe(false);
  });

  it("refuses a batch edit with an empty pattern", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    store.applyBatchEdit("name", "", "x");
    expect(store.canUndo()).toBe(false);
  });

  it("does not record undo history for a batch edit that matches nothing", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    store.applyBatchEdit("name", "no-such-name-zzz", "x");
    expect(store.canUndo()).toBe(false);
  });

  it("caps undo history growth", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    for (let i = 0; i < 120; i++) store.normalizeAll();
    let undone = 0;
    while (store.canUndo()) {
      store.undo();
      undone++;
    }
    expect(undone).toBe(50);
  });

  it("clears stale AI results when a rerun fails", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    store.aiHygieneFindings.set([{ itemIds: [], title: "old" } as never]);
    store.aiOrganizeSummary.set("old summary");
    await store.analyzeHygieneWithAi({ provider: "no-such-provider" } as never);
    await store.organizeWithAi({ provider: "no-such-provider" } as never);
    expect(store.aiHygieneFindings()).toEqual([]);
    expect(store.aiOrganizeSummary()).toBeNull();
    expect(store.aiRunning()).toBe(false);
  });

  it("does not echo file contents from JSON syntax errors", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadVaultInput('{"items":[{"login":{"password":"hunter2-secret"}} oops', "x.json");
    const messages = store
      .auditLog()
      .map((entry) => entry.action)
      .join(" ");
    expect(messages).not.toContain("hunter2-secret");
  });

  it("does not apply an older vault load after a newer invalid file selection", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const olderLoad = store.loadVaultInput(
      JSON.stringify({
        encrypted: false,
        folders: [],
        items: [{ id: "new", name: "New vault", type: 1, login: { username: "new" } }],
      }),
      "new.json",
    );
    await store.loadVaultObject(null, "invalid.json");
    await olderLoad;

    expect(store.totalItems()).toBe(4);
    expect(store.auditLog()[0]?.action).toContain("Invalid vault JSON");
  });

  it("does not restore an in-flight vault load after the user clears the workspace", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const olderLoad = store.loadVaultInput(
      JSON.stringify({ encrypted: false, items: [{ id: "new", name: "New vault" }] }),
      "new.json",
    );
    store.clearVault();
    await olderLoad;

    expect(store.vaultData()).toBeNull();
    expect(store.totalItems()).toBe(0);
  });

  it("should merge duplicates and support signal-based undo/redo", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    store.mergeAllDuplicates();
    expect(store.totalItems()).toBe(3);
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(store.totalItems()).toBe(4);
    expect(store.canRedo()).toBe(true);

    store.redo();
    expect(store.totalItems()).toBe(3);
  });

  it("does not merge stale duplicate indexes after a vault edit", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const staleGroup = store.duplicateGroups()[0];

    store.createItem({
      name: "Inserted before stale indexes",
      username: "user@example.com",
      password: "StrongPassword!2026",
      urisText: "",
      notes: "",
    });
    store.mergeGroup(staleGroup);

    expect(store.totalItems()).toBe(5);
    expect(
      store.vaultData()?.items.some((item) => item.name === "Inserted before stale indexes"),
    ).toBe(true);
  });

  it("should regenerate weak passwords and support batch edits", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    store.regenerateAllWeak();
    expect(store.weakItems().length).toBe(0);

    const matches = store.previewBatchEdit("name", "^Google$", "Alphabet");
    expect(matches.length).toBe(1);
    store.applyBatchEdit("name", "^Google$", "Alphabet");
    expect(store.vaultData()?.items[0].name).toBe("Alphabet");
  });

  it("should create items, compute health score, and detect reused passwords", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    store.createItem({
      name: "Duplicate Pass Site",
      username: "alice@example.com",
      password: "VeryStrong$Pass2025",
      urisText: "https://example.org",
      notes: "",
    });

    expect(store.totalItems()).toBe(5);
    expect(store.reusedGroups().length).toBe(1);
    expect(store.passwordHealthScore()).toBeLessThan(100);
  });

  it("should create folders and suggest subdomain mappings", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const folderId = store.createFolder("Banking");
    expect(folderId).toBeTruthy();
    expect(store.folders().some((f) => f.name === "Banking")).toBe(true);

    store.createItem({
      name: "GitHub Gist",
      username: "dev",
      password: "VeryStrong$Pass2025",
      urisText: "https://gist.github.com/user",
      notes: "",
    });
    const added = store.suggestDomainMappings();
    expect(added).toBe(1);
    expect(store.domainMappings()["gist.github.com"]).toBe("github.com");
  });

  it("should compute chartBreakdown, duplicate conflicts, and support batch edit variables", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    const chart = store.chartBreakdown();
    expect(chart.totalItems).toBe(4);
    expect(chart.loginCount).toBe(4);
    expect(chart.weakCount).toBeGreaterThan(0);

    const groups = store.duplicateGroups();
    expect(groups.length).toBe(1);
    expect(groups[0].conflicts.hasDifferentSubdomains).toBe(true);
    expect(groups[0].conflicts.hasDifferentPasswords).toBe(true);

    store.applyBatchEdit("notes", ".*", "Domain: {{domain.tld}}", "empty");
    const firstNotes = store.vaultData()?.items[0].notes;
    expect(firstNotes).toBe("Domain: google.com");
  });

  it("should categorize folders via injected AI_CONTAINER and suggest mobile app URIs", async () => {
    let sentUserPayload = "";
    const mockHttp: IHttpClient = {
      async request<T>(req: HttpRequest) {
        const messages = (req.body as { messages: Array<{ content: string }> }).messages;
        sentUserPayload = messages[1].content;
        return {
          status: 200,
          data: { message: { content: '{"categories":{"0":"Cloud"}}' } } as T,
        };
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AI_CONTAINER, useValue: createDefaultAiContainer(mockHttp) }],
    });

    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    await store.categorizeWithAi({ provider: "ollama" });
    const sentItems = JSON.parse(sentUserPayload) as Array<{
      name: string;
      uris: string[];
      folder?: string;
    }>;
    expect(sentItems[0]).toEqual({ name: "Google", uris: ["mail.google.com"] });
    expect(sentItems.every((item) => !Object.hasOwn(item, "id"))).toBe(true);
    expect(sentItems.every((item) => !Object.hasOwn(item, "folder"))).toBe(true);
    expect(sentUserPayload).not.toContain('"f-work"');
    expect(sentUserPayload).not.toContain('"Work"');
    expect(store.folders().some((f) => f.name === "Cloud")).toBe(true);
    expect(store.vaultData()?.items[0].folderId).toBe("ai-cloud");

    await store.checkMobileAppUris();
    const suggested = store.mobileUriFindings().find((f) => f.status === "suggested");
    expect(suggested).toBeDefined();
    store.applySuggestedMobileUri(suggested!);
    expect(
      store
        .vaultData()
        ?.items.some((i) =>
          i.login?.uris?.some((u) => JSON.stringify(u).includes("androidapp://")),
        ),
    ).toBe(true);
  });

  it("should organize, detect semantic duplicates, suggest missing URIs, and run hygiene audit via AI_CONTAINER", async () => {
    const mockHttp: IHttpClient = {
      async request<T>(req: HttpRequest) {
        const body = JSON.stringify(req.body);
        if (body.includes("renames")) {
          return {
            status: 200,
            data: {
              message: {
                content: JSON.stringify({
                  categories: { "0": "Social" },
                  renames: { "0": "Google Primary" },
                  summary: "Cleaned 1 item.",
                }),
              },
            } as T,
          };
        }
        if (body.includes("duplicates")) {
          return {
            status: 200,
            data: {
              message: {
                content: JSON.stringify({
                  duplicates: [
                    {
                      itemIndices: ["1", "2"],
                      suggestedName: "Google Suite",
                      reason: "Same Google account across subdomains",
                      confidence: "high",
                    },
                  ],
                }),
              },
            } as T,
          };
        }
        if (body.includes("suggestedUri")) {
          const messages = (req.body as { messages: Array<{ content: string }> }).messages;
          const items = JSON.parse(messages[1].content) as Array<{ name?: string }>;
          const targetIndex = items.findIndex((i) => i.name === "Notion");
          return {
            status: 200,
            data: {
              message: {
                content: JSON.stringify({
                  suggestions:
                    targetIndex >= 0
                      ? [
                          {
                            itemIndex: String(targetIndex),
                            suggestedUri: "https://notion.so",
                            reason: "Official site",
                          },
                        ]
                      : [],
                }),
              },
            } as T,
          };
        }
        return {
          status: 200,
          data: {
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    category: "naming-inconsistency",
                    severity: "low",
                    title: "Inconsistent naming",
                    description: "Some items include domain suffixes.",
                    itemIndices: ["1"],
                    recommendation: "Standardize item names.",
                  },
                ],
              }),
            },
          } as T,
        };
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AI_CONTAINER, useValue: createDefaultAiContainer(mockHttp) }],
    });

    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    await store.organizeWithAi({ provider: "ollama" });
    expect(store.vaultData()?.items[0].name).toBe("Google Primary");
    expect(store.aiOrganizeSummary()).toBe("Cleaned 1 item.");

    await store.detectDuplicatesWithAi({ provider: "ollama" });
    expect(store.aiDuplicateGroups()).toHaveLength(1);
    const beforeCount = store.totalItems();
    store.mergeAiDuplicateGroup(store.aiDuplicateGroups()[0]);
    expect(store.totalItems()).toBe(beforeCount - 1);
    expect(store.aiDuplicateGroups()).toHaveLength(0);

    store.createItem({
      name: "Notion",
      folderId: null,
      username: "user@example.com",
      password: "StrongPassword!123",
      urisText: "",
      notes: "",
    });
    await store.suggestUrisWithAi({ provider: "ollama" });
    expect(store.aiUriSuggestions()).toHaveLength(1);
    store.applyAllAiUriSuggestions();
    expect(store.aiUriSuggestions()).toHaveLength(0);
    expect(
      store.vaultData()?.items.some((i) => JSON.stringify(i.login?.uris).includes("notion.so")),
    ).toBe(true);

    await store.analyzeHygieneWithAi({ provider: "ollama" });
    expect(store.aiHygieneFindings()).toHaveLength(1);
    expect(store.aiHygieneFindings()[0].title).toBe("Inconsistent naming");
  });

  it("preserves concurrent vault edits while an AI organize request is pending", async () => {
    let resolveRequest!: (response: { status: number; data: unknown }) => void;
    const mockHttp: IHttpClient = {
      request<T>() {
        return new Promise<{ status: number; data: T }>((resolve) => {
          resolveRequest = (response) =>
            resolve({ status: response.status, data: response.data as T });
        });
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AI_CONTAINER, useValue: createDefaultAiContainer(mockHttp) }],
    });

    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const targetId = store.vaultData()!.items[0].id!;
    const organizing = store.organizeWithAi({ provider: "ollama" });

    store.createItem({
      name: "Added while AI runs",
      username: "user@example.com",
      password: "StrongPassword!2026",
      urisText: "",
      notes: "",
    });

    resolveRequest({
      status: 200,
      data: {
        message: {
          content: JSON.stringify({ categories: { "0": "Cloud" }, renames: {} }),
        },
      },
    });
    await organizing;

    expect(store.totalItems()).toBe(5);
    expect(store.vaultData()?.items.some((item) => item.name === "Added while AI runs")).toBe(true);
    expect(store.vaultData()?.items.find((item) => item.id === targetId)?.folderId).toBe(
      "ai-cloud",
    );
  });

  it("resolves AI duplicate groups against current item indexes before merge", async () => {
    let resolveRequest!: (response: { status: number; data: unknown }) => void;
    const mockHttp: IHttpClient = {
      request<T>() {
        return new Promise<{ status: number; data: T }>((resolve) => {
          resolveRequest = (response) =>
            resolve({ status: response.status, data: response.data as T });
        });
      },
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AI_CONTAINER, useValue: createDefaultAiContainer(mockHttp) }],
    });

    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();
    const detecting = store.detectDuplicatesWithAi({ provider: "ollama" });
    store.createItem({
      name: "Added while AI runs",
      username: "user@example.com",
      password: "StrongPassword!2026",
      urisText: "",
      notes: "",
    });

    resolveRequest({
      status: 200,
      data: {
        message: {
          content: JSON.stringify({
            duplicates: [
              {
                itemIndices: ["1", "2"],
                suggestedName: "Google",
                reason: "Same account",
                confidence: "high",
              },
            ],
          }),
        },
      },
    });
    await detecting;

    const group = store.aiDuplicateGroups()[0];
    expect(group.group.items.map((entry) => entry.index)).toEqual([1, 2]);
    store.mergeAiDuplicateGroup(group);

    expect(store.totalItems()).toBe(4);
    expect(store.vaultData()?.items.some((item) => item.name === "Added while AI runs")).toBe(true);
    expect(store.vaultData()?.items.some((item) => item.id === "1")).toBe(true);
  });

  it("should compute lint findings, switch rulesets, override rules, and apply autofix with undo", async () => {
    const store = TestBed.inject(VaultStoreService);
    await store.loadSampleVault();

    store.createItem({
      name: "  Http Site  ",
      folderId: null,
      username: "user",
      password: "VeryStrong$Password2026!",
      urisText: "http://example.com",
      notes: "",
    });

    const initial = store.lintResult();
    expect(initial).not.toBeNull();
    expect(initial!.counts.error).toBeGreaterThan(0);
    expect(initial!.counts.warning).toBeGreaterThan(0);
    expect(initial!.counts.fixableSafe).toBeGreaterThan(0);

    store.setLintRuleset("strict");
    expect(store.lintResult()!.ruleset).toBe("strict");

    store.setLintRuleSeverity("insecure-http-uri", "off");
    expect(store.lintResult()!.findings.some((f) => f.ruleId === "insecure-http-uri")).toBe(false);

    store.resetLintRules();
    store.setLintRuleset("recommended");

    const beforeFixCount = store.lintResult()!.counts.fixableSafe;
    store.runLintAutofix(false);
    expect(store.lintResult()!.counts.fixableSafe).toBeLessThan(beforeFixCount);
    expect(store.canUndo()).toBe(true);

    store.undo();
    expect(store.lintResult()!.counts.fixableSafe).toBe(beforeFixCount);
  });

  it("connects to the local vendor CLI bridge to fetch, plan, and push", async () => {
    const bwVault = {
      encrypted: false,
      folders: [],
      items: [
        {
          id: "bw-1",
          name: "GitHub",
          type: 1,
          folderId: null,
          login: {
            username: "alice",
            password: "Str0ng!Password",
            uris: [{ uri: "https://github.com" }],
          },
        },
      ],
    };

    const fetchMock = vi.fn<(url: string) => Promise<unknown>>(async (url: string) => {
      if (url === "/api/vendor-cli/providers") {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({
            available: true,
            providers: [
              { id: "bitwarden", displayName: "Bitwarden", binary: "bw", read: true, write: true },
            ],
          }),
        };
      }
      if (url === "/api/vendor-cli/fetch") {
        return {
          ok: true,
          json: async () => ({
            provider: "bitwarden",
            format: "bitwarden-json",
            content: JSON.stringify(bwVault),
          }),
        };
      }
      if (url === "/api/vendor-cli/plan") {
        return {
          ok: true,
          json: async () => ({
            creates: 0,
            updates: 1,
            removes: 0,
            newFolders: 0,
            updatedFolders: 0,
            removedFolders: 0,
            lines: ["update: GitHub"],
          }),
        };
      }
      if (url === "/api/vendor-cli/push") {
        return {
          ok: true,
          json: async () => ({
            created: 0,
            updated: 1,
            removed: 0,
            newFolders: 0,
            updatedFolders: 0,
            removedFolders: 0,
          }),
        };
      }
      return { ok: false, headers: { get: () => "text/plain" } };
    });

    vi.stubGlobal("fetch", fetchMock);
    try {
      const store = TestBed.inject(VaultStoreService);
      await store.probeVendorCliBridge();
      expect(store.vendorBridgeAvailable()).toBe(true);
      expect(store.vendorProviders().length).toBe(1);

      await store.loadFromVendorCli("bitwarden");
      expect(store.totalItems()).toBe(1);
      expect(store.activeVendorPushLabel()).toBe("Push to Bitwarden");

      const plan = await store.planVendorCliPush();
      expect(plan?.updates).toBe(1);

      await store.pushToVendorCli();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/vendor-cli/push",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

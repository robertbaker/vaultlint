import { describe, expect, it } from "bun:test";

import {
  type AiProviderId,
  type HttpRequest,
  type IHttpClient,
  applyCategorySuggestions,
  applyUriSuggestions,
  createDefaultAiContainer,
  isNonLocalAiEndpoint,
  restoreAiItemIdRecord,
} from "@vaultlint/ai";
import type { VaultData } from "@vaultlint/vault-schema";

import {
  analyzeHygieneWithAi,
  applyAIEnhancements,
  detectDuplicatesWithAi,
  organizeVaultWithAi,
  suggestUrisWithAi,
} from "../src/aiService";

class MockHttpClient implements IHttpClient {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responseFactory: (req: HttpRequest) => unknown) {}

  async request<T = unknown>(req: HttpRequest): Promise<{ status: number; data: T }> {
    this.requests.push(req);
    return { status: 200, data: this.responseFactory(req) as T };
  }
}

describe("Multi-Provider AI Service (DI / IoC)", () => {
  it("sanitizes secrets and routes OpenAI, Anthropic, OpenRouter, Grok, Gemini, and Ollama via IoC container", async () => {
    const sampleVault: VaultData = {
      folders: [{ id: "private-folder-id", name: "PRIVATE_FOLDER_NAME" }],
      items: [
        {
          id: "item-1",
          name: "GitHub",
          folderId: "private-folder-id",
          notes: "SUPER_SECRET_NOTE",
          login: {
            username: "secret-user",
            password: "SUPER_SECRET_PASSWORD",
            totp: "SECRET_TOTP",
            uris: [
              { uri: "https://github.com/login" },
              { uri: "https://github.com:invalid/path?token=URI_SECRET" },
            ],
          },
        },
      ],
    };

    const providers: AiProviderId[] = [
      "openai",
      "anthropic",
      "openrouter",
      "grok",
      "gemini",
      "ollama",
    ];

    for (const provider of providers) {
      const vault = structuredClone(sampleVault);
      const mockHttp = new MockHttpClient((req) => {
        if (req.url.includes("anthropic")) {
          return { content: [{ type: "text", text: '{"categories":{"0":"Dev"}}' }] };
        }
        if (req.url.includes("/api/chat")) {
          return { message: { content: '{"categories":{"0":"Dev"}}' } };
        }
        return {
          choices: [{ message: { content: '{"categories":{"0":"Dev"}}' } }],
        };
      });

      const container = createDefaultAiContainer(mockHttp);
      await applyAIEnhancements(vault, {
        provider,
        apiKey: provider === "ollama" ? undefined : "test-key",
        container,
      });

      expect(mockHttp.requests).toHaveLength(1);
      const sentBody = JSON.stringify(mockHttp.requests[0].body);
      expect(sentBody).toContain("GitHub");
      expect(sentBody).toContain("github.com");
      expect(sentBody).not.toContain('\\"id\\":');
      expect(sentBody).not.toContain("item-1");
      expect(sentBody).not.toContain('\\"folder\\"');
      expect(sentBody).not.toContain("PRIVATE_FOLDER_NAME");
      expect(sentBody).not.toContain("private-folder-id");
      expect(sentBody).not.toContain("SUPER_SECRET_PASSWORD");
      expect(sentBody).not.toContain("secret-user");
      expect(sentBody).not.toContain("SECRET_TOTP");
      expect(sentBody).not.toContain("SUPER_SECRET_NOTE");
      expect(sentBody).not.toContain("URI_SECRET");

      expect(vault.folders?.some((f) => f.name === "Dev")).toBe(true);
      expect(vault.items[0].folderId).toBe("ai-dev");
    }
  });

  it("supports organize, semantic duplicate detection, missing URI suggestions, and hygiene audit", async () => {
    const sampleVault: VaultData = {
      folders: [{ id: "f-dev", name: "Dev" }],
      items: [
        {
          id: "i-1",
          name: "Login - Twitter (Old)",
          login: {
            username: "a@b.com",
            password: "SECRET_PASSWORD_1",
            uris: [{ uri: "https://twitter.com" }],
          },
        },
        {
          id: "i-2",
          name: "X",
          login: {
            username: "a@b.com",
            password: "SECRET_PASSWORD_2",
            uris: [{ uri: "https://x.com" }],
          },
        },
        {
          id: "i-3",
          name: "Notion",
          login: { username: "a@b.com", password: "SECRET_PASSWORD_3" },
        },
      ],
    };

    const mockHttp = new MockHttpClient((req) => {
      const bodyStr = JSON.stringify(req.body);
      if (bodyStr.includes("renames")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  categories: { "0": "Social", "1": "Social", "2": "Dev" },
                  renames: { "0": "Twitter" },
                  summary: "Organized 3 items and cleaned 1 name.",
                }),
              },
            },
          ],
        };
      }
      if (bodyStr.includes("duplicates")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  duplicates: [
                    {
                      itemIndices: ["0", "1"],
                      suggestedName: "X (Twitter)",
                      reason: "Twitter rebranded to X",
                      confidence: "high",
                    },
                    {
                      itemIndices: ["2"],
                      suggestedName: "Invalid Single",
                      reason: "Should be filtered out",
                      confidence: "low",
                    },
                  ],
                }),
              },
            },
          ],
        };
      }
      if (bodyStr.includes("suggestedUri")) {
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  suggestions: [
                    {
                      itemIndex: "0",
                      suggestedUri: "https://notion.so",
                      reason: "Official Notion domain",
                    },
                    {
                      itemIndex: "0",
                      suggestedUri: "javascript:alert(1)",
                      reason: "Unsafe scheme",
                    },
                    { itemIndex: "0", suggestedUri: "http://notion.so", reason: "HTTP is unsafe" },
                    {
                      itemIndex: "0",
                      suggestedUri: "https://user:pass@notion.so",
                      reason: "Credentials in URI are unsafe",
                    },
                  ],
                }),
              },
            },
          ],
        };
      }
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    category: "domain-consolidation",
                    severity: "medium",
                    title: "Twitter / X legacy domain",
                    description: "Both twitter.com and x.com are present.",
                    itemIndices: ["0", "1"],
                    recommendation: "Merge and keep x.com as primary URI.",
                  },
                  {
                    category: "defunct-service",
                    severity: "high",
                    title: "Service has shut down",
                    description: "This service is no longer operating.",
                    itemIndices: ["0"],
                    recommendation: "Remove the login.",
                  },
                ],
              }),
            },
          },
        ],
      };
    });

    const container = createDefaultAiContainer(mockHttp);
    const opts = { provider: "openai" as const, apiKey: "test-key", container };

    const orgVault = structuredClone(sampleVault);
    const orgRes = await organizeVaultWithAi(orgVault, opts);
    expect(orgRes.renamedCount).toBe(1);
    expect(orgVault.items[0].name).toBe("Twitter");
    expect(orgVault.items[2].folderId).toBe("f-dev");

    const dups = await detectDuplicatesWithAi(sampleVault, opts);
    expect(dups).toHaveLength(1);
    expect(dups[0].suggestedName).toBe("X (Twitter)");
    expect(dups[0].confidence).toBe("high");

    const uriVault = structuredClone(sampleVault);
    const uriRes = await suggestUrisWithAi(uriVault, opts, true);
    expect(uriRes.suggestions).toHaveLength(1);
    expect(uriRes.updatedCount).toBe(1);
    expect(uriVault.items[2].login?.uris?.[0]).toEqual({ uri: "https://notion.so/" });

    const suggestionOnlyVault = structuredClone(sampleVault);
    const suggestionOnly = await suggestUrisWithAi(suggestionOnlyVault, opts);
    expect(suggestionOnly.updatedCount).toBe(0);
    expect(suggestionOnlyVault.items[2].login?.uris).toBeUndefined();

    const hygiene = await analyzeHygieneWithAi(sampleVault, opts);
    expect(hygiene).toHaveLength(1);
    expect(hygiene[0].category).toBe("domain-consolidation");

    for (const req of mockHttp.requests) {
      const sent = JSON.stringify(req.body);
      expect(sent).not.toContain("SECRET_PASSWORD");
      expect(sent).not.toContain("a@b.com");
      expect(sent).not.toContain('"i-1"');
      expect(sent).not.toContain('"i-2"');
      expect(sent).not.toContain('"i-3"');
      expect(sent).not.toContain('"f-dev"');
      const messages = (req.body as { messages?: Array<{ content?: string }> }).messages;
      const userPayload = JSON.stringify(JSON.parse(messages?.[1]?.content ?? "null"));
      expect(userPayload).not.toContain('"Dev"');
    }
  });

  it("correctly classifies local vs non-local AI endpoints", () => {
    expect(isNonLocalAiEndpoint("openai")).toBe(true);
    expect(isNonLocalAiEndpoint("anthropic")).toBe(true);
    expect(isNonLocalAiEndpoint("gemini")).toBe(true);
    expect(isNonLocalAiEndpoint("ollama")).toBe(false);
    expect(isNonLocalAiEndpoint("ollama", "http://localhost:11434")).toBe(false);
    expect(isNonLocalAiEndpoint("ollama", "https://ollama.example.com")).toBe(true);
  });

  it("does not apply a URI suggestion if the item now has a URI", () => {
    const vault: VaultData = {
      items: [{ id: "item-1", login: { uris: [{ uri: "https://user-added.example" }] } }],
    };

    const result = applyUriSuggestions(vault, [
      { itemId: "item-1", suggestedUri: "https://model-suggested.example", reason: "test" },
      { itemId: "item-1", suggestedUri: "http://insecure.example", reason: "test" },
    ]);

    expect(result.updatedCount).toBe(0);
    expect(vault.items[0].login?.uris).toEqual([{ uri: "https://user-added.example" }]);
  });

  it("creates collision-free folder IDs from untrusted AI folder names", () => {
    const vault: VaultData = {
      folders: [{ id: "ai-a-b", name: "Existing folder" }],
      items: [{ id: "item-1" }, { id: "item-2" }],
    };

    applyCategorySuggestions(vault, { "item-1": "A/B", "item-2": "A?B" });

    expect(new Set(vault.folders?.map((folder) => folder.id)).size).toBe(3);
    expect(vault.items[0].folderId).not.toBe(vault.items[1].folderId);
  });

  it("restores AI references safely when a local item ID is a prototype property name", () => {
    const vault: VaultData = { items: [{ id: "__proto__", name: "Admin" }] };
    const restored = restoreAiItemIdRecord({ "0": "Security" }, vault);

    expect(Object.hasOwn(restored, "__proto__")).toBe(true);
    expect(restored["__proto__"]).toBe("Security");
    applyCategorySuggestions(vault, restored);
    expect(vault.items[0].folderId).toBe("ai-security");
  });

  it("categorizes duplicate-id and id-less items independently end to end", async () => {
    const vault = {
      items: [
        { id: "dup", name: "A" },
        { id: "dup", name: "B" },
        { name: "C" },
        { id: "2", name: "D" },
      ],
    } as unknown as VaultData;
    const http = new MockHttpClient(() => ({
      choices: [
        { message: { content: JSON.stringify({ categories: { "1": "Two", "2": "Three" } }) } },
      ],
    }));
    await applyAIEnhancements(vault, {
      provider: "openai",
      apiKey: "k-test",
      container: createDefaultAiContainer(http),
    });
    const names = vault.items.map((i) => vault.folders?.find((f) => f.id === i.folderId)?.name);
    expect(names).toEqual([undefined, "Two", "Three", undefined]);
  });
});

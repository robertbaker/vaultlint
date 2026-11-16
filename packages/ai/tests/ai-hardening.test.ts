import { describe, expect, test } from "bun:test";

import type { VaultData } from "@vaultlint/vault-schema";

import {
  AiResponseError,
  type HttpRequest,
  type IHttpClient,
  applyCategorySuggestions,
  applyUriSuggestions,
  chunkItems,
  createDefaultAiContainer,
  restoreAiItemIdRecord,
  restoreAiItemIds,
  sanitizeVaultItemsForAi,
} from "../src";

function userItems(req: HttpRequest): Array<{ name?: string; uris: string[] }> {
  const body = req.body as {
    messages?: Array<{ role: string; content: string }>;
  };
  const user = body.messages?.find((m) => m.role === "user");
  return JSON.parse(user?.content ?? "[]");
}

function chatReply(content: string) {
  return { status: 200, data: { choices: [{ message: { content } }] } };
}

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Item ${i}`, uris: [] }));
}

describe("sanitizeVaultItemsForAi", () => {
  test("derives hostnames leniently without leaking paths, ports, or credentials", () => {
    const vault: VaultData = {
      items: [
        {
          id: "real-id",
          name: "Example",
          login: {
            username: "alice",
            password: "hunter2",
            uris: [
              { uri: "example.com" },
              "www.example.org/login?token=abc",
              "https://user:pw@example.net:8443/path",
              { uri: "hunter2" },
              { uri: "has spaces.com" },
              { uri: "https://example.com/other" },
              { uri: "androidapp://com.example.app" },
            ],
          },
        },
      ],
    } as VaultData;
    const [item] = sanitizeVaultItemsForAi(vault);
    expect(item.id).toBe("0");
    expect(item.uris).toEqual(["example.com", "www.example.org", "example.net", "com.example.app"]);
    expect(JSON.stringify(item)).not.toMatch(/hunter2|alice|token|user|pw|real-id/);
  });
});

describe("batching", () => {
  test("chunkItems respects item count and serialized size", () => {
    expect(chunkItems(makeItems(5), 2).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunkItems(makeItems(4), 100, 60).length).toBeGreaterThan(1);
    expect(chunkItems([], 10)).toEqual([]);
  });

  test("chunkItems rejects a single item larger than the payload limit", () => {
    expect(() => chunkItems([{ name: "x".repeat(100) }], 10, 32)).toThrow(
      /exceeds the 32-character payload limit/,
    );
    expect(() => chunkItems([{ name: "ok" }, { name: "x".repeat(100) }], 10, 32)).toThrow(
      /exceeds the 32-character payload limit/,
    );
  });

  test("categorize splits large vaults into several requests and merges the results", async () => {
    const batches: number[] = [];
    const http: IHttpClient = {
      async request<T>(req: HttpRequest) {
        const items = userItems(req);
        batches.push(items.length);
        const categories = Object.fromEntries(items.map((_, index) => [String(index), "Work"]));
        return chatReply(JSON.stringify({ categories })) as never as { status: number; data: T };
      },
    };
    const provider = createDefaultAiContainer(http).resolve("openai");
    const result = await provider.categorize(makeItems(120), {
      provider: "openai",
      apiKey: "k-test",
    });
    expect(batches).toEqual([50, 50, 20]);
    expect(Object.keys(result)).toHaveLength(120);
  });

  test("anthropic requests ask for a larger output budget", async () => {
    let body: { max_tokens?: number } = {};
    const http: IHttpClient = {
      async request<T>(req: HttpRequest) {
        body = req.body as typeof body;
        return {
          status: 200,
          data: { content: [{ type: "text", text: '{"categories":{"0":"Dev"}}' }] },
        } as { status: number; data: T };
      },
    };
    const provider = createDefaultAiContainer(http).resolve("anthropic");
    await provider.categorize(makeItems(1), { provider: "anthropic", apiKey: "k-test" });
    expect(body.max_tokens).toBeGreaterThanOrEqual(8192);
  });
});

describe("truncated or invalid responses", () => {
  const truncated = '{"categories": {"0": "Work", "1": "Fin';
  const http = (replies: string[]): IHttpClient => {
    let call = 0;
    return {
      async request<T>() {
        return chatReply(replies[Math.min(call++, replies.length - 1)]) as never as {
          status: number;
          data: T;
        };
      },
    };
  };
  const config = { provider: "openai" as const, apiKey: "k-test" };

  test("categorize throws instead of returning an empty result", async () => {
    const provider = createDefaultAiContainer(http([truncated])).resolve("openai");
    await expect(provider.categorize(makeItems(2), config)).rejects.toBeInstanceOf(AiResponseError);
    await expect(provider.categorize(makeItems(2), config)).rejects.toThrow(/truncated/);
  });

  test("organize, duplicates, URI suggestions, and hygiene all throw on truncation", async () => {
    const cut = '{"duplicates": [{"itemIndices": ["0","1"';
    const provider = createDefaultAiContainer(http([cut])).resolve("openai");
    await expect(provider.organize(makeItems(2), config)).rejects.toThrow(AiResponseError);
    await expect(provider.detectDuplicates(makeItems(2), config)).rejects.toThrow(AiResponseError);
    await expect(provider.suggestUris(makeItems(2), config)).rejects.toThrow(AiResponseError);
    await expect(provider.analyzeHygiene(makeItems(2), config)).rejects.toThrow(AiResponseError);
  });

  test("a wrongly shaped object is rejected, but an explicitly empty result is accepted", async () => {
    const wrong = createDefaultAiContainer(http(['{"oops": 1}'])).resolve("openai");
    await expect(wrong.categorize(makeItems(1), config)).rejects.toThrow(/"categories"/);
    const empty = createDefaultAiContainer(http(['{"duplicates": []}'])).resolve("openai");
    expect(await empty.detectDuplicates(makeItems(2), config)).toEqual([]);
  });

  test("a failing batch is attributed in the error message", async () => {
    const ok = JSON.stringify({ categories: { "0": "A" } });
    const provider = createDefaultAiContainer(http([ok, truncated])).resolve("openai");
    await expect(provider.categorize(makeItems(60), config)).rejects.toThrow(/batch 2 of 2/);
  });
});

describe("cross-batch grouping", () => {
  test("duplicates sharing a name/host label land in one batch even beyond the batch size", async () => {
    const batches: string[][] = [];
    const http: IHttpClient = {
      async request<T>(req: HttpRequest) {
        batches.push(userItems(req).map((i) => i.name ?? ""));
        return chatReply('{"duplicates": []}') as never as { status: number; data: T };
      },
    };
    const items = [
      ...Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: `Zeta${i}x`, uris: [] })),
      { id: "9", name: "Alpha Mail", uris: ["gmail.com"] },
      { id: "10", name: "Zzz", uris: ["mail.gmail.com"] },
      { id: "11", name: "Gmail", uris: [] },
    ];
    const provider = createDefaultAiContainer(http).resolve("openai");
    await provider.detectDuplicates(items, { provider: "openai", apiKey: "k", batchSize: 4 });
    const home = batches.filter((b) => b.includes("Gmail"));
    expect(home).toHaveLength(1);
    expect(home[0]).toEqual(expect.arrayContaining(["Alpha Mail", "Zzz", "Gmail"]));
    expect(batches.flat()).toHaveLength(items.length);
    expect(JSON.stringify(batches)).not.toMatch(/@/);
  });
});

describe("id-robust suggestion application", () => {
  test("duplicate, empty, and index-mimicking ids never alias another item", () => {
    const vault = {
      items: [
        { id: "dup", name: "A" },
        { id: "dup", name: "B" },
        { id: "", name: "C" },
        { id: "2", name: "D" },
        { name: "E" },
      ],
    } as unknown as VaultData;
    const cats = restoreAiItemIdRecord({ "0": "One", "1": "Two", "2": "Three" }, vault);
    expect(applyCategorySuggestions(vault, cats).categorizedCount).toBe(3);
    const folderOf = (i: number) =>
      vault.folders?.find((f) => f.id === vault.items[i].folderId)?.name;
    expect([folderOf(0), folderOf(1), folderOf(2), folderOf(3), folderOf(4)]).toEqual([
      "One",
      "Two",
      "Three",
      undefined,
      undefined,
    ]);
  });

  test("URI suggestions hit only the intended id-less or duplicate-id item", () => {
    const vault = {
      items: [{ id: "x", name: "A" }, { id: "x", name: "B" }, { name: "C" }],
    } as VaultData;
    const [ref] = restoreAiItemIds(["1"], vault);
    const { updatedCount } = applyUriSuggestions(vault, [
      { itemId: ref, suggestedUri: "https://b.example", reason: "r" },
    ]);
    expect(updatedCount).toBe(1);
    expect(vault.items[1].login?.uris).toEqual([{ uri: "https://b.example/" }]);
    expect(vault.items[0].login?.uris).toBeUndefined();
    expect(vault.items[2].login?.uris).toBeUndefined();
  });

  test("a prototype-named id is not treated as a suggestion key", () => {
    const vault = { items: [{ id: "constructor", name: "A" }] } as VaultData;
    expect(applyCategorySuggestions(vault, {}).categorizedCount).toBe(0);
  });
});

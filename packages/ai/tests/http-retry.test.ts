import { afterEach, describe, expect, test } from "bun:test";

import {
  FetchHttpClient,
  HttpStatusError,
  createDefaultAiContainer,
  type HttpRequest,
  type IHttpClient,
} from "../src";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("FetchHttpClient errors", () => {
  test("surfaces string-style errors (Ollama) and status/Retry-After", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "model not found" }), {
        status: 429,
        headers: { "Retry-After": "2" },
      })) as unknown as typeof fetch;
    const error = await new FetchHttpClient()
      .request({ url: "http://x.test", method: "POST" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).message).toBe("model not found");
    expect((error as HttpStatusError).status).toBe(429);
    expect((error as HttpStatusError).retryAfterMs).toBe(2000);
  });

  test("reports a timeout instead of a bare abort", async () => {
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    await expect(
      new FetchHttpClient().request({ url: "http://x.test", method: "POST", timeoutMs: 10 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("provider retry", () => {
  test("retries a 429 once and then succeeds; does not retry other statuses", async () => {
    let calls = 0;
    const http: IHttpClient = {
      async request<T>(_req: HttpRequest) {
        calls++;
        if (calls === 1) throw new HttpStatusError("slow down", 429, 1);
        return { status: 200, data: { choices: [{ message: { content: "ok" } }] } as T };
      },
    };
    const provider = createDefaultAiContainer(http).resolve("openai");
    const out = await provider.complete({
      systemPrompt: "s",
      userPrompt: "u",
      model: "m",
      apiKey: "sk-test-123456",
    });
    expect(out).toBe("ok");
    expect(calls).toBe(2);

    calls = 0;
    const failing: IHttpClient = {
      async request() {
        calls++;
        throw new HttpStatusError("bad key", 401);
      },
    };
    await expect(
      createDefaultAiContainer(failing)
        .resolve("openai")
        .complete({ systemPrompt: "s", userPrompt: "u", model: "m", apiKey: "sk-test-123456" }),
    ).rejects.toThrow("bad key");
    expect(calls).toBe(1);
  });
});

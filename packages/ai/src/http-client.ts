import type { HttpRequest, HttpResponse, IHttpClient } from "./types";

/** Error for a non-2xx response; carries the status and any `Retry-After` hint (milliseconds). */
export class HttpStatusError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = "HttpStatusError";
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Default `fetch`-based `IHttpClient` implementation that works in Bun, Node, and Browsers. */
export class FetchHttpClient implements IHttpClient {
  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? 20000;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let timedOut = false;
    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        // Never follow redirects: custom headers such as `x-api-key` would be re-sent to the target.
        redirect: "error",
        signal: controller.signal,
      });

      const rawText = await response.text();
      let data: unknown = rawText;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        // Keep raw text when response is not JSON
      }

      if (!response.ok) {
        const err = (data as { error?: unknown } | null)?.error;
        const message =
          typeof err === "string" && err
            ? err
            : typeof (err as { message?: unknown } | undefined)?.message === "string"
              ? (err as { message: string }).message
              : `HTTP ${response.status}`;
        throw new HttpStatusError(
          message,
          response.status,
          parseRetryAfter(response.headers.get("retry-after")),
        );
      }

      return { status: response.status, data: data as T };
    } catch (error) {
      if (timedOut) throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

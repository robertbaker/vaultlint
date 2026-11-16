import fs from "fs";
import http from "http";
import path from "path";
import { constants as zlibConstants, brotliCompressSync, gzipSync } from "zlib";

import type { VaultData } from "@vaultlint/vault-schema";

import { createCliStyle, isColorSupported, renderBox, renderBrandHeader } from "./cliUi";
import {
  describeVendorCliSupport,
  fetchFromVendorCli,
  getVendorCliProvider,
  isVendorCliId,
  nodeCommandRunner,
  VENDOR_CLI_PROVIDERS,
  type CommandRunner,
} from "./vendorCli";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
} as const satisfies Record<string, string>;

const MAX_API_BODY_BYTES = 64 * 1024 * 1024;

export interface WebServerOptions {
  port?: number;
  host?: string;
  publicDir?: string;
  /** Test seam: replaces the real vendor CLI process runner. */
  vendorRunner?: CommandRunner;
}

/**
 * Content-hashed build output: Angular emits `main-R3XVMKT3.js` / `styles-ZZD46XT3.css` (8
 * upper-case base32 chars), `chunk-BGeF69ny.js` (8 base64url chars), and legacy `name.<hash>.ext`
 * names. Plain names such as `index.html`, `favicon.svg` or `Inter-Variable.woff2` must stay
 * revalidated.
 */
const HASHED_ASSET_RE =
  /^(?:chunk-[\w-]{8}\.js|.+-[A-Z0-9]{8}\.[A-Za-z0-9]+|.+\.[\w-]{8,}\.[^./]+)(?:\.map)?$/;

function resolvePublicDir(): string {
  const candidates = [
    // Published package layout: <pkg>/dist/index.js next to <pkg>/web/.
    path.resolve(__dirname, "..", "web"),
    path.resolve(process.cwd(), "apps", "web", "dist", "web", "browser"),
    path.resolve(__dirname, "..", "..", "web", "dist", "web", "browser"),
    path.resolve(__dirname, "..", "..", "..", "apps", "web", "dist", "web", "browser"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(
    'Could not locate built Web UI (apps/web/dist/web/browser). Run "bun run build:web" first.',
  );
}

/**
 * Map a request path to a file inside `publicDir`. Percent-encoding is decoded first and symlinks
 * are resolved so neither can escape the directory; anything missing falls back to the SPA's
 * index.html.
 */
export function resolveStaticPath(publicDir: string, reqUrl: string): string {
  const root = fs.realpathSync(publicDir);
  const fallback = path.join(root, "index.html");
  const decoded = decodeURIComponent(reqUrl);
  if (decoded.includes("\u0000")) throw new Error("Invalid path.");
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^[/\\]+/, "");
  const candidate = path.join(root, path.normalize(relativePath));
  try {
    const real = fs.realpathSync(candidate);
    if ((real === root || real.startsWith(root + path.sep)) && fs.statSync(real).isFile()) {
      return real;
    }
  } catch {
    // Missing path: fall through to the SPA entry point.
  }
  return fallback;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  cacheControl = "no-store",
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function getAcceptedCompression(acceptEncoding: string): "br" | "gzip" | undefined {
  const qualities = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [rawName, ...parameters] = part.trim().toLowerCase().split(";");
    if (!rawName) continue;
    const qParameter = parameters
      .map((parameter) => parameter.trim())
      .find((p) => p.startsWith("q="));
    const quality = qParameter ? Number(qParameter.slice(2)) : 1;
    qualities.set(rawName, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
  }

  const wildcardQuality = qualities.get("*") ?? 0;
  const qualityFor = (encoding: "br" | "gzip"): number =>
    qualities.get(encoding) ?? wildcardQuality;
  const brQuality = qualityFor("br");
  const gzipQuality = qualityFor("gzip");
  if (brQuality <= 0 && gzipQuality <= 0) return undefined;
  return brQuality >= gzipQuality ? "br" : "gzip";
}

function isAllowedLocalOrigin(req: http.IncomingMessage, boundPort: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:") return false;
    const isLoopback =
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname === "::1";
    const port = parsed.port ? Number(parsed.port) : 80;
    return isLoopback && port === boundPort;
  } catch {
    return false;
  }
}

/** Reject DNS-rebinding requests whose Host header is not a loopback name or the bound host. */
function isAllowedHost(req: http.IncomingMessage, boundHost: string): boolean {
  const raw = req.headers.host;
  if (!raw) return false;
  try {
    const hostname = new URL(`http://${raw}`).hostname.toLowerCase();
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "[::1]" ||
      hostname === boundHost.toLowerCase().replace(/^\[|\]$/g, "") ||
      hostname === boundHost.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw Object.assign(new Error("Expected Content-Type: application/json."), { statusCode: 415 });
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_API_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    }
    chunks.push(buf);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Invalid JSON request body."), { statusCode: 400 });
  }
}

class HttpError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isVaultLike(value: unknown): value is VaultData {
  if (!value || typeof value !== "object") return false;
  const items = (value as { items?: unknown }).items;
  return (
    Array.isArray(items) &&
    items.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))
  );
}

/**
 * Vendor CLI failures (locked vault, missing binary, bad output) are upstream errors, not bad
 * requests.
 */
async function upstream<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new HttpError(error instanceof Error ? error.message : "Vendor CLI failed.", 502);
  }
}

/** Methods each known API route accepts (HEAD mirrors GET; Node drops the HEAD body). */
const API_ROUTE_METHODS: Record<string, readonly string[]> = {
  "/api/vendor-cli/providers": ["GET", "HEAD"],
  "/api/vendor-cli/fetch": ["POST"],
  "/api/vendor-cli/plan": ["POST"],
  "/api/vendor-cli/push": ["POST"],
};

async function handleVendorApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqUrl: string,
  boundPort: number,
  runner: CommandRunner,
  boundHost: string,
): Promise<void> {
  if (!isAllowedHost(req, boundHost) || !isAllowedLocalOrigin(req, boundPort)) {
    sendJson(res, 403, { error: "Cross-origin requests to the local bridge are not allowed." });
    return;
  }

  const allowed = API_ROUTE_METHODS[reqUrl];
  if (allowed && !allowed.includes(req.method ?? "")) {
    res.writeHead(405, {
      Allow: allowed.join(", "),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && reqUrl === "/api/vendor-cli/providers") {
    const providers = Object.values(VENDOR_CLI_PROVIDERS).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      binary: p.binary,
      ...describeVendorCliSupport(p),
      unsupportedReason: p.unsupportedReason,
    }));
    sendJson(res, 200, { available: true, providers }, "private, max-age=60");
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/vendor-cli/fetch") {
    const body = await readJsonBody(req);
    const providerId = String(body["provider"] ?? "");
    if (!isVendorCliId(providerId)) {
      sendJson(res, 400, { error: `Unknown vendor CLI provider "${providerId}".` });
      return;
    }
    const fetched = await upstream(() => fetchFromVendorCli(providerId, runner));
    sendJson(res, 200, {
      provider: providerId,
      format: fetched.format,
      content: fetched.content,
    });
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/vendor-cli/plan") {
    const body = await readJsonBody(req);
    const providerId = String(body["provider"] ?? "");
    if (!isVendorCliId(providerId)) {
      sendJson(res, 400, { error: `Unknown vendor CLI provider "${providerId}".` });
      return;
    }
    const provider = getVendorCliProvider(providerId);
    const support = describeVendorCliSupport(provider);
    if (!support.write || !provider.planPush) {
      sendJson(res, 400, {
        error:
          provider.unsupportedReason?.write ?? `${provider.displayName} does not support push.`,
      });
      return;
    }
    const original = body["original"];
    const updated = body["updated"];
    if (!isVaultLike(original) || !isVaultLike(updated)) {
      sendJson(res, 400, { error: "Missing or malformed original or updated vault data." });
      return;
    }
    sendJson(res, 200, await upstream(() => provider.planPush!(original, updated)));
    return;
  }

  if (req.method === "POST" && reqUrl === "/api/vendor-cli/push") {
    const body = await readJsonBody(req);
    const providerId = String(body["provider"] ?? "");
    if (!isVendorCliId(providerId)) {
      sendJson(res, 400, { error: `Unknown vendor CLI provider "${providerId}".` });
      return;
    }
    const provider = getVendorCliProvider(providerId);
    const support = describeVendorCliSupport(provider);
    if (!support.write || !provider.push) {
      sendJson(res, 400, {
        error:
          provider.unsupportedReason?.write ?? `${provider.displayName} does not support push.`,
      });
      return;
    }
    const original = body["original"];
    const updated = body["updated"];
    if (!isVaultLike(original) || !isVaultLike(updated)) {
      sendJson(res, 400, { error: "Missing or malformed original or updated vault data." });
      return;
    }
    const result = await upstream(() => provider.push!(runner, original, updated));
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

export function startWebUIServer(
  portOrOptions: number | WebServerOptions = 4173,
): Promise<http.Server> {
  const options: WebServerOptions =
    typeof portOrOptions === "number" ? { port: portOrOptions } : portOrOptions;
  const port = options.port ?? 4173;
  const host = options.host ?? "127.0.0.1";
  const publicDir = options.publicDir ?? resolvePublicDir();
  const runner = options.vendorRunner ?? nodeCommandRunner;

  const server = http.createServer((req, res) => {
    const reqUrl = (req.url || "/").split("?")[0];

    if (reqUrl.startsWith("/api/")) {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      void handleVendorApi(req, res, reqUrl, boundPort, runner, host).catch((error: unknown) => {
        const err = error as Error & { statusCode?: number };
        if (res.headersSent) {
          res.destroy();
          return;
        }
        // Only deliberately raised HttpErrors expose their message; anything else is an internal bug.
        if (typeof err.statusCode === "number") {
          sendJson(res, err.statusCode, { error: err.message || "Request failed." });
        } else {
          sendJson(res, 500, { error: "Internal server error." });
        }
      });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    let filePath: string;
    try {
      filePath = resolveStaticPath(publicDir, reqUrl);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Request");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = (MIME_TYPES as Record<string, string>)[ext] || "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      const acceptedCompression = getAcceptedCompression(req.headers["accept-encoding"] ?? "");
      const useBrotli = content.length >= 1024 && acceptedCompression === "br";
      const useGzip = content.length >= 1024 && acceptedCompression === "gzip";
      const body = useBrotli
        ? brotliCompressSync(content, {
            params: {
              [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
              [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
            },
          })
        : useGzip
          ? gzipSync(content, { level: zlibConstants.Z_DEFAULT_COMPRESSION })
          : content;
      const isHashedAsset = HASHED_ASSET_RE.test(path.basename(filePath));
      const headers: http.OutgoingHttpHeaders = {
        "Content-Type": contentType,
        "Cache-Control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
      };
      if (useBrotli || useGzip) {
        headers["Content-Encoding"] = useBrotli ? "br" : "gzip";
        headers.Vary = "Accept-Encoding";
      }
      headers["Content-Length"] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const style = createCliStyle(isColorSupported());
      const url = `http://${host}:${port}`;
      console.log(
        renderBox(
          renderBrandHeader("Web UI", style),
          [
            `Listening at ${style.bold(style.cyan(url))}`,
            "Local-first · Vault data stays on this machine.",
            style.dim("Press Ctrl+C to stop."),
          ],
          style,
          "success",
        ),
      );
      resolve(server);
    });
  });
}

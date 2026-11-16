import { afterEach, describe, expect, test } from "bun:test";
import http from "http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CommandResult, CommandRunner } from "../src/vendorCli";
import { startWebUIServer } from "../src/webServer";

const servers: Array<{ close: () => void }> = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makePublicDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-web-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>ok</body></html>");
  return dir;
}

function fakeBitwardenRunner() {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const items = [
    {
      id: "1",
      name: "GitHub",
      type: 1,
      folderId: null,
      revisionDate: "2024-01-01T00:00:00Z",
      login: { username: "alice", password: "old", uris: [{ uri: "https://github.com" }] },
    },
  ];
  const runner: CommandRunner = {
    async run(_bin, args, options): Promise<CommandResult> {
      calls.push({ args, input: options?.input });
      const key = args.slice(0, 2).join(" ");
      if (key === "status --nointeraction") {
        return { code: 0, stdout: JSON.stringify({ status: "unlocked" }), stderr: "" };
      }
      if (key === "list items") return { code: 0, stdout: JSON.stringify(items), stderr: "" };
      if (key === "list folders") return { code: 0, stdout: "[]", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  return { runner, calls, items };
}

describe("Web UI vendor CLI bridge", () => {
  test("lists providers, fetches vault, plans push, and pushes changes", async () => {
    const { runner, calls, items } = fakeBitwardenRunner();
    const server = await startWebUIServer({
      port: 0,
      host: "127.0.0.1",
      publicDir: makePublicDir(),
      vendorRunner: runner,
    });
    servers.push(server);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const providersRes = await fetch(`${base}/api/vendor-cli/providers`);
    expect(providersRes.status).toBe(200);
    const providersBody = (await providersRes.json()) as {
      available: boolean;
      providers: Array<{ id: string; read: boolean; write: boolean }>;
    };
    expect(providersBody.available).toBe(true);
    expect(providersBody.providers.find((p) => p.id === "bitwarden")).toMatchObject({
      read: true,
      write: true,
    });

    const fetchRes = await fetch(`${base}/api/vendor-cli/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ provider: "bitwarden" }),
    });
    expect(fetchRes.status).toBe(200);
    const fetched = (await fetchRes.json()) as { format: string; content: string };
    expect(fetched.format).toBe("bitwarden-json");
    expect(JSON.parse(fetched.content).items).toHaveLength(1);

    const updated = {
      items: [{ ...items[0], login: { ...items[0].login, password: "new-strong-password" } }],
    };
    const planRes = await fetch(`${base}/api/vendor-cli/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ provider: "bitwarden", original: { items }, updated }),
    });
    expect(planRes.status).toBe(200);
    expect(await planRes.json()).toMatchObject({ updates: 1, creates: 0, removes: 0 });

    const pushRes = await fetch(`${base}/api/vendor-cli/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ provider: "bitwarden", original: { items }, updated }),
    });
    expect(pushRes.status).toBe(200);
    expect(await pushRes.json()).toMatchObject({ updated: 1, created: 0, removed: 0 });
    expect(calls.some((c) => c.args[0] === "edit")).toBe(true);
  });

  test("rejects cross-origin requests and unknown API routes", async () => {
    const { runner } = fakeBitwardenRunner();
    const server = await startWebUIServer({
      port: 0,
      host: "127.0.0.1",
      publicDir: makePublicDir(),
      vendorRunner: runner,
    });
    servers.push(server);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const badOrigin = await fetch(`${base}/api/vendor-cli/providers`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(badOrigin.status).toBe(403);

    const missing = await fetch(`${base}/api/unknown`);
    expect(missing.status).toBe(404);

    const inheritedProvider = await fetch(`${base}/api/vendor-cli/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ provider: "constructor" }),
    });
    expect(inheritedProvider.status).toBe(400);
    expect(await inheritedProvider.json()).toEqual({
      error: 'Unknown vendor CLI provider "constructor".',
    });
  });

  test("rejects API requests with a non-loopback Host header (DNS rebinding)", async () => {
    const { runner } = fakeBitwardenRunner();
    const server = await startWebUIServer({
      port: 0,
      host: "127.0.0.1",
      publicDir: makePublicDir(),
      vendorRunner: runner,
    });
    servers.push(server);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/vendor-cli/providers",
          headers: { Host: "evil.example" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  test("respects Accept-Encoding quality values", async () => {
    const publicDir = makePublicDir();
    fs.writeFileSync(path.join(publicDir, "index.html"), "x".repeat(2048));
    const server = await startWebUIServer({ port: 0, host: "127.0.0.1", publicDir });
    servers.push(server);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const noneAccepted = await fetch(base, {
      headers: { "Accept-Encoding": "br;q=0, gzip;q=0" },
    });
    expect(noneAccepted.headers.get("content-encoding")).toBeNull();

    const gzipPreferred = await fetch(base, {
      headers: { "Accept-Encoding": "br;q=0.2, gzip;q=0.8" },
    });
    expect(gzipPreferred.headers.get("content-encoding")).toBe("gzip");
  });

  test("serves percent-encoded paths, blocks traversal and symlinks, handles HEAD and methods", async () => {
    const publicDir = makePublicDir();
    fs.writeFileSync(path.join(publicDir, "my file.js"), "console.log(1)");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vl-out-"));
    tempDirs.push(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOPSECRET");
    try {
      fs.symlinkSync(outside, path.join(publicDir, "link"), "junction");
    } catch {
      // symlinks unavailable; the rest still runs
    }
    const server = await startWebUIServer({ port: 0, host: "127.0.0.1", publicDir });
    servers.push(server);
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const encoded = await fetch(`${base}/my%20file.js`);
    expect(await encoded.text()).toBe("console.log(1)");

    for (const p of ["/link/secret.txt", "/%2e%2e/%2e%2e/etc/passwd", "/..%5c..%5csecret.txt"]) {
      const res = await fetch(`${base}${p}`);
      expect(await res.text()).not.toContain("TOPSECRET");
    }

    const head = await fetch(base, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);

    const post = await fetch(base, { method: "POST", body: "x" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");

    const bad = await fetch(`${base}/%E0%A4%A`);
    expect(bad.status).toBe(400);
  });

  test("maps vendor CLI failures to 502 and rejects malformed vault payloads", async () => {
    const failing: CommandRunner = {
      async run(): Promise<CommandResult> {
        return { code: 1, stdout: "", stderr: "vault is locked" };
      },
    };
    const server = await startWebUIServer({
      port: 0,
      host: "127.0.0.1",
      publicDir: makePublicDir(),
      vendorRunner: failing,
    });
    servers.push(server);
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    const post = (route: string, body: unknown) =>
      fetch(`${base}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify(body),
      });

    expect((await post("/api/vendor-cli/fetch", { provider: "bitwarden" })).status).toBe(502);
    const malformed = await post("/api/vendor-cli/plan", {
      provider: "bitwarden",
      original: { items: [null] },
      updated: { items: [] },
    });
    expect(malformed.status).toBe(400);
  });
});

describe("Web UI API method handling", () => {
  test("known API routes answer HEAD and reject other methods with 405 + Allow", async () => {
    const { runner } = fakeBitwardenRunner();
    const server = await startWebUIServer({
      port: 0,
      host: "127.0.0.1",
      publicDir: makePublicDir(),
      vendorRunner: runner,
    });
    servers.push(server);
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const head = await fetch(`${base}/api/vendor-cli/providers`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const getFetch = await fetch(`${base}/api/vendor-cli/fetch`);
    expect(getFetch.status).toBe(405);
    expect(getFetch.headers.get("allow")).toBe("POST");

    const postProviders = await fetch(`${base}/api/vendor-cli/providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(postProviders.status).toBe(405);
    expect(postProviders.headers.get("allow")).toBe("GET, HEAD");

    expect((await fetch(`${base}/api/vendor-cli/nope`)).status).toBe(404);
  });
});

describe("Web UI static caching", () => {
  async function cacheControlFor(files: string[]): Promise<Record<string, string | null>> {
    const publicDir = makePublicDir();
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(publicDir, file)), { recursive: true });
      fs.writeFileSync(path.join(publicDir, file), "x");
    }
    const server = await startWebUIServer({ port: 0, host: "127.0.0.1", publicDir });
    servers.push(server);
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const result: Record<string, string | null> = {};
    for (const file of [...files, "index.html"]) {
      const res = await fetch(`http://127.0.0.1:${port}/${file}`);
      result[file] = res.headers.get("cache-control");
    }
    return result;
  }

  const IMMUTABLE = "public, max-age=31536000, immutable";

  test("marks Angular content-hashed assets immutable", async () => {
    const hashed = [
      "main-R3XVMKT3.js",
      "main-R3XVMKT3.js.map",
      "chunk-D7iZqTD4.js",
      "chunk-B_lon52a.js",
      "styles-ZZD46XT3.css",
      "media/bricolage-grotesque-latin-wght-normal-HY2A4V5R.woff2",
      "app.abcdef123456.js",
    ];
    const headers = await cacheControlFor(hashed);
    expect(headers).toEqual({
      ...Object.fromEntries(hashed.map((f) => [f, IMMUTABLE])),
      "index.html": "no-cache",
    });
  });

  test("never marks index.html or unhashed files immutable", async () => {
    const plain = [
      "favicon.svg",
      "robots.txt",
      "3rdpartylicenses.txt",
      "main.js",
      "styles.css",
      "Inter-Variable.woff2",
      "polyfills-es2015.js",
      "chunk-lower.js",
    ];
    const headers = await cacheControlFor(plain);
    for (const file of [...plain, "index.html"]) expect(headers[file]).toBe("no-cache");
  });
});

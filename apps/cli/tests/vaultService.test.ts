import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { createZipArchive } from "@vaultlint/vault-formats";
import { VaultData } from "@vaultlint/vault-schema";
import axios from "axios";

import {
  detectWeakPasswords,
  nodeVaultStorage,
  batchUpdateWeakPasswords,
  detectCompromisedPasswords,
  generateStrongPassword,
  isWeakPassword,
  findReusedPasswordGroups,
  batchUpdateReusedPasswords,
  findMalformedUris,
  computeVaultHealth,
  checkUriReachability,
  applyRedirectUpdates,
  loadVaultWithMeta,
} from "../src/vaultService";

describe("Vault Service - Weak & Compromised Password Detection", () => {
  let vaultDataMock: VaultData;

  beforeEach(() => {
    vaultDataMock = {
      items: [
        { name: "Weak Site", login: { password: "weak" } },
        { name: "Strong Site", login: { password: "StrongPass123!" } },
      ],
    };
  });

  it("should detect weak passwords", () => {
    const weakPasswordCount = detectWeakPasswords(vaultDataMock);
    expect(weakPasswordCount).toBe(1);
  });

  it("should update weak passwords with strong generated passwords", () => {
    const updated = batchUpdateWeakPasswords(vaultDataMock);
    expect(updated).toBe(1);
    const nextPassword = vaultDataMock.items[0].login!.password!;
    expect(nextPassword.length).toBeGreaterThanOrEqual(12);
    expect(isWeakPassword(nextPassword)).toBe(false);
  });

  it("should always generate strong passwords", () => {
    for (let i = 0; i < 20; i++) {
      const pw = generateStrongPassword(16);
      expect(isWeakPassword(pw)).toBe(false);
    }
  });

  it("rejects non-finite and excessively large generated password lengths", () => {
    expect(() => generateStrongPassword(Number.POSITIVE_INFINITY)).toThrow(/finite number/);
    expect(() => generateStrongPassword(4097)).toThrow(/cannot exceed 4096/);
  });

  it("preserves an existing vault if atomic replacement fails", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultlint-save-test-"));
    const target = path.join(directory, "vault.json");
    fs.writeFileSync(target, "original vault");
    const renameSpy = spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated replace failure");
    });

    try {
      expect(() => nodeVaultStorage.writeText(target, "updated vault")).toThrow(
        /simulated replace failure/,
      );
      expect(fs.readFileSync(target, "utf8")).toBe("original vault");
      expect(fs.readdirSync(directory)).toEqual(["vault.json"]);
    } finally {
      renameSpy.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("should detect compromised passwords using HIBP range response", async () => {
    const getSpy = spyOn(axios, "get").mockResolvedValue({
      status: 200,
      data: "00000000000000000000000000000000000:1\r\n",
    });
    const compromisedCount = await detectCompromisedPasswords(vaultDataMock);
    expect(compromisedCount).toBe(0);
    getSpy.mockRestore();
  });

  it("returns only a compromised count instead of plaintext passwords", async () => {
    const digest = await globalThis.crypto.subtle.digest("SHA-1", new TextEncoder().encode("weak"));
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const getSpy = spyOn(axios, "get").mockResolvedValue({
      status: 200,
      data: `${hash.slice(5)}:1\r\n`,
    });
    try {
      const compromisedCount = await detectCompromisedPasswords(vaultDataMock);
      expect(compromisedCount).toBe(1);
      expect(compromisedCount).not.toBe("weak");
    } finally {
      getSpy.mockRestore();
    }
  });

  it("should fail the HIBP check on network errors instead of reporting a clean result", async () => {
    const getSpy = spyOn(axios, "get").mockRejectedValue(new Error("connection failed"));
    try {
      await expect(detectCompromisedPasswords(vaultDataMock)).rejects.toThrow(
        /HIBP range request failed/,
      );
    } finally {
      getSpy.mockRestore();
    }
  });

  it("should reject invalid HIBP response bodies", async () => {
    const getSpy = spyOn(axios, "get").mockResolvedValue({ status: 200, data: {} } as never);
    try {
      await expect(detectCompromisedPasswords(vaultDataMock)).rejects.toThrow(
        /invalid range response/,
      );
    } finally {
      getSpy.mockRestore();
    }
  });

  it("should reject malformed HIBP range lines", async () => {
    const getSpy = spyOn(axios, "get").mockResolvedValue({
      status: 200,
      data: "upstream error page",
    } as never);
    try {
      await expect(detectCompromisedPasswords(vaultDataMock)).rejects.toThrow(
        /invalid range response/,
      );
    } finally {
      getSpy.mockRestore();
    }
  });
});

describe("CLI Proton Pass ZIP import", () => {
  it("loads Proton Pass data.json from the native export archive", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaultlint-proton-zip-"));
    const input = path.join(directory, "proton-export.zip");
    const data = {
      version: "2.3.3",
      vaults: {
        synthetic: {
          name: "Personal",
          items: [
            {
              itemId: "synthetic-login",
              state: 1,
              data: {
                type: "login",
                metadata: { name: "Synthetic login", note: "" },
                content: { itemUsername: "user", password: "synthetic-secret", urls: [] },
              },
            },
          ],
        },
      },
    };

    try {
      fs.writeFileSync(input, createZipArchive({ "Proton Pass/data.json": JSON.stringify(data) }));
      const parsed = await loadVaultWithMeta(input);
      expect(parsed.format).toBe("protonpass-json");
      expect(parsed.vault.items[0].name).toBe("Synthetic login");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Vault Service - Reused Passwords, Malformed URIs, and Health Score", () => {
  it("should detect and fix reused passwords without exposing plaintext", () => {
    const vault: VaultData = {
      items: [
        { name: "Site A", login: { username: "a", password: "SharedPassword1!" } },
        { name: "Site B", login: { username: "b", password: "SharedPassword1!" } },
        { name: "Site C", login: { username: "c", password: "UniqueStrongPassword1!" } },
      ],
    };

    const groups = findReusedPasswordGroups(vault);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);

    const updated = batchUpdateReusedPasswords(vault);
    expect(updated).toBe(1);
    expect(vault.items[0].login!.password).toBe("SharedPassword1!");
    expect(vault.items[1].login!.password).not.toBe("SharedPassword1!");
    expect(isWeakPassword(vault.items[1].login!.password!)).toBe(false);
    expect(findReusedPasswordGroups(vault)).toHaveLength(0);
  });

  it("should detect malformed URIs and compute vault health score", () => {
    const vault: VaultData = {
      folders: [{ id: "f1", name: "Work" }],
      items: [
        {
          name: "Good Site",
          favorite: true,
          login: {
            password: "StrongPassword123!",
            totp: "JBSWY3DPEHPK3PXP",
            uris: [{ uri: "https://example.com" }],
          },
        },
        {
          name: "Bad URI Site",
          login: {
            password: "weak",
            uris: [{ uri: "not-a-valid-uri" }, { uri: "androidapp://" }],
          },
        },
      ],
    };

    const uriIssues = findMalformedUris(vault);
    expect(uriIssues).toHaveLength(2);
    expect(uriIssues[0].uri).toBe("not-a-valid-uri");
    expect(uriIssues[1].uri).toBe("androidapp://");

    const health = computeVaultHealth(vault);
    expect(health.totalItems).toBe(2);
    expect(health.foldersCount).toBe(1);
    expect(health.favoritesCount).toBe(1);
    expect(health.totpCount).toBe(1);
    expect(health.weakPasswordCount).toBe(1);
    expect(health.malformedUriCount).toBe(2);
    expect(health.healthScore).toBeGreaterThanOrEqual(0);
    expect(health.healthScore).toBeLessThan(100);
  });

  it("should detect redirects and dead links on opt-in reachability check and apply redirect updates", async () => {
    const vault: VaultData = {
      items: [
        {
          name: "Redirect Site",
          login: { uris: [{ uri: "http://example.com" }] },
        },
        {
          name: "Dead Site",
          login: { uris: [{ uri: "https://dead.example.com" }] },
        },
      ],
    };

    const headSpy = spyOn(axios, "head").mockImplementation(async (url: string) => {
      if (url === "http://example.com") {
        return { status: 301, headers: { location: "https://example.com/" } } as never;
      }
      return { status: 404, headers: {} } as never;
    });

    try {
      const result = await checkUriReachability(vault);
      expect(result.checkedCount).toBe(2);
      expect(result.redirects).toHaveLength(1);
      expect(result.redirects[0].redirectedUri).toBe("https://example.com/");
      expect(result.deadLinks).toHaveLength(1);
      expect(result.deadLinks[0].reason).toBe("HTTP 404");

      const added = applyRedirectUpdates(vault, result.redirects);
      expect(added).toBe(1);
      expect(vault.items[0].login!.uris).toEqual([
        { uri: "http://example.com" },
        { uri: "https://example.com/" },
      ]);
    } finally {
      headSpy.mockRestore();
    }
  });

  it("never sends credentials embedded in a URI during the reachability check", async () => {
    const vault: VaultData = {
      items: [
        {
          name: "Embedded creds",
          login: { uris: [{ uri: "http://user:hunter2@example.com/path?x=1" }] },
        },
      ],
    };
    const requested: string[] = [];
    const headSpy = spyOn(axios, "head").mockImplementation(async (url: string) => {
      requested.push(url);
      return { status: 200, headers: {} } as never;
    });
    try {
      await checkUriReachability(vault);
      expect(requested).toEqual(["http://example.com/path?x=1"]);
      expect(requested.join("")).not.toContain("hunter2");
    } finally {
      headSpy.mockRestore();
    }
  });
});

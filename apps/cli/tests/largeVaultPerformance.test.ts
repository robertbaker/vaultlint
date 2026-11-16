import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";

import { runVaultEnhancement } from "../src/vaultManager";

function makeVault(count: number) {
  return {
    encrypted: false,
    folders: [],
    items: Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      type: 1,
      name: `Site ${i}`,
      login: {
        username: `user${i}`,
        password: "password",
        uris: [{ uri: `http://site${i}.example.com/login` }],
      },
    })),
  };
}

describe("large vault performance", () => {
  test("SARIF export scales roughly linearly (no per-finding scan of the whole vault)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vl-perf-"));
    try {
      const input = path.join(dir, "vault.json");
      fs.writeFileSync(input, JSON.stringify(makeVault(20_000)));
      const started = performance.now();
      await runVaultEnhancement({
        input,
        lint: true,
        sarif: path.join(dir, "out.sarif"),
        quiet: true,
        noColor: true,
      });
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(2500);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

import { describe, expect, test } from "bun:test";

import type { VaultData } from "@vaultlint/vault-schema";

import { runVaultEnhancement } from "../src/vaultManager";
import type { CommandResult, CommandRunner } from "../src/vendorCli";
import { VENDOR_CLI_PROVIDERS, describeVendorCliSupport } from "../src/vendorCli";
import { bitwardenProvider, diffBitwardenVaults } from "../src/vendorCli/bitwarden";
import { nodeCommandRunner, redactSecrets } from "../src/vendorCli/runner";

interface Call {
  args: string[];
  input?: string;
}

function item(id: string, name: string, password: string, revisionDate = "2024-01-01T00:00:00Z") {
  return {
    id,
    name,
    type: 1,
    folderId: null,
    revisionDate,
    login: { username: "u@example.com", password, uris: [{ uri: "https://example.com" }] },
  };
}

function fakeBitwarden(items: unknown[], folders: unknown[] = []) {
  const calls: Call[] = [];
  const runner: CommandRunner = {
    async run(_bin, args, options): Promise<CommandResult> {
      calls.push({ args, input: options?.input });
      const key = args.slice(0, 2).join(" ");
      const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
      if (key === "status --nointeraction") return ok(JSON.stringify({ status: "unlocked" }));
      if (key === "list items") return ok(JSON.stringify(items));
      if (key === "list folders") return ok(JSON.stringify(folders));
      if (key === "create folder") return ok(JSON.stringify({ id: "new-folder-id" }));
      return ok();
    },
  };
  return { runner, calls };
}

const baseOptions = { input: "unused.json", quiet: true, skipConfirmation: true } as const;

describe("vendor CLI integration", () => {
  test("lists provider capabilities honestly", () => {
    expect(describeVendorCliSupport(VENDOR_CLI_PROVIDERS.bitwarden)).toEqual({
      read: true,
      write: true,
    });
    expect(describeVendorCliSupport(VENDOR_CLI_PROVIDERS.lastpass)).toEqual({
      read: true,
      write: false,
    });
    expect(describeVendorCliSupport(VENDOR_CLI_PROVIDERS.dashlane)).toEqual({
      read: true,
      write: false,
    });
    expect(describeVendorCliSupport(VENDOR_CLI_PROVIDERS["proton-pass"])).toEqual({
      read: true,
      write: false,
    });
  });

  test("redacts session keys from error text", () => {
    expect(redactSecrets("bad key abcdef123456!", { BW_SESSION: "abcdef123456" })).toBe(
      "bad key [redacted BW_SESSION]!",
    );
  });

  test("redacts short vendor secrets such as a four-digit Enpass PIN", () => {
    expect(redactSecrets("authentication failed for PIN 1234", { ENP_PIN: "1234" })).toBe(
      "authentication failed for PIN [redacted ENP_PIN]",
    );
  });

  test("caps oversized CLI stderr while retaining a truncation marker", async () => {
    const result = await nodeCommandRunner.run(process.execPath, [
      "-e",
      "process.stderr.write('diagnostic-prefix:' + 'x'.repeat(2 * 1024 * 1024))",
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr.startsWith("diagnostic-prefix:")).toBe(true);
    expect(result.stderr).toContain("[stderr truncated after 1 MiB]");
    expect(Buffer.byteLength(result.stderr)).toBeLessThan(1024 * 1024 + 64);
  });

  test("diffs creates, updates, removals, and new folders", () => {
    const original = {
      folders: [{ id: "f1", name: "Old" }],
      items: [item("1", "A", "p1"), item("2", "B", "p2"), item("3", "C", "p3")],
    };
    const updated = {
      folders: [
        { id: "f1", name: "Old" },
        { id: "f2", name: "New" },
      ],
      items: [
        item("1", "A", "p1"),
        item("2", "B", "changed"),
        { ...item("x", "D", "p4"), id: undefined },
      ],
    };
    const plan = diffBitwardenVaults(original, updated);
    expect(plan.updates.map((i) => i.id)).toEqual(["2"]);
    expect(plan.removes.map((i) => i.id)).toEqual(["3"]);
    expect(plan.creates.map((i) => i.name)).toEqual(["D"]);
    expect(plan.newFolders.map((f) => f.name)).toEqual(["New"]);
  });

  test("plans and applies folder renames and permanent deletions", async () => {
    const original: VaultData = {
      folders: [
        { id: "rename", name: "Old name" },
        { id: "delete", name: "Remove me" },
      ],
      items: [],
    };
    const updated: VaultData = {
      folders: [{ id: "rename", name: "New name" }],
      items: [],
    };
    const plan = diffBitwardenVaults(original, updated);

    expect(plan.updatedFolders).toEqual([
      { before: { id: "rename", name: "Old name" }, after: { id: "rename", name: "New name" } },
    ]);
    expect(plan.removedFolders).toEqual([{ id: "delete", name: "Remove me" }]);

    const { runner, calls } = fakeBitwarden([], original.folders);
    const result = await bitwardenProvider.push!(runner, original, updated);
    expect(result.updatedFolders).toBe(1);
    expect(result.removedFolders).toBe(1);
    expect(calls.some((call) => call.args.slice(0, 3).join(" ") === "edit folder rename")).toBe(
      true,
    );
    expect(calls.some((call) => call.args.slice(0, 3).join(" ") === "delete folder delete")).toBe(
      true,
    );
    const edit = calls.find((call) => call.args[0] === "edit" && call.args[1] === "folder");
    expect(JSON.parse(Buffer.from(edit?.input ?? "", "base64").toString("utf8"))).toEqual({
      id: "rename",
      name: "New name",
    });
  });

  test("aborts folder updates when the live folder changed after fetch", async () => {
    const original: VaultData = {
      folders: [{ id: "rename", name: "Old name" }],
      items: [],
    };
    const updated: VaultData = {
      folders: [{ id: "rename", name: "New name" }],
      items: [],
    };
    const { runner, calls } = fakeBitwarden([], [{ id: "rename", name: "Changed elsewhere" }]);

    await expect(bitwardenProvider.push!(runner, original, updated)).rejects.toThrow(
      /changed or no longer exists in Bitwarden/,
    );
    expect(calls.some((call) => ["create", "edit", "delete"].includes(call.args[0]))).toBe(false);
  });

  test("audits a Bitwarden vault read through the CLI without writing files", async () => {
    const { runner, calls } = fakeBitwarden([item("1", "A", "p1"), item("2", "A", "p1")]);
    const report = await runVaultEnhancement({
      ...baseOptions,
      fromCli: "bitwarden",
      audit: true,
      dryRun: true,
      vendorRunner: runner,
    });
    expect(report.totalItemsBefore).toBe(2);
    expect(calls.map((c) => c.args[0])).toEqual(["status", "sync", "list", "list"]);
  });

  test("pushes merged duplicates back with stdin payloads and a trash delete", async () => {
    const items = [item("1", "Site", "StrongPass#9921"), item("2", "Site", "StrongPass#9921")];
    const { runner, calls } = fakeBitwarden(items);
    await runVaultEnhancement({
      ...baseOptions,
      fromCli: "bitwarden",
      autoMerge: true,
      pushToCli: true,
      vendorRunner: runner,
    });
    const deletes = calls.filter((c) => c.args[0] === "delete");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args).not.toContain("--permanently");
    // Secrets only ever travel on stdin, never in argv.
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain("StrongPass#9921");
    }
    expect(calls.at(-1)?.args[0]).toBe("sync");
  });

  test("push dry-run changes nothing", async () => {
    const items = [item("1", "Site", "StrongPass#9921"), item("2", "Site", "StrongPass#9921")];
    const { runner, calls } = fakeBitwarden(items);
    await runVaultEnhancement({
      ...baseOptions,
      fromCli: "bitwarden",
      autoMerge: true,
      pushToCli: true,
      dryRun: true,
      vendorRunner: runner,
    });
    expect(calls.some((c) => ["edit", "create", "delete"].includes(c.args[0]))).toBe(false);
  });

  test("aborts the push if an item changed on the server after it was read", async () => {
    const original = [item("1", "Site", "StrongPass#9921"), item("2", "Site", "StrongPass#9921")];
    const { runner, calls } = fakeBitwarden(original);
    let listCalls = 0;
    const drifting: CommandRunner = {
      async run(bin, args, options) {
        if (args[0] === "list" && args[1] === "items") {
          listCalls++;
          if (listCalls > 1) {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify(
                original.map((i) => ({ ...i, revisionDate: "2030-01-01T00:00:00Z" })),
              ),
            };
          }
        }
        return runner.run(bin, args, options);
      },
    };
    await expect(
      runVaultEnhancement({
        ...baseOptions,
        fromCli: "bitwarden",
        autoMerge: true,
        pushToCli: true,
        vendorRunner: drifting,
      }),
    ).rejects.toThrow(/changed in Bitwarden/);
    expect(calls.some((c) => ["edit", "create", "delete"].includes(c.args[0]))).toBe(false);
  });

  test("rejects a locked vault and unsupported providers with actionable errors", async () => {
    const locked: CommandRunner = {
      async run() {
        return { code: 0, stdout: JSON.stringify({ status: "locked" }), stderr: "" };
      },
    };
    await expect(
      runVaultEnhancement({ ...baseOptions, fromCli: "bitwarden", vendorRunner: locked }),
    ).rejects.toThrow(/BW_SESSION/);
    await expect(
      runVaultEnhancement({
        ...baseOptions,
        fromCli: "dashlane",
        pushToCli: true,
        vendorRunner: locked,
      }),
    ).rejects.toThrow(/read-only/);
    await expect(runVaultEnhancement({ ...baseOptions, pushToCli: true })).rejects.toThrow(
      /requires --from-cli/,
    );
  });
});

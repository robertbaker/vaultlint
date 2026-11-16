import type { VaultData, VaultFolder, VaultItem } from "@vaultlint/vault-schema";

import { runChecked } from "./runner";
import type {
  CommandRunner,
  VendorCliProvider,
  VendorFetchResult,
  VendorPlanSummary,
  VendorPushResult,
} from "./types";

const BIN = "bw";
/** `--nointeraction` stops bw from prompting; `--raw` gives plain JSON on stdout. */
const BASE = ["--nointeraction"];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseJsonArray(text: string, what: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Could not read ${what} from the Bitwarden CLI (output was not JSON).`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Unexpected ${what} output from the Bitwarden CLI.`);
  }
  return parsed as Array<Record<string, unknown>>;
}

/** Bw reads JSON for create/edit from stdin as base64, which keeps secrets out of argv. */
function encodePayload(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

interface Plan {
  newFolders: VaultFolder[];
  updatedFolders: Array<{ before: VaultFolder; after: VaultFolder }>;
  removedFolders: VaultFolder[];
  creates: VaultItem[];
  updates: VaultItem[];
  removes: VaultItem[];
}

function assertUniquePersistentIds(vault: VaultData, label: string): void {
  const ids = new Set<string>();
  for (const item of vault.items) {
    if (!item.id) continue;
    if (ids.has(item.id)) {
      throw new Error(`Cannot safely plan a Bitwarden push: ${label} contains duplicate item IDs.`);
    }
    ids.add(item.id);
  }
}

export function diffBitwardenVaults(original: VaultData, updated: VaultData): Plan {
  assertUniquePersistentIds(original, "the original vault");
  assertUniquePersistentIds(updated, "the updated vault");
  const originalById = new Map<string, VaultItem>();
  for (const item of original.items) {
    if (item.id) originalById.set(item.id, item);
  }
  const updatedIds = new Set<string>();
  const creates: VaultItem[] = [];
  const updates: VaultItem[] = [];

  for (const item of updated.items) {
    const before = item.id ? originalById.get(item.id) : undefined;
    if (!before) {
      creates.push(item);
      continue;
    }
    updatedIds.add(item.id as string);
    if (stableStringify(before) !== stableStringify(item)) updates.push(item);
  }

  const removes = original.items.filter((item) => item.id && !updatedIds.has(item.id));
  const knownFolders = new Set((original.folders ?? []).map((f) => f.id));
  const newFolders = (updated.folders ?? []).filter((f) => !knownFolders.has(f.id));
  const originalFolders = new Map((original.folders ?? []).map((folder) => [folder.id, folder]));
  const updatedFolderIds = new Set((updated.folders ?? []).map((folder) => folder.id));
  const updatedFolders = (updated.folders ?? []).flatMap((after) => {
    const before = originalFolders.get(after.id);
    return before && before.name !== after.name ? [{ before, after }] : [];
  });
  const removedFolders = (original.folders ?? []).filter(
    (folder) => !updatedFolderIds.has(folder.id),
  );
  return { newFolders, updatedFolders, removedFolders, creates, updates, removes };
}

export function summarizeBitwardenPlan(original: VaultData, updated: VaultData): VendorPlanSummary {
  const plan = diffBitwardenVaults(original, updated);
  const label = (item: VaultItem) => item.name || item.id || "(unnamed)";
  return {
    creates: plan.creates.length,
    updates: plan.updates.length,
    removes: plan.removes.length,
    newFolders: plan.newFolders.length,
    updatedFolders: plan.updatedFolders.length,
    removedFolders: plan.removedFolders.length,
    lines: [
      ...plan.newFolders.map((f) => `create folder: ${f.name}`),
      ...plan.updatedFolders.map(
        ({ before, after }) => `rename folder: ${before.name} → ${after.name}`,
      ),
      ...plan.removedFolders.map((folder) => `permanently delete folder: ${folder.name}`),
      ...plan.creates.map((i) => `create: ${label(i)}`),
      ...plan.updates.map((i) => `update: ${label(i)}`),
      ...plan.removes.map((i) => `move to trash: ${label(i)}`),
    ],
  };
}

async function listItems(runner: CommandRunner): Promise<Array<Record<string, unknown>>> {
  return parseJsonArray(
    await runChecked(runner, BIN, ["list", "items", "--raw", ...BASE]),
    "vault items",
  );
}

async function listFolders(runner: CommandRunner): Promise<Array<Record<string, unknown>>> {
  return parseJsonArray(
    await runChecked(runner, BIN, ["list", "folders", "--raw", ...BASE]),
    "folders",
  );
}

async function pushBitwarden(
  runner: CommandRunner,
  original: VaultData,
  updated: VaultData,
): Promise<VendorPushResult> {
  const plan = diffBitwardenVaults(original, updated);
  const result: VendorPushResult = {
    created: 0,
    updated: 0,
    removed: 0,
    newFolders: 0,
    updatedFolders: 0,
    removedFolders: 0,
  };

  // Refuse to overwrite anything that changed on the server since we read it.
  const live = new Map((await listItems(runner)).map((item) => [String(item["id"]), item]));
  const liveFolders = new Map(
    (await listFolders(runner)).map((folder) => [String(folder["id"]), folder]),
  );
  for (const item of [...plan.updates, ...plan.removes]) {
    const before = original.items.find((o) => o.id === item.id);
    const current = live.get(String(item.id));
    if (!current) throw new Error(`"${item.name ?? item.id}" no longer exists in the vault.`);
    if (before?.revisionDate && current["revisionDate"] !== before.revisionDate) {
      throw new Error(
        `"${item.name ?? item.id}" changed in Bitwarden after it was read. Nothing was pushed; re-run to start from the current vault.`,
      );
    }
  }
  for (const { before } of plan.updatedFolders) {
    const current = liveFolders.get(before.id);
    if (!current || current["name"] !== before.name) {
      throw new Error(
        `Folder "${before.name}" changed or no longer exists in Bitwarden. Nothing was pushed; re-run to start from the current vault.`,
      );
    }
  }
  for (const folder of plan.removedFolders) {
    const current = liveFolders.get(folder.id);
    if (!current || current["name"] !== folder.name) {
      throw new Error(
        `Folder "${folder.name}" changed or no longer exists in Bitwarden. Nothing was pushed; re-run to start from the current vault.`,
      );
    }
  }

  const folderIds = new Map<string, string>();
  for (const folder of plan.newFolders) {
    const out = await runChecked(runner, BIN, ["create", "folder", "--raw", ...BASE], {
      input: encodePayload({ name: folder.name }),
    });
    let createdId: unknown;
    try {
      createdId = (JSON.parse(out) as { id?: unknown } | null)?.id;
    } catch {
      createdId = undefined;
    }
    if (typeof createdId !== "string" || !createdId) {
      throw new Error(
        `Bitwarden created folder "${folder.name}" but returned unreadable output, so the push was stopped before any items changed. Check your Bitwarden folders for a duplicate before retrying.`,
      );
    }
    folderIds.set(folder.id, createdId);
    result.newFolders++;
  }

  for (const { after } of plan.updatedFolders) {
    await runChecked(runner, BIN, ["edit", "folder", after.id, "--raw", ...BASE], {
      input: encodePayload(after),
    });
    result.updatedFolders++;
  }

  const remap = (item: VaultItem): VaultItem =>
    item.folderId && folderIds.has(item.folderId)
      ? { ...item, folderId: folderIds.get(item.folderId) as string }
      : item;

  for (const item of plan.updates) {
    await runChecked(runner, BIN, ["edit", "item", String(item.id), "--raw", ...BASE], {
      input: encodePayload(remap(item)),
    });
    result.updated++;
  }
  for (const item of plan.creates) {
    const { id: _id, revisionDate: _rev, creationDate: _created, ...payload } = remap(item);
    await runChecked(runner, BIN, ["create", "item", "--raw", ...BASE], {
      input: encodePayload(payload),
    });
    result.created++;
  }
  for (const item of plan.removes) {
    // No --permanently: removed items land in Bitwarden's trash and stay recoverable.
    await runChecked(runner, BIN, ["delete", "item", String(item.id), ...BASE]);
    result.removed++;
  }
  for (const folder of plan.removedFolders) {
    // Bitwarden folder deletion is permanent, so the explicit push confirmation previews this.
    await runChecked(runner, BIN, ["delete", "folder", folder.id, ...BASE]);
    result.removedFolders++;
  }

  await runChecked(runner, BIN, ["sync", ...BASE]);
  return result;
}

export const bitwardenProvider: VendorCliProvider = {
  id: "bitwarden",
  displayName: "Bitwarden",
  binary: BIN,

  async ensureReady(runner) {
    const out = await runChecked(runner, BIN, ["status", ...BASE]);
    let status: string | undefined;
    try {
      status = (JSON.parse(out) as { status?: string }).status;
    } catch {
      // fall through to the generic message
    }
    if (status !== "unlocked") {
      throw new Error(
        `The Bitwarden vault is ${status ?? "not available"}. Run \`bw login\` / \`bw unlock\`, then export the session key it prints as BW_SESSION and try again. vaultlint never asks for your master password.`,
      );
    }
  },

  async fetch(runner): Promise<VendorFetchResult> {
    await runChecked(runner, BIN, ["sync", ...BASE]);
    const items = await listItems(runner);
    const folders = (await listFolders(runner)).filter(
      (f) => typeof f["id"] === "string" && f["id"],
    );
    return {
      content: JSON.stringify({ encrypted: false, folders, items }),
      format: "bitwarden-json",
    };
  },

  planPush: summarizeBitwardenPlan,
  push: pushBitwarden,
};

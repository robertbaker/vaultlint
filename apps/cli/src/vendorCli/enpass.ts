import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "enpasscli";
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fieldValue(field: JsonObject): string | undefined {
  const value = field["value"];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function normalizeEntry(rawValue: unknown): JsonObject | undefined {
  const raw = object(rawValue);
  if (!raw || !Array.isArray(raw["fields"])) return undefined;

  const fields = raw["fields"]
    .map(object)
    .filter((field): field is JsonObject => field !== undefined)
    .map((field) => ({
      type: text(field["type"]) ?? "",
      label: text(field["label"]) ?? "",
      value: fieldValue(field) ?? "",
      sensitive: field["sensitive"] === true,
    }));
  const category = text(raw["category"]) ?? "";
  const categoryKey = category.toLowerCase().replace(/[^a-z]/g, "");
  const fieldTypes = new Set(fields.map((field) => field.type.toLowerCase()));
  const templateType =
    categoryKey.includes("creditcard") || fieldTypes.has("ccnumber")
      ? "creditcard.cli"
      : categoryKey.includes("identity")
        ? "identity.cli"
        : categoryKey.includes("login")
          ? "login.cli"
          : categoryKey.includes("password") || fieldTypes.has("password")
            ? "password.cli"
            : "note.cli";
  const note = fields.find(
    (field) => field.type.toLowerCase() === "note" || field.label.toLowerCase() === "note",
  )?.value;

  return {
    uuid: text(raw["uuid"]),
    title: text(raw["title"]) ?? "Untitled",
    note: note ?? "",
    template_type: templateType,
    fields,
    trashed: raw["trashed"] === true,
  };
}

function parseOutput(output: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error("Could not read the Enpass CLI output as JSON.");
  }
  if (!Array.isArray(parsed))
    throw new Error("Unexpected Enpass CLI output; expected a JSON array.");
  const entries = parsed.map(normalizeEntry);
  if (entries.some((entry) => entry === undefined)) {
    throw new Error("The Enpass CLI returned an entry without the expected detailed fields.");
  }
  return entries;
}

export const enpassProvider: VendorCliProvider = {
  id: "enpass",
  displayName: "Enpass (community CLI)",
  binary: BIN,
  unsupportedReason: {
    write:
      "Enpass CLI write commands are not used by vaultlint; this integration only reads detailed vault entries.",
  },

  async ensureReady(runner: CommandRunner) {
    await runChecked(runner, BIN, ["version"]);
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    const args = ["-json", "-detailed", "-nonInteractive"];
    const vaultPath = process.env["VAULTLINT_ENPASS_VAULT"];
    const keyfilePath = process.env["VAULTLINT_ENPASS_KEYFILE"];
    if (!vaultPath) {
      throw new Error(
        "Set VAULTLINT_ENPASS_VAULT to the Enpass vault directory before using --from-cli enpass.",
      );
    }
    args.push(`-vault=${vaultPath}`);
    if (keyfilePath) args.push(`-keyfile=${keyfilePath}`);
    const output = await runChecked(runner, BIN, [...args, "show"]);
    const items = parseOutput(output);
    return {
      content: JSON.stringify({ items, folders: [] }),
      format: "enpass-json",
    };
  },
};

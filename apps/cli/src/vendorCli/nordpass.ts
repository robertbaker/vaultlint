import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "np";
const HEADERS = [
  "name",
  "url",
  "username",
  "password",
  "note",
  "cardholdername",
  "cardnumber",
  "cvc",
  "expirydate",
  "zipcode",
  "folder",
  "full_name",
  "phone_number",
  "email",
  "address1",
  "address2",
  "city",
  "country",
  "state",
  "type",
  "totp",
  "shared_folder",
];
type JsonObject = Record<string, unknown>;

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Never include stdout in errors; it may contain decrypted vault data.
    throw new Error(`Could not read ${what} from the NordPass CLI (output was not JSON).`);
  }
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function field(item: JsonObject, ...names: string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [key, value] of Object.entries(item)) {
    if (
      wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
      value !== null &&
      value !== undefined
    ) {
      return string(value);
    }
  }
  const nested = object(item["fields"]);
  if (nested) {
    for (const [key, value] of Object.entries(nested)) {
      if (
        wanted.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
        value !== null &&
        value !== undefined
      ) {
        return string(object(value)?.["value"] ?? value);
      }
    }
  }
  if (Array.isArray(item["fields"])) {
    for (const raw of item["fields"]) {
      const entry = object(raw);
      if (!entry) continue;
      const key = string(entry["label"] ?? entry["name"] ?? entry["key"])
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (wanted.has(key)) return string(entry["value"] ?? entry["content"]);
    }
  }
  return "";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function mapItem(item: JsonObject): string[] {
  const type = field(item, "type", "category").toLowerCase().replace(/[ -]/g, "_");
  const normalizedType = type.includes("note")
    ? "note"
    : type.includes("card")
      ? "credit_card"
      : type.includes("identity") || type.includes("personal")
        ? "personal_info"
        : "password";
  return [
    field(item, "name", "title"),
    field(item, "url", "website", "login_url"),
    field(item, "username", "login"),
    field(item, "password"),
    field(item, "note", "notes"),
    field(item, "cardholder", "cardholdername"),
    field(item, "number", "cardnumber"),
    field(item, "cvv", "cvc"),
    field(item, "expiry", "expirydate"),
    field(item, "zip", "zipcode"),
    field(item, "folder", "foldername"),
    field(item, "fullname", "full_name"),
    field(item, "phone", "phonenumber"),
    field(item, "email"),
    field(item, "address1"),
    field(item, "address2"),
    field(item, "city"),
    field(item, "country"),
    field(item, "state"),
    normalizedType,
    field(item, "totp", "otp", "totpsecret"),
    field(item, "sharedfolder"),
  ];
}

export const nordPassProvider: VendorCliProvider = {
  id: "nordpass",
  displayName: "NordPass",
  binary: BIN,
  unsupportedReason: {
    write:
      "NordPass CLI supports item edits, but vaultlint does not yet have a lossless field mapping and conflict guard for NordPass write-back.",
  },

  async ensureReady(runner: CommandRunner) {
    // `whoami` is non-mutating; `item list` below confirms the vault is unlocked.
    await runChecked(runner, BIN, ["whoami", "--format", "json"]);
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    const rawList = parseJson(
      await runChecked(runner, BIN, ["item", "list", "--format", "json"]),
      "item list",
    );
    const listed = Array.isArray(rawList) ? rawList : object(rawList)?.["items"];
    if (!Array.isArray(listed)) {
      throw new Error("Unexpected item list output from the NordPass CLI.");
    }
    const rows: string[][] = [];
    for (const referenceValue of listed) {
      const reference = object(referenceValue);
      if (!reference) throw new Error("Unexpected item reference in NordPass CLI output.");
      const id = string(reference["id"] ?? reference["itemId"]);
      if (!id) throw new Error("A NordPass CLI item did not include an ID.");
      const detail = object(
        parseJson(
          await runChecked(runner, BIN, ["item", "get", id, "--format", "json"]),
          "item details",
        ),
      );
      if (!detail) throw new Error("Unexpected item details output from the NordPass CLI.");
      const data = object(detail["item"]) ?? detail;
      rows.push(mapItem(data));
    }
    const content = [HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return { content, format: "nordpass-csv" };
  },
};

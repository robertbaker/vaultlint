import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "keeper";
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function parseJson(output: string, what: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error(`Could not read ${what} from Keeper Commander (output was not JSON).`);
  }
}

function isEmptyList(value: unknown): boolean {
  const message = string(object(value)?.["message"]);
  return Boolean(message && /no\s+(records|folders|data)/i.test(message));
}

function listedRecords(output: string): JsonObject[] {
  const parsed = parseJson(output, "record list");
  if (isEmptyList(parsed)) return [];
  if (!Array.isArray(parsed))
    throw new Error("Unexpected record list output from Keeper Commander.");
  const records = parsed.map(object);
  if (records.some((record) => !record)) {
    throw new Error("Unexpected record entry in Keeper Commander output.");
  }
  return records as JsonObject[];
}

function listedFolders(output: string): JsonObject[] {
  const parsed = parseJson(output, "folder list");
  if (isEmptyList(parsed)) return [];
  const root = object(parsed);
  const rows = Array.isArray(parsed) ? parsed : root?.["folders"];
  if (!Array.isArray(rows)) throw new Error("Unexpected folder list output from Keeper Commander.");
  const folders = rows.map(object);
  if (folders.some((folder) => !folder)) {
    throw new Error("Unexpected folder entry in Keeper Commander output.");
  }
  return folders as JsonObject[];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fieldValue(raw: JsonObject, ...types: string[]): string | undefined {
  const fields = Array.isArray(raw["fields"]) ? raw["fields"] : [];
  for (const candidate of fields) {
    const field = object(candidate);
    if (!field || !types.includes(string(field["type"]) ?? "")) continue;
    const value = field["value"];
    const firstValue = Array.isArray(value) ? value[0] : value;
    const nested = object(firstValue);
    if (nested) {
      const text = Object.values(nested).map(string).find(Boolean);
      if (text) return text;
    }
    const text = string(firstValue);
    if (text) return text;
  }
  return undefined;
}

function normalizeRecord(raw: JsonObject): JsonObject {
  const recordType = string(raw["record_type"] ?? raw["type"])?.toLowerCase();
  const isCard = recordType === "bankcard" || recordType === "paymentcard";
  const isNote =
    recordType === "encryptednotes" || recordType === "securenote" || recordType === "note";
  const isLogin = recordType === "login" || recordType === "" || recordType === undefined;
  const customFields: Record<string, unknown> = {};
  const rawCustom = raw["custom_fields"] ?? raw["custom"];
  if (rawCustom && typeof rawCustom === "object" && !Array.isArray(rawCustom)) {
    Object.assign(customFields, rawCustom);
  } else if (Array.isArray(rawCustom)) {
    for (const fieldValue of rawCustom) {
      const field = object(fieldValue);
      const name = string(field?.["name"] ?? field?.["type"]);
      if (name && field) customFields[name] = field["value"];
    }
  }
  const totp = string(raw["totp"]) ?? fieldValue(raw, "oneTimeCode");
  if (totp) customFields["TOTP"] = totp;

  const folder = object(raw["folder"]);
  const path = string(folder?.["path"])?.replace(/\\/g, "/");
  const unsupportedType = !isCard && !isNote && !isLogin;
  return {
    title: string(raw["title"]) ?? "Untitled",
    login: unsupportedType ? undefined : (string(raw["login"]) ?? fieldValue(raw, "login")),
    password: unsupportedType
      ? undefined
      : (string(raw["password"]) ?? fieldValue(raw, "password")),
    login_url: unsupportedType ? undefined : (string(raw["login_url"]) ?? fieldValue(raw, "url")),
    notes: unsupportedType ? JSON.stringify(raw, null, 2) : string(raw["notes"]),
    custom_fields: customFields,
    ...(Array.isArray(raw["fields"]) ? { fields: raw["fields"] } : {}),
    $type: isCard ? "paymentCard" : isLogin ? "login" : "note",
    folders: path && path !== "/" ? [{ folder: path }] : [],
  };
}

export const keeperProvider: VendorCliProvider = {
  id: "keeper",
  displayName: "Keeper Commander",
  binary: BIN,
  unsupportedReason: {
    write:
      "Keeper Commander record reads are available, but vaultlint has no guarded write-back adapter for Keeper.",
  },

  async ensureReady(runner: CommandRunner) {
    // Folder listing is read-only and verifies Commander is configured and authenticated.
    await runChecked(runner, BIN, ["folder", "list", "--json"]);
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    const listed = listedRecords(
      await runChecked(runner, BIN, ["list", "--format=json", "--verbose"]),
    );
    const folders = listedFolders(await runChecked(runner, BIN, ["folder", "list", "--json"]));
    const recordIds = new Set<string>();
    for (const reference of listed) {
      const uid = string(reference["record_uid"] ?? reference["uid"]);
      if (!uid) throw new Error("A Keeper Commander record did not include a UID.");
      recordIds.add(uid);
    }
    // `list` covers the current folder. Each folder's JSON details include its
    // record UIDs, so walk those references and deduplicate before reading.
    for (const folderReference of folders) {
      const folderUid = string(folderReference["folder_uid"] ?? folderReference["uid"]);
      if (!folderUid) throw new Error("A Keeper Commander folder did not include a UID.");
      const folder = object(
        parseJson(
          await runChecked(runner, BIN, ["get", folderUid, "--format=json"]),
          "folder details",
        ),
      );
      if (!folder || string(folder["folder_uid"] ?? folder["uid"]) !== folderUid) {
        throw new Error(
          "Keeper Commander returned incomplete folder details; no audit was started.",
        );
      }
      const folderRecords = Array.isArray(folder["records"]) ? folder["records"] : [];
      for (const row of folderRecords) {
        const record = object(row);
        const uid = string(record?.["record_uid"] ?? record?.["uid"]);
        if (!uid) throw new Error("A Keeper Commander folder record did not include a UID.");
        recordIds.add(uid);
      }
    }

    const records: JsonObject[] = [];
    for (const uid of recordIds) {
      const detail = object(
        parseJson(
          await runChecked(runner, BIN, ["get", uid, "--unmask", "--legacy", "--format=json"]),
          "record details",
        ),
      );
      if (!detail || string(detail["record_uid"]) !== uid) {
        throw new Error(
          "Keeper Commander returned incomplete record details; no audit was started.",
        );
      }
      records.push(normalizeRecord(detail));
    }
    return { content: JSON.stringify({ records }), format: "keeper-json" };
  },
};

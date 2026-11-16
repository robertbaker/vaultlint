import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "dcli";
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const ITEM_KEYS = [
  "title",
  "name",
  "id",
  "password",
  "login",
  "username",
  "email",
  "domain",
  "url",
  "urls",
  "website",
  "content",
  "note",
  "notes",
];

function parseRows(output: string, what: string): JsonObject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch {
    throw new Error(`Could not read ${what} from the Dashlane CLI (output was not JSON).`);
  }
  if (Array.isArray(parsed)) {
    const rows = parsed.map(object);
    if (rows.some((row) => row === undefined)) {
      throw new Error(`Unexpected entry in ${what} output from the Dashlane CLI.`);
    }
    return rows as JsonObject[];
  }
  const root = object(parsed);
  if (!root) throw new Error(`Unexpected ${what} output from the Dashlane CLI.`);
  for (const key of ["items", "results", "data"]) {
    if (Array.isArray(root[key])) {
      const rows = (root[key] as unknown[]).map(object);
      if (rows.some((row) => row === undefined)) {
        throw new Error(`Unexpected entry in ${what} output from the Dashlane CLI.`);
      }
      return rows as JsonObject[];
    }
  }
  // Dashlane's CLI can return a single object when a query matches one entry. Status/error
  // envelopes (for example `{"status":"locked"}`) must fail instead of becoming a vault row.
  const looksLikeEntry = ITEM_KEYS.some((key) => root[key] !== undefined && root[key] !== null);
  const looksLikeStatus = typeof root["status"] === "string" || root["error"] !== undefined;
  if (!looksLikeEntry || (looksLikeStatus && !first(root, "title", "name", "id"))) {
    const status = str(root["status"]) ?? str(root["error"]);
    throw new Error(
      `The Dashlane CLI did not return ${what}${status ? ` (status: ${status.slice(0, 80)})` : ""}. Make sure the vault is unlocked and synced.`,
    );
  }
  return [root];
}

function first(row: JsonObject, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizePasswords(rows: JsonObject[]): JsonObject[] {
  return rows.map((row) => {
    const urls = first(row, "urls", "url", "domain", "website");
    const domain = Array.isArray(urls) ? urls.find((url) => typeof url === "string") : urls;
    return {
      title: str(first(row, "title", "name")) ?? "Untitled",
      domain: typeof domain === "string" ? domain : undefined,
      login: str(first(row, "login", "username")),
      secondaryLogin: str(first(row, "secondaryLogin", "username2")),
      email: str(first(row, "email")),
      password: str(first(row, "password")),
      note: str(first(row, "note", "notes")),
      otpSecret: str(first(row, "otpSecret", "otpUrl", "totp", "otp")),
      category: str(first(row, "category", "folder", "collection")),
    };
  });
}

function normalizeNotes(rows: JsonObject[]): JsonObject[] {
  return rows.map((row) => ({
    title: str(first(row, "title", "name")) ?? "Secure Note",
    content: str(first(row, "content", "note", "text")) ?? "",
    category: str(first(row, "category", "folder", "collection")),
  }));
}

function structuredItemAsNote(
  row: JsonObject,
  index: number,
  category: "Secrets" | "Personal IDs",
): JsonObject {
  const title = str(first(row, "title", "name")) ?? `${category.slice(0, -1)} ${index + 1}`;
  // Keep the complete CLI JSON for structured item types instead of silently
  // discarding fields that the portable login/note schema cannot represent.
  return {
    title,
    content: JSON.stringify(row, null, 2),
    category,
  };
}

export const dashlaneProvider: VendorCliProvider = {
  id: "dashlane",
  displayName: "Dashlane",
  binary: BIN,
  unsupportedReason: {
    write:
      "Dashlane CLI vault access is read-only. The portable JSON adapter cannot represent every Dashlane item type, so payment cards are not imported by the CLI path and secrets/personal IDs are retained as JSON secure notes.",
  },

  async ensureReady(runner: CommandRunner) {
    // This checks the registered CLI device without syncing or printing vault items.
    await runChecked(runner, BIN, ["devices", "list", "--json"]);
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    // Refresh the encrypted local CLI cache before reading its item JSON.
    await runChecked(runner, BIN, ["sync"]);
    const [passwordOutput, noteOutput, secretOutput, identityOutput] = await Promise.all([
      runChecked(runner, BIN, ["password", "-o", "json"]),
      runChecked(runner, BIN, ["note", "-o", "json"]),
      runChecked(runner, BIN, ["secret", "-o", "json"]),
      runChecked(runner, BIN, ["id", "-o", "json"]),
    ]);
    const passwords = normalizePasswords(parseRows(passwordOutput, "password list"));
    const notes = normalizeNotes(parseRows(noteOutput, "secure note list"));
    const secrets = parseRows(secretOutput, "secret list").map((row, index) =>
      structuredItemAsNote(row, index, "Secrets"),
    );
    const personalIds = parseRows(identityOutput, "personal ID list").map((row, index) =>
      structuredItemAsNote(row, index, "Personal IDs"),
    );
    return {
      content: JSON.stringify({
        AUTHENTIFIANT: passwords,
        NOTE: [...notes, ...secrets, ...personalIds],
      }),
      format: "dashlane-json",
    };
  },
};

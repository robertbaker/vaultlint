import type { VaultData, VaultItem } from "@vaultlint/vault-schema";
import * as z from "zod";

import {
  getRecordField,
  hasAllHeaders,
  parseCsvRecords,
  parseCsvRows,
  serializeCsvRecords,
} from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

function getKeeperExportWarnings(vault: VaultData, csv: boolean): string[] {
  const warnings: string[] = [];
  const items = vault.items;
  if (items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
    warnings.push(`Keeper ${csv ? "CSV" : "JSON"} preserves only the primary URI for each item.`);
  }
  if (
    items.some((item) =>
      item.login?.uris?.some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push(`Keeper ${csv ? "CSV" : "JSON"} does not preserve URI match settings.`);
  }
  if (
    items.some(
      (item) =>
        (csv && item.type !== undefined && item.type !== 1) ||
        (csv && item.card) ||
        item.identity ||
        (item.type !== undefined && item.type === 4),
    )
  ) {
    warnings.push(
      csv
        ? "Keeper CSV does not preserve item types, card and identity details."
        : "Keeper JSON does not preserve identity fields.",
    );
  }
  if (
    items.some(
      (item) =>
        item.id ||
        item.favorite ||
        item.reprompt ||
        item.organizationId ||
        item.collectionIds?.length ||
        item.creationDate ||
        item.deletedDate ||
        item.lastModified ||
        item.revisionDate ||
        item.passwordHistory?.length ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    warnings.push(`Keeper ${csv ? "CSV" : "JSON"} omits favorites, item IDs, and other metadata.`);
  }
  if (csv && items.some((item) => item.login?.totp)) {
    warnings.push("Keeper CSV does not preserve TOTP secrets.");
  }
  if (items.some((item) => item.fields?.length)) {
    warnings.push(
      csv
        ? "Keeper CSV does not preserve custom fields."
        : "Keeper JSON does not preserve custom-field types or linked IDs.",
    );
  }
  return warnings;
}

const KEEPER_CSV_HEADERS = [
  "Folder",
  "Title",
  "Login",
  "Password",
  "Website Address",
  "Notes",
] as const;

const keeperRecordSchema = z
  .object({
    title: z.string().nullish(),
    login: z.string().nullish(),
    password: z.string().nullish(),
    login_url: z.string().nullish(),
    notes: z.string().nullish(),
    custom_fields: z.record(z.string(), z.unknown()).nullish(),
    folders: z.array(z.record(z.string(), z.unknown())).nullish(),
    fields: z
      .array(z.object({ type: z.string().nullish(), value: z.unknown() }).passthrough())
      .nullish(),
    $type: z.string().nullish(),
  })
  .passthrough();

const keeperJsonSchema = z
  .object({
    records: z.array(keeperRecordSchema),
    shared_folders: z.array(z.object({ path: z.string() }).passthrough()).nullish(),
  })
  .passthrough();

function keeperText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(keeperText).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.values(record).map(keeperText).filter(Boolean).join("\n");
  }
  return "";
}

function keeperCardValue(record: Record<string, unknown>, fieldName: string): string {
  const values = Array.isArray(record["fields"]) ? record["fields"] : [];
  for (const field of values) {
    if (!field || typeof field !== "object") continue;
    const data = (field as Record<string, unknown>)["value"];
    const candidates = Array.isArray(data) ? data : [data];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object" && fieldName in candidate) {
        return keeperText((candidate as Record<string, unknown>)[fieldName]);
      }
    }
  }
  return "";
}

export const keeperJsonAdapter: VaultFormatAdapter = {
  info: {
    id: "keeper-json",
    name: "Keeper JSON",
    provider: "Keeper",
    extensions: [".json"],
    mimeType: "application/json",
    description: "Keeper JSON export",
  },
  detect(ctx: VaultParseContext): number {
    return keeperJsonSchema.safeParse(ctx.json).success ? 0.99 : 0;
  },
  parse(ctx: VaultParseContext) {
    const parsed = keeperJsonSchema.safeParse(ctx.json);
    if (!parsed.success) throw new Error("Invalid Keeper JSON: expected a records array.");
    const folders = new FolderRegistry();
    const items = parsed.data.records.map((record, index) => {
      const folderPaths = (record.folders ?? [])
        .flatMap((folder) => [folder["shared_folder"], folder["folder"]])
        .filter((path): path is string => typeof path === "string" && path !== "")
        .map((path) => path.split("/").filter(Boolean).join(" / "));
      const folderId = folders.getOrCreate(folderPaths[0]);
      const rawType = record.$type?.toLowerCase() ?? "login";
      const type = rawType === "paymentcard" ? 3 : rawType === "note" ? 2 : 1;
      const custom = record.custom_fields ?? {};
      // Real exports key typed fields as `$<type>:<label>:<index>`; TOTP is `$oneTimeCode::1`.
      const oneTimeKey = Object.keys(custom).find((name) => /^\$oneTimeCode(?::|$)/.test(name));
      const totp = keeperText(
        custom["TOTP"] ?? custom["TOTP Secret"] ?? (oneTimeKey ? custom[oneTimeKey] : undefined),
      );
      const item = makeLoginItem({
        id: `keeper-json-${index + 1}`,
        name: record.title ?? "Untitled",
        username: record.login ?? "",
        password: record.password ?? "",
        uris: [record.login_url ?? ""].filter(Boolean),
        totp,
        notes: record.notes ?? keeperText(custom["$note"]),
        folderId,
        type,
      });
      if (type === 3) {
        const number = keeperCardValue(record, "cardNumber");
        const expiry = keeperCardValue(record, "cardExpirationDate");
        const [expMonth = "", expYear = ""] = expiry.split(/[/-]/);
        item.card = {
          number,
          cardholderName: keeperCardValue(record, "cardholderName"),
          code: keeperCardValue(record, "cardSecurityCode"),
          expMonth,
          expYear,
        };
      }
      const fields = Object.entries(custom)
        .filter(
          ([name]) =>
            name !== "TOTP" && name !== "TOTP Secret" && name !== "$note" && name !== oneTimeKey,
        )
        .map(([name, value]) => ({
          name,
          value: keeperText(value),
          type: /password|secret|pin|code|token/i.test(name) ? 1 : 0,
        }))
        .filter((field) => field.value);
      if (fields.length) item.fields = fields;
      if (folderPaths.length > 1) {
        item.fields = [
          ...(item.fields ?? []),
          { name: "Keeper folders", value: folderPaths.slice(1).join(", ") },
        ];
      }
      return item;
    });
    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "keeper-json",
      providerName: "Keeper",
      formatName: "Keeper JSON",
      warnings: [],
    };
  },
  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => {
      const custom_fields: Record<string, string> = {};
      if (item.login?.totp) custom_fields["TOTP"] = item.login.totp;
      for (const field of item.fields ?? []) {
        if (field.name !== "Keeper folders") custom_fields[field.name] = field.value;
      }
      const record: Record<string, unknown> = {
        title: item.name ?? "",
        notes: item.notes ?? "",
        folders: item.folderId ? [{ folder: getItemFolderName(item, folderMap) }] : [],
        $type: item.type === 3 ? "paymentCard" : item.type === 2 ? "note" : "login",
      };
      if (item.type === 3) {
        record["fields"] = [
          {
            type: "paymentCard",
            value: [
              {
                cardNumber: item.card?.number ?? "",
                cardExpirationDate:
                  item.card?.expMonth && item.card?.expYear
                    ? `${item.card.expMonth}/${item.card.expYear}`
                    : "",
                cardSecurityCode: item.card?.code ?? "",
                cardholderName: item.card?.cardholderName ?? "",
              },
            ],
          },
        ];
      } else if (item.type === 1 || (item.type === undefined && item.login)) {
        record["login"] = item.login?.username ?? "";
        record["password"] = item.login?.password ?? "";
        record["login_url"] = getPrimaryUri(item);
      }
      if (Object.keys(custom_fields).length) record["custom_fields"] = custom_fields;
      return record;
    });
    return {
      content: JSON.stringify({ records }, null, 2),
      mimeType: "application/json",
      extension: "json",
      format: "keeper-json",
      warnings: getKeeperExportWarnings(vault, false),
    };
  },
};

const KEEPER_URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+$/i;

/**
 * Real Keeper CSV exports have no header row: Folder, Title, Login, Password, Website Address,
 * Notes, Shared Folder, then custom field name/value pairs. Detect conservatively: every row has at
 * least six columns and every Website Address cell is empty or a URL, with at least one URL.
 */
function looksLikeHeaderlessKeeper(rows: string[][]): boolean {
  if (rows.length === 0 || rows.some((row) => row.length < 6)) return false;
  let urls = 0;
  for (const row of rows) {
    const url = row[4].trim();
    if (url === "") continue;
    if (!KEEPER_URL_LIKE.test(url)) return false;
    urls++;
  }
  return urls > 0;
}

function parseHeaderlessKeeperCsv(rows: string[][]) {
  const folders = new FolderRegistry();
  const items = rows.map((row, idx) => {
    const url = row[4].trim();
    const regularFolder = row[0].trim();
    const sharedFolder = row[6]?.trim() ?? "";
    const item = makeLoginItem({
      id: `keeper-${idx + 1}`,
      name: row[1].trim() || url || "Untitled",
      username: row[2],
      password: row[3],
      uris: url ? [url] : [],
      notes: row[5],
      folderId: folders.getOrCreate(sharedFolder || regularFolder),
    });
    const fields: NonNullable<VaultItem["fields"]> = [];
    if (sharedFolder && regularFolder) {
      fields.push({ name: "Keeper folders", value: regularFolder, type: 0 });
    }
    for (let i = 7; i + 1 < row.length; i += 2) {
      const name = row[i].trim();
      if (name && row[i + 1]) fields.push({ name, value: row[i + 1], type: 0 });
    }
    if (fields.length) item.fields = fields;
    return item;
  });
  return {
    vault: { encrypted: false, folders: folders.list(), items },
    format: "keeper-csv" as const,
    providerName: "Keeper",
    formatName: "Keeper CSV",
    warnings: [
      "Keeper CSV has no header row; columns were read as Folder, Title, Login, Password, Website Address, Notes, Shared Folder, then custom field pairs.",
    ],
  };
}

export const keeperCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "keeper-csv",
    name: "Keeper CSV",
    provider: "Keeper",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Keeper Password Manager unencrypted CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (hasAllHeaders(headers, ["Title", "Login", "Password", "Website Address"])) {
      return 0.97;
    }
    return looksLikeHeaderlessKeeper(parseCsvRows(ctx.text)) ? 0.6 : 0;
  },

  parse(ctx: VaultParseContext) {
    const text = ctx.text ?? "";
    const { headers, records } = parseCsvRecords(text);
    if (!hasAllHeaders(headers, ["Title", "Login", "Password", "Website Address"])) {
      const rows = parseCsvRows(text);
      if (looksLikeHeaderlessKeeper(rows)) return parseHeaderlessKeeperCsv(rows);
    }
    const folders = new FolderRegistry();
    const items: VaultItem[] = records.map((rec, idx) => {
      const folderId = folders.getOrCreate(getRecordField(rec, "Folder"));
      const url = getRecordField(rec, "Website Address");
      return makeLoginItem({
        id: `keeper-${idx + 1}`,
        name: getRecordField(rec, "Title") || url || "Untitled",
        username: getRecordField(rec, "Login"),
        password: getRecordField(rec, "Password"),
        uris: url ? [url] : [],
        notes: getRecordField(rec, "Notes"),
        folderId,
      });
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "keeper-csv",
      providerName: "Keeper",
      formatName: "Keeper CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => ({
      Folder: getItemFolderName(item, folderMap),
      Title: item.name ?? "",
      Login: item.login?.username ?? "",
      Password: item.login?.password ?? "",
      "Website Address": getPrimaryUri(item),
      Notes: item.notes ?? "",
    }));

    return {
      content: serializeCsvRecords(KEEPER_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "keeper-csv",
      warnings: getKeeperExportWarnings(vault, true),
    };
  },
};

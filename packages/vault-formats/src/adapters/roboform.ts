import type { VaultData, VaultItem } from "@vaultlint/vault-schema";
import * as z from "zod";

import { escapeCsvCell, hasAllHeaders, parseCsv } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

const ROBOFORM_HEADERS = [
  "Name",
  "Url",
  "MatchUrl",
  "Login",
  "Pwd",
  "Note",
  "Folder",
  "RfFieldsV2",
] as const;

const roboFormHeaderSchema = z.array(z.string()).superRefine((headers, context) => {
  if (!hasAllHeaders(headers, ["name", "url", "login", "note", "folder"])) {
    context.addIssue({ code: "custom", message: "Missing RoboForm CSV columns." });
  }
});
const roboFormRowSchema = z.array(z.string());
const FIELD = /^([^,]*),[^,]*,[^,]*,([^,]*),([\s\S]*)$/;

/** RoboForm prefixes values that start with a formula character with `'` (CSV-injection guard). */
const GUARDED_VALUE = /^'*[=+\-@]/;

function unquote(value: string): string {
  return value.startsWith("'") && GUARDED_VALUE.test(value.slice(1)) ? value.slice(1) : value;
}

/** Inverse of `unquote`: re-add the guard quote when the value would otherwise be mis-read. */
function quoteGuard(value: string): string {
  return GUARDED_VALUE.test(value) ? `'${value}` : value;
}

/** Field names live inside a comma-separated cell, so commas cannot be represented in them. */
function safeFieldName(name: string): string {
  return name.replace(/,/g, ";");
}

function splitFields(cells: readonly string[], username: string, password: string) {
  let totp: string | undefined;
  const fields: NonNullable<VaultItem["fields"]> = [];
  for (const cell of cells) {
    const match = FIELD.exec(cell);
    if (!match) {
      if (cell) fields.push({ name: "Field", value: cell });
      continue;
    }
    const [, rawName = "", rawType = "", rawValue = ""] = match;
    const name = rawName.trim();
    const type = rawType.trim().toLowerCase();
    const value = unquote(rawValue);
    if (name === "TOTP KEY$" && !totp) {
      totp = value;
    } else if (name === "User ID$") {
      if (value !== username) fields.push({ name: "Username", value });
    } else if (name === "Password$") {
      if (value !== password) fields.push({ name: "Password", value, type: 1 });
    } else {
      fields.push({
        name: !name || name === "-no-name-" ? "Field" : name,
        value,
        type: type === "pwd" ? 1 : 0,
      });
    }
  }
  return { totp, fields };
}

export const roboFormCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "roboform-csv",
    name: "RoboForm CSV",
    provider: "RoboForm",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "RoboForm unencrypted CSV export",
  },
  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsv(ctx.text);
    return roboFormHeaderSchema.safeParse(headers).success ? 0.98 : 0;
  },
  parse(ctx: VaultParseContext) {
    const { headers, rows } = parseCsv(ctx.text ?? "");
    if (!roboFormHeaderSchema.safeParse(headers).success) {
      throw new Error("Invalid RoboForm CSV: expected Name, Url, Login, Note, and Folder columns.");
    }
    const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
    const col = (...names: string[]) =>
      normalizedHeaders.findIndex((header) => names.includes(header));
    const cols = {
      name: col("name"),
      url: col("url"),
      matchUrl: col("matchurl"),
      username: col("login"),
      password: col("pwd", "password"),
      note: col("note"),
      folder: col("folder"),
      fields: col("rffieldsv2", "rf_fields"),
    };
    const at = (row: string[], index: number) => (index < 0 ? "" : (row[index] ?? ""));
    const folders = new FolderRegistry();
    const items: VaultItem[] = [];
    let skipped = 0;
    let foldered = 0;
    for (const rawRow of rows) {
      const row = roboFormRowSchema.parse(rawRow);
      const name = at(row, cols.name).trim();
      const url = at(row, cols.url);
      const matchUrl = at(row, cols.matchUrl);
      const username = unquote(at(row, cols.username));
      const password = unquote(at(row, cols.password));
      const notes = at(row, cols.note);
      const folderPath = at(row, cols.folder).split("/").filter(Boolean).join(" / ");
      const folderId = folders.getOrCreate(folderPath);
      const fieldCells = cols.fields < 0 ? [] : row.slice(cols.fields).filter(Boolean);

      if (
        !name &&
        !url &&
        !matchUrl &&
        !username &&
        !password &&
        !notes &&
        fieldCells.length === 0
      ) {
        skipped++;
        continue;
      }
      const { totp, fields } = splitFields(fieldCells, username, password);
      const urls = [...new Set([url, matchUrl].filter(Boolean))];
      const isLogin = Boolean(matchUrl || username || password || totp);
      const isBookmark = !isLogin && Boolean(url);
      const item = makeLoginItem({
        id: `roboform-${items.length + 1}`,
        name: name || (isBookmark ? url : "Untitled"),
        username,
        password,
        uris: isBookmark ? [] : urls,
        totp,
        notes,
        folderId,
        type: isLogin ? 1 : 2,
      });
      if (isBookmark) item.fields = [{ name: "URL", value: url }];
      else if (fields.length) item.fields = fields;
      items.push(item);
      if (folderId) foldered++;
    }
    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "roboform-csv",
      providerName: "RoboForm",
      formatName: "RoboForm CSV",
      warnings: [
        ...(foldered
          ? [`${foldered} RoboForm folder path(s) were flattened to folder names.`]
          : []),
        ...(items.some((item) => item.type !== 1 && item.type !== 2)
          ? ["RoboForm CSV omits payment cards and identities."]
          : []),
      ],
    };
  },
  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const rows = vault.items
      .filter((item) => item.type === 1 || item.type === 2)
      .map((item) => {
        const url =
          getPrimaryUri(item) ||
          (item.type === 2
            ? (item.fields?.find((field) => field.name === "URL")?.value ?? "")
            : "");
        const fieldCells: string[] = [];
        if (item.login?.username)
          fieldCells.push(`User ID$,,,txt,${quoteGuard(item.login.username)}`);
        if (item.login?.password)
          fieldCells.push(`Password$,,,pwd,${quoteGuard(item.login.password)}`);
        if (item.login?.totp) fieldCells.push(`TOTP KEY$,,,txt,${quoteGuard(item.login.totp)}`);
        for (const field of item.fields ?? []) {
          if (field.name !== "URL")
            fieldCells.push(
              `${safeFieldName(field.name)},,,${field.type === 1 ? "pwd" : "txt"},${quoteGuard(field.value)}`,
            );
        }
        const record = {
          Name: item.name ?? "",
          Url: url,
          MatchUrl: url,
          Login: quoteGuard(item.login?.username ?? ""),
          Pwd: quoteGuard(item.login?.password ?? ""),
          Note: item.notes ?? "",
          Folder: getItemFolderName(item, folderMap),
          RfFieldsV2: "",
        };
        return [
          ROBOFORM_HEADERS.slice(0, 7)
            .map((header) => escapeCsvCell(record[header]))
            .join(","),
          ...fieldCells.map(escapeCsvCell),
        ].join(",");
      });
    const content = [ROBOFORM_HEADERS.join(","), ...rows].join("\n") + "\n";
    return {
      content,
      mimeType: "text/csv",
      extension: "csv",
      format: "roboform-csv",
      warnings: [
        ...(vault.items.some((item) => item.type !== 1 && item.type !== 2)
          ? ["RoboForm CSV omits payment cards, identities, and other non-login items."]
          : []),
        ...(vault.items.some((item) => item.fields?.some((field) => field.name.includes(",")))
          ? ["RoboForm CSV replaces commas in custom-field names with semicolons."]
          : []),
      ],
    };
  },
};

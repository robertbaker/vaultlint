import type { VaultData, VaultItem } from "@vaultlint/vault-schema";
import * as z from "zod";

import { getRecordField, parseCsvRecords, serializeCsvRecords } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

interface DashlaneJsonEntry {
  title?: string;
  domain?: string;
  login?: string;
  secondaryLogin?: string;
  email?: string;
  password?: string;
  note?: string;
  otpSecret?: string;
  category?: string;
}

function getDashlaneExportWarnings(vault: VaultData): string[] {
  const warnings: string[] = [];
  if (vault.items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
    warnings.push("Dashlane exports preserve only the primary URI for each item.");
  }
  if (
    vault.items.some((item) =>
      item.login?.uris?.some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push("Dashlane exports do not preserve URI match settings.");
  }
  if (vault.items.some((item) => item.type !== undefined && item.type !== 1 && item.type !== 2)) {
    warnings.push(
      "Dashlane exports do not preserve card, identity, or other non-login item details.",
    );
  }
  if (
    vault.items.some(
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
        item.fields?.length ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    warnings.push("Dashlane exports omit favorites, custom fields, item IDs, and other metadata.");
  }
  return warnings;
}

const dashlaneJsonSchema = z
  .object({
    AUTHENTIFIANT: z
      .array(
        z
          .object({
            title: z.string().nullish(),
            domain: z.string().nullish(),
            login: z.string().nullish(),
            secondaryLogin: z.string().nullish(),
            email: z.string().nullish(),
            password: z.string().nullish(),
            note: z.string().nullish(),
            otpSecret: z.string().nullish(),
            category: z.string().nullish(),
          })
          .passthrough(),
      )
      .optional(),
    NOTE: z
      .array(
        z
          .object({
            title: z.string().nullish(),
            content: z.string().nullish(),
            category: z.string().nullish(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export const dashlaneJsonAdapter: VaultFormatAdapter = {
  info: {
    id: "dashlane-json",
    name: "Dashlane JSON",
    provider: "Dashlane",
    extensions: [".json"],
    mimeType: "application/json",
    description: "Dashlane unencrypted JSON export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.json || typeof ctx.json !== "object" || Array.isArray(ctx.json)) return 0;
    const parsed = dashlaneJsonSchema.safeParse(ctx.json);
    if (parsed.success && Array.isArray(parsed.data.AUTHENTIFIANT)) return 0.96;
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const parsed = dashlaneJsonSchema.safeParse(ctx.json);
    if (!parsed.success || !Array.isArray(parsed.data.AUTHENTIFIANT)) {
      throw new Error('Invalid Dashlane JSON: missing "AUTHENTIFIANT" array.');
    }
    const obj = parsed.data;

    const folders = new FolderRegistry();
    const items: VaultItem[] = (obj.AUTHENTIFIANT ?? []).map((entry, idx) => {
      const folderId = folders.getOrCreate(entry.category);
      const url = entry.domain
        ? entry.domain.includes("://")
          ? entry.domain
          : `https://${entry.domain}`
        : "";
      return makeLoginItem({
        id: `dashlane-json-${idx + 1}`,
        name: entry.title || entry.domain || "Untitled",
        username: entry.login || entry.email || entry.secondaryLogin || "",
        password: entry.password || "",
        uris: url ? [url] : [],
        totp: entry.otpSecret || "",
        notes: entry.note || "",
        folderId,
      });
    });

    for (const note of obj.NOTE ?? []) {
      const folderId = folders.getOrCreate(note.category);
      items.push(
        makeLoginItem({
          id: `dashlane-note-${items.length + 1}`,
          name: note.title || "Secure Note",
          notes: note.content || "",
          folderId,
          type: 2,
        }),
      );
    }

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "dashlane-json",
      providerName: "Dashlane",
      formatName: "Dashlane JSON",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const entries: DashlaneJsonEntry[] = vault.items
      .filter((item) => item.type !== 2)
      .map((item) => ({
        title: item.name ?? "",
        domain: getPrimaryUri(item),
        login: item.login?.username ?? "",
        password: item.login?.password ?? "",
        note: item.notes ?? "",
        otpSecret: item.login?.totp ?? "",
        category: getItemFolderName(item, folderMap),
      }));
    const notes = vault.items
      .filter((item) => item.type === 2)
      .map((item) => ({
        title: item.name ?? "",
        content: item.notes ?? "",
        category: getItemFolderName(item, folderMap),
      }));

    return {
      content: JSON.stringify(
        { AUTHENTIFIANT: entries, ...(notes.length ? { NOTE: notes } : {}) },
        null,
        2,
      ),
      mimeType: "application/json",
      extension: "json",
      format: "dashlane-json",
      warnings: getDashlaneExportWarnings(vault),
    };
  },
};

const DASHLANE_CSV_HEADERS = [
  "type",
  "username",
  "username2",
  "username3",
  "title",
  "password",
  "note",
  "url",
  "category",
  "otpSecret",
] as const;

const dashlaneCsvHeaderSchema = z.array(z.string()).superRefine((headers, context) => {
  const present = new Set(headers.map((header) => header.trim().toLowerCase()));
  const template = ["type", "name", "url", "username", "password", "note", "totp", "collections"];
  const standard = ["username", "username2", "title", "password", "url"];
  const old = ["title", "password", "url", "otpsecret"];
  if (![template, standard, old].some((required) => required.every((key) => present.has(key)))) {
    context.addIssue({ code: "custom", message: "Missing Dashlane CSV columns." });
  }
});

export const dashlaneCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "dashlane-csv",
    name: "Dashlane CSV",
    provider: "Dashlane",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Dashlane unencrypted CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    return dashlaneCsvHeaderSchema.safeParse(headers).success ? 0.97 : 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    const items: VaultItem[] = records.map((rec, idx) => {
      const folderId = folders.getOrCreate(getRecordField(rec, "category", "collections"));
      const url = getRecordField(rec, "url");
      const rawType = getRecordField(rec, "Type").trim().toLowerCase();
      const itemType = rawType.includes("note") ? 2 : 1;
      if (itemType === 2) {
        return makeLoginItem({
          id: `dashlane-csv-${idx + 1}`,
          name: getRecordField(rec, "name", "title") || "Secure Note",
          notes: getRecordField(rec, "note", "content"),
          folderId,
          type: 2,
        });
      }
      return makeLoginItem({
        id: `dashlane-csv-${idx + 1}`,
        name: getRecordField(rec, "title", "name") || url || "Untitled",
        username:
          getRecordField(rec, "username") ||
          getRecordField(rec, "username2") ||
          getRecordField(rec, "username3") ||
          getRecordField(rec, "email"),
        password: getRecordField(rec, "password"),
        uris: url ? [url] : [],
        totp:
          getRecordField(rec, "otpUrl") ||
          getRecordField(rec, "otpSecret") ||
          getRecordField(rec, "totp"),
        notes: getRecordField(rec, "note"),
        folderId,
        type: itemType,
      });
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "dashlane-csv",
      providerName: "Dashlane",
      formatName: "Dashlane CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => ({
      type: item.type === 2 ? "note" : "password",
      username: item.login?.username ?? "",
      username2: "",
      username3: "",
      title: item.name ?? "",
      password: item.login?.password ?? "",
      note: item.notes ?? "",
      url: getPrimaryUri(item),
      category: getItemFolderName(item, folderMap),
      otpSecret: item.login?.totp ?? "",
    }));

    return {
      content: serializeCsvRecords(DASHLANE_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "dashlane-csv",
      warnings: getDashlaneExportWarnings(vault),
    };
  },
};

import type { VaultData, VaultItem } from "@vaultlint/vault-schema";

import { getRecordField, hasAllHeaders, parseCsvRecords, serializeCsvRecords } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

const LASTPASS_HEADERS = [
  "url",
  "username",
  "password",
  "totp",
  "extra",
  "name",
  "grouping",
  "fav",
] as const;

function getLastPassExportWarnings(vault: VaultData): string[] {
  const warnings: string[] = [];
  const items = vault.items;
  if (items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
    warnings.push("LastPass CSV preserves only the primary URI for each item.");
  }
  if (
    items.some((item) =>
      item.login?.uris?.some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push("LastPass CSV does not preserve URI match settings.");
  }
  if (
    items.some(
      (item) =>
        (item.type !== undefined && item.type !== 1 && item.type !== 2) ||
        item.card ||
        item.identity,
    )
  ) {
    warnings.push("LastPass CSV does not preserve cards, identities, or other item types.");
  }
  if (items.some((item) => item.type === 2 && !getPrimaryUri(item) && item.login?.password)) {
    warnings.push(
      "LastPass treats entries without a URL as secure notes; passwords on note items may be ignored by LastPass itself.",
    );
  }
  if (
    items.some(
      (item) =>
        item.id ||
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
    warnings.push("LastPass CSV omits custom fields, item IDs, and other metadata.");
  }
  return warnings;
}

export const lastpassCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "lastpass-csv",
    name: "LastPass CSV",
    provider: "LastPass",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "LastPass unencrypted CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (hasAllHeaders(headers, ["url", "username", "password", "extra", "grouping", "fav"])) {
      return 0.98;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    const items: VaultItem[] = records.map((rec, idx) => {
      const url = getRecordField(rec, "url").trim();
      const isNote = url === "http://sn" || url === "https://sn";
      const folderId = folders.getOrCreate(getRecordField(rec, "grouping"));
      const favRaw = getRecordField(rec, "fav").trim();
      return makeLoginItem({
        id: `lp-${idx + 1}`,
        name: getRecordField(rec, "name") || (isNote ? "Secure Note" : url || "Untitled"),
        username: getRecordField(rec, "username"),
        password: getRecordField(rec, "password"),
        uris: isNote || !url ? [] : [url],
        totp: getRecordField(rec, "totp"),
        notes: getRecordField(rec, "extra"),
        folderId,
        favorite: favRaw === "1" || favRaw.toLowerCase() === "true",
        type: isNote ? 2 : 1,
      });
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "lastpass-csv",
      providerName: "LastPass",
      formatName: "LastPass CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => {
      // Keep type-2 items as notes (even with a password) so they re-import as notes, not logins.
      const isNote = item.type === 2 && !getPrimaryUri(item);
      return {
        url: isNote ? "http://sn" : getPrimaryUri(item),
        username: item.login?.username ?? "",
        password: item.login?.password ?? "",
        totp: item.login?.totp ?? "",
        extra: item.notes ?? "",
        name: item.name ?? "",
        grouping: getItemFolderName(item, folderMap),
        fav: item.favorite ? "1" : "0",
      };
    });

    return {
      content: serializeCsvRecords(LASTPASS_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "lastpass-csv",
      warnings: getLastPassExportWarnings(vault),
    };
  },
};

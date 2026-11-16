import type { VaultData, VaultItem } from "@vaultlint/vault-schema";

import { getRecordField, hasAllHeaders, parseCsvRecords, serializeCsvRecords } from "../csv";
import { deriveNameFromUrl, getPrimaryUri, makeLoginItem } from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

const CHROME_CSV_HEADERS = ["name", "url", "username", "password", "note"] as const;

type BrowserCsvFormat = "Chrome CSV" | "Firefox CSV" | "Safari CSV";

function getBrowserCsvExportWarnings(vault: VaultData, format: BrowserCsvFormat): string[] {
  const warnings: string[] = [];
  const items = vault.items;
  if (items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
    warnings.push(`${format} preserves only the primary URI for each item.`);
  }
  if (
    items.some((item) =>
      item.login?.uris?.some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push(`${format} does not preserve URI match settings.`);
  }
  if (items.some((item) => item.type !== undefined && item.type !== 1)) {
    warnings.push(`${format} does not preserve item types or card and identity details.`);
  }
  if (
    items.some(
      (item) =>
        (format !== "Firefox CSV" && item.id) ||
        item.folderId ||
        item.favorite ||
        item.reprompt ||
        item.organizationId ||
        item.collectionIds?.length ||
        item.creationDate ||
        item.deletedDate ||
        (format !== "Firefox CSV" && item.lastModified) ||
        item.revisionDate ||
        item.passwordHistory?.length ||
        item.secureNote ||
        item.card ||
        item.identity ||
        item.fields?.length ||
        item._providerData ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    const idWarning = format === "Firefox CSV" ? "" : " item IDs,";
    warnings.push(
      `${format} omits folders, favorites, custom fields,${idWarning} and unsupported metadata.`,
    );
  }
  if (format === "Chrome CSV" && items.some((item) => item.login?.totp)) {
    warnings.push("Chrome CSV does not preserve TOTP secrets.");
  }
  if (format === "Firefox CSV") {
    if (items.some((item) => item.name)) {
      warnings.push("Firefox CSV does not preserve item names; imports derive names from URLs.");
    }
    if (items.some((item) => item.notes || item.login?.totp)) {
      warnings.push("Firefox CSV does not preserve notes or TOTP secrets.");
    }
  }
  return warnings;
}

export const chromeCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "chrome-csv",
    name: "Chrome / Edge CSV",
    provider: "Chrome / Edge",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Google Chrome, Microsoft Edge, or Brave password CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    const lower = headers.map((h) => h.toLowerCase());
    if (
      hasAllHeaders(headers, ["name", "url", "username", "password"]) &&
      lower.length <= 5 &&
      !lower.includes("vault") &&
      !lower.includes("grouping") &&
      !lower.includes("totp")
    ) {
      return 0.9;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const items: VaultItem[] = records.map((rec, idx) => {
      const url = getRecordField(rec, "url");
      return makeLoginItem({
        id: `chrome-${idx + 1}`,
        name: getRecordField(rec, "name") || deriveNameFromUrl(url),
        username: getRecordField(rec, "username"),
        password: getRecordField(rec, "password"),
        uris: url ? [url] : [],
        notes: getRecordField(rec, "note"),
      });
    });

    return {
      vault: { encrypted: false, folders: [], items },
      format: "chrome-csv",
      providerName: "Chrome / Edge",
      formatName: "Chrome / Edge CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const records = vault.items.map((item) => ({
      name: item.name ?? "",
      url: getPrimaryUri(item),
      username: item.login?.username ?? "",
      password: item.login?.password ?? "",
      note: item.notes ?? "",
    }));

    return {
      content: serializeCsvRecords(CHROME_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "chrome-csv",
      warnings: getBrowserCsvExportWarnings(vault, "Chrome CSV"),
    };
  },
};

const FIREFOX_CSV_HEADERS = [
  "url",
  "username",
  "password",
  "httpRealm",
  "formActionOrigin",
  "guid",
  "timeCreated",
  "timeLastUsed",
  "timePasswordChanged",
] as const;

export const firefoxCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "firefox-csv",
    name: "Firefox CSV",
    provider: "Firefox",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Mozilla Firefox password CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (hasAllHeaders(headers, ["url", "username", "password", "httpRealm", "formActionOrigin"])) {
      return 0.98;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const usedItemIds = new Set<string>();
    const items: VaultItem[] = records.map((rec, idx) => {
      const url = getRecordField(rec, "url");
      const changedRaw = getRecordField(rec, "timePasswordChanged");
      const changedMs = Number(changedRaw);
      const changedDate =
        Number.isFinite(changedMs) && changedMs > 0 ? new Date(changedMs) : undefined;
      const lastModified =
        changedDate && !Number.isNaN(changedDate.getTime()) ? changedDate.toISOString() : undefined;
      const baseId = getRecordField(rec, "guid") || `firefox-${idx + 1}`;
      let itemId = baseId;
      if (usedItemIds.has(itemId)) {
        itemId = `firefox:${baseId}`;
        let suffix = 2;
        while (usedItemIds.has(itemId)) itemId = `firefox:${baseId}:${suffix++}`;
      }
      usedItemIds.add(itemId);
      return makeLoginItem({
        id: itemId,
        name: deriveNameFromUrl(url),
        username: getRecordField(rec, "username"),
        password: getRecordField(rec, "password"),
        uris: url ? [url] : [],
        lastModified,
      });
    });

    return {
      vault: { encrypted: false, folders: [], items },
      format: "firefox-csv",
      providerName: "Firefox",
      formatName: "Firefox CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const now = String(Date.now());
    const records = vault.items.map((item, idx) => {
      const url = getPrimaryUri(item);
      const changedMs = item.lastModified
        ? String(new Date(item.lastModified).getTime() || Date.now())
        : now;
      return {
        url,
        username: item.login?.username ?? "",
        password: item.login?.password ?? "",
        httpRealm: "",
        formActionOrigin: url,
        guid: item.id || `{ff-${idx + 1}}`,
        timeCreated: now,
        timeLastUsed: now,
        timePasswordChanged: changedMs,
      };
    });

    return {
      content: serializeCsvRecords(FIREFOX_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "firefox-csv",
      warnings: getBrowserCsvExportWarnings(vault, "Firefox CSV"),
    };
  },
};

const SAFARI_CSV_HEADERS = ["Title", "URL", "Username", "Password", "Notes", "OTPAuth"] as const;

export const safariCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "safari-csv",
    name: "Safari / Apple Passwords CSV",
    provider: "Apple Safari",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Apple Safari / Passwords app CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    const lower = headers.map((h) => h.toLowerCase());
    if (
      hasAllHeaders(headers, ["Title", "URL", "Username", "Password", "Notes", "OTPAuth"]) &&
      !lower.includes("group") &&
      !lower.includes("favorite") &&
      !lower.includes("tags")
    ) {
      return 0.96;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const items: VaultItem[] = records.map((rec, idx) => {
      const url = getRecordField(rec, "URL");
      return makeLoginItem({
        id: `safari-${idx + 1}`,
        name: getRecordField(rec, "Title") || deriveNameFromUrl(url),
        username: getRecordField(rec, "Username"),
        password: getRecordField(rec, "Password"),
        uris: url ? [url] : [],
        totp: getRecordField(rec, "OTPAuth"),
        notes: getRecordField(rec, "Notes"),
      });
    });

    return {
      vault: { encrypted: false, folders: [], items },
      format: "safari-csv",
      providerName: "Apple Safari",
      formatName: "Safari / Apple Passwords CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const records = vault.items.map((item) => ({
      Title: item.name ?? "",
      URL: getPrimaryUri(item),
      Username: item.login?.username ?? "",
      Password: item.login?.password ?? "",
      Notes: item.notes ?? "",
      OTPAuth: item.login?.totp ?? "",
    }));

    return {
      content: serializeCsvRecords(SAFARI_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "safari-csv",
      warnings: getBrowserCsvExportWarnings(vault, "Safari CSV"),
    };
  },
};

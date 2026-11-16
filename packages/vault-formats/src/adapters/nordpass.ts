import { inferItemType, type VaultData, type VaultItem } from "@vaultlint/vault-schema";

import { getRecordField, hasAllHeaders, parseCsvRecords, serializeCsvRecords } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

const NORDPASS_CSV_HEADERS = [
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
] as const;

function getNordPassExportWarnings(vault: VaultData): string[] {
  const warnings: string[] = [];
  const items = vault.items;
  if (items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
    warnings.push("NordPass CSV preserves only the primary URI for each item.");
  }
  if (
    items.some((item) =>
      item.login?.uris?.some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push("NordPass CSV does not preserve URI match settings.");
  }
  if (
    items.some(
      (item) =>
        item.card?.brand ||
        item.identity?.title ||
        item.identity?.username ||
        item.identity?.company ||
        item.identity?.address3 ||
        item.identity?.ssn ||
        item.identity?.passportNumber ||
        item.identity?.licenseNumber,
    )
  ) {
    warnings.push("NordPass CSV omits card brand and some identity fields.");
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
        item.fields?.length ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    warnings.push("NordPass CSV omits custom fields, favorites, item IDs, and other metadata.");
  }
  return warnings;
}

function parseJsonArray(raw: string): unknown[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const nordPassCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "nordpass-csv",
    name: "NordPass CSV",
    provider: "NordPass",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "NordPass unencrypted CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (
      hasAllHeaders(headers, ["name", "url", "username", "password", "cardholdername", "folder"])
    ) {
      return 0.97;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    const items: VaultItem[] = records.map((rec, idx) => {
      const folderId = folders.getOrCreate(getRecordField(rec, "folder"));
      const url = getRecordField(rec, "url");
      const rawType = getRecordField(rec, "type").trim().toLowerCase();
      const itemType =
        rawType === "note"
          ? 2
          : rawType === "credit_card" || rawType === "card"
            ? 3
            : rawType === "identity" || rawType === "personal_info"
              ? 4
              : 1;

      const item = makeLoginItem({
        id: `nordpass-${idx + 1}`,
        name: getRecordField(rec, "name") || url || "Untitled",
        username:
          getRecordField(rec, "username") || (itemType === 4 ? "" : getRecordField(rec, "email")),
        password: getRecordField(rec, "password"),
        uris: [
          ...(url ? [url] : []),
          ...parseJsonArray(getRecordField(rec, "additional_urls")).filter(
            (u): u is string => typeof u === "string" && u !== url,
          ),
        ],
        totp: getRecordField(rec, "totp"),
        notes: getRecordField(rec, "note"),
        folderId,
        type: itemType,
      });

      const customFields = parseJsonArray(getRecordField(rec, "custom_fields")).flatMap((entry) => {
        const field = entry as { label?: unknown; type?: unknown; value?: unknown } | null;
        if (!field || typeof field.label !== "string" || typeof field.value !== "string") return [];
        return [{ name: field.label, value: field.value, type: field.type === "hidden" ? 1 : 0 }];
      });
      if (customFields.length > 0) item.fields = customFields;

      if (itemType === 3) {
        const expiry = getRecordField(rec, "expirydate");
        const [expMonth = "", expYear = ""] = expiry.split("/");
        item.card = {
          cardholderName: getRecordField(rec, "cardholdername"),
          number: getRecordField(rec, "cardnumber"),
          code: getRecordField(rec, "cvc"),
          expMonth,
          expYear,
        };
      } else if (itemType === 4) {
        const fullName = getRecordField(rec, "full_name").trim();
        const parts = fullName.split(/\s+/);
        item.identity = {
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" "),
          email: getRecordField(rec, "email"),
          phone: getRecordField(rec, "phone_number"),
          address1: getRecordField(rec, "address1"),
          address2: getRecordField(rec, "address2"),
          city: getRecordField(rec, "city"),
          state: getRecordField(rec, "state"),
          country: getRecordField(rec, "country"),
          postalCode: getRecordField(rec, "zipcode"),
        };
      }

      return item;
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "nordpass-csv",
      providerName: "NordPass",
      formatName: "NordPass CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => {
      const itemType = inferItemType(item);
      const expiry =
        item.card?.expMonth && item.card?.expYear
          ? `${item.card.expMonth}/${item.card.expYear}`
          : "";
      const fullName = [
        item.identity?.firstName,
        item.identity?.middleName,
        item.identity?.lastName,
      ]
        .filter(Boolean)
        .join(" ");
      return {
        name: item.name ?? "",
        url: getPrimaryUri(item),
        username: item.login?.username ?? "",
        password: item.login?.password ?? "",
        note: item.notes ?? "",
        cardholdername: item.card?.cardholderName ?? "",
        cardnumber: item.card?.number ?? "",
        cvc: item.card?.code ?? "",
        expirydate: expiry,
        zipcode: item.identity?.postalCode ?? "",
        folder: getItemFolderName(item, folderMap),
        full_name: fullName,
        phone_number: item.identity?.phone ?? "",
        email: item.identity?.email ?? "",
        address1: item.identity?.address1 ?? "",
        address2: item.identity?.address2 ?? "",
        city: item.identity?.city ?? "",
        country: item.identity?.country ?? "",
        state: item.identity?.state ?? "",
        totp: item.login?.totp ?? "",
        shared_folder: "",
        type:
          itemType === 2
            ? "note"
            : itemType === 3
              ? "credit_card"
              : itemType === 4
                ? "personal_info"
                : "password",
      };
    });

    return {
      content: serializeCsvRecords(NORDPASS_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "nordpass-csv",
      warnings: getNordPassExportWarnings(vault),
    };
  },
};

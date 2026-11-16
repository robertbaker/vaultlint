import type {
  BitwardenVaultExport,
  VaultCollection,
  VaultCustomField,
  VaultData,
  VaultItem,
} from "@vaultlint/vault-schema";
import * as z from "zod";

import { getRecordField, hasAllHeaders, parseCsvRecords, serializeCsvRecords } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getAllUris,
  getItemFolderName,
  makeLoginItem,
  stripInternalProviderData,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const bitwardenRootSchema = z
  .object({
    encrypted: z.boolean().optional(),
    items: z.array(z.unknown()),
    folders: z.array(z.unknown()).optional(),
    collections: z.array(z.unknown()).optional(),
  })
  .passthrough();

function validateRecordArray(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new Error(`Invalid Bitwarden vault format: "${label}" must be an array of objects.`);
  }
}

function validateStringFields(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  nullableKeys: readonly string[] = [],
): void {
  for (const key of keys) {
    if (
      record[key] !== undefined &&
      !(record[key] === null && nullableKeys.includes(key)) &&
      typeof record[key] !== "string"
    ) {
      throw new Error(`Invalid Bitwarden vault format: ${label} "${key}" must be a string.`);
    }
  }
}

function validateBitwardenJson(value: unknown): asserts value is BitwardenVaultExport {
  if (!isRecord(value)) {
    throw new Error("Invalid Bitwarden JSON: expected an object.");
  }
  if (value["folders"] !== undefined) {
    validateRecordArray(value["folders"], "folders");
    for (const [index, folder] of value["folders"].entries()) {
      validateStringFields(folder, ["id", "name"], `folder ${index}`);
    }
  }
  if (value["collections"] !== undefined) {
    validateRecordArray(value["collections"], "collections");
    for (const [index, collection] of value["collections"].entries()) {
      validateStringFields(collection, ["id", "name", "organizationId"], `collection ${index}`);
    }
  }
  const items = value["items"];
  if (!bitwardenRootSchema.safeParse(value).success) {
    throw new Error('Invalid Bitwarden vault format: expected an "items" array.');
  }
  validateRecordArray(items, "items");

  for (const [index, item] of items.entries()) {
    validateStringFields(
      item,
      ["id", "name", "organizationId", "creationDate", "revisionDate"],
      `item ${index}`,
      ["organizationId", "creationDate", "revisionDate"],
    );
    if (item["type"] !== undefined && typeof item["type"] !== "number") {
      throw new Error(`Invalid Bitwarden vault format: item ${index} "type" must be a number.`);
    }
    if (item["favorite"] !== undefined && typeof item["favorite"] !== "boolean") {
      throw new Error(
        `Invalid Bitwarden vault format: item ${index} "favorite" must be a boolean.`,
      );
    }
    // Official importers guard these with `!= null`; the SDK exporter writes `"passwordHistory": null`.
    for (const key of ["fields", "passwordHistory"] as const) {
      if (item[key] === null) delete item[key];
    }
    if (item["fields"] !== undefined && !Array.isArray(item["fields"])) {
      throw new Error(`Invalid Bitwarden vault format: item ${index} "fields" must be an array.`);
    }
    if (Array.isArray(item["fields"])) {
      for (const [fieldIndex, field] of item["fields"].entries()) {
        if (!isRecord(field)) {
          throw new Error(
            `Invalid Bitwarden vault format: item ${index} "fields" must contain objects.`,
          );
        }
        // Linked custom fields (type 3) are exported with `"value": null`.
        validateStringFields(field, ["name", "value"], `item ${index} field ${fieldIndex}`, [
          "name",
          "value",
        ]);
        for (const key of ["name", "value"] as const) {
          if (field[key] === null) field[key] = "";
        }
        if (field["type"] !== undefined && typeof field["type"] !== "number") {
          throw new Error(
            `Invalid Bitwarden vault format: item ${index} field ${fieldIndex} "type" must be a number.`,
          );
        }
      }
    }
    if (
      item["passwordHistory"] !== undefined &&
      (!Array.isArray(item["passwordHistory"]) ||
        item["passwordHistory"].some((entry) => !isRecord(entry)))
    ) {
      throw new Error(
        `Invalid Bitwarden vault format: item ${index} "passwordHistory" must be an array of objects.`,
      );
    }
    if (item["collectionIds"] !== undefined) {
      const collectionIds = item["collectionIds"];
      if (
        collectionIds !== null &&
        (!Array.isArray(collectionIds) ||
          collectionIds.some((id) => id !== null && typeof id !== "string"))
      ) {
        throw new Error(
          `Invalid Bitwarden vault format: item ${index} "collectionIds" must be an array of strings or null entries, or null.`,
        );
      }
    }
    const login = item["login"];
    if (login !== undefined && !isRecord(login)) {
      throw new Error(`Invalid Bitwarden vault format: item ${index} "login" must be an object.`);
    }
    if (isRecord(login)) {
      // Bitwarden writes `null` (not omission) for empty login fields, e.g. `"totp": null`.
      const nullableLoginKeys = ["username", "password", "totp"] as const;
      validateStringFields(login, nullableLoginKeys, `item ${index} login`, nullableLoginKeys);
      for (const key of nullableLoginKeys) {
        if (login[key] === null) delete login[key];
      }
      if (login["uris"] === null) delete login["uris"];
      if (login["uris"] !== undefined && !Array.isArray(login["uris"])) {
        throw new Error(
          `Invalid Bitwarden vault format: item ${index} login "uris" must be an array.`,
        );
      }
      if (
        Array.isArray(login["uris"]) &&
        login["uris"].some(
          (uri) => typeof uri !== "string" && (!isRecord(uri) || typeof uri["uri"] !== "string"),
        )
      ) {
        throw new Error(
          `Invalid Bitwarden vault format: item ${index} login "uris" must contain strings or URI objects.`,
        );
      }
      if (
        login["fido2Credentials"] !== undefined &&
        login["fido2Credentials"] !== null &&
        (!Array.isArray(login["fido2Credentials"]) ||
          login["fido2Credentials"].some((credential) => !isRecord(credential)))
      ) {
        throw new Error(
          `Invalid Bitwarden vault format: item ${index} login "fido2Credentials" must be an array of objects or null.`,
        );
      }
    }
  }
}

export const bitwardenJsonAdapter: VaultFormatAdapter = {
  info: {
    id: "bitwarden-json",
    name: "Bitwarden JSON",
    provider: "Bitwarden",
    extensions: [".json"],
    mimeType: "application/json",
    description: "Unencrypted Bitwarden / Vaultwarden JSON export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.json || typeof ctx.json !== "object" || Array.isArray(ctx.json)) return 0;
    const obj = ctx.json as Record<string, unknown>;
    if (bitwardenRootSchema.safeParse(obj).success) return 0.95;
    if (obj["encrypted"] === true) {
      return 0.95;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const raw = ctx.json;
    if (!isRecord(raw)) throw new Error("Invalid Bitwarden JSON: expected an object.");
    const obj = raw as BitwardenVaultExport;
    if (obj.encrypted) {
      throw new Error(
        "Encrypted Bitwarden vaults are not supported. Please export an unencrypted JSON vault.",
      );
    }
    if (!Array.isArray(raw["items"])) {
      throw new Error('Invalid Bitwarden vault format: missing "items" array.');
    }
    validateBitwardenJson(raw);

    const { items: _items, folders: _folders, ...rawMeta } = obj;
    return {
      vault: obj,
      format: "bitwarden-json",
      providerName: "Bitwarden",
      formatName: "Bitwarden JSON",
      warnings: [],
      rawMeta: Object.keys(rawMeta).length > 0 ? rawMeta : undefined,
    };
  },

  export(vault: VaultData, options) {
    const cleanItems: VaultItem[] = vault.items.map(stripInternalProviderData);
    const payload: VaultData = {
      ...options?.rawMeta,
      encrypted: false,
      folders: vault.folders ?? [],
      ...(vault.collections ? { collections: vault.collections } : {}),
      items: cleanItems,
    };
    return {
      content: JSON.stringify(payload, null, 2),
      mimeType: "application/json",
      extension: "json",
      format: "bitwarden-json",
      warnings: [],
    };
  },
};

const BW_CSV_ITEM_HEADERS = [
  "folder",
  "favorite",
  "type",
  "name",
  "notes",
  "fields",
  "reprompt",
  "login_uri",
  "login_username",
  "login_password",
  "login_totp",
] as const;

const BW_CSV_ORG_HEADERS = [
  "collections",
  "type",
  "name",
  "notes",
  "fields",
  "reprompt",
  "login_uri",
  "login_username",
  "login_password",
  "login_totp",
] as const;

function splitCollectionNames(raw: string): string[] {
  return raw
    .split(/[;,\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function bwTypeFromString(raw: string): number {
  switch (raw.trim().toLowerCase()) {
    case "note":
    case "securenote":
      return 2;
    case "card":
      return 3;
    case "identity":
      return 4;
    default:
      return 1;
  }
}

function bwTypeToString(type?: number): string {
  switch (type) {
    case 2:
      return "note";
    case 3:
      return "card";
    case 4:
      return "identity";
    default:
      return "login";
  }
}

function parseBwCsvFields(raw: string): VaultCustomField[] | undefined {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return undefined;
  const fields: VaultCustomField[] = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      fields.push({ name: line.trim(), value: "", type: 0 });
    } else {
      const rawValue = line.slice(colonIdx + 1);
      fields.push({
        name: line.slice(0, colonIdx).trim(),
        value: rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue,
        type: 0,
      });
    }
  }
  return fields;
}

function serializeBwCsvFields(fields?: VaultCustomField[]): string {
  if (!fields || fields.length === 0) return "";
  return fields.map((f) => `${f.name}: ${f.value}`).join("\n");
}

export const bitwardenCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "bitwarden-csv",
    name: "Bitwarden CSV",
    provider: "Bitwarden",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Unencrypted Bitwarden / Vaultwarden CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (hasAllHeaders(headers, ["login_uri", "login_username", "login_password"])) {
      return 0.96;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    const collectionIdsByName = new Map<string, string>();
    const collections: VaultCollection[] = [];
    const items: VaultItem[] = records.map((rec, idx) => {
      const collectionNames = splitCollectionNames(getRecordField(rec, "collections"));
      const folderId =
        collectionNames.length > 0 ? null : folders.getOrCreate(getRecordField(rec, "folder"));
      const collectionIds = collectionNames.map((name) => {
        let id = collectionIdsByName.get(name);
        if (!id) {
          id = `collection-${collections.length + 1}`;
          collectionIdsByName.set(name, id);
          collections.push({ id, name });
        }
        return id;
      });
      const uriRaw = getRecordField(rec, "login_uri");
      const uris = uriRaw
        .split(/[,\n]/)
        .map((u) => u.trim())
        .filter(Boolean);
      const itemType = bwTypeFromString(getRecordField(rec, "type"));
      const favRaw = getRecordField(rec, "favorite").trim().toLowerCase();
      const repromptRaw = getRecordField(rec, "reprompt").trim();
      const fields = parseBwCsvFields(getRecordField(rec, "fields"));
      const item = makeLoginItem({
        id: `bw-csv-${idx + 1}`,
        name: getRecordField(rec, "name") || "Untitled",
        username: getRecordField(rec, "login_username"),
        password: getRecordField(rec, "login_password"),
        uris,
        totp: getRecordField(rec, "login_totp"),
        notes: getRecordField(rec, "notes"),
        folderId,
        favorite: favRaw === "1" || favRaw === "true",
        type: itemType,
      });
      if (repromptRaw === "1") item.reprompt = 1;
      if (fields) item.fields = fields;
      if (collectionIds.length > 0) item.collectionIds = collectionIds;
      return item;
    });

    return {
      vault: {
        encrypted: false,
        folders: folders.list(),
        ...(collections.length > 0 ? { collections } : {}),
        items,
      },
      format: "bitwarden-csv",
      providerName: "Bitwarden",
      formatName: "Bitwarden CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const collectionMap = new Map(
      (vault.collections ?? []).map((collection) => [collection.id, collection.name]),
    );
    const isOrganizationExport = (vault.collections?.length ?? 0) > 0;
    const hasUnrepresentableFields = vault.items.some((item) =>
      item.fields?.some(
        (field) =>
          (field.type !== undefined && field.type !== 0) ||
          (field.linkedId !== undefined && field.linkedId !== null) ||
          /[\r\n]/.test(field.name) ||
          field.name !== field.name.trim() ||
          field.name.includes(":") ||
          /[\r\n]/.test(field.value),
      ),
    );
    const hasUnsupportedItemMetadata = vault.items.some(
      (item) =>
        Boolean(
          item.id ||
          item.organizationId ||
          item.creationDate ||
          item.revisionDate ||
          item.deletedDate ||
          item.passwordHistory?.length ||
          item.card ||
          item.identity ||
          item.login?.fido ||
          item.login?.fido2Credentials?.length,
        ) ||
        (item.login?.uris ?? []).some(
          (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
        ) ||
        (isOrganizationExport && (item.favorite || item.folderId)) ||
        (item.collectionIds ?? []).some((id) => id !== null && !collectionMap.has(id)),
    );
    const hasAmbiguousListValues =
      vault.items.some((item) =>
        getAllUris(item).some((uri) => /[,\r\n]/.test(uri) || uri !== uri.trim()),
      ) ||
      (vault.collections ?? []).some(
        (collection) =>
          /[,;\r\n]/.test(collection.name) || collection.name !== collection.name.trim(),
      );
    const records = vault.items.map((item) => ({
      ...(isOrganizationExport
        ? {
            collections: (item.collectionIds ?? [])
              .filter((id): id is string => typeof id === "string")
              .map((id) => collectionMap.get(id))
              .filter((name): name is string => Boolean(name))
              .join(","),
          }
        : { folder: getItemFolderName(item, folderMap) }),
      favorite: item.favorite ? "1" : "",
      type: bwTypeToString(item.type),
      name: item.name ?? "",
      notes: item.notes ?? "",
      fields: serializeBwCsvFields(item.fields),
      reprompt: item.reprompt ? String(item.reprompt) : "0",
      login_uri: getAllUris(item).join(","),
      login_username: item.login?.username ?? "",
      login_password: item.login?.password ?? "",
      login_totp: item.login?.totp ?? "",
    }));
    return {
      content: serializeCsvRecords(
        isOrganizationExport ? BW_CSV_ORG_HEADERS : BW_CSV_ITEM_HEADERS,
        records,
      ),
      mimeType: "text/csv",
      extension: "csv",
      format: "bitwarden-csv",
      warnings: [
        ...(hasUnrepresentableFields
          ? [
              "Bitwarden CSV cannot preserve custom-field types or linked IDs; custom-field names with colons or edge whitespace and values with line breaks may not round-trip.",
            ]
          : []),
        ...(hasUnsupportedItemMetadata
          ? [
              "Bitwarden CSV omits item IDs, dates, password history, FIDO2 data, card and identity details, and URI match settings; organization CSV also omits favorites and folders, and cannot preserve collection assignments with unknown collection IDs. Use JSON to retain this metadata.",
            ]
          : []),
        ...(isOrganizationExport
          ? [
              "Bitwarden organization CSV retains collection names and assignments, but not collection IDs or organization metadata.",
            ]
          : []),
        ...(hasAmbiguousListValues
          ? [
              "Bitwarden CSV separates URI and collection lists with delimiters; commas or line breaks inside a URI, and commas, semicolons, line breaks, or edge whitespace in collection names, may be split or trimmed.",
            ]
          : []),
      ],
    };
  },
};

import type { VaultData, VaultItem } from "@vaultlint/vault-schema";
import * as z from "zod";

import { getRecordField, hasAllHeaders, parseCsvRecords, serializeCsvRecords } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getAllUris,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

interface ProtonPassItem {
  itemId?: string;
  state?: number;
  modifyTime?: number;
  data?: {
    type?: string;
    metadata?: { name?: string; note?: string };
    content?: {
      username?: string;
      itemUsername?: string;
      email?: string;
      itemEmail?: string;
      password?: string;
      urls?: string[];
      totpUri?: string;
      autofillUrls?: Array<{ url: string; mode?: number }>;
    };
    extraFields?: Array<{
      fieldName?: string;
      type?: string;
      data?: { content?: string; totpUri?: string; timestamp?: number };
    }>;
    [key: string]: unknown;
  };
  shareId?: string;
  folderId?: string | null;
  createTime?: number;
  aliasEmail?: string | null;
  pinned?: boolean;
  [key: string]: unknown;
}

interface ProtonPassVault {
  name?: string;
  items?: ProtonPassItem[];
  folders?: Array<{ folderId: string; parentFolderId?: string | null; name: string }>;
  [key: string]: unknown;
}

interface ProtonPassJson {
  encrypted?: boolean;
  userId?: string;
  vaults?: Record<string, ProtonPassVault>;
  version?: string;
  [key: string]: unknown;
}

const protonPassRootSchema = z
  .object({
    encrypted: z.boolean().nullish(),
    vaults: z.record(
      z.string(),
      z
        .object({
          name: z.string().nullish(),
          items: z.array(z.unknown()).nullish(),
          folders: z.array(z.unknown()).nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function protonTimestamp(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export const protonPassJsonAdapter: VaultFormatAdapter = {
  info: {
    id: "protonpass-json",
    name: "Proton Pass JSON",
    provider: "Proton Pass",
    extensions: [".json"],
    mimeType: "application/json",
    description: "Unencrypted Proton Pass JSON export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.json || typeof ctx.json !== "object" || Array.isArray(ctx.json)) return 0;
    if (protonPassRootSchema.safeParse(ctx.json).success) {
      return 0.96;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const parsed = protonPassRootSchema.safeParse(ctx.json);
    if (!parsed.success) {
      throw new Error("Invalid Proton Pass JSON.");
    }
    const obj = ctx.json as ProtonPassJson;
    if (obj.encrypted) {
      throw new Error(
        "Encrypted Proton Pass exports are not supported. Please export an unencrypted vault.",
      );
    }
    if (!obj.vaults || typeof obj.vaults !== "object") {
      throw new Error('Invalid Proton Pass JSON: missing "vaults" object.');
    }

    const folders = new FolderRegistry();
    const items: VaultItem[] = [];
    const usedItemIds = new Set<string>();

    for (const [vaultKey, pVault] of Object.entries(obj.vaults)) {
      for (const pFolder of pVault.folders ?? []) folders.getOrCreate(pFolder?.name);
      for (const raw of pVault.items ?? []) {
        if (!raw || typeof raw !== "object") continue;
        if (raw.state === 2) continue; // trashed
        const meta = raw.data?.metadata;
        const content = raw.data?.content;
        const rawType = raw.data?.type ?? "login";
        const itemType =
          rawType === "note"
            ? 2
            : rawType === "creditCard"
              ? 3
              : rawType === "identity"
                ? 4
                : rawType === "login"
                  ? 1
                  : 0;

        const itemId = raw.itemId || `proton-${items.length + 1}`;
        let uniqueItemId = itemId;
        if (usedItemIds.has(uniqueItemId)) {
          uniqueItemId = `${vaultKey}:${itemId}`;
          let suffix = 2;
          while (usedItemIds.has(uniqueItemId)) {
            uniqueItemId = `${vaultKey}:${itemId}:${suffix++}`;
          }
        }
        usedItemIds.add(uniqueItemId);
        const item = makeLoginItem({
          id: uniqueItemId,
          name: meta?.name || "Untitled",
          // Real exports put the login in `itemEmail` and/or `itemUsername`; aliases keep their
          // address in the item-level `aliasEmail`.
          username:
            content?.itemUsername ||
            content?.username ||
            content?.itemEmail ||
            content?.email ||
            (rawType === "alias" ? raw.aliasEmail : "") ||
            "",
          password: content?.password || "",
          uris: content?.urls ?? [],
          totp: content?.totpUri || "",
          notes: meta?.note || "",
          folderId: raw.folderId
            ? folders.getOrCreate(pVault.folders?.find((f) => f?.folderId === raw.folderId)?.name)
            : null,
          lastModified: protonTimestamp(raw.modifyTime),
          type: itemType,
        });
        if (raw.data?.extraFields && raw.data.extraFields.length > 0) {
          item.fields = raw.data.extraFields
            .filter((ef): ef is NonNullable<typeof ef> => Boolean(ef && typeof ef === "object"))
            .map((ef) => ({
              name: ef.fieldName ?? "Field",
              value: ef.data?.content ?? ef.data?.totpUri ?? String(ef.data?.timestamp ?? ""),
              type: ef.type === "hidden" ? 1 : ef.type === "totp" ? 2 : 0,
            }));
        }
        item._providerData = {
          protonPass: raw,
          protonVaultKey: vaultKey,
          protonVaultName: pVault.name ?? "Personal",
          protonFolders: pVault.folders ?? [],
        };
        items.push(item);
      }
    }

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "protonpass-json",
      providerName: "Proton Pass",
      formatName: "Proton Pass JSON",
      warnings: getProtonPassImportWarnings(obj),
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const vaults = Object.create(null) as Record<string, ProtonPassVault>;

    vault.items.forEach((item, idx) => {
      const savedRaw = item._providerData?.["protonPass"] as ProtonPassItem | undefined;
      const vaultName =
        (item._providerData?.["protonVaultName"] as string | undefined) || "Personal";
      const baseVaultKey =
        (item._providerData?.["protonVaultKey"] as string | undefined) ||
        vaultName.toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
        "personal";
      let vaultKey = baseVaultKey;
      let suffix = 2;
      while (vaults[vaultKey] && vaults[vaultKey].name !== vaultName) {
        vaultKey = `${baseVaultKey}-${suffix++}`;
      }
      if (!vaults[vaultKey]) {
        vaults[vaultKey] = {
          name: vaultName,
          folders: (item._providerData?.["protonFolders"] as ProtonPassVault["folders"]) ?? [],
          items: [],
        };
      }
      if (item.folderId && !savedRaw?.folderId) {
        const folders = vaults[vaultKey].folders ?? (vaults[vaultKey].folders = []);
        if (!folders.some((folder) => folder.folderId === item.folderId)) {
          folders.push({
            folderId: item.folderId,
            parentFolderId: null,
            name: getItemFolderName(item, folderMap),
          });
        }
      }

      const savedType = savedRaw?.data?.type;
      const typeStr =
        item.type === 2
          ? "note"
          : item.type === 3
            ? "creditCard"
            : item.type === 4
              ? "identity"
              : item.type === 0 && savedType
                ? savedType
                : "login";

      vaults[vaultKey].items!.push({
        ...savedRaw,
        itemId: savedRaw?.itemId || item.id || `item-${idx + 1}`,
        folderId: savedRaw?.folderId ?? item.folderId ?? null,
        state: 1,
        modifyTime: item.lastModified
          ? Math.floor(new Date(item.lastModified).getTime() / 1000) ||
            Math.floor(Date.now() / 1000)
          : Math.floor(Date.now() / 1000),
        data: {
          ...savedRaw?.data,
          type: typeStr,
          metadata: {
            name: item.name ?? "Untitled",
            note: item.notes ?? "",
          },
          content: {
            ...savedRaw?.data?.content,
            username: item.login?.username ?? "",
            itemUsername: item.login?.username ?? "",
            itemEmail: (savedRaw?.data?.content?.itemEmail as string | undefined) ?? "",
            password: item.login?.password ?? "",
            urls: getAllUris(item),
            totpUri: item.login?.totp ?? "",
          },
          extraFields: item.fields?.map((field) => ({
            fieldName: field.name,
            type: field.type === 1 ? "hidden" : field.type === 2 ? "totp" : "text",
            data: field.type === 2 ? { totpUri: field.value } : { content: field.value },
          })),
        },
      });
    });

    return {
      content: JSON.stringify({ encrypted: false, vaults }, null, 2),
      mimeType: "application/json",
      extension: "json",
      format: "protonpass-json",
      warnings: getProtonPassExportWarnings(vault, false),
    };
  },
};

const PROTONPASS_CSV_HEADERS = [
  "type",
  "name",
  "url",
  "autofillUrls",
  "email",
  "username",
  "password",
  "note",
  "totp",
  "vault",
  "createTime",
  "modifyTime",
] as const;

function getProtonPassImportWarnings(obj: ProtonPassJson): string[] {
  const types = new Set(
    Object.values(obj.vaults ?? {}).flatMap((v) =>
      (v.items ?? []).map((i) => i?.data?.type ?? "login"),
    ),
  );
  const warnings: string[] = [];
  if ([...types].some((type) => !["login", "note", "creditCard", "identity"].includes(type)))
    warnings.push(
      "Proton Pass import retained unsupported item payloads for JSON re-export. Review item details before converting to another format.",
    );
  if (Object.values(obj.vaults ?? {}).some((v) => v.folders?.some((f) => f?.parentFolderId)))
    warnings.push("Proton Pass nested folders are flattened during import.");
  return warnings;
}

function getProtonPassExportWarnings(vault: VaultData, csv: boolean): string[] {
  const warnings: string[] = [];
  if (
    vault.items.some(
      (item) =>
        item.card ||
        item.identity ||
        item.passwordHistory?.length ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    warnings.push(
      "Proton Pass exports omit card and identity details, password history, and FIDO2 credentials.",
    );
  }
  if (csv && vault.items.some((item) => item.fields?.length)) {
    warnings.push("Proton Pass CSV omits custom fields.");
  } else if (
    vault.items.some((item) =>
      item.fields?.some(
        (field) =>
          (field.type !== undefined && field.type !== 0 && field.type !== 1) ||
          (field.linkedId !== undefined && field.linkedId !== null),
      ),
    )
  ) {
    warnings.push("Proton Pass JSON does not preserve custom-field types or linked IDs.");
  }
  if (vault.items.some((item) => item.favorite)) {
    warnings.push("Proton Pass exports do not preserve favorites.");
  }
  if (vault.items.some((item) => item.collectionIds?.length || item.organizationId)) {
    warnings.push("Proton Pass exports do not preserve organization collection assignments.");
  }
  if (
    vault.items.some((item) =>
      (item.login?.uris ?? []).some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push("Proton Pass exports do not preserve URI match settings.");
  }
  if (csv) {
    if (vault.items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
      warnings.push("Proton Pass CSV preserves only the primary URI for each item.");
    }
    if (vault.items.some((item) => item.type !== undefined && item.type !== 1)) {
      warnings.push("Proton Pass CSV does not preserve item types.");
    }
    if (
      vault.items.some(
        (item) => item.id || item.lastModified || item.revisionDate || item.deletedDate,
      )
    ) {
      warnings.push("Proton Pass CSV omits item IDs and dates.");
    }
  }
  return warnings;
}

export const protonPassCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "protonpass-csv",
    name: "Proton Pass CSV",
    provider: "Proton Pass",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Proton Pass unencrypted CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (hasAllHeaders(headers, ["name", "url", "username", "password", "totp", "vault"])) {
      return 0.96;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    const items: VaultItem[] = records.map((rec, idx) => {
      const folderId = folders.getOrCreate(getRecordField(rec, "vault"));
      const url = getRecordField(rec, "url");
      const rawType = getRecordField(rec, "type").trim().toLowerCase();
      const itemType =
        rawType === "note"
          ? 2
          : rawType === "creditcard" || rawType === "credit_card"
            ? 3
            : rawType === "identity"
              ? 4
              : 1;
      const item = makeLoginItem({
        id: `proton-csv-${idx + 1}`,
        name: getRecordField(rec, "name") || url || "Untitled",
        username: getRecordField(rec, "username", "email"),
        password: getRecordField(rec, "password"),
        uris: url ? [url] : [],
        totp: getRecordField(rec, "totp"),
        notes: getRecordField(rec, "note"),
        folderId,
        type: itemType,
      });
      item._providerData = {
        protonEmail: getRecordField(rec, "email"),
        protonAutofillUrls: getRecordField(rec, "autofillUrls"),
        protonCreateTime: getRecordField(rec, "createTime"),
        protonModifyTime: getRecordField(rec, "modifyTime"),
      };
      return item;
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "protonpass-csv",
      providerName: "Proton Pass",
      formatName: "Proton Pass CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => ({
      type:
        item.type === 2
          ? "note"
          : item.type === 3
            ? "creditCard"
            : item.type === 4
              ? "identity"
              : "login",
      name: item.name ?? "",
      url: getPrimaryUri(item),
      autofillUrls:
        (item._providerData?.["protonAutofillUrls"] as string | undefined) ||
        JSON.stringify(item.login?.uris ?? []),
      email: (item._providerData?.["protonEmail"] as string | undefined) ?? "",
      username: item.login?.username ?? "",
      password: item.login?.password ?? "",
      note: item.notes ?? "",
      totp: item.login?.totp ?? "",
      vault: getItemFolderName(item, folderMap) || "Personal",
      createTime: (item._providerData?.["protonCreateTime"] as string | undefined) ?? "",
      modifyTime:
        (item._providerData?.["protonModifyTime"] as string | undefined) ??
        (item.lastModified ? String(Math.floor(new Date(item.lastModified).getTime() / 1000)) : ""),
    }));

    return {
      content: serializeCsvRecords(PROTONPASS_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "protonpass-csv",
      warnings: getProtonPassExportWarnings(vault, true),
    };
  },
};

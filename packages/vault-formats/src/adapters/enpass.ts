import type { VaultData, VaultFolder, VaultItem } from "@vaultlint/vault-schema";
import * as z from "zod";

import { getRecordField, hasAllHeaders, parseCsvRecords, serializeCsvRecords } from "../csv";
import {
  buildFolderNameMap,
  FolderRegistry,
  getItemFolderName,
  getPrimaryUri,
  makeLoginItem,
} from "../helpers";
import type { VaultFormatAdapter, VaultParseContext } from "../types";

const ENPASS_CSV_HEADERS = [
  "Title",
  "Username",
  "Email",
  "Password",
  "Website",
  "TOTP Secret Key",
  "Custom Field 1",
  "*Custom Field 2",
  "Note",
  "Tags",
] as const;

const enpassFieldSchema = z.object({
  type: z.string().nullish(),
  label: z.string().nullish(),
  value: z.union([z.string(), z.number()]).nullish(),
  sensitive: z.union([z.number(), z.boolean()]).nullish(),
  deleted: z.union([z.number(), z.boolean()]).nullish(),
});
const enpassItemSchema = z.object({
  uuid: z.string().nullish(),
  title: z.string().nullish(),
  note: z.string().nullish(),
  template_type: z.string().nullish(),
  fields: z.array(enpassFieldSchema).nullish(),
  folders: z.array(z.string()).nullish(),
  trashed: z.union([z.number(), z.boolean()]).nullish(),
  archived: z.union([z.number(), z.boolean()]).nullish(),
  createdAt: z.number().nullish(),
  updated_at: z.number().nullish(),
  attachments: z.array(z.unknown()).nullish(),
});
const enpassExportSchema = z.object({
  items: z.array(enpassItemSchema),
  folders: z
    .array(
      z.object({
        uuid: z.string().nullish(),
        parent_uuid: z.string().nullish(),
        title: z.string().nullish(),
      }),
    )
    .nullish(),
});

type EnpassField = z.infer<typeof enpassFieldSchema>;
type EnpassFolder = NonNullable<z.infer<typeof enpassExportSchema>["folders"]>[number];

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function fieldValue(fields: EnpassField[], ...types: string[]): string {
  const wanted = new Set(types.map((type) => type.toLowerCase()));
  const found = fields.find((field) => wanted.has(field.type?.toLowerCase() ?? ""));
  return textValue(found?.value);
}

function enpassFolderPaths(rawFolders: EnpassFolder[]): Map<string, string> {
  const byId = new Map(
    rawFolders.filter((folder) => folder.uuid).map((folder) => [folder.uuid!, folder]),
  );
  const paths = new Map<string, string>();
  for (const [id, folder] of byId) {
    const path: string[] = [];
    const seen = new Set<string>();
    let current: EnpassFolder | undefined = folder;
    while (current?.uuid && !seen.has(current.uuid)) {
      seen.add(current.uuid);
      if (current.title) path.unshift(current.title);
      current = byId.get(current.parent_uuid ?? "");
    }
    paths.set(id, path.join(" / "));
  }
  return paths;
}

function enpassDate(value: number | string | null | undefined): string | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function enpassExpiry(fields: EnpassField[]): { expMonth: string; expYear: string } {
  const value = fieldValue(fields, "ccExpiry").trim();
  const match = /^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/.exec(value);
  const month = Number(match?.[1]);
  return match && month >= 1 && month <= 12
    ? { expMonth: String(month), expYear: match[2] ?? "" }
    : { expMonth: "", expYear: "" };
}

/**
 * Effective Enpass template for a canonical item. Honors the declared type, but falls back to the
 * populated payload so items with a missing/unknown `type` do not lose their login/card/identity
 * data.
 */
function enpassExportType(item: VaultItem): 1 | 2 | 3 | 4 {
  const t = item.type;
  if (t === 1 || t === 3 || t === 4) {
    if (t === 1 && !item.login && item.card) return 3;
    return t;
  }
  if (
    item.login &&
    (item.login.username || item.login.password || item.login.uris?.length || item.login.totp)
  )
    return 1;
  if (item.card) return 3;
  if (item.identity) return 4;
  if (t === 2) return 2;
  return item.login ? 1 : 2;
}

function getEnpassJsonExportWarnings(vault: VaultData): string[] {
  const warnings: string[] = [];
  const items = vault.items;
  if (
    items.some((item) =>
      item.login?.uris?.some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push("Enpass JSON does not preserve URI match settings.");
  }
  if (
    items.some(
      (item) =>
        item.identity?.title ||
        item.identity?.middleName ||
        item.identity?.username ||
        item.identity?.company ||
        item.identity?.address2 ||
        item.identity?.address3 ||
        item.identity?.ssn ||
        item.identity?.passportNumber ||
        item.identity?.licenseNumber,
    )
  ) {
    warnings.push("Enpass JSON does not preserve all identity fields.");
  }
  if (
    items.some(
      (item) =>
        item.favorite ||
        item.reprompt ||
        item.organizationId ||
        item.collectionIds?.length ||
        item.creationDate ||
        item.deletedDate ||
        item.lastModified ||
        item.revisionDate ||
        item.passwordHistory?.length ||
        item.fields?.some((field) => field.linkedId !== undefined && field.linkedId !== null) ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    warnings.push("Enpass JSON omits favorites, password history, and other metadata.");
  }
  return warnings;
}

function parseEnpassJson(ctx: VaultParseContext) {
  const root = objectValue(ctx.json);
  const parsed = enpassExportSchema.safeParse(root);
  if (!parsed.success)
    throw new Error("Invalid Enpass JSON: expected an items array with Enpass fields.");
  const foldersById = enpassFolderPaths(parsed.data.folders ?? []);
  const folders: VaultFolder[] = [...foldersById].map(([id, name]) => ({ id, name }));
  const items: VaultItem[] = [];
  const usedItemIds = new Set<string>();
  let trashed = 0;
  for (const [index, entry] of parsed.data.items.entries()) {
    if (entry.trashed === true || entry.trashed === 1) {
      trashed++;
      continue;
    }
    const fields = (entry.fields ?? []).filter((field) => {
      const fieldType = field.type?.toLowerCase() ?? "";
      return (
        field.deleted !== true &&
        field.deleted !== 1 &&
        fieldType !== "section" &&
        textValue(field.value) !== ""
      );
    });
    const template = entry.template_type ?? "";
    const type = template.startsWith("creditcard.")
      ? 3
      : template.startsWith("identity.")
        ? 4
        : template.startsWith("login.") ||
            template.startsWith("password.") ||
            (!template.startsWith("identity.") && fields.some((field) => field.type === "password"))
          ? 1
          : 2;
    const folderIds = entry.folders ?? [];
    const baseId = entry.uuid || `enpass-${index + 1}`;
    let itemId = baseId;
    if (usedItemIds.has(itemId)) {
      itemId = `enpass:${baseId}`;
      let suffix = 2;
      while (usedItemIds.has(itemId)) itemId = `enpass:${baseId}:${suffix++}`;
    }
    usedItemIds.add(itemId);
    const item = makeLoginItem({
      id: itemId,
      name: entry.title?.trim() || "Untitled",
      username: fieldValue(fields, "username") || fieldValue(fields, "email"),
      password: fieldValue(fields, "password"),
      uris: fields.filter((field) => field.type === "url").map((field) => textValue(field.value)),
      totp: fieldValue(fields, "totp"),
      notes: entry.note ?? "",
      folderId: folderIds[0] ?? null,
      type,
    });
    const secretTypes = new Set(["password", "totp", "pin", "ccpin", "cccvc", "cctxnpassword"]);
    const knownTypes = new Set([
      "username",
      "email",
      "password",
      "url",
      "totp",
      "ccname",
      "ccnumber",
      "cccvc",
      "ccexpiry",
      "cctype",
      "firstname",
      "lastname",
      "city",
      "state",
      "zip",
      "country",
      // Identity-only fields are mapped onto item.identity below; keeping them as custom fields too
      // would duplicate them on every export/import cycle.
      ...(type === 4 ? ["phone", "address"] : []),
    ]);
    const customFields = fields
      .filter((field) => !knownTypes.has(field.type?.toLowerCase() ?? ""))
      .map((field) => ({
        name: field.label?.trim() || field.type || "Field",
        value: textValue(field.value),
        type:
          field.sensitive === true ||
          field.sensitive === 1 ||
          secretTypes.has(field.type?.toLowerCase() ?? "")
            ? 1
            : 0,
      }));
    if (customFields.length) item.fields = customFields;
    if (type === 3) {
      item.card = {
        cardholderName: fieldValue(fields, "ccName"),
        brand: fieldValue(fields, "ccType"),
        number: fieldValue(fields, "ccNumber"),
        code: fieldValue(fields, "ccCvc"),
        ...enpassExpiry(fields),
      };
    }
    if (type === 4) {
      item.identity = {
        firstName: fieldValue(fields, "firstName"),
        lastName: fieldValue(fields, "lastName"),
        email: fieldValue(fields, "email"),
        phone: fieldValue(fields, "phone"),
        address1: fieldValue(fields, "address"),
        city: fieldValue(fields, "city"),
        state: fieldValue(fields, "state"),
        postalCode: fieldValue(fields, "zip"),
        country: fieldValue(fields, "country"),
      };
    }
    item.creationDate = enpassDate(entry.createdAt) ?? null;
    item.lastModified = enpassDate(entry.updated_at);
    if (entry.archived === true || entry.archived === 1) item["archived"] = true;
    if (folderIds.length > 1) {
      item.fields = [
        ...(item.fields ?? []),
        { name: "Enpass folders", value: folderIds.slice(1).join(",") },
      ];
    }
    items.push(item);
  }

  return {
    vault: { encrypted: false, folders, items },
    format: "enpass-json" as const,
    providerName: "Enpass",
    formatName: "Enpass JSON",
    warnings: trashed > 0 ? [`${trashed} item(s) in Enpass trash were omitted.`] : [],
  };
}

export const enpassJsonAdapter: VaultFormatAdapter = {
  info: {
    id: "enpass-json",
    name: "Enpass JSON",
    provider: "Enpass",
    extensions: [".json"],
    mimeType: "application/json",
    description: "Enpass unencrypted JSON export",
  },
  detect(ctx: VaultParseContext): number {
    const parsed = enpassExportSchema.safeParse(ctx.json);
    if (!parsed.success) return 0;
    const exportData = parsed.data;
    const hasEnpassMarkers = exportData.items.some(
      (item) =>
        item.template_type !== undefined ||
        item.fields?.some((field) => field.label !== undefined || field.sensitive !== undefined),
    );
    const hasEnpassFolders = exportData.folders?.some(
      (folder) => folder.uuid || folder.parent_uuid,
    );
    return hasEnpassFolders || hasEnpassMarkers ? 0.99 : 0;
  },
  parse: parseEnpassJson,
  export(vault: VaultData) {
    const folders = (vault.folders ?? []).map((folder) => ({
      uuid: folder.id,
      title: folder.name,
    }));
    const items = vault.items.map((item) => {
      const fields: EnpassField[] = [];
      const effectiveType = enpassExportType(item);
      if (effectiveType === 3) {
        if (item.card?.brand)
          fields.push({ label: "Type", type: "ccType", value: item.card.brand });
        if (item.card?.cardholderName)
          fields.push({ label: "Name", type: "ccName", value: item.card.cardholderName });
        if (item.card?.number)
          fields.push({
            label: "Number",
            type: "ccNumber",
            value: item.card.number,
            sensitive: true,
          });
        if (item.card?.code)
          fields.push({ label: "CVC", type: "ccCvc", value: item.card.code, sensitive: true });
        if (item.card?.expMonth && item.card.expYear)
          fields.push({
            label: "Expiry",
            type: "ccExpiry",
            value: `${item.card.expMonth}/${item.card.expYear}`,
          });
      } else if (effectiveType === 1) {
        if (item.login?.username)
          fields.push({ label: "Username", type: "username", value: item.login.username });
        if (item.login?.password)
          fields.push({
            label: "Password",
            type: "password",
            value: item.login.password,
            sensitive: true,
          });
        for (const uri of item.login?.uris ?? []) {
          const value = typeof uri === "string" ? uri : uri.uri;
          if (value) fields.push({ label: "Website", type: "url", value });
        }
        if (item.login?.totp)
          fields.push({ label: "TOTP", type: "totp", value: item.login.totp, sensitive: true });
      } else if (effectiveType === 4) {
        if (item.identity?.firstName)
          fields.push({ label: "First name", type: "firstName", value: item.identity.firstName });
        if (item.identity?.lastName)
          fields.push({ label: "Last name", type: "lastName", value: item.identity.lastName });
        if (item.identity?.email)
          fields.push({ label: "Email", type: "email", value: item.identity.email });
        if (item.identity?.phone)
          fields.push({ label: "Phone", type: "phone", value: item.identity.phone });
        if (item.identity?.address1)
          fields.push({ label: "Address", type: "address", value: item.identity.address1 });
        if (item.identity?.city)
          fields.push({ label: "City", type: "city", value: item.identity.city });
        if (item.identity?.state)
          fields.push({ label: "State", type: "state", value: item.identity.state });
        if (item.identity?.postalCode)
          fields.push({ label: "Postal code", type: "zip", value: item.identity.postalCode });
        if (item.identity?.country)
          fields.push({ label: "Country", type: "country", value: item.identity.country });
      }
      for (const field of item.fields ?? []) {
        if (field.name !== "Enpass folders")
          fields.push({
            label: field.name,
            type: "text",
            value: field.value,
            sensitive: field.type === 1,
          });
      }
      const additionalFolders = item.fields?.find(
        (field) => field.name === "Enpass folders",
      )?.value;
      return {
        ...(item.id ? { uuid: item.id } : {}),
        title: item.name ?? "Untitled",
        template_type:
          effectiveType === 2
            ? "note.secure"
            : effectiveType === 3
              ? "creditcard.creditcard"
              : effectiveType === 4
                ? "identity.identity"
                : "login.default",
        note: item.notes ?? "",
        folders: [
          ...(item.folderId ? [item.folderId] : []),
          ...(additionalFolders?.split(",").filter(Boolean) ?? []),
        ],
        fields,
      };
    });
    return {
      content: JSON.stringify({ folders, items }, null, 2),
      mimeType: "application/json",
      extension: "json",
      format: "enpass-json",
      warnings: getEnpassJsonExportWarnings(vault),
    };
  },
};

function getEnpassCsvExportWarnings(vault: VaultData, supportedItems: VaultItem[]): string[] {
  const warnings: string[] = [];
  if (supportedItems.length < vault.items.length) {
    warnings.push("Enpass login CSV only exports login items; non-login items were omitted.");
  }
  if (supportedItems.some((item) => (item.fields?.length ?? 0) > 2)) {
    warnings.push(
      "Enpass login CSV holds only two custom fields; additional custom fields were omitted.",
    );
  }
  if (supportedItems.some((item) => item.fields?.length)) {
    warnings.push("Enpass login CSV does not preserve custom field names or hidden/visible types.");
  }
  if (supportedItems.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
    warnings.push("Enpass login CSV preserves only the primary URI for each item.");
  }
  const folderMap = buildFolderNameMap(vault);
  if (supportedItems.some((item) => /[;,]/.test(getItemFolderName(item, folderMap)))) {
    warnings.push(
      "Enpass login CSV tags cannot contain commas or semicolons; they were replaced with spaces.",
    );
  }
  if (supportedItems.some((item) => item.card || item.identity || item.passwordHistory?.length)) {
    warnings.push("Enpass login CSV omits card/identity details and password history.");
  }
  return warnings;
}

export const enpassCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "enpass-csv",
    name: "Enpass Login CSV",
    provider: "Enpass",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "Enpass preformatted login CSV template",
  },
  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    return hasAllHeaders(headers, ["title", "username", "email", "password", "website", "tags"])
      ? 0.98
      : 0;
  },
  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    let extraTags = 0;
    const items = records.map((record, index) => {
      const tags = getRecordField(record, "tags")
        .split(/[;,]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length > 1) extraTags += tags.length - 1;
      const item = makeLoginItem({
        id: `enpass-${index + 1}`,
        name: getRecordField(record, "title") || "Untitled",
        username: getRecordField(record, "username") || getRecordField(record, "email"),
        password: getRecordField(record, "password"),
        uris: [getRecordField(record, "website")].filter(Boolean),
        totp: getRecordField(record, "totp secret key"),
        notes: getRecordField(record, "note"),
        folderId: folders.getOrCreate(tags[0]),
        type: 1,
      });
      const customFields = ["custom field 1", "*custom field 2"]
        .map((key) => ({ name: key.replace(/^\*/, ""), value: getRecordField(record, key) }))
        .filter((field) => field.value);
      if (customFields.length) item.fields = customFields;
      return item;
    });
    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "enpass-csv",
      providerName: "Enpass",
      formatName: "Enpass Login CSV",
      warnings: extraTags
        ? [
            `${extraTags} additional Enpass tag(s) were ignored; only the first tag becomes the folder.`,
          ]
        : [],
    };
  },
  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const supportedItems = vault.items.filter((item) => enpassExportType(item) === 1);
    const records = supportedItems.map((item) => ({
      Title: item.name ?? "",
      Username: item.login?.username ?? "",
      Email: "",
      Password: item.login?.password ?? "",
      Website: getPrimaryUri(item),
      "TOTP Secret Key": item.login?.totp ?? "",
      "Custom Field 1": item.fields?.[0]?.value ?? "",
      "*Custom Field 2": item.fields?.[1]?.value ?? "",
      Note: item.notes ?? "",
      Tags: getItemFolderName(item, folderMap).replace(/[;,]/g, " "),
    }));
    return {
      content: serializeCsvRecords(ENPASS_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "enpass-csv",
      warnings: getEnpassCsvExportWarnings(vault, supportedItems),
    };
  },
};

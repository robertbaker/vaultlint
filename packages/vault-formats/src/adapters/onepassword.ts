import type {
  VaultCard,
  VaultCustomField,
  VaultData,
  VaultIdentity,
  VaultItem,
} from "@vaultlint/vault-schema";
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
import { createZipArchive, isZipBytes, readZipEntriesSync } from "../zip";

interface OnePassword1PuxField {
  id?: string;
  name?: string;
  fieldType?: string;
  value?: string;
  designation?: string;
}

interface OnePassword1PuxSectionField {
  id?: string;
  title?: string;
  /** An object keyed by field type (`concealed`, `totp`, ...), or a bare string. */
  value?: string | { totp?: string; string?: string; concealed?: string; [key: string]: unknown };
}

interface OnePassword1PuxSection {
  title?: string;
  name?: string;
  fields?: OnePassword1PuxSectionField[];
}

interface OnePassword1PuxItem {
  uuid?: string;
  favIndex?: number;
  state?: string;
  createdAt?: number;
  updatedAt?: number;
  categoryUuid?: string;
  overview?: {
    title?: string;
    url?: string;
    urls?: Array<{ url?: string; label?: string }>;
    tags?: string[];
    subtitle?: string;
  };
  details?: {
    loginFields?: OnePassword1PuxField[];
    notesPlain?: string;
    password?: string;
    sections?: OnePassword1PuxSection[];
    passwordHistory?: Array<{ value?: string; time?: number }>;
    documentAttributes?: unknown;
  };
}

interface OnePassword1PuxData {
  accounts?: Array<{
    attrs?: {
      accountName?: string;
      name?: string;
      avatar?: string;
      email?: string;
      uuid?: string;
      domain?: string;
    };
    vaults?: Array<{
      attrs?: { uuid?: string; desc?: string; avatar?: string; name?: string; type?: string };
      items?: OnePassword1PuxItem[];
    }>;
  }>;
}

const onePassword1puxSchema = z
  .object({
    accounts: z.array(
      z
        .object({
          vaults: z
            .array(
              z
                .object({
                  items: z.array(z.unknown()).optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** The 1PUX spec stores timestamps as Unix seconds. */
function fromUnixSeconds(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toUnixSeconds(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/**
 * Per the 1PUX spec at most two loginFields carry a `designation` (username/password). Exports from
 * some versions omit it, so fall back to the field name and the `P` (password) field type.
 */
function findLoginField(fields: OnePassword1PuxField[], kind: "username" | "password") {
  const byDesignation = fields.find((f) => f.designation === kind);
  if (byDesignation) return byDesignation.value;
  const byName = fields.find((f) => !f.designation && f.name?.toLowerCase() === kind);
  if (byName) return byName.value;
  if (kind === "password") return fields.find((f) => !f.designation && f.fieldType === "P")?.value;
  return undefined;
}

/**
 * 1Password category UUIDs (001 Login, 002 Credit Card, 003 Secure Note, 004 Identity, 005
 * Password, 006 Document, 100+ Software License, Bank Account, Driver License, ...).
 * Credential-bearing categories stay logins; the remaining categories carry their data in sections,
 * so they import as secure notes with those sections as custom fields.
 */
const LOGIN_LIKE_CATEGORIES = new Set(["001", "005", "110", "112"]);

function bitwardenTypeForCategory(category: string | undefined): number {
  if (!category || LOGIN_LIKE_CATEGORIES.has(category)) return 1;
  if (category === "002") return 3;
  if (category === "004") return 4;
  return 2;
}

function normalizedFieldLabel(field: OnePassword1PuxSectionField): string {
  return `${field.title ?? field.id ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Render one typed 1PUX value (`monthYear`/`date` are numbers, `address` is an object). */
function describeFieldValue(kind: string, raw: unknown): string | undefined {
  if (typeof raw === "string") return raw || undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (kind === "monthYear") {
      const year = Math.floor(raw / 100);
      const month = raw % 100;
      if (year > 0 && month >= 1 && month <= 12) return `${String(month).padStart(2, "0")}/${year}`;
    }
    if (kind === "date") {
      const date = new Date(raw * 1000);
      if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }
    return String(raw);
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const parts = Object.values(raw as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  return undefined;
}

function normalizedFieldId(field: OnePassword1PuxSectionField): string {
  return `${field.id ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldText(field: OnePassword1PuxSectionField): string | undefined {
  if (typeof field.value === "string") return field.value || undefined;
  if (!field.value || typeof field.value !== "object") return undefined;
  for (const key of [
    "string",
    "concealed",
    "creditCardNumber",
    "creditCardType",
    "monthYear",
    "email",
    "phone",
    "date",
  ]) {
    const value = describeFieldValue(key, field.value[key]);
    if (value) return value;
  }
  return undefined;
}

function map1PasswordStructuredFields(
  category: string | undefined,
  sections: OnePassword1PuxSection[],
): { card?: VaultCard; identity?: VaultIdentity; consumed: WeakSet<object> } {
  const consumed = new WeakSet<object>();
  const card: VaultCard = {};
  const identity: VaultIdentity = {};
  const cardLabels: Record<string, keyof VaultCard> = {
    "cardholder name": "cardholderName",
    "card holder": "cardholderName",
    "name on card": "cardholderName",
    cardholder: "cardholderName",
    number: "number",
    ccnum: "number",
    type: "brand",
    "card number": "number",
    "credit card number": "number",
    "cc number": "number",
    "card type": "brand",
    "credit card type": "brand",
    brand: "brand",
    "expiration date": "expMonth",
    "expiry date": "expMonth",
    expiration: "expMonth",
    expiry: "expMonth",
    "expiration month": "expMonth",
    "expiry month": "expMonth",
    "expiration year": "expYear",
    "expiry year": "expYear",
    "security code": "code",
    "verification number": "code",
    cvv: "code",
    cvc: "code",
  };
  const identityLabels: Record<string, string> = {
    "first name": "firstName",
    firstname: "firstName",
    "middle name": "middleName",
    initial: "middleName",
    lastname: "lastName",
    "last name": "lastName",
    title: "title",
    company: "company",
    "company name": "company",
    username: "username",
    email: "email",
    phone: "phone",
    "default phone": "phone",
    "phone number": "phone",
    address: "address1",
    "address line 1": "address1",
    "address line 2": "address2",
    "address line 3": "address3",
    city: "city",
    state: "state",
    province: "state",
    "postal code": "postalCode",
    "zip code": "postalCode",
    country: "country",
    "social security number": "ssn",
    ssn: "ssn",
    "passport number": "passportNumber",
    "driver license number": "licenseNumber",
    "license number": "licenseNumber",
  };
  const setIfValue = (target: object, key: string, value: string, overwrite: boolean) => {
    const record = target as Record<string, unknown>;
    if (overwrite || record[key] === undefined) record[key] = value;
  };

  for (const section of sections) {
    for (const field of section.fields ?? []) {
      const address =
        category === "004" && field.value && typeof field.value === "object"
          ? (field.value["address"] as Record<string, unknown> | undefined)
          : undefined;
      if (address && typeof address === "object") {
        const parts: Array<[string, unknown]> = [
          ["address1", address["street"]],
          ["city", address["city"]],
          ["state", address["state"]],
          ["postalCode", address["zip"]],
          ["country", address["country"]],
        ];
        for (const [key, v] of parts) {
          if (typeof v === "string" && v) setIfValue(identity, key, v, false);
        }
        consumed.add(field);
        continue;
      }
      const value = fieldText(field);
      if (!value) continue;
      const labels = [normalizedFieldLabel(field), normalizedFieldId(field)];
      const mappedCard =
        category === "002" ? labels.map((l) => cardLabels[l]).find(Boolean) : undefined;
      const mappedIdentity =
        category === "004" ? labels.map((l) => identityLabels[l]).find(Boolean) : undefined;
      if (mappedCard === "expMonth") {
        const [month, year] = value.split(/[ /-]+/).filter(Boolean);
        if (month) setIfValue(card, "expMonth", month, false);
        if (year) setIfValue(card, "expYear", year, false);
        consumed.add(field);
      } else if (mappedCard === "expYear") {
        setIfValue(card, "expYear", value, false);
        consumed.add(field);
      } else if (mappedCard) {
        setIfValue(card, mappedCard, value, false);
        consumed.add(field);
      } else if (mappedIdentity) {
        setIfValue(identity, mappedIdentity, value, false);
        consumed.add(field);
      }
    }
  }

  return {
    ...(Object.keys(card).length > 0 ? { card } : {}),
    ...(Object.keys(identity).length > 0 ? { identity } : {}),
    consumed,
  };
}

function extract1PuxJsonFromContext(ctx: VaultParseContext): OnePassword1PuxData | null {
  if (ctx.json && typeof ctx.json === "object" && !Array.isArray(ctx.json)) {
    const parsed = onePassword1puxSchema.safeParse(ctx.json);
    if (!parsed.success) return null;
    const obj = ctx.json as OnePassword1PuxData;
    return obj;
  }
  if (ctx.bytes && isZipBytes(ctx.bytes)) {
    const entries = readZipEntriesSync(ctx.bytes);
    const exportDataBytes = entries.get("export.data");
    if (exportDataBytes) {
      const text = new TextDecoder().decode(exportDataBytes);
      const json = JSON.parse(text);
      if (onePassword1puxSchema.safeParse(json).success) return json as OnePassword1PuxData;
    }
  }
  return null;
}

export const onePassword1puxAdapter: VaultFormatAdapter = {
  info: {
    id: "1password-1pux",
    name: "1Password 1PUX",
    provider: "1Password",
    extensions: [".1pux", ".json"],
    mimeType: "application/zip",
    description: "1Password Unencrypted Export (.1pux archive or export.data JSON)",
  },

  detect(ctx: VaultParseContext): number {
    if (ctx.json && typeof ctx.json === "object" && !Array.isArray(ctx.json)) {
      if (onePassword1puxSchema.safeParse(ctx.json).success) return 0.96;
    }
    if (ctx.bytes && isZipBytes(ctx.bytes)) {
      try {
        const entries = readZipEntriesSync(ctx.bytes);
        if (entries.has("export.data")) return 0.98;
      } catch {
        // Not a valid/readable 1pux zip
      }
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const data = extract1PuxJsonFromContext(ctx);
    if (!data || !Array.isArray(data.accounts)) {
      throw new Error("Invalid 1Password 1PUX format: missing accounts/export.data.");
    }

    const warnings: string[] = [];
    if (ctx.bytes && isZipBytes(ctx.bytes)) {
      const attributes = readZipEntriesSync(ctx.bytes).get("export.attributes");
      if (attributes) {
        try {
          const { version } = JSON.parse(new TextDecoder().decode(attributes)) as {
            version?: number;
          };
          if (version !== undefined && version !== 3) {
            warnings.push(
              `Unrecognized 1PUX format version ${version}; this importer targets version 3.`,
            );
          }
        } catch {
          warnings.push("Could not read 1PUX export.attributes.");
        }
      }
    }

    const folders = new FolderRegistry();
    const items: VaultItem[] = [];
    const usedItemIds = new Set<string>();
    let taggedItems = 0;
    let attachmentItems = 0;

    for (const account of data.accounts) {
      for (const vault of account.vaults ?? []) {
        const folderId = folders.getOrCreate(vault.attrs?.name);
        for (const rawItem of vault.items ?? []) {
          if (rawItem.state === "trashed") continue;
          if (rawItem.overview?.tags?.length) taggedItems++;
          if (rawItem.details?.documentAttributes) attachmentItems++;
          const loginFields = rawItem.details?.loginFields ?? [];
          const username = findLoginField(loginFields, "username") ?? "";
          const password =
            findLoginField(loginFields, "password") ?? rawItem.details?.password ?? "";

          const uris: string[] = [];
          if (rawItem.overview?.url) uris.push(rawItem.overview.url);
          for (const u of rawItem.overview?.urls ?? []) {
            if (u.url && !uris.includes(u.url)) uris.push(u.url);
          }

          const category = rawItem.categoryUuid;
          const itemType = bitwardenTypeForCategory(category);
          const structured = map1PasswordStructuredFields(
            category,
            rawItem.details?.sections ?? [],
          );

          let totp = "";
          const customFields: VaultCustomField[] = [];
          for (const section of rawItem.details?.sections ?? []) {
            for (const f of section.fields ?? []) {
              // Fields already mapped to the card/identity must not be repeated as custom fields,
              // otherwise every export/import cycle would duplicate them.
              if (structured.consumed.has(f)) continue;
              // Section values are normally { <type>: value }, but the docs allow a bare string.
              const value = typeof f.value === "string" ? { string: f.value } : (f.value ?? {});
              const isOtpUri =
                typeof value.string === "string" && value.string.startsWith("otpauth://");
              if (!totp && (value.totp || isOtpUri)) {
                totp = value.totp || (value.string as string);
                continue;
              }
              // Remaining section fields become custom fields (numbers/objects are rendered as text).
              for (const [kind, raw] of Object.entries(value)) {
                if (kind === "totp") continue;
                const text = describeFieldValue(kind, raw);
                if (!text) continue;
                const label = f.title || f.id || kind;
                customFields.push({
                  name: section.title ? `${section.title}: ${label}` : label,
                  value: text,
                  type: kind === "concealed" ? 1 : 0,
                });
                break;
              }
            }
          }

          const baseItemId = rawItem.uuid || `1p-${items.length + 1}`;
          let itemId = baseItemId;
          if (usedItemIds.has(itemId)) {
            itemId = `${vault.attrs?.uuid || vault.attrs?.name || "vault"}:${baseItemId}`;
            let suffix = 2;
            while (usedItemIds.has(itemId)) {
              itemId = `${vault.attrs?.uuid || vault.attrs?.name || "vault"}:${baseItemId}:${suffix++}`;
            }
          }
          usedItemIds.add(itemId);

          const parsedItem = makeLoginItem({
            id: itemId,
            name: rawItem.overview?.title || "Untitled",
            username,
            password,
            uris,
            totp,
            notes: rawItem.details?.notesPlain ?? "",
            folderId,
            favorite: (rawItem.favIndex ?? 0) > 0,
            lastModified: fromUnixSeconds(rawItem.updatedAt),
            type: itemType,
          });
          const creationDate = fromUnixSeconds(rawItem.createdAt);
          if (creationDate) parsedItem.creationDate = creationDate;
          if (customFields.length > 0) parsedItem.fields = customFields;
          if (structured.card) parsedItem.card = structured.card;
          if (structured.identity) parsedItem.identity = structured.identity;
          const history = (rawItem.details?.passwordHistory ?? [])
            .filter((h) => typeof h.value === "string" && h.value)
            .map((h) => ({
              password: h.value as string,
              lastUsedDate: fromUnixSeconds(h.time) ?? null,
            }));
          if (history.length > 0) parsedItem.passwordHistory = history;
          items.push(parsedItem);
        }
      }
    }

    if (taggedItems > 0) {
      warnings.push(`${taggedItems} item(s) had 1Password tags, which are not imported.`);
    }
    if (attachmentItems > 0) {
      warnings.push(`${attachmentItems} item(s) had file attachments, which are not imported.`);
    }

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "1password-1pux",
      providerName: "1Password",
      formatName: "1Password 1PUX",
      warnings,
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const byVault = new Map<string, OnePassword1PuxItem[]>();

    vault.items.forEach((item, idx) => {
      const vaultName = getItemFolderName(item, folderMap) || "Personal";
      const list = byVault.get(vaultName) ?? [];
      const uris = getAllUris(item);
      const categoryUuid =
        item.type === 2 ? "003" : item.type === 3 ? "002" : item.type === 4 ? "004" : "001";
      const nowSeconds = Math.floor(Date.now() / 1000);
      const updatedAt = toUnixSeconds(item.lastModified) ?? nowSeconds;
      const createdAt = toUnixSeconds(item.creationDate) ?? updatedAt;

      const sections: OnePassword1PuxSection[] = [];
      if (item.login?.totp) {
        sections.push({
          title: "",
          name: "TOTP_section",
          fields: [
            {
              id: "TOTP_field",
              title: "one-time password",
              value: { totp: item.login.totp },
            },
          ],
        });
      }
      if (item.type === 3 && item.card) {
        const fields: OnePassword1PuxSectionField[] = [];
        const push = (title: string, value: string | number | undefined, kind = "string") => {
          if (value)
            fields.push({ id: `card-${fields.length + 1}`, title, value: { [kind]: value } });
        };
        push("Cardholder Name", item.card.cardholderName);
        push("Credit Card Type", item.card.brand, "creditCardType");
        push("Credit Card Number", item.card.number, "creditCardNumber");
        const expiry = [item.card.expMonth, item.card.expYear].filter(Boolean).join("/");
        // 1Password stores monthYear as a YYYYMM number; keep free-form text as a string.
        const numericExpiry =
          /^\d{1,2}$/.test(item.card.expMonth ?? "") && /^\d{4}$/.test(item.card.expYear ?? "")
            ? Number(item.card.expYear) * 100 + Number(item.card.expMonth)
            : undefined;
        push("Expiration Date", numericExpiry ?? expiry, "monthYear");
        push("Security Code", item.card.code, "concealed");
        if (fields.length > 0) sections.push({ title: "Credit Card", name: "credit_card", fields });
      }
      if (item.type === 4 && item.identity) {
        const fields: OnePassword1PuxSectionField[] = [];
        const identityLabels: Array<[keyof VaultIdentity, string]> = [
          ["title", "Title"],
          ["firstName", "First Name"],
          ["middleName", "Middle Name"],
          ["lastName", "Last Name"],
          ["company", "Company"],
          ["username", "Username"],
          ["email", "Email"],
          ["phone", "Phone"],
          ["address1", "Address Line 1"],
          ["address2", "Address Line 2"],
          ["address3", "Address Line 3"],
          ["city", "City"],
          ["state", "State"],
          ["postalCode", "Postal Code"],
          ["country", "Country"],
          ["ssn", "Social Security Number"],
          ["passportNumber", "Passport Number"],
          ["licenseNumber", "License Number"],
        ];
        for (const [key, title] of identityLabels) {
          const value = item.identity[key];
          if (typeof value === "string" && value) {
            fields.push({ id: `identity-${fields.length + 1}`, title, value: { string: value } });
          }
        }
        if (fields.length > 0) sections.push({ title: "Identity", name: "identity", fields });
      }
      const customFields = (item.fields ?? []).filter((f) => f.name || f.value);
      if (customFields.length > 0) {
        sections.push({
          title: "Custom Fields",
          name: "Section_custom_fields",
          fields: customFields.map((f, fieldIdx) => ({
            id: `custom-${fieldIdx + 1}`,
            title: f.name,
            value: f.type === 1 ? { concealed: f.value } : { string: f.value },
          })),
        });
      }

      const passwordHistory = (item.passwordHistory ?? [])
        .filter((h) => h.password)
        .map((h) => ({ value: h.password, time: toUnixSeconds(h.lastUsedDate) ?? updatedAt }));

      list.push({
        uuid: item.id || `item-${idx + 1}`,
        favIndex: item.favorite ? 1 : 0,
        createdAt,
        updatedAt,
        state: "active",
        categoryUuid,
        overview: {
          subtitle: item.login?.username ?? "",
          title: item.name ?? "Untitled",
          url: uris[0] ?? "",
          urls: uris.map((url) => ({ url, label: "website" })),
        },
        details: {
          loginFields: [
            {
              id: "",
              name: "username",
              fieldType: "T",
              designation: "username",
              value: item.login?.username ?? "",
            },
            {
              id: "",
              name: "password",
              fieldType: "P",
              designation: "password",
              value: item.login?.password ?? "",
            },
          ],
          notesPlain: item.notes ?? "",
          sections,
          ...(passwordHistory.length > 0 ? { passwordHistory } : {}),
        },
      });
      byVault.set(vaultName, list);
    });

    // Vault type: "P" personal, "E" everyone, "U" user-created.
    const vaults = [...byVault.entries()].map(([name, items], idx) => ({
      attrs: {
        uuid: `vault-${idx + 1}`,
        desc: "",
        avatar: "",
        name,
        type: name === "Personal" ? "P" : "U",
      },
      items,
    }));

    const exportData: OnePassword1PuxData = {
      accounts: [
        {
          attrs: {
            accountName: "vaultlint",
            name: "vaultlint",
            avatar: "",
            email: "",
            uuid: "vaultlint-account",
            domain: "",
          },
          vaults,
        },
      ],
    };

    const zipBytes = createZipArchive({
      "export.attributes": JSON.stringify({
        version: 3,
        description: "1Password Unencrypted Export",
        createdAt: Math.floor(Date.now() / 1000),
      }),
      "export.data": JSON.stringify(exportData, null, 2),
    });

    return {
      content: zipBytes,
      mimeType: "application/zip",
      extension: "1pux",
      format: "1password-1pux",
      warnings: getOnePasswordExportWarnings(vault, false),
    };
  },
};

const ONEPASSWORD_CSV_HEADERS = [
  "Title",
  "Url",
  "Username",
  "Password",
  "OTPAuth",
  "Favorite",
  "Archived",
  "Tags",
  "Notes",
] as const;

function getOnePasswordExportWarnings(vault: VaultData, csv: boolean): string[] {
  const warnings: string[] = [];
  const dropsExtras = (item: VaultItem) =>
    csv ? item.fields?.length || item.passwordHistory?.length : false;
  if (
    vault.items.some(
      (item) =>
        (csv && (item.card || item.identity)) ||
        dropsExtras(item) ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    warnings.push(
      csv
        ? "1Password CSV omits card and identity details, custom fields, password history, and FIDO2 credentials; export as 1PUX or JSON to retain them."
        : "1Password 1PUX export omits FIDO2 credentials; card and identity details, custom fields, and password history are preserved.",
    );
  }
  if (csv) {
    if (vault.items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
      warnings.push("1Password CSV preserves only the primary URI for each item.");
    }
    if (vault.items.some((item) => item.type !== undefined && item.type !== 1)) {
      warnings.push("1Password CSV does not preserve item types.");
    }
    if (
      vault.items.some(
        (item) => item.id || item.lastModified || item.revisionDate || item.deletedDate,
      )
    ) {
      warnings.push("1Password CSV omits item IDs and dates.");
    }
  }
  if (
    vault.items.some((item) =>
      (item.login?.uris ?? []).some(
        (uri) => typeof uri !== "string" && uri.match !== undefined && uri.match !== null,
      ),
    )
  ) {
    warnings.push(`1Password ${csv ? "CSV" : "1PUX"} does not preserve URI match settings.`);
  }
  return warnings;
}

/**
 * Escape a folder name for the comma-separated Tags column: a comma becomes `\,` and a backslash is
 * doubled only when it precedes a comma or another backslash (so ordinary names are untouched).
 */
export function encodeOnePasswordTag(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    const next = name[i + 1];
    if (ch === ",") out += "\\,";
    else if (ch === "\\" && (next === "\\" || next === ",")) out += "\\\\";
    else out += ch;
  }
  return out;
}

/**
 * Split a Tags cell into tags, honouring the `\,` and `\\` escapes written by
 * `encodeOnePasswordTag`.
 */
export function splitOnePasswordTags(raw: string): string[] {
  const tags: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (ch === "\\" && (next === "," || next === "\\")) {
      current += next;
      i++;
    } else if (ch === ",") {
      tags.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tags.push(current);
  return tags.map((t) => t.trim()).filter(Boolean);
}

export const onePasswordCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "1password-csv",
    name: "1Password CSV",
    provider: "1Password",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "1Password CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    const hasTitle = hasAllHeaders(headers, ["Title", "Username", "Password"]);
    if (!hasTitle) return 0;
    if (hasAllHeaders(headers, ["OTPAuth", "Favorite", "Tags"])) return 0.97;
    if (hasAllHeaders(headers, ["Url", "Username", "Password"])) {
      return 0.85;
    }
    if (hasAllHeaders(headers, ["Website", "Username", "Password"])) {
      return 0.9;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    let extraTags = 0;
    const items: VaultItem[] = records.map((rec, idx) => {
      const tags = splitOnePasswordTags(getRecordField(rec, "Tags"));
      if (tags.length > 1) extraTags += tags.length - 1;
      const firstTag = tags[0] ?? getRecordField(rec, "Folder", "Vault").trim();
      const folderId = folders.getOrCreate(firstTag);
      const url = getRecordField(rec, "Url", "URL", "Website");
      const favRaw = getRecordField(rec, "Favorite").trim().toLowerCase();
      const rawType = getRecordField(rec, "Type").trim().toLowerCase();
      const itemType =
        rawType === "secure note" || rawType === "note"
          ? 2
          : rawType === "credit card" || rawType === "card"
            ? 3
            : rawType === "identity"
              ? 4
              : 1;
      return makeLoginItem({
        id: `1p-csv-${idx + 1}`,
        name: getRecordField(rec, "Title") || url || "Untitled",
        username: getRecordField(rec, "Username"),
        password: getRecordField(rec, "Password"),
        uris: url ? [url] : [],
        totp: getRecordField(rec, "OTPAuth", "TOTP"),
        notes: getRecordField(rec, "Notes"),
        folderId,
        favorite: favRaw === "true" || favRaw === "1",
        type: itemType,
      });
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "1password-csv",
      providerName: "1Password",
      formatName: "1Password CSV",
      warnings: extraTags
        ? [
            `${extraTags} additional 1Password tag(s) were ignored; only the first tag becomes the folder.`,
          ]
        : [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => ({
      Title: item.name ?? "",
      Url: getPrimaryUri(item),
      Username: item.login?.username ?? "",
      Password: item.login?.password ?? "",
      OTPAuth: item.login?.totp ?? "",
      Favorite: item.favorite ? "true" : "false",
      Archived: "false",
      Tags: encodeOnePasswordTag(getItemFolderName(item, folderMap)),
      Notes: item.notes ?? "",
    }));

    return {
      content: serializeCsvRecords(ONEPASSWORD_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "1password-csv",
      warnings: getOnePasswordExportWarnings(vault, true),
    };
  },
};

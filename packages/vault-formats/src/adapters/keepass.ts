import type { VaultData, VaultItem } from "@vaultlint/vault-schema";

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
import { escapeXml, findChild, findChildren, parseXml, type XmlNode } from "../xml";

const KEEPASS_CSV_HEADERS = [
  "Group",
  "Title",
  "Username",
  "Password",
  "URL",
  "Notes",
  "TOTP",
  "Last Modified",
] as const;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const KEEPASS_UUID_BYTES = 16;

function encodeBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    encoded +=
      second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return encoded;
}

function decodeBase64Uuid(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(value)) return undefined;
  const bytes = new Uint8Array(KEEPASS_UUID_BYTES);
  let byteIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const chars = value.slice(index, index + 4);
    const values = [...chars].map((char) => (char === "=" ? 0 : BASE64_ALPHABET.indexOf(char)));
    if (values.some((entry) => entry < 0)) return undefined;
    const [a, b, c, d] = values;
    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (chars[2] !== "=") bytes[byteIndex++] = ((b & 0x0f) << 4) | (c >> 2);
    if (chars[3] !== "=") bytes[byteIndex++] = ((c & 0x03) << 6) | d;
  }
  return byteIndex === KEEPASS_UUID_BYTES && encodeBase64(bytes) === value ? bytes : undefined;
}

function decodeHexUuid(value: string): Uint8Array | undefined {
  const hex = value.replaceAll("-", "");
  if (!/^[\da-f]{32}$/i.test(hex)) return undefined;
  return Uint8Array.from({ length: KEEPASS_UUID_BYTES }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

/** Stable 128-bit identifier for IDs that are not already KeePass UUIDs. */
function hashItemId(id: string, salt = ""): Uint8Array {
  const input = new TextEncoder().encode(`${id}\u0000${salt}`);
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  const mask = 0xffffffffffffffffn;
  for (const byte of input) {
    first = ((first ^ BigInt(byte)) * 0x100000001b3n) & mask;
    second = ((second ^ BigInt(byte + 0x9d)) * 0x100000001b3n) & mask;
  }
  const bytes = new Uint8Array(KEEPASS_UUID_BYTES);
  for (let index = 0; index < 8; index++) {
    bytes[index] = Number((first >> BigInt((7 - index) * 8)) & 0xffn);
    bytes[index + 8] = Number((second >> BigInt((7 - index) * 8)) & 0xffn);
  }
  // RFC 4122 version/variant bits make the bytes recognizable as a name-derived UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

function getKeePassExportUuids(items: readonly VaultItem[]): string[] {
  const reserved = new Set(
    items.flatMap((item) => {
      if (!item.id) return [];
      const bytes = decodeBase64Uuid(item.id) ?? decodeHexUuid(item.id);
      return bytes ? [encodeBase64(bytes)] : [];
    }),
  );
  const used = new Set<string>();
  const duplicateCounts = new Map<string, number>();
  return items.map((item, index) => {
    const id = item.id || `vaultlint-item-${index + 1}`;
    const directBytes = item.id ? (decodeBase64Uuid(item.id) ?? decodeHexUuid(item.id)) : undefined;
    const directUuid = directBytes ? encodeBase64(directBytes) : undefined;
    let occurrence = duplicateCounts.get(id) ?? 0;
    duplicateCounts.set(id, occurrence + 1);
    let usingDirectUuid = directUuid !== undefined;
    let uuid = directUuid ?? encodeBase64(hashItemId(id));
    while (used.has(uuid) || (!usingDirectUuid && reserved.has(uuid))) {
      usingDirectUuid = false;
      uuid = encodeBase64(hashItemId(id, `duplicate-${++occurrence}`));
    }
    used.add(uuid);
    return uuid;
  });
}

function hasNonKeePassItemIds(items: readonly VaultItem[]): boolean {
  const seen = new Set<string>();
  return items.some((item) => {
    if (!item.id) return false;
    const id = item.id;
    const bytes = decodeBase64Uuid(id) ?? decodeHexUuid(id);
    const uuid = bytes ? encodeBase64(bytes) : undefined;
    const uniqueKey = uuid ?? id;
    const duplicate = seen.has(uniqueKey);
    seen.add(uniqueKey);
    return !uuid || duplicate;
  });
}

function getKeePassExportWarnings(vault: VaultData, csv: boolean): string[] {
  const warnings: string[] = [];
  const items = vault.items;
  const format = csv ? "KeePass CSV" : "KeePass XML";
  if (csv && items.some((item) => (item.login?.uris?.length ?? 0) > 1)) {
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
  if (csv) {
    if (
      items.some(
        (item) =>
          (item.type !== undefined && item.type !== 1) ||
          item.card ||
          item.identity ||
          item.fields?.length,
      )
    ) {
      warnings.push(
        `${format} does not preserve item types, card/identity details, or custom fields.`,
      );
    }
  } else {
    if (items.some((item) => item.type !== undefined && ![1, 3, 4].includes(item.type))) {
      warnings.push(
        `${format} does not preserve item types other than login, card, and identity (e.g. secure notes become plain entries).`,
      );
    }
    if (
      items.some((item) =>
        item.fields?.some((f) => f.linkedId !== undefined && f.linkedId !== null),
      )
    ) {
      warnings.push(
        `${format} does not preserve linked custom fields; their values were exported as plain text.`,
      );
    }
  }
  if (
    items.some(
      (item) =>
        item.favorite ||
        item.reprompt ||
        item.organizationId ||
        item.collectionIds?.length ||
        (csv && item.creationDate) ||
        item.deletedDate ||
        (csv && item.id) ||
        item.passwordHistory?.length ||
        item.login?.fido ||
        item.login?.fido2Credentials?.length,
    )
  ) {
    const idWarning = csv ? " item IDs," : "";
    warnings.push(`${format} omits favorites,${idWarning} and other metadata.`);
  }
  if (!csv && hasNonKeePassItemIds(items)) {
    warnings.push(
      `${format} converts non-KeePass item IDs to stable 16-byte UUIDs required by KeePass XML.`,
    );
  }
  return warnings;
}

export const keepassCsvAdapter: VaultFormatAdapter = {
  info: {
    id: "keepass-csv",
    name: "KeePass / KeePassXC CSV",
    provider: "KeePass",
    extensions: [".csv"],
    mimeType: "text/csv",
    description: "KeePass 2.x or KeePassXC unencrypted CSV export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const { headers } = parseCsvRecords(ctx.text);
    if (hasAllHeaders(headers, ["Group", "Title", "Username", "Password", "URL"])) {
      return 0.96;
    }
    if (hasAllHeaders(headers, ["Title", "User Name", "Password", "URL"])) {
      return 0.94;
    }
    if (hasAllHeaders(headers, ["Account", "Login Name", "Password", "Web Site"])) {
      return 0.95;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const { records } = parseCsvRecords(ctx.text ?? "");
    const folders = new FolderRegistry();
    const items: VaultItem[] = records.map((rec, idx) => {
      const groupRaw = getRecordField(rec, "Group");
      const cleanGroup = groupRaw.replace(/^Root(?:\/|$)/i, "");
      const folderId = folders.getOrCreate(cleanGroup);
      const url = getRecordField(rec, "URL", "Web Site");
      return makeLoginItem({
        id: `kp-csv-${idx + 1}`,
        name: getRecordField(rec, "Title", "Account") || url || "Untitled",
        username: getRecordField(rec, "Username", "User Name", "Login Name"),
        password: getRecordField(rec, "Password"),
        uris: url ? [url] : [],
        totp: getRecordField(rec, "TOTP", "otp"),
        notes: getRecordField(rec, "Notes", "Comments"),
        folderId,
        lastModified: getRecordField(rec, "Last Modified") || undefined,
      });
    });

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "keepass-csv",
      providerName: "KeePass",
      formatName: "KeePass / KeePassXC CSV",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const folderMap = buildFolderNameMap(vault);
    const records = vault.items.map((item) => {
      const folder = getItemFolderName(item, folderMap);
      return {
        Group: folder ? `Root/${folder}` : "Root",
        Title: item.name ?? "",
        Username: item.login?.username ?? "",
        Password: item.login?.password ?? "",
        URL: getPrimaryUri(item),
        Notes: item.notes ?? "",
        TOTP: item.login?.totp ?? "",
        "Last Modified": item.lastModified ?? "",
      };
    });

    return {
      content: serializeCsvRecords(KEEPASS_CSV_HEADERS, records),
      mimeType: "text/csv",
      extension: "csv",
      format: "keepass-csv",
      warnings: getKeePassExportWarnings(vault, true),
    };
  },
};

interface EntryStrings {
  strings: Record<string, string>;
  protectedKeys: Set<string>;
}

function readEntryStrings(entryNode: XmlNode): EntryStrings {
  const strings = Object.create(null) as Record<string, string>;
  const protectedKeys = new Set<string>();
  for (const strNode of findChildren(entryNode, "String")) {
    const key = findChild(strNode, "Key")?.text.trim() ?? "";
    const valueNode = findChild(strNode, "Value");
    if (!key) continue;
    strings[key] = valueNode?.text ?? "";
    if (
      valueNode?.attributes["ProtectInMemory"] === "True" ||
      valueNode?.attributes["Protected"] === "True"
    ) {
      protectedKeys.add(key);
    }
  }
  return { strings, protectedKeys };
}

/** String keys that map onto canonical login fields and are therefore not custom fields. */
const KEEPASS_RESERVED_KEYS = new Set([
  "Title",
  "UserName",
  "Password",
  "URL",
  "Notes",
  "otp",
  "TOTP",
  "TOTP Seed",
  "TimeOtp-Secret-Base32",
]);
const KEEPASS_CUSTOM_PREFIX = "field:";
// Reserved, namespaced prefixes so user-defined strings like "card.number" stay custom fields.
const KEEPASS_CARD_PREFIX = "vaultlint:card.";
const KEEPASS_IDENTITY_PREFIX = "vaultlint:identity.";
const KEEPASS_RESERVED_PREFIX = "vaultlint:";
const KEEPASS_EXTRA_URL = /^KP2A_URL(?:_(\d+))?$/;

function isKeePassManagedKey(key: string): boolean {
  return (
    KEEPASS_RESERVED_KEYS.has(key) ||
    key.startsWith("TimeOtp-") ||
    key.startsWith(KEEPASS_RESERVED_PREFIX) ||
    KEEPASS_EXTRA_URL.test(key)
  );
}

/** KeePass inner-stream encrypted values (`Protected="True"`) hold ciphertext, not plaintext. */
function assertNoEncryptedValues(entry: XmlNode): void {
  for (const strNode of findChildren(entry, "String")) {
    const valueNode = findChild(strNode, "Value");
    if (valueNode?.attributes["Protected"] === "True" && valueNode.text.trim()) {
      throw new Error(
        'Encrypted KeePass XML values detected (Protected="True"). Export an unencrypted XML (not the raw database inner XML) from KeePass or KeePassXC.',
      );
    }
  }
}

function parseKeePassEntry(entry: XmlNode, folderId: string | null, fallbackId: string): VaultItem {
  assertNoEncryptedValues(entry);
  const { strings: fields, protectedKeys } = readEntryStrings(entry);
  const times = findChild(entry, "Times");
  const lastMod = times ? findChild(times, "LastModificationTime")?.text.trim() : undefined;
  const created = times ? findChild(times, "CreationTime")?.text.trim() : undefined;
  const url = fields["URL"] ?? "";
  const uuid = findChild(entry, "UUID")?.text.trim();

  const extraUrls = Object.keys(fields)
    .map((key) => ({ match: KEEPASS_EXTRA_URL.exec(key), key }))
    .filter((candidate) => candidate.match && fields[candidate.key])
    .sort((a, b) => Number(a.match![1] ?? 0) - Number(b.match![1] ?? 0))
    .map((candidate) => fields[candidate.key]);

  const card: Record<string, string> = {};
  const identity: Record<string, string> = {};
  const customFields: NonNullable<VaultItem["fields"]> = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith(KEEPASS_CUSTOM_PREFIX)) {
      customFields.push({
        name: key.slice(KEEPASS_CUSTOM_PREFIX.length),
        value,
        type: protectedKeys.has(key) ? 1 : 0,
      });
    } else if (key.startsWith(KEEPASS_CARD_PREFIX) && key.length > KEEPASS_CARD_PREFIX.length) {
      card[key.slice(KEEPASS_CARD_PREFIX.length)] = value;
    } else if (
      key.startsWith(KEEPASS_IDENTITY_PREFIX) &&
      key.length > KEEPASS_IDENTITY_PREFIX.length
    ) {
      identity[key.slice(KEEPASS_IDENTITY_PREFIX.length)] = value;
    } else if (!isKeePassManagedKey(key)) {
      customFields.push({ name: key, value, type: protectedKeys.has(key) ? 1 : 0 });
    }
  }
  const hasCard = Object.keys(card).length > 0;
  const hasIdentity = !hasCard && Object.keys(identity).length > 0;

  const item = makeLoginItem({
    id: uuid || fallbackId,
    name: fields["Title"] || url || "Untitled",
    username: fields["UserName"] ?? "",
    password: fields["Password"] ?? "",
    uris: [...(url ? [url] : []), ...extraUrls],
    totp:
      fields["otp"] ||
      fields["TOTP"] ||
      fields["TimeOtp-Secret-Base32"] ||
      fields["TOTP Seed"] ||
      "",
    notes: fields["Notes"] ?? "",
    folderId,
    lastModified: lastMod || undefined,
    type: hasCard ? 3 : hasIdentity ? 4 : 1,
  });
  if (hasCard) item.card = card;
  if (hasIdentity) item.identity = identity;
  if (customFields.length) item.fields = customFields;
  if (created) item.creationDate = created;
  return item;
}

function renderKeePassEntry(item: VaultItem, keepassUuid: string): string {
  const fields: Array<[string, string, boolean]> = [
    ["Title", item.name ?? "", false],
    ["UserName", item.login?.username ?? "", false],
    ["Password", item.login?.password ?? "", true],
    ["URL", getPrimaryUri(item), false],
    ["Notes", item.notes ?? "", false],
  ];
  if (item.login?.totp) fields.push(["otp", item.login.totp, true]);
  getAllUris(item)
    .slice(1)
    .forEach((uri, i) => fields.push([`KP2A_URL_${i + 1}`, uri, false]));
  const secretCardKeys = new Set(["number", "code"]);
  for (const [k, v] of Object.entries(item.card ?? {})) {
    if (typeof v === "string" && v) {
      fields.push([`${KEEPASS_CARD_PREFIX}${k}`, v, secretCardKeys.has(k)]);
    }
  }
  const secretIdentityKeys = new Set(["ssn", "passportNumber", "licenseNumber"]);
  for (const [k, v] of Object.entries(item.identity ?? {})) {
    if (typeof v === "string" && v) {
      fields.push([`${KEEPASS_IDENTITY_PREFIX}${k}`, v, secretIdentityKeys.has(k)]);
    }
  }
  for (const field of item.fields ?? []) {
    if (!field.name) continue;
    const collides =
      isKeePassManagedKey(field.name) || field.name.startsWith(KEEPASS_CUSTOM_PREFIX);
    fields.push([
      collides ? `${KEEPASS_CUSTOM_PREFIX}${field.name}` : field.name,
      field.value ?? "",
      field.type === 1,
    ]);
  }
  const stringsXml = fields
    .map(
      ([k, v, isProtected]) =>
        `        <String>\n          <Key>${escapeXml(k)}</Key>\n          <Value${
          isProtected ? ' ProtectInMemory="True"' : ""
        }>${escapeXml(v)}</Value>\n        </String>`,
    )
    .join("\n");
  const lastMod = item.lastModified ?? new Date().toISOString();
  return [
    "      <Entry>",
    `        <UUID>${escapeXml(keepassUuid)}</UUID>`,
    stringsXml,
    "        <Times>",
    ...(item.creationDate
      ? [`          <CreationTime>${escapeXml(item.creationDate)}</CreationTime>`]
      : []),
    `          <LastModificationTime>${escapeXml(lastMod)}</LastModificationTime>`,
    "        </Times>",
    "      </Entry>",
  ].join("\n");
}

export const keepassXmlAdapter: VaultFormatAdapter = {
  info: {
    id: "keepass-xml",
    name: "KeePass XML",
    provider: "KeePass",
    extensions: [".xml"],
    mimeType: "application/xml",
    description: "KeePass 2.x / KeePassXC XML 2.0 export",
  },

  detect(ctx: VaultParseContext): number {
    if (!ctx.text || ctx.json !== undefined) return 0;
    const trimmed = ctx.text.trimStart();
    if (
      (trimmed.startsWith("<?xml") || trimmed.startsWith("<KeePassFile")) &&
      ctx.text.includes("<KeePassFile")
    ) {
      return 0.99;
    }
    return 0;
  },

  parse(ctx: VaultParseContext) {
    const doc = parseXml(ctx.text ?? "", { strict: true });
    if (!doc || doc.tag !== "KeePassFile") {
      throw new Error("Invalid KeePass XML: missing <KeePassFile> root element.");
    }
    const rootNode = findChild(doc, "Root");
    const topGroup = rootNode ? findChild(rootNode, "Group") : undefined;
    if (!topGroup) {
      throw new Error("Invalid KeePass XML: missing <Root><Group>.");
    }

    const folders = new FolderRegistry();
    const items: VaultItem[] = [];
    const usedItemIds = new Set<string>();

    // KeePass records the recycle bin by UUID (its name is localized); an all-zero UUID means none.
    const recycleBinUuid = findChild(findChild(doc, "Meta") ?? doc, "RecycleBinUUID")?.text.trim();
    const hasRecycleBinUuid = Boolean(recycleBinUuid) && !/^A+={0,2}$/.test(recycleBinUuid!);
    const isRecycleBin = (group: XmlNode, name: string) =>
      hasRecycleBinUuid
        ? findChild(group, "UUID")?.text.trim() === recycleBinUuid
        : name === "Recycle Bin";

    const walkGroup = (groupNode: XmlNode, pathPrefix: string[], isTop = false) => {
      const groupName = findChild(groupNode, "Name")?.text.trim() ?? "";
      // The top group is the database root (named "Root", the database name, ...), not a folder.
      const nextPath = isTop ? [] : groupName ? [...pathPrefix, groupName] : pathPrefix;

      const folderName = nextPath.join("/");
      const folderId = folderName ? folders.getOrCreate(folderName) : null;

      for (const entry of findChildren(groupNode, "Entry")) {
        const item = parseKeePassEntry(entry, folderId, `kp-xml-${items.length + 1}`);
        const baseId = item.id || `kp-xml-${items.length + 1}`;
        let itemId = baseId;
        if (usedItemIds.has(itemId)) {
          itemId = `kp-xml:${baseId}`;
          let suffix = 2;
          while (usedItemIds.has(itemId)) itemId = `kp-xml:${baseId}:${suffix++}`;
        }
        item.id = itemId;
        usedItemIds.add(itemId);
        items.push(item);
      }

      for (const childGroup of findChildren(groupNode, "Group")) {
        const childName = findChild(childGroup, "Name")?.text.trim() ?? "";
        if (isRecycleBin(childGroup, childName)) continue;
        walkGroup(childGroup, nextPath);
      }
    };

    walkGroup(topGroup, [], true);

    return {
      vault: { encrypted: false, folders: folders.list(), items },
      format: "keepass-xml",
      providerName: "KeePass",
      formatName: "KeePass XML",
      warnings: [],
    };
  },

  export(vault: VaultData) {
    const uuids = getKeePassExportUuids(vault.items);
    const folderMap = buildFolderNameMap(vault);
    const byGroup = new Map<string, Array<{ item: VaultItem; uuid: string }>>();
    for (const [index, item] of vault.items.entries()) {
      const group = getItemFolderName(item, folderMap) || "";
      const list = byGroup.get(group) ?? [];
      list.push({ item, uuid: uuids[index] });
      byGroup.set(group, list);
    }

    const renderEntry = ({ item, uuid }: { item: VaultItem; uuid: string }) =>
      renderKeePassEntry(item, uuid);

    const rootEntries = (byGroup.get("") ?? []).map(renderEntry).join("\n");
    const subGroupsXml = [...byGroup.entries()]
      .filter(([name]) => name !== "")
      .map(
        ([name, groupItems]) =>
          `      <Group>\n        <Name>${escapeXml(name)}</Name>\n${groupItems
            .map(renderEntry)
            .join("\n")}\n      </Group>`,
      )
      .join("\n");

    const xml = [
      '<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
      "<KeePassFile>",
      "  <Root>",
      "    <Group>",
      "      <Name>Root</Name>",
      rootEntries,
      subGroupsXml,
      "    </Group>",
      "  </Root>",
      "</KeePassFile>",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n");

    return {
      content: xml,
      mimeType: "application/xml",
      extension: "xml",
      format: "keepass-xml",
      warnings: getKeePassExportWarnings(vault, false),
    };
  },
};

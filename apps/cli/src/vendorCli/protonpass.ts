import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "pass-cli";
type JsonObject = Record<string, unknown>;

function parseObject(text: string, what: string): JsonObject {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonObject;
    }
  } catch {
    // Keep CLI output out of the error because it can contain vault secrets.
  }
  throw new Error(
    `Could not read ${what} from the Proton Pass CLI (output was not a JSON object).`,
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function canonicalType(value: string): string {
  const normalized = value.toLowerCase().replace(/[ _]/g, "-");
  switch (normalized) {
    case "credit-card":
    case "creditcard":
      return "creditCard";
    case "ssh-key":
    case "sshkey":
      return "sshKey";
    case "wifi":
    case "identity":
    case "alias":
    case "custom":
    case "login":
    case "note":
      return normalized;
    default:
      return normalized;
  }
}

function normalizeExtraFields(raw: unknown): JsonObject[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const field = entry as JsonObject;
    const rawData = field["data"];
    const dataObject =
      rawData && typeof rawData === "object" && !Array.isArray(rawData)
        ? (rawData as JsonObject)
        : {};
    const kind = optionalString(field["type"] ?? field["kind"]) ?? "text";
    const rawValue = field["value"] ?? dataObject["content"] ?? dataObject["totpUri"];
    return [
      {
        fieldName: optionalString(field["fieldName"] ?? field["title"] ?? field["name"]),
        type: kind === "hidden" ? "hidden" : kind === "totp" ? "totp" : "text",
        data:
          kind === "totp"
            ? { totpUri: optionalString(rawValue) }
            : { content: optionalString(rawValue) },
      },
    ];
  });
}

function normalizeItem(value: unknown, index: number): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected item output from the Proton Pass CLI.");
  }
  const item = value as JsonObject;
  const existingData = item["data"];
  if (existingData && typeof existingData === "object" && !Array.isArray(existingData)) {
    return item;
  }

  // `item view --output json` exposes the CLI item shape, while the portable
  // Proton JSON adapter consumes the provider's export.data shape.
  const content = item["content"];
  const contentObject =
    content && typeof content === "object" && !Array.isArray(content)
      ? (content as JsonObject)
      : {};
  const nestedContent = contentObject["content"];
  const fields =
    nestedContent && typeof nestedContent === "object" && !Array.isArray(nestedContent)
      ? (nestedContent as JsonObject)
      : contentObject;
  const metadata = contentObject["metadata"];
  const metadataObject =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as JsonObject)
      : {};
  const type = canonicalType(optionalString(contentObject["type"] ?? item["type"]) ?? "login");
  const name =
    optionalString(metadataObject["name"] ?? contentObject["title"] ?? item["title"]) ??
    `Item ${index + 1}`;
  const note = optionalString(metadataObject["note"] ?? fields["note"]) ?? "";
  const urls = fields["urls"] ?? fields["url"];
  const normalizedUrls = Array.isArray(urls)
    ? urls.filter((url): url is string => typeof url === "string")
    : typeof urls === "string"
      ? [urls]
      : [];
  const extraFields = normalizeExtraFields(
    fields["extraFields"] ??
      fields["extra_fields"] ??
      contentObject["extraFields"] ??
      contentObject["extra_fields"],
  );

  const data: JsonObject = {
    type,
    metadata: { name, note },
    content: {
      ...fields,
      username: optionalString(fields["username"] ?? fields["itemUsername"] ?? fields["login"]),
      itemUsername: optionalString(fields["itemUsername"] ?? fields["username"] ?? fields["login"]),
      email: optionalString(fields["email"] ?? fields["itemEmail"]),
      itemEmail: optionalString(fields["itemEmail"] ?? fields["email"]),
      password: optionalString(fields["password"]),
      urls: normalizedUrls,
      totpUri: optionalString(fields["totpUri"] ?? fields["totp_uri"] ?? fields["totp"]),
    },
    ...(extraFields.length > 0 ? { extraFields } : {}),
  };
  const id = optionalString(item["itemId"] ?? item["id"]);
  const shareId = optionalString(item["shareId"] ?? item["share_id"]);
  const folderId = item["folderId"] ?? item["folder_id"] ?? null;
  const modifyTime = item["modifyTime"] ?? item["modify_time"];
  return {
    ...item,
    itemId: id ?? `proton-cli-${index + 1}`,
    shareId,
    folderId,
    modifyTime,
    state: item["state"] ?? 1,
    data,
  };
}

function normalizeFolder(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const folder = value as JsonObject;
  const folderId = folder["folderId"] ?? folder["folder_id"] ?? folder["id"];
  const name = folder["name"] ?? folder["folder_name"];
  if (typeof folderId !== "string" || typeof name !== "string") return undefined;
  return {
    folderId,
    parentFolderId: folder["parentFolderId"] ?? folder["parent_id"] ?? null,
    name,
  };
}

export const protonPassProvider: VendorCliProvider = {
  id: "proton-pass",
  displayName: "Proton Pass",
  binary: BIN,
  unsupportedReason: {
    write:
      "Proton Pass CLI supports item edits, but its field-by-field update interface cannot safely apply vault-wide deletes, folder changes, and complete replacements as one guarded operation.",
  },

  async ensureReady(runner: CommandRunner) {
    // `info` verifies the saved CLI session without prompting for credentials.
    await runChecked(runner, BIN, ["info"]);
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    const output = parseObject(
      await runChecked(runner, BIN, ["item", "list", "--output", "json"]),
      "vault items",
    );
    const listedItems = output["items"];
    if (!Array.isArray(listedItems)) {
      throw new Error("Unexpected item list output from the Proton Pass CLI.");
    }

    const items: JsonObject[] = [];
    for (const [index, listed] of listedItems.entries()) {
      if (!listed || typeof listed !== "object" || Array.isArray(listed)) {
        throw new Error("Unexpected item reference in Proton Pass CLI output.");
      }
      const reference = listed as JsonObject;
      // Listing output is optimized for discovery. Fetch each full JSON item so
      // credentials and custom fields reach the parser without shell pipelines.
      const shareId = optionalString(reference["shareId"] ?? reference["share_id"]);
      const itemId = optionalString(reference["itemId"] ?? reference["id"]);
      if (!itemId) throw new Error("A Proton Pass CLI item did not include an ID.");
      const viewArgs = ["item", "view"];
      if (shareId) viewArgs.push("--share-id", shareId);
      viewArgs.push("--item-id", itemId, "--output", "json");
      let details: unknown = parseObject(await runChecked(runner, BIN, viewArgs), "item details");
      // Some CLI versions wrap the item in a `item` object.
      const wrapped = (details as JsonObject)["item"];
      if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) details = wrapped;
      items.push(normalizeItem(details, index));
    }

    const folders = Array.isArray(output["folders"])
      ? output["folders"].map(normalizeFolder).filter((folder) => folder !== undefined)
      : [];
    const vaultName = optionalString(output["vaultName"] ?? output["vault_name"]);
    const vaultKey = shareIdFrom(items) ?? "personal";
    return {
      content: JSON.stringify({
        encrypted: false,
        vaults: {
          [vaultKey]: { ...(vaultName ? { name: vaultName } : {}), items, folders },
        },
      }),
      format: "protonpass-json",
    };
  },
};

function shareIdFrom(items: JsonObject[]): string | undefined {
  return items.map((item) => optionalString(item["shareId"])).find(Boolean);
}

import { runChecked } from "./runner";
import type { CommandRunner, VendorCliProvider, VendorFetchResult } from "./types";

const BIN = "op";
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseJson(textValue: string, what: string): unknown {
  try {
    return JSON.parse(textValue) as unknown;
  } catch {
    throw new Error(`Could not read ${what} from the 1Password CLI (output was not JSON).`);
  }
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value > 1_000_000_000_000 ? value / 1000 : value);
  }
  if (typeof value !== "string") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : undefined;
}

function valueText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function cliFieldValue(field: JsonObject): string | undefined {
  return valueText(field["value"]);
}

function categoryUuid(category: string | undefined): string {
  switch (category?.toLowerCase().replace(/[ _-]/g, "")) {
    case "login":
      return "001";
    case "creditcard":
      return "002";
    case "securenote":
      return "003";
    case "identity":
      return "004";
    case "password":
      return "005";
    default:
      return "110";
  }
}

function onePasswordItem(rawValue: unknown): JsonObject | undefined {
  const raw = object(rawValue);
  if (!raw) return undefined;
  const fields = Array.isArray(raw["fields"])
    ? raw["fields"].map(object).filter((field): field is JsonObject => field !== undefined)
    : [];
  const loginFields: JsonObject[] = [];
  const sections = new Map<string, JsonObject[]>();
  let notesPlain = text(raw["notesPlain"]) ?? "";

  for (const field of fields) {
    const purpose = text(field["purpose"])?.toUpperCase();
    const id = text(field["id"])?.toLowerCase();
    const label = text(field["label"]) ?? id ?? "field";
    const value = cliFieldValue(field);
    if (purpose === "NOTES" || id === "notesplain") {
      notesPlain = value ?? notesPlain;
      continue;
    }
    if (purpose === "USERNAME" || id === "username") {
      loginFields.push({ name: "username", designation: "username", fieldType: "T", value });
      continue;
    }
    if (purpose === "PASSWORD" || id === "password") {
      loginFields.push({ name: "password", designation: "password", fieldType: "P", value });
      continue;
    }

    const rawSection = field["section"];
    const sectionObject = object(rawSection);
    const section = text(rawSection) ?? text(sectionObject?.["label"] ?? sectionObject?.["title"]);
    const bucket = sections.get(section ?? "Custom Fields") ?? [];
    const fieldType = text(field["type"])?.toUpperCase();
    const kind = fieldType === "CONCEALED" ? "concealed" : fieldType === "OTP" ? "totp" : "string";
    bucket.push({
      id: text(field["id"]),
      title: label,
      value: value === undefined ? {} : { [kind]: value },
    });
    sections.set(section ?? "Custom Fields", bucket);
  }

  const rawUrls = Array.isArray(raw["urls"]) ? raw["urls"] : [];
  const urls = rawUrls
    .map(object)
    .filter((url): url is JsonObject => url !== undefined)
    .map((url) => ({ url: text(url["href"] ?? url["url"]) }))
    .filter((url) => url.url);
  const primaryUrl = urls.find((url) => url.url)?.url;
  const rawVault = object(raw["vault"]);
  const vaultName = text(rawVault?.["name"]) ?? "Personal";
  const tags = Array.isArray(raw["tags"])
    ? raw["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];
  const state = text(raw["state"]);

  return {
    uuid: text(raw["id"] ?? raw["uuid"]),
    // Keep archived items in the audit; the canonical schema has no archive flag.
    // Only items the CLI explicitly marks trashed should be discarded by the 1PUX parser.
    state: state?.toLowerCase() === "trashed" ? "trashed" : "active",
    categoryUuid: categoryUuid(text(raw["category"])),
    createdAt: timestamp(raw["createdAt"]),
    updatedAt: timestamp(raw["updatedAt"]),
    favIndex: raw["favorite"] === true ? 1 : 0,
    overview: {
      title: text(raw["title"]) ?? "Untitled",
      url: primaryUrl,
      urls,
      tags,
    },
    details: {
      loginFields,
      notesPlain,
      sections: [...sections.entries()].map(([title, sectionFields]) => ({
        title,
        fields: sectionFields,
      })),
    },
    __vaultName: vaultName,
  };
}

function build1PuxData(items: unknown[]): JsonObject {
  const vaults = new Map<string, JsonObject[]>();
  for (const raw of items) {
    const normalized = onePasswordItem(raw);
    if (!normalized) throw new Error("Unexpected item in 1Password CLI output.");
    const name = text(normalized["__vaultName"]) ?? "Personal";
    delete normalized["__vaultName"];
    const vaultItems = vaults.get(name) ?? [];
    vaultItems.push(normalized);
    vaults.set(name, vaultItems);
  }
  return {
    accounts: [
      {
        attrs: { accountName: "1Password CLI" },
        vaults: [...vaults.entries()].map(([name, vaultItems]) => ({
          attrs: { name },
          items: vaultItems,
        })),
      },
    ],
  };
}

export const onePasswordProvider: VendorCliProvider = {
  id: "1password",
  displayName: "1Password",
  binary: BIN,
  unsupportedReason: {
    write:
      "1Password CLI item templates do not preserve all passkeys and provider-specific item data, so vault-wide write-back is not enabled.",
  },

  async ensureReady(runner: CommandRunner) {
    // Account list is non-mutating and verifies that the CLI has an active session.
    await runChecked(runner, BIN, ["account", "list", "--format", "json"]);
  },

  async fetch(runner: CommandRunner): Promise<VendorFetchResult> {
    const listedText = await runChecked(runner, BIN, [
      "item",
      "list",
      "--include-archive",
      "--format",
      "json",
    ]);
    const listed = parseJson(listedText, "item list");
    if (!Array.isArray(listed))
      throw new Error("Unexpected item list output from the 1Password CLI.");
    let details: unknown[] = [];
    if (listed.length > 0) {
      const detailOutput = parseJson(
        await runChecked(runner, BIN, ["item", "get", "-", "--reveal", "--format", "json"], {
          input: listedText,
        }),
        "item details",
      );
      details = Array.isArray(detailOutput) ? detailOutput : [detailOutput];
    }
    if (details.length !== listed.length) {
      throw new Error(
        "The 1Password CLI returned an incomplete item detail list; no audit was started.",
      );
    }
    return {
      content: JSON.stringify(build1PuxData(details)),
      format: "1password-1pux",
    };
  },
};

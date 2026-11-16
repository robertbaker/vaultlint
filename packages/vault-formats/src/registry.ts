import type { VaultData } from "@vaultlint/vault-schema";

import { bitwardenCsvAdapter, bitwardenJsonAdapter } from "./adapters/bitwarden";
import { chromeCsvAdapter, firefoxCsvAdapter, safariCsvAdapter } from "./adapters/browsers";
import { dashlaneCsvAdapter, dashlaneJsonAdapter } from "./adapters/dashlane";
import { enpassCsvAdapter, enpassJsonAdapter } from "./adapters/enpass";
import { keepassCsvAdapter, keepassXmlAdapter } from "./adapters/keepass";
import { keeperCsvAdapter, keeperJsonAdapter } from "./adapters/keeper";
import { lastpassCsvAdapter } from "./adapters/lastpass";
import { nordPassCsvAdapter } from "./adapters/nordpass";
import { onePassword1puxAdapter, onePasswordCsvAdapter } from "./adapters/onepassword";
import { protonPassCsvAdapter, protonPassJsonAdapter } from "./adapters/protonpass";
import { roboFormCsvAdapter } from "./adapters/roboform";
import { VAULT_FORMATS } from "./metadata";
import type {
  ExportedVault,
  ExportVaultOptions,
  ParsedVault,
  ParseVaultOptions,
  VaultFormatAdapter,
  VaultFormatId,
  VaultParseContext,
} from "./types";
import { isZipBytes, readZipEntries, readZipEntriesSync } from "./zip";

export const VAULT_FORMAT_ADAPTERS: readonly VaultFormatAdapter[] = [
  bitwardenJsonAdapter,
  bitwardenCsvAdapter,
  lastpassCsvAdapter,
  onePassword1puxAdapter,
  onePasswordCsvAdapter,
  keepassXmlAdapter,
  keepassCsvAdapter,
  protonPassJsonAdapter,
  protonPassCsvAdapter,
  dashlaneJsonAdapter,
  dashlaneCsvAdapter,
  nordPassCsvAdapter,
  enpassJsonAdapter,
  enpassCsvAdapter,
  keeperJsonAdapter,
  keeperCsvAdapter,
  roboFormCsvAdapter,
  safariCsvAdapter,
  firefoxCsvAdapter,
  chromeCsvAdapter,
];

export { VAULT_FORMATS };

export function getFormatAdapter(format: VaultFormatId): VaultFormatAdapter {
  const adapter = VAULT_FORMAT_ADAPTERS.find((a) => a.info.id === format);
  if (!adapter) {
    throw new Error(`Unsupported vault format: "${format}".`);
  }
  return adapter;
}

export function isValidVaultFormat(value: string): value is VaultFormatId {
  return VAULT_FORMAT_ADAPTERS.some((a) => a.info.id === value);
}

function isKdbxBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x03 &&
    bytes[1] === 0xd9 &&
    bytes[2] === 0xa2 &&
    bytes[3] === 0x9a
  );
}

function isBrambleBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x56 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x31
  );
}

function rejectEncryptedBramble(): never {
  throw new Error(
    "Encrypted Bramble (.bramble) exports are not supported. Open the export in Bramble, export as KeePass, then open that password-protected .kdbx in KeePassXC and export as CSV before using vaultlint.",
  );
}

function rejectEncryptedKeePass(): never {
  throw new Error(
    "Encrypted KeePass (.kdbx) databases are not supported, including Bramble's password-protected KeePass exports. Open the database in KeePassXC and export as CSV, or export as KeePass XML.",
  );
}

function buildContext(
  input: string | Uint8Array | Record<string, unknown>,
  fileName?: string,
): VaultParseContext {
  if (input instanceof Uint8Array) {
    if (isBrambleBytes(input)) rejectEncryptedBramble();
    if (isKdbxBytes(input)) rejectEncryptedKeePass();
    if (isZipBytes(input)) {
      return { bytes: input, fileName };
    }
    const text = new TextDecoder().decode(input);
    return buildContextFromText(text, fileName, input);
  }

  if (typeof input === "string") {
    return buildContextFromText(input, fileName);
  }

  return { json: input, fileName };
}

function buildContextFromText(
  text: string,
  fileName?: string,
  bytes?: Uint8Array,
): VaultParseContext {
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  let json: unknown;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      // Leave json undefined so adapters or error messages can handle invalid JSON
    }
  }
  return { text, bytes, json, fileName };
}

export function detectVaultFormat(
  input: string | Uint8Array | Record<string, unknown>,
  fileName?: string,
): VaultFormatAdapter | null {
  const ctx = buildContext(input, fileName);
  let best: VaultFormatAdapter | null = null;
  let bestScore = 0;

  for (const adapter of VAULT_FORMAT_ADAPTERS) {
    let score = 0;
    try {
      score = adapter.detect(ctx);
    } catch {
      // Detection is best-effort; malformed input belongs to the selected parser, not another adapter.
    }
    if (score > bestScore) {
      bestScore = score;
      best = adapter;
    }
  }

  return bestScore > 0 ? best : null;
}

export function parseVault(
  input: string | Uint8Array | Record<string, unknown>,
  options?: ParseVaultOptions,
): ParsedVault {
  if (options?.fileName?.toLowerCase().endsWith(".bramble")) rejectEncryptedBramble();
  if (options?.fileName?.toLowerCase().endsWith(".kdbx")) rejectEncryptedKeePass();
  const head =
    typeof input === "string"
      ? input.slice(0, 64)
      : input instanceof Uint8Array && !isZipBytes(input)
        ? new TextDecoder().decode(input.subarray(0, 64))
        : "";
  if (/^﻿?\s*-----BEGIN PGP /.test(head)) {
    throw new Error(
      "Encrypted (PGP) exports are not supported. Decrypt the Proton Pass export or choose the unencrypted ZIP / CSV export.",
    );
  }
  if (input instanceof Uint8Array && isZipBytes(input)) {
    let entries: Map<string, Uint8Array>;
    try {
      entries = readZipEntriesSync(input);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to read ZIP export synchronously: ${reason} Use parseVaultAsync for compressed archives.`,
      );
    }
    const payload = selectZipPayload(entries, options?.format);
    if (payload && payload.format !== "1password-1pux") {
      return parseVault(payload.text, { ...options, format: payload.format });
    }
  }
  const ctx = buildContext(input, options?.fileName);

  if (options?.format) {
    return getFormatAdapter(options.format).parse(ctx);
  }

  const adapter = detectVaultFormat(input, options?.fileName);
  if (!adapter) {
    if (typeof input === "string" && input.trimStart().startsWith("{")) {
      throw new Error(
        "Unrecognized or invalid JSON vault format. Supported JSON formats: Bitwarden, 1Password (export.data), Proton Pass, Dashlane, Enpass, Keeper.",
      );
    }
    throw new Error(
      "Could not detect vault format. Supported formats: Bitwarden (JSON/CSV), LastPass (CSV), 1Password (1PUX/CSV), KeePass (XML/CSV), Proton Pass (JSON/CSV), Dashlane (JSON/CSV), NordPass (CSV), Enpass (JSON/CSV), Keeper (JSON/CSV), RoboForm (CSV), Chrome/Firefox/Safari (CSV).",
    );
  }

  return adapter.parse(ctx);
}

const ENCRYPTED_PROTON_ZIP_MESSAGE =
  "Encrypted Proton Pass exports are not supported. Decrypt the PGP export or choose the unencrypted ZIP / CSV export.";

/**
 * Pick the JSON payload inside a ZIP export. A user-supplied `format` always wins: it must match
 * the archive contents, otherwise a clear error is thrown instead of feeding mismatched data to
 * another adapter. Returns null when no format was requested and the archive is not recognised.
 */
function selectZipPayload(
  entries: Map<string, Uint8Array>,
  format: VaultFormatId | undefined,
): { text: string; format: VaultFormatId } | null {
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const onePux = entries.get("export.data");
  const proton = entries.get("Proton Pass/data.json");
  const encryptedProton = entries.has("Proton Pass/data.pgp");

  if (format && format !== "1password-1pux" && format !== "protonpass-json") {
    throw new Error(
      `ZIP archives can only be parsed as 1password-1pux or protonpass-json, not "${format}".`,
    );
  }
  if (format === "1password-1pux" && !onePux) {
    throw new Error(
      'The ZIP archive does not contain "export.data"; it is not a 1Password 1PUX export.',
    );
  }
  if (format === "protonpass-json" && !proton) {
    if (encryptedProton) throw new Error(ENCRYPTED_PROTON_ZIP_MESSAGE);
    throw new Error(
      'The ZIP archive does not contain "Proton Pass/data.json"; it is not a Proton Pass export.',
    );
  }

  if (format === "protonpass-json" || (!format && !onePux && proton)) {
    return { text: decode(proton!), format: "protonpass-json" };
  }
  if (onePux) return { text: decode(onePux), format: "1password-1pux" };
  if (encryptedProton) throw new Error(ENCRYPTED_PROTON_ZIP_MESSAGE);
  return null;
}

/**
 * Async variant of `parseVault` that also supports Deflate-compressed `.1pux` / Proton Pass ZIP
 * archives in browser environments without Node `zlib`.
 */
export async function parseVaultAsync(
  input: string | Uint8Array | Record<string, unknown>,
  options?: ParseVaultOptions,
): Promise<ParsedVault> {
  if (input instanceof Uint8Array && isZipBytes(input)) {
    const entries = await readZipEntries(input);
    const payload = selectZipPayload(entries, options?.format);
    if (payload) return parseVault(payload.text, { ...options, format: payload.format });
  }
  return parseVault(input, options);
}

export function exportVault(
  vault: VaultData,
  format: VaultFormatId,
  options?: ExportVaultOptions,
): ExportedVault {
  return getFormatAdapter(format).export(vault, options);
}

/**
 * Infer an unambiguous output format from a file extension when `--output-format` is omitted. Falls
 * back to `defaultFormat` for ambiguous extensions like `.json` or `.csv`.
 */
export function inferFormatFromOutputPath(
  outputPath: string | undefined,
  defaultFormat: VaultFormatId,
): VaultFormatId {
  if (!outputPath) return defaultFormat;
  const lower = outputPath.toLowerCase();
  if (lower.endsWith(".1pux")) return "1password-1pux";
  if (lower.endsWith(".xml")) return "keepass-xml";
  return defaultFormat;
}

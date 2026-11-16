import type { VaultData } from "@vaultlint/vault-schema";

export type VaultFormatId =
  | "bitwarden-json"
  | "bitwarden-csv"
  | "lastpass-csv"
  | "1password-1pux"
  | "1password-csv"
  | "keepass-csv"
  | "keepass-xml"
  | "protonpass-json"
  | "protonpass-csv"
  | "dashlane-json"
  | "dashlane-csv"
  | "nordpass-csv"
  | "enpass-json"
  | "enpass-csv"
  | "keeper-json"
  | "keeper-csv"
  | "roboform-csv"
  | "chrome-csv"
  | "firefox-csv"
  | "safari-csv";

export interface VaultFormatInfo {
  id: VaultFormatId;
  name: string;
  provider: string;
  extensions: readonly string[];
  mimeType: string;
  description: string;
}

export interface ParsedVault {
  vault: VaultData;
  format: VaultFormatId;
  providerName: string;
  formatName: string;
  warnings: string[];
  rawMeta?: Record<string, unknown>;
}

export interface ExportedVault {
  content: string | Uint8Array;
  mimeType: string;
  extension: string;
  format: VaultFormatId;
  warnings: string[];
}

export interface ParseVaultOptions {
  format?: VaultFormatId;
  fileName?: string;
}

export interface ExportVaultOptions {
  rawMeta?: Record<string, unknown>;
}

export interface VaultParseContext {
  text?: string;
  bytes?: Uint8Array;
  json?: unknown;
  fileName?: string;
}

export interface VaultFormatAdapter {
  readonly info: VaultFormatInfo;
  detect(ctx: VaultParseContext): number;
  parse(ctx: VaultParseContext): ParsedVault;
  export(vault: VaultData, options?: ExportVaultOptions): ExportedVault;
}

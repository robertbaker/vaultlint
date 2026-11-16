import type { VaultFormatId } from "@vaultlint/vault-formats";
import type { VaultData } from "@vaultlint/vault-schema";

export type VendorCliId =
  | "bitwarden"
  | "lastpass"
  | "dashlane"
  | "keeper"
  | "proton-pass"
  | "nordpass"
  | "1password"
  | "enpass";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  /** Written to the child's stdin. Used for secrets so they never appear in argv. */
  input?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

/** Spawns a vendor CLI. Injectable so providers can be tested without the real binaries. */
export interface CommandRunner {
  run(binary: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
}

/** Everything fetched from a vendor CLI, ready to feed the normal parse pipeline. */
export interface VendorFetchResult {
  /** Vault text in an existing vaultlint format. Held in memory only, never written to disk. */
  content: string;
  format: VaultFormatId;
}

export interface VendorPlanSummary {
  creates: number;
  updates: number;
  removes: number;
  newFolders: number;
  updatedFolders: number;
  removedFolders: number;
  /** Human-readable lines describing each change (names only, never secrets). */
  lines: string[];
}

export interface VendorPushResult {
  created: number;
  updated: number;
  removed: number;
  newFolders: number;
  updatedFolders: number;
  removedFolders: number;
}

export interface VendorCliProvider {
  id: VendorCliId;
  displayName: string;
  binary: string;
  /** Why read/write is unavailable, when it is. */
  unsupportedReason?: { read?: string; write?: string };
  /** Throws an actionable error unless the CLI is installed and unlocked. */
  ensureReady(runner: CommandRunner): Promise<void>;
  fetch(runner: CommandRunner): Promise<VendorFetchResult>;
  /** Summarise what pushing `updated` over `original` would change. No side effects. */
  planPush?(original: VaultData, updated: VaultData): VendorPlanSummary;
  /** Apply the changes to the live vault. Aborts if the vault changed since `original`. */
  push?(runner: CommandRunner, original: VaultData, updated: VaultData): Promise<VendorPushResult>;
}

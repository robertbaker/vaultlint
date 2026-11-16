import {
  type BatchEditTargetMode,
  applyBatchEditToVault,
  normalizeVaultItems,
  previewBatchEditOnVault,
  redactUriCredentials,
} from "@vaultlint/vault-ops";
import type { VaultData } from "@vaultlint/vault-schema";

export interface BatchEditPreviewItem {
  itemName: string;
  field: string;
  before: string;
  after: string;
}

function validateBatchRegex(pattern: string): void {
  try {
    new RegExp(pattern, "g");
  } catch (err) {
    throw new Error(`Invalid regex pattern "${pattern}": ${(err as Error).message}`);
  }
}

/** Preview regex-based batch edits to a specified field without modifying the vault. */
export function previewBatchEdits(
  vaultData: VaultData,
  pattern: string,
  replacement: string,
  field: string,
  targetMode: BatchEditTargetMode = "all",
): BatchEditPreviewItem[] {
  validateBatchRegex(pattern);
  // Previews are printed to the terminal, so URL-embedded passwords must never reach them.
  const mask = (value: string) => (field === "uri" ? redactUriCredentials(value) : value);
  return previewBatchEditOnVault(vaultData, field, pattern, replacement, targetMode).map((m) => ({
    itemName: m.label,
    field,
    before: mask(m.before),
    after: mask(m.after),
  }));
}

/**
 * Apply regex-based batch edits to a specified field across vault items. Returns the number of
 * modified fields.
 */
export async function applyBatchEdits(
  vaultData: VaultData,
  pattern: string,
  replacement: string,
  field: string,
  targetMode: BatchEditTargetMode = "all",
): Promise<number> {
  validateBatchRegex(pattern);
  const modifiedCount = applyBatchEditToVault(vaultData, field, pattern, replacement, targetMode);
  console.log(`Batch edits applied (${modifiedCount} modification(s)).`);
  return modifiedCount;
}

/** Normalize vault item names and URIs in-place. */
export async function runBatchEditing(vaultData: VaultData): Promise<void> {
  console.log("Running batch editing...");
  normalizeVaultItems(vaultData);
  console.log("Batch editing complete.");
}

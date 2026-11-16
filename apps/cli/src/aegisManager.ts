import { importFidoKeys, replaceExistingFidoKeys } from "./fidoHandler";
import { loadVault, type VaultData } from "./vaultService";

/**
 * Import FIDO keys from an unencrypted Aegis JSON export into the provided vault data (or load from
 * a vault file path if a string is passed).
 */
export async function handleAegisImport(
  aegisFilePath: string,
  vaultOrPath: VaultData | string,
): Promise<VaultData> {
  console.log("Importing Aegis unencrypted backup...");

  const vaultData = typeof vaultOrPath === "string" ? await loadVault(vaultOrPath) : vaultOrPath;

  const fidoData = await importFidoKeys(aegisFilePath);
  const count = replaceExistingFidoKeys(fidoData, vaultData);

  console.log(`Aegis FIDO key import complete (${count} item(s) updated).`);
  return vaultData;
}

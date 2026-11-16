import { getUriString, inferItemType, type VaultData } from "@vaultlint/vault-schema";

import { findReusedPasswordGroupFindings, isWeakPassword } from "./password";

export interface VaultBreakdown {
  totalItems: number;
  strongCount: number;
  weakCount: number;
  reusedCount: number;
  noPasswordCount: number;
  loginCount: number;
  noteCount: number;
  cardCount: number;
  identityCount: number;
  appCount: number;
}

/** Compute password strength & item category breakdown for charts and summaries. */
export function computeVaultBreakdown(vaultData: VaultData): VaultBreakdown {
  const reusedGroups = findReusedPasswordGroupFindings(vaultData);
  const reusedIndices = new Set<number>();
  for (const g of reusedGroups) {
    for (const entry of g.items) {
      reusedIndices.add(entry.index);
    }
  }

  let strongCount = 0;
  let weakCount = 0;
  let reusedCount = 0;
  let noPasswordCount = 0;
  let loginCount = 0;
  let noteCount = 0;
  let cardCount = 0;
  let identityCount = 0;
  let appCount = 0;

  vaultData.items.forEach((item, index) => {
    const pw = item.login?.password;
    if (!pw) {
      noPasswordCount++;
    } else {
      const isWeak = isWeakPassword(pw);
      const isReused = reusedIndices.has(index);
      if (isWeak) weakCount++;
      if (isReused) reusedCount++;
      if (!isWeak && !isReused) strongCount++;
    }

    const itemType = inferItemType(item);
    if (itemType === 1) loginCount++;
    else if (itemType === 2) noteCount++;
    else if (itemType === 3) cardCount++;
    else if (itemType === 4) identityCount++;

    const hasMobileUri = (item.login?.uris ?? []).some((u) => {
      const s = getUriString(u);
      return s.startsWith("androidapp://") || s.startsWith("iosapp://");
    });
    if (hasMobileUri) appCount++;
  });

  return {
    totalItems: vaultData.items.length,
    strongCount,
    weakCount,
    reusedCount,
    noPasswordCount,
    loginCount,
    noteCount,
    cardCount,
    identityCount,
    appCount,
  };
}

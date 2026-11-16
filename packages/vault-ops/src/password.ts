import { buildVaultItemRefs, type VaultData, type VaultItem } from "@vaultlint/vault-schema";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SPECIAL = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const ALL_CHARS = UPPER + LOWER + DIGITS + SPECIAL;
const SPECIAL_REGEX = /[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/;']/;
const MAX_GENERATED_PASSWORD_LENGTH = 4096;

export interface WeakPasswordFinding {
  item: VaultItem;
  index: number;
  reasons: string[];
}

export interface ReusedPasswordGroupFinding {
  items: Array<{ item: VaultItem; index: number }>;
}

/** Return true when a password fails minimum strength rules (12+ chars, digit, special char). */
export function isWeakPassword(password: string | undefined): boolean {
  if (!password) return false;
  return password.length < 12 || !/\d/.test(password) || !SPECIAL_REGEX.test(password);
}

/** Explain why a password is weak, or return an empty array if strong. */
export function getWeakPasswordReasons(password: string): string[] {
  const reasons: string[] = [];
  if (password.length < 12) reasons.push(`too short (${password.length} chars)`);
  if (!/\d/.test(password)) reasons.push("missing digit");
  if (!SPECIAL_REGEX.test(password)) reasons.push("missing special character");
  return reasons;
}

/** Validate a HIBP response and return matches for the requested SHA-1 suffixes. */
export function findHibpRangeMatches(body: string, targets: ReadonlySet<string>): Set<string> {
  const normalizedTargets = new Set([...targets].map((suffix) => suffix.toUpperCase()));
  const matches = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([0-9a-f]{35}):([0-9]+)$/i.exec(trimmed);
    const count = match ? Number(match[2]) : 0;
    if (!match || !Number.isSafeInteger(count) || count < 1) {
      throw new Error("HIBP returned an invalid range response.");
    }
    const suffix = match[1].toUpperCase();
    if (normalizedTargets.has(suffix)) matches.add(suffix);
  }
  return matches;
}

/** Check whether a validated HIBP range response contains a SHA-1 suffix. */
export function hibpRangeContainsSuffix(body: string, suffix: string): boolean {
  return findHibpRangeMatches(body, new Set([suffix])).has(suffix.toUpperCase());
}

/** Generate a cryptographically random strong password of at least 12 characters. */
export function generateStrongPassword(length = 16): string {
  if (!Number.isFinite(length)) {
    throw new RangeError("Password length must be a finite number.");
  }
  const target = Math.max(12, Math.ceil(length));
  if (target > MAX_GENERATED_PASSWORD_LENGTH) {
    throw new RangeError(
      `Password length cannot exceed ${MAX_GENERATED_PASSWORD_LENGTH} characters.`,
    );
  }
  // Rejection sampling avoids modulo bias in the character distribution.
  const rand = (max: number) => {
    const limit = 0x100000000 - (0x100000000 % max);
    const buf = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % max;
  };

  const chars = [
    UPPER[rand(UPPER.length)],
    LOWER[rand(LOWER.length)],
    DIGITS[rand(DIGITS.length)],
    SPECIAL[rand(SPECIAL.length)],
  ];
  for (let i = chars.length; i < target; i++) {
    chars.push(ALL_CHARS[rand(ALL_CHARS.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Find all vault items whose password fails strength requirements. */
export function findWeakPasswordFindings(vaultData: VaultData): WeakPasswordFinding[] {
  const findings: WeakPasswordFinding[] = [];
  vaultData.items.forEach((item, index) => {
    const pw = item.login?.password;
    if (!pw || !isWeakPassword(pw)) return;
    findings.push({ item, index, reasons: getWeakPasswordReasons(pw) });
  });
  return findings;
}

/** Group vault items that share the same non-empty password (never exposes plaintext). */
export function findReusedPasswordGroupFindings(
  vaultData: VaultData,
): ReusedPasswordGroupFinding[] {
  const byPassword = new Map<string, Array<{ item: VaultItem; index: number }>>();
  vaultData.items.forEach((item, index) => {
    const pw = item.login?.password;
    if (!pw) return;
    const list = byPassword.get(pw) ?? [];
    list.push({ item, index });
    byPassword.set(pw, list);
  });

  const groups: ReusedPasswordGroupFinding[] = [];
  for (const items of byPassword.values()) {
    if (items.length > 1) {
      groups.push({ items });
    }
  }
  return groups;
}

/** Regenerate all weak passwords in `vaultData` in-place. Returns count updated. */
export function regenerateWeakPasswordsInVault(vaultData: VaultData, length = 16): number {
  let count = 0;
  for (const item of vaultData.items) {
    if (isWeakPassword(item.login?.password)) {
      item.login = item.login ?? {};
      item.login.password = generateStrongPassword(length);
      count++;
    }
  }
  return count;
}

/** Regenerate reused passwords in `vaultData` in-place (keeping the first item in each group). */
export function regenerateReusedPasswordsInVault(vaultData: VaultData, length = 16): number {
  const groups = findReusedPasswordGroupFindings(vaultData);
  let count = 0;
  for (const group of groups) {
    for (const entry of group.items.slice(1)) {
      entry.item.login = entry.item.login ?? {};
      entry.item.login.password = generateStrongPassword(length);
      count++;
    }
  }
  return count;
}

/**
 * Opt-in HIBP k-anonymity breach check. Only sends the first 5 characters of each password's SHA-1
 * hash to `api.pwnedpasswords.com`. Returns collision-free item references from
 * `buildVaultItemRefs`.
 */
export async function checkVaultPasswordsHibp(
  vaultData: VaultData,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Set<string>> {
  const foundIds = new Set<string>();
  const targetsByPrefix = new Map<string, Array<{ suffix: string; itemId: string }>>();
  const hashCache = new Map<string, { prefix: string; suffix: string }>();
  const itemRefs = buildVaultItemRefs(vaultData);

  for (let i = 0; i < vaultData.items.length; i++) {
    const item = vaultData.items[i];
    const pw = item.login?.password;
    if (!pw) continue;

    let hash = hashCache.get(pw);
    if (!hash) {
      const data = new TextEncoder().encode(pw);
      const hashBuffer = await globalThis.crypto.subtle.digest("SHA-1", data);
      const fullHash = [...new Uint8Array(hashBuffer)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
      hash = { prefix: fullHash.slice(0, 5), suffix: fullHash.slice(5) };
      hashCache.set(pw, hash);
    }
    const { prefix, suffix } = hash;
    const entries = targetsByPrefix.get(prefix) ?? [];
    entries.push({ suffix, itemId: itemRefs[i] });
    targetsByPrefix.set(prefix, entries);
  }

  for (const [prefix, entries] of targetsByPrefix) {
    const resp = await fetchFn(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!resp.ok) {
      throw new Error(`HIBP range request failed (HTTP ${resp.status}).`);
    }
    const targets = new Set(entries.map((entry) => entry.suffix));
    const matches = findHibpRangeMatches(await resp.text(), targets);
    for (const entry of entries) {
      if (matches.has(entry.suffix)) foundIds.add(entry.itemId);
    }
  }

  return foundIds;
}

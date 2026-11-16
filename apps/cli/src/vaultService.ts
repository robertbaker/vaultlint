import crypto from "crypto";
import fs from "fs";

import {
  exportVault,
  parseVaultAsync,
  type ParsedVault,
  type VaultFormatId,
} from "@vaultlint/vault-formats";
import {
  findHibpRangeMatches,
  findWeakPasswordFindings,
  generateStrongPassword as generateSharedStrongPassword,
  isWeakPassword as isSharedWeakPassword,
  regenerateWeakPasswordsInVault,
} from "@vaultlint/vault-ops";
import {
  type VaultData,
  type VaultItem,
  getUriString,
  hasFidoCredentials,
} from "@vaultlint/vault-schema";
import axios from "axios";

import { atomicWrite } from "./safeWrite";

export type { VaultData, VaultItem };

/**
 * Check whether a password is weak (shorter than 12 chars, missing digits, or missing special
 * chars).
 */
export function isWeakPassword(password: string): boolean {
  return isSharedWeakPassword(password);
}

/** Generate a cryptographically strong password guaranteed to satisfy strength rules. */
export function generateStrongPassword(length = 16): string {
  return generateSharedStrongPassword(length);
}

/** Count weak passwords without returning plaintext secrets. */
export function detectWeakPasswords(vaultData: VaultData): number {
  return findWeakPasswordFindings(vaultData).length;
}

/** Return metadata for vault items that have weak passwords (without exposing passwords). */
export function findWeakPasswordItems(vaultData: VaultData): VaultItem[] {
  return findWeakPasswordFindings(vaultData).map((f) => f.item);
}

/**
 * Batch update weak passwords with newly generated strong passwords. Returns the number of updated
 * items.
 */
export function batchUpdateWeakPasswords(vaultData: VaultData): number {
  return regenerateWeakPasswordsInVault(vaultData);
}

/** Abstraction over vault file persistence for DI and unit testing. */
export interface IVaultStorage {
  exists(filePath: string): boolean;
  readText(filePath: string): string;
  writeText(filePath: string, content: string): void;
  readBytes?: (filePath: string) => Uint8Array;
  writeBytes?: (filePath: string, content: Uint8Array) => void;
}

export const nodeVaultStorage: IVaultStorage = {
  exists: (filePath) => fs.existsSync(filePath),
  readText: (filePath) => fs.readFileSync(filePath, "utf-8"),
  writeText: atomicWrite,
  readBytes: (filePath) => new Uint8Array(fs.readFileSync(filePath)),
  writeBytes: atomicWrite,
};

/** Abstraction over HIBP k-anonymity range lookups for DI and unit testing. */
export interface IHibpRangeClient {
  fetchRange(prefix: string): Promise<string[]>;
}

export const axiosHibpClient: IHibpRangeClient = {
  async fetchRange(prefix) {
    let response;
    try {
      response = await axios.get(`https://api.pwnedpasswords.com/range/${prefix}`, {
        timeout: 5000,
      });
    } catch {
      throw new Error("HIBP range request failed. Check the network connection and try again.");
    }
    if (typeof response.data !== "string") {
      throw new Error("HIBP returned an invalid range response.");
    }
    return response.data.split("\n");
  },
};

export interface LoadVaultOptions {
  format?: VaultFormatId;
}

export interface SaveVaultOptions {
  format?: VaultFormatId;
  rawMeta?: Record<string, unknown>;
}

/**
 * Windows PowerShell's `>` redirection (and some editors) write UTF-16 with a BOM, which format
 * detection cannot read. Decode it to text, and refuse OpenPGP-encrypted payloads with a clear
 * error.
 */
function normalizeVaultBytes(input: Uint8Array): Uint8Array | string {
  if (input.length >= 2) {
    const [a, b] = input;
    if (a === 0xff && b === 0xfe) return new TextDecoder("utf-16le").decode(input.subarray(2));
    if (a === 0xfe && b === 0xff) {
      const swapped = Uint8Array.from(input.subarray(2));
      for (let i = 0; i + 1 < swapped.length; i += 2) {
        const t = swapped[i];
        swapped[i] = swapped[i + 1];
        swapped[i + 1] = t;
      }
      return new TextDecoder("utf-16le").decode(swapped);
    }
  }
  const head = new TextDecoder("utf-8").decode(input.subarray(0, 64)).trimStart();
  if (head.startsWith("-----BEGIN PGP MESSAGE-----")) {
    throw new Error(
      "Encrypted (PGP) exports are not supported. Decrypt the export first or choose an unencrypted vault export.",
    );
  }
  return input;
}

/** Load and auto-detect (or parse as specified format) any supported password manager export. */
export async function loadVaultWithMeta(
  filePath: string,
  storage: IVaultStorage = nodeVaultStorage,
  options?: LoadVaultOptions,
): Promise<ParsedVault> {
  if (!storage.exists(filePath)) {
    throw new Error(`Vault file not found: ${filePath}`);
  }
  const raw = storage.readBytes ? storage.readBytes(filePath) : storage.readText(filePath);
  const input = typeof raw === "string" ? raw : normalizeVaultBytes(raw);
  return parseVaultAsync(input, { format: options?.format, fileName: filePath });
}

/** Load and validate vault data from disk (supports all registered password manager formats). */
export async function loadVault(
  filePath: string,
  storage: IVaultStorage = nodeVaultStorage,
  options?: LoadVaultOptions,
): Promise<VaultData> {
  const parsed = await loadVaultWithMeta(filePath, storage, options);
  return parsed.vault;
}

/** Save vault data to disk in the specified format (defaults to Bitwarden JSON). */
export async function saveVault(
  vaultData: VaultData,
  outputPath: string,
  storage: IVaultStorage = nodeVaultStorage,
  options?: SaveVaultOptions,
): Promise<void> {
  const targetFormat = options?.format ?? "bitwarden-json";
  const exported = exportVault(vaultData, targetFormat, { rawMeta: options?.rawMeta });
  for (const warning of exported.warnings) {
    console.warn(`Export warning: ${warning}`);
  }
  if (typeof exported.content === "string") {
    storage.writeText(outputPath, exported.content);
  } else if (storage.writeBytes) {
    storage.writeBytes(outputPath, exported.content);
  } else {
    throw new Error(`Binary export (${targetFormat}) is not supported by this storage backend.`);
  }
}

function sha1Upper(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").toUpperCase();
}

export async function isPasswordCompromised(
  password: string,
  hibpClient: IHibpRangeClient = axiosHibpClient,
): Promise<boolean> {
  const fullHash = sha1Upper(password);
  const hashPrefix = fullHash.slice(0, 5);
  const hashSuffix = fullHash.slice(5);

  const matchingHashes = await hibpClient.fetchRange(hashPrefix);
  return findHibpRangeMatches(matchingHashes.join("\n"), new Set([hashSuffix])).has(hashSuffix);
}

export type ProgressCallback = (completed: number, total: number, label?: string) => void;

/**
 * Detect compromised passwords in the vault using k-anonymity (HIBP). Never logs plaintext
 * passwords.
 */
export async function detectCompromisedPasswords(
  vaultData: VaultData,
  onProgress?: ProgressCallback,
): Promise<number> {
  let compromisedCount = 0;
  const itemsWithPasswords = vaultData.items.filter((item) => Boolean(item.login?.password));
  const total = itemsWithPasswords.length;
  const targetsByPrefix = new Map<string, Array<{ suffix: string; label: string }>>();
  const hashCache = new Map<string, { prefix: string; suffix: string }>();

  for (const item of itemsWithPasswords) {
    const pw = item.login!.password!;
    const label = item.name || item.id || "Unnamed item";
    let hash = hashCache.get(pw);
    if (!hash) {
      const fullHash = sha1Upper(pw);
      hash = { prefix: fullHash.slice(0, 5), suffix: fullHash.slice(5) };
      hashCache.set(pw, hash);
    }
    const hashPrefix = hash.prefix;
    const entries = targetsByPrefix.get(hashPrefix) ?? [];
    entries.push({ suffix: hash.suffix, label });
    targetsByPrefix.set(hashPrefix, entries);
  }

  let completed = 0;
  for (const [prefix, entries] of targetsByPrefix) {
    const matchingHashes = await axiosHibpClient.fetchRange(prefix);
    const targets = new Set(entries.map((entry) => entry.suffix));
    const matchingSuffixes = findHibpRangeMatches(matchingHashes.join("\n"), targets);

    for (const entry of entries) {
      if (matchingSuffixes.has(entry.suffix)) {
        compromisedCount++;
        if (!onProgress) {
          console.warn(`Compromised password detected for vault item: ${entry.label}`);
        }
      }
      completed++;
      onProgress?.(completed, total, entry.label);
    }
  }

  return compromisedCount;
}

function isMobileAppUri(uri: string): boolean {
  return uri.startsWith("androidapp://") || uri.startsWith("iosapp://");
}

async function validateMobileAppUri(uri: string): Promise<boolean> {
  try {
    if (uri.startsWith("androidapp://")) {
      const packageName = uri.slice("androidapp://".length).trim();
      if (!packageName) return false;
      const response = await axios.get(
        `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`,
        { timeout: 5000 },
      );
      return response.status === 200;
    } else if (uri.startsWith("iosapp://")) {
      const appId = uri.slice("iosapp://".length).trim();
      if (!appId) return false;
      const response = await axios.get(
        `https://itunes.apple.com/lookup?id=${encodeURIComponent(appId)}`,
        { timeout: 5000 },
      );
      return response.status === 200 && response.data?.resultCount > 0;
    }
    return false;
  } catch (error) {
    console.error("Error validating mobile app URI:", (error as Error).message);
    return false;
  }
}

/** Detect and validate mobile app URIs in the vault. */
export async function detectAndValidateMobileAppUris(
  vaultData: VaultData,
  onProgress?: ProgressCallback,
): Promise<{ valid: string[]; invalid: string[] }> {
  const valid: string[] = [];
  const invalid: string[] = [];

  const mobileUris: string[] = [];
  for (const item of vaultData.items) {
    for (const uriObj of item.login?.uris ?? []) {
      const uri = getUriString(uriObj);
      if (isMobileAppUri(uri)) {
        mobileUris.push(uri);
      }
    }
  }

  const total = mobileUris.length;
  for (let i = 0; i < total; i++) {
    const uri = mobileUris[i];
    const isValid = await validateMobileAppUri(uri);
    if (isValid) {
      valid.push(uri);
      if (!onProgress) console.log(`Valid mobile app URI: ${uri}`);
    } else {
      invalid.push(uri);
      if (!onProgress) console.log(`Invalid mobile app URI found: ${uri}`);
    }
    onProgress?.(i + 1, total, uri);
  }

  return { valid, invalid };
}

export interface ReusedPasswordGroup {
  count: number;
  items: VaultItem[];
}

/**
 * Group vault items that share the same non-empty password. Never exposes plaintext passwords in
 * the returned structure.
 */
export function findReusedPasswordGroups(vaultData: VaultData): ReusedPasswordGroup[] {
  const byPassword = new Map<string, VaultItem[]>();

  for (const item of vaultData.items) {
    const pw = item.login?.password;
    if (!pw) continue;
    const list = byPassword.get(pw);
    if (list) {
      list.push(item);
    } else {
      byPassword.set(pw, [item]);
    }
  }

  const groups: ReusedPasswordGroup[] = [];
  for (const items of byPassword.values()) {
    if (items.length > 1) {
      groups.push({ count: items.length, items });
    }
  }
  return groups;
}

/**
 * Replace reused passwords with unique generated strong passwords, keeping the first item in each
 * group unchanged. Returns the number of updated items.
 */
export function batchUpdateReusedPasswords(vaultData: VaultData): number {
  const groups = findReusedPasswordGroups(vaultData);
  let updatedCount = 0;

  for (const group of groups) {
    for (const item of group.items.slice(1)) {
      if (item.login) {
        item.login.password = generateStrongPassword();
        updatedCount++;
      }
    }
  }

  return updatedCount;
}

export interface MalformedUriIssue {
  item: VaultItem;
  uri: string;
  reason: string;
}

/** Audit all login URIs in the vault for malformed syntax or missing schemes. */
export function findMalformedUris(vaultData: VaultData): MalformedUriIssue[] {
  const issues: MalformedUriIssue[] = [];

  for (const item of vaultData.items) {
    const uris = item.login?.uris ?? [];
    for (const entry of uris) {
      const raw = getUriString(entry).trim();
      if (!raw) {
        issues.push({ item, uri: "(empty)", reason: "Empty URI entry" });
        continue;
      }

      if (raw.startsWith("androidapp://")) {
        if (!raw.slice("androidapp://".length).trim()) {
          issues.push({ item, uri: raw, reason: "Missing Android package name" });
        }
        continue;
      }

      if (raw.startsWith("iosapp://")) {
        if (!raw.slice("iosapp://".length).trim()) {
          issues.push({ item, uri: raw, reason: "Missing iOS app ID" });
        }
        continue;
      }

      try {
        const parsed = new URL(raw);
        if ((parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname) {
          issues.push({ item, uri: raw, reason: "Missing hostname" });
        }
      } catch {
        issues.push({ item, uri: raw, reason: "Invalid URL or missing scheme (e.g. https://)" });
      }
    }
  }

  return issues;
}

export interface VaultHealthSummary {
  totalItems: number;
  loginItems: number;
  foldersCount: number;
  favoritesCount: number;
  totpCount: number;
  fidoCount: number;
  weakPasswordCount: number;
  reusedGroupCount: number;
  reusedItemCount: number;
  duplicateItemCount: number;
  malformedUriCount: number;
  healthScore: number;
}

/** Compute overall vault statistics and a 0-100 health score. */
export function computeVaultHealth(vaultData: VaultData): VaultHealthSummary {
  const totalItems = vaultData.items.length;
  let loginItems = 0;
  let favoritesCount = 0;
  let totpCount = 0;
  let fidoCount = 0;

  for (const item of vaultData.items) {
    if (item.favorite) favoritesCount++;
    if (item.login) {
      loginItems++;
      if (item.login.totp) totpCount++;
      if (hasFidoCredentials(item)) fidoCount++;
    }
  }

  const weakPasswordCount = findWeakPasswordItems(vaultData).length;
  const reusedGroups = findReusedPasswordGroups(vaultData);
  const reusedGroupCount = reusedGroups.length;
  const reusedItemCount = reusedGroups.reduce((sum, g) => sum + g.count, 0);
  const malformedUriCount = findMalformedUris(vaultData).length;

  const seenNames = new Set<string>();
  let duplicateItemCount = 0;
  for (const item of vaultData.items) {
    const key = item.name?.trim().toLowerCase();
    if (!key) continue;
    if (seenNames.has(key)) {
      duplicateItemCount++;
    } else {
      seenNames.add(key);
    }
  }

  // Score calculation: start at 100 and deduct proportionally to vault size
  const denom = Math.max(1, totalItems);
  const penalty =
    (weakPasswordCount / denom) * 45 +
    (reusedItemCount / denom) * 30 +
    (duplicateItemCount / denom) * 15 +
    (malformedUriCount / denom) * 10;
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    totalItems,
    loginItems,
    foldersCount: vaultData.folders?.length ?? 0,
    favoritesCount,
    totpCount,
    fidoCount,
    weakPasswordCount,
    reusedGroupCount,
    reusedItemCount,
    duplicateItemCount,
    malformedUriCount,
    healthScore,
  };
}

export interface RedirectFinding {
  item: VaultItem;
  originalUri: string;
  redirectedUri: string;
  status: number;
}

export interface DeadLinkFinding {
  item: VaultItem;
  uri: string;
  reason: string;
}

export interface UriReachabilityResult {
  checkedCount: number;
  redirects: RedirectFinding[];
  deadLinks: DeadLinkFinding[];
}

/**
 * Remove `user:password@` credentials from a URL before it is sent over the network. Reachability
 * checks must never transmit credentials embedded in a stored URI as an HTTP Authorization header.
 */
export function stripUriCredentials(uri: string): string {
  try {
    const url = new URL(uri);
    if (!url.username && !url.password) return uri;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return uri;
  }
}

/**
 * Opt-in HTTP reachability and redirect check for `http://` and `https://` vault URIs. Never called
 * during default local audits.
 */
export async function checkUriReachability(
  vaultData: VaultData,
  onProgress?: ProgressCallback,
): Promise<UriReachabilityResult> {
  const targets: Array<{ item: VaultItem; uri: string }> = [];
  for (const item of vaultData.items) {
    for (const entry of item.login?.uris ?? []) {
      const uri = getUriString(entry);
      if (/^https?:\/\//i.test(uri)) {
        targets.push({ item, uri });
      }
    }
  }

  const total = targets.length;
  const outcomes: Array<{
    redirect?: RedirectFinding;
    deadLink?: DeadLinkFinding;
  }> = Array.from({ length: total }, () => ({}));
  let nextTarget = 0;
  let completed = 0;

  const worker = async (): Promise<void> => {
    while (nextTarget < total) {
      const index = nextTarget++;
      const { item, uri } = targets[index];
      const requestUri = stripUriCredentials(uri);
      const outcome: (typeof outcomes)[number] = {};
      try {
        let res = await axios.head(requestUri, {
          timeout: 5000,
          maxRedirects: 0,
          validateStatus: () => true,
        });
        if (res.status === 405) {
          res = await axios.get(requestUri, {
            timeout: 5000,
            maxRedirects: 0,
            validateStatus: () => true,
          });
        }

        if (res.status >= 300 && res.status < 400 && typeof res.headers?.location === "string") {
          const resolved = new URL(res.headers.location, requestUri).toString();
          if (resolved !== requestUri) {
            outcome.redirect = {
              item,
              originalUri: uri,
              redirectedUri: resolved,
              status: res.status,
            };
          }
        } else if (res.status >= 400) {
          outcome.deadLink = { item, uri, reason: `HTTP ${res.status}` };
        }
      } catch (error) {
        outcome.deadLink = {
          item,
          uri,
          reason: (error as Error).message || "Network error",
        };
      }
      outcomes[index] = outcome;
      completed++;
      onProgress?.(completed, total, requestUri);
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, total) }, () => worker()));

  const redirects: RedirectFinding[] = [];
  const deadLinks: DeadLinkFinding[] = [];
  for (const outcome of outcomes) {
    if (outcome.redirect) redirects.push(outcome.redirect);
    if (outcome.deadLink) deadLinks.push(outcome.deadLink);
  }

  return { checkedCount: total, redirects, deadLinks };
}

/**
 * Append redirected URIs to matching items (preserving the original URI) without duplicating
 * existing URIs. Returns the number of URIs added.
 */
export function applyRedirectUpdates(
  _vaultData: VaultData,
  redirects: readonly RedirectFinding[],
): number {
  let added = 0;
  for (const finding of redirects) {
    const uris = finding.item.login?.uris;
    if (!uris) continue;
    const exists = uris.some((u) => getUriString(u) === finding.redirectedUri);
    if (!exists) {
      const usesObjects = uris.some((u) => typeof u === "object" && u !== null && "uri" in u);
      uris.push(usesObjects ? { uri: finding.redirectedUri } : finding.redirectedUri);
      added++;
    }
  }
  return added;
}

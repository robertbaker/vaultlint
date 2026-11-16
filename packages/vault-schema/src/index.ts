export interface VaultUriObject {
  uri: string;
  match?: number | null;
}

export type VaultUri = string | VaultUriObject;

export interface VaultLogin {
  username?: string;
  password?: string;
  uris?: VaultUri[];
  totp?: string;
  fido?: unknown;
  fido2Credentials?: VaultFido2Credential[] | null;
  [key: string]: unknown;
}

export interface VaultFido2Credential {
  credentialId?: string;
  keyType?: string;
  keyAlgorithm?: string;
  keyCurve?: string;
  keyValue?: string;
  rpId?: string;
  counter?: string;
  discoverable?: string;
  creationDate?: string | null;
  userHandle?: string;
  userName?: string;
  rpName?: string;
  userDisplayName?: string;
  [key: string]: unknown;
}

export interface VaultCustomField {
  name: string;
  value: string;
  type?: number;
  linkedId?: number | null;
}

export interface VaultCard {
  cardholderName?: string;
  brand?: string;
  number?: string;
  expMonth?: string;
  expYear?: string;
  code?: string;
}

export interface VaultIdentity {
  title?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  username?: string;
  company?: string;
  email?: string;
  phone?: string;
  address1?: string;
  address2?: string | null;
  address3?: string | null;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  ssn?: string;
  passportNumber?: string;
  licenseNumber?: string;
  [key: string]: unknown;
}

export interface VaultItem {
  id?: string;
  name?: string;
  type?: number;
  folderId?: string | null;
  collectionIds?: Array<string | null> | null;
  favorite?: boolean;
  reprompt?: number;
  notes?: string;
  organizationId?: string | null;
  creationDate?: string | null;
  deletedDate?: string | null;
  lastModified?: string;
  revisionDate?: string | null;
  passwordHistory?: Array<{ password: string; lastUsedDate: string | null }>;
  secureNote?: { type: number };
  login?: VaultLogin;
  card?: VaultCard;
  identity?: VaultIdentity;
  fields?: VaultCustomField[];
  /** Original provider payload retained when the canonical schema cannot represent all fields. */
  _providerData?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VaultFolder {
  id: string;
  name: string;
}

/** Bitwarden organization collection metadata included in organization JSON exports. */
export interface VaultCollection {
  id: string;
  name: string;
  organizationId?: string;
  externalId?: string | null;
}

/** An item in a Bitwarden export, including provider-specific fields on VaultItem. */
export type BitwardenVaultItem = VaultItem;

/** Shape of an unencrypted Bitwarden personal or organization JSON export. */
export interface BitwardenVaultExport {
  encrypted?: false;
  folders?: VaultFolder[];
  collections?: VaultCollection[];
  items: BitwardenVaultItem[];
  [key: string]: unknown;
}

export interface VaultData {
  encrypted?: boolean;
  folders?: VaultFolder[];
  collections?: VaultCollection[];
  items: VaultItem[];
  [key: string]: unknown;
}

/**
 * Infer the provider item category (1 login, 2 note, 3 card, 4 identity) when an export omits its
 * numeric type. Shared so duplicate grouping and migration matching classify items identically.
 */
export function inferItemType(item: VaultItem): number {
  if (typeof item.type === "number") return item.type;
  if (item.card) return 3;
  if (item.identity) return 4;
  if (item.secureNote) return 2;
  return 1;
}

/** True when a login holds a passkey; Bitwarden writes an empty `fido2Credentials: []` otherwise. */
export function hasFidoCredentials(item: VaultItem): boolean {
  const login = item.login;
  return Boolean(
    login?.fido || (Array.isArray(login?.fido2Credentials) && login.fido2Credentials.length > 0),
  );
}

const POSITIONAL_ITEM_REF_PREFIX = "index:";

/**
 * Build collision-free local references for vault items. A persistent ID is used only when it is
 * non-empty and unique; otherwise the item's current position is used. IDs using the positional
 * prefix are also positionalized so they cannot collide with fallback references.
 */
export function buildVaultItemRefs(vaultData: VaultData): string[] {
  const counts = new Map<string, number>();
  for (const item of vaultData.items) {
    if (item.id) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  }
  return vaultData.items.map((item, index) =>
    item.id && counts.get(item.id) === 1 && !item.id.startsWith(POSITIONAL_ITEM_REF_PREFIX)
      ? item.id
      : `${POSITIONAL_ITEM_REF_PREFIX}${index}`,
  );
}

export function getUriString(entry: VaultUri | null | undefined): string {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return typeof entry.uri === "string" ? entry.uri : "";
}

/** Return a URI label safe for logs and reports: hostname and port only. */
export function getSafeUriDisplayLabel(uri: string | undefined): string {
  if (!uri) return "(invalid URI)";
  try {
    const hasPort = /^(?:\[[^\]]+\]|[^/:?#]+):\d+(?:[/?#]|$)/.test(uri);
    const hasScheme = uri.includes("://") || (/^[a-z][a-z\d+.-]*:/i.test(uri) && !hasPort);
    const parsed = new URL(hasScheme ? uri : `https://${uri}`);
    if (!parsed.hostname) return "(invalid URI)";
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "(invalid URI)";
  }
}

export function withUpdatedUri(entry: VaultUri, nextUri: string): VaultUri {
  if (typeof entry === "string") {
    return nextUri;
  }
  return { ...entry, uri: nextUri };
}

const TWO_PART_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.nz",
  "co.za",
  "com.br",
  "com.mx",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "co.in",
  "net.in",
  "org.in",
  "gov.in",
  "ac.in",
  "co.kr",
  "or.kr",
  "go.kr",
  "ac.kr",
  "com.tr",
  "net.tr",
  "org.tr",
  "com.tw",
  "com.hk",
  "com.sg",
  "com.my",
  "com.ph",
  "com.vn",
  "co.id",
  "co.th",
  "com.ar",
  "com.co",
  "com.pe",
  "com.ua",
  "co.il",
  "com.eg",
  "com.sa",
  "com.pk",
  "com.ng",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "org.nz",
  "net.nz",
  "net.br",
  "org.br",
  "gov.br",
  "edu.au",
  "gov.au",
]);

export interface DomainParts {
  hostname: string;
  domainTld: string;
  subDomain: string;
}

/** Extract hostname, registrable domain.tld, and subdomain prefix from a URI string. */
export function extractDomainParts(uri: string | undefined): DomainParts {
  if (!uri) return { hostname: "", domainTld: "", subDomain: "" };
  try {
    // Preserve explicit schemes (including opaque mailto:/tel:) while treating a numeric
    // suffix as a port on a scheme-less host (example.com:8443, localhost:3000).
    const hasPort = /^(?:\[[^\]]+\]|[^/:?#]+):\d+(?:[/?#]|$)/.test(uri);
    const hasScheme = uri.includes("://") || (/^[a-z][a-z\d+.-]*:/i.test(uri) && !hasPort);
    const parsed = new URL(hasScheme ? uri : `https://${uri}`);
    const hostname = parsed.hostname.toLowerCase();
    // IP literals have no registrable domain or subdomain.
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) {
      return { hostname, domainTld: hostname, subDomain: "" };
    }
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length <= 1) {
      return { hostname, domainTld: hostname, subDomain: "" };
    }
    const lastTwo = parts.slice(-2).join(".");
    const domainPartCount = parts.length >= 3 && TWO_PART_TLDS.has(lastTwo) ? 3 : 2;
    const domainTld = parts.slice(-domainPartCount).join(".");
    const subDomain = parts.slice(0, -domainPartCount).join(".");
    return { hostname, domainTld, subDomain };
  } catch {
    return { hostname: "", domainTld: "", subDomain: "" };
  }
}

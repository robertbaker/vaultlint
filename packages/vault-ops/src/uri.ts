import {
  extractDomainParts,
  getUriString,
  withUpdatedUri,
  type VaultData,
  type VaultItem,
} from "@vaultlint/vault-schema";

/**
 * Mask the password in a `user:password@host` URI userinfo for display in CLI tables and listings.
 * Works on schemeless values too; the username and everything after `@` are left untouched.
 */
export function redactUriCredentials(uri: string): string {
  // Userinfo ends at the LAST "@" of the authority, so a password may itself contain "@".
  return uri.replace(/^((?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#@\s:]*):[^/?#\s]*@/i, "$1:***@");
}

export interface InvalidUriFinding {
  item: VaultItem;
  index: number;
  invalidUris: string[];
}

function parseUriForDomainMapping(value: string): { url: URL; schemeLess: boolean } | undefined {
  try {
    const url = new URL(value);
    if (url.hostname) return { url, schemeLess: false };
  } catch {
    // Try a scheme-less web address below.
  }
  try {
    const url = new URL(`https://${value}`);
    if (url.hostname) return { url, schemeLess: true };
  } catch {
    // Not a URL with a host that can be mapped.
  }
  return undefined;
}

/** Find vault items containing malformed or schemeless URIs. */
export function findInvalidUriFindings(vaultData: VaultData): InvalidUriFinding[] {
  const list: InvalidUriFinding[] = [];
  vaultData.items.forEach((item, index) => {
    const uris = item.login?.uris ?? [];
    const invalidUris: string[] = [];
    for (const entry of uris) {
      const str = getUriString(entry);
      if (!str) continue;
      if (str.startsWith("androidapp://") || str.startsWith("iosapp://")) {
        const prefix = str.startsWith("androidapp://") ? "androidapp://" : "iosapp://";
        if (str.length <= prefix.length) invalidUris.push(str);
        continue;
      }
      try {
        const parsed = new URL(str);
        if (!parsed.hostname) invalidUris.push(str);
      } catch {
        invalidUris.push(str);
      }
    }
    if (invalidUris.length > 0) {
      list.push({ item, index, invalidUris });
    }
  });
  return list;
}

/** Normalize all item names (lowercase, strip protocol) and URIs (origin-only) in-place. */
export function normalizeVaultItems(vaultData: VaultData): number {
  let modified = 0;
  for (const item of vaultData.items) {
    if (item.name) {
      const nextName = item.name.toLowerCase().replace(/^https?:\/\//, "");
      if (nextName !== item.name) {
        item.name = nextName;
        modified++;
      }
    }
    if (item.login?.uris) {
      item.login.uris = item.login.uris.map((u) => {
        const cur = getUriString(u);
        try {
          const url = new URL(cur);
          // Hostless URIs (mailto:, file:, javascript:) have no origin to reduce to.
          if (!url.hostname) return u;
          const origin = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
          if (origin !== cur) modified++;
          return withUpdatedUri(u, origin);
        } catch {
          return u;
        }
      });
    }
  }
  return modified;
}

/** Apply host-to-host domain mappings across all vault item URIs in-place. */
export function applyDomainMappingsToVault(
  vaultData: VaultData,
  mappings: Record<string, string>,
): number {
  let updated = 0;
  for (const item of vaultData.items) {
    if (!item.login?.uris) continue;
    item.login.uris = item.login.uris.map((u) => {
      const cur = getUriString(u);
      if (!cur) return u;
      const parsed = parseUriForDomainMapping(cur);
      if (parsed) {
        const { url, schemeLess } = parsed;
        const lowerHostname = url.hostname.toLowerCase();
        const mapped = Object.hasOwn(mappings, lowerHostname)
          ? mappings[lowerHostname]
          : Object.hasOwn(mappings, url.hostname)
            ? mappings[url.hostname]
            : undefined;
        if (mapped && mapped !== url.hostname) {
          url.hostname = mapped;
          updated++;
          let nextUri = url.toString();
          if (schemeLess) {
            nextUri = nextUri.replace(/^https:\/\//i, "");
            if (url.pathname === "/" && !url.search && !url.hash && !cur.endsWith("/")) {
              nextUri = nextUri.slice(0, -1);
            }
          } else if (url.pathname === "/" && !url.search && !url.hash && !cur.endsWith("/")) {
            nextUri = url.origin;
          }
          return withUpdatedUri(u, nextUri);
        }
      }
      if (Object.hasOwn(mappings, cur) && mappings[cur]) {
        updated++;
        return withUpdatedUri(u, mappings[cur]);
      }
      return u;
    });
  }
  return updated;
}

/** Suggest subdomain -> registrable domain mappings from existing vault URIs. */
export function suggestSubdomainMappings(
  vaultData: VaultData,
  existingMappings: Record<string, string>,
): Record<string, string> {
  const suggestions = Object.create(null) as Record<string, string>;
  for (const item of vaultData.items) {
    for (const u of item.login?.uris ?? []) {
      const { hostname, domainTld, subDomain } = extractDomainParts(getUriString(u));
      if (!hostname || !domainTld || !subDomain || subDomain === "www") continue;
      if (!Object.hasOwn(existingMappings, hostname) || !existingMappings[hostname]) {
        suggestions[hostname] = domainTld;
      }
    }
  }
  return suggestions;
}

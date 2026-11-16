/**
 * Shared vaultlint brand constants used by the Astro site and the Angular Web UI so names, copy,
 * colours, and the supported-manager list never drift between the two.
 */

export const BRAND_NAME = "vaultlint";

/** Two-part tagline; the second half is the accented phrase in hero headings. */
export const BRAND_TAGLINE = ["Lint your vault.", "Keep it local."] as const;

export const BRAND_DESCRIPTION =
  "Audit, edit, and convert unencrypted password manager exports locally, in your browser or terminal.";

/** `<meta name="theme-color">` values matching `--background` in each scheme. */
export const BRAND_THEME_COLOR = { light: "#ffffff", dark: "#0b1220" } as const;

export const BRAND_LINKS = {
  docs: "https://robertbaker.github.io/vaultlint/",
  repository: "https://github.com/robertbaker/vaultlint",
  license: "https://github.com/robertbaker/vaultlint/blob/main/LICENSE",
  changelog: "https://github.com/robertbaker/vaultlint/blob/main/CHANGELOG.md",
} as const;

export const BRAND_LICENSE = "GPL-3.0";

/** Password managers and browsers named in marketing copy, in display order. */
export const SUPPORTED_MANAGERS = [
  "Bitwarden",
  "1Password",
  "KeePass",
  "Proton Pass",
  "LastPass",
  "Dashlane",
  "NordPass",
  "Enpass",
  "Keeper",
  "RoboForm",
  "Chrome / Edge / Brave",
  "Firefox",
  "Safari",
] as const;

/** Vendors named in the non-affiliation notice shown in both footers. */
export const TRADEMARK_OWNERS = [
  "Bitwarden",
  "1Password",
  "KeePass",
  "Proton",
  "LastPass",
  "Dashlane",
  "NordPass",
  "Enpass",
  "Keeper",
  "RoboForm",
  "Bramble",
  "Aegis",
  "Google",
  "Microsoft",
  "Mozilla",
  "Brave Software",
  "Apple",
] as const;

/** "A, B, and C" with an Oxford comma. */
export function formatList(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1)}`;
}

export const TRADEMARK_NOTICE = `${BRAND_NAME} is an independent open-source project and is not affiliated with, endorsed by, or sponsored by ${formatList(TRADEMARK_OWNERS, "or")}. All product names and trademarks belong to their respective owners.`;

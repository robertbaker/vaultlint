/**
 * Colour plumbing shared by the composites and house directives.
 *
 * Every component reads its colours from `--r5-<component>-*` custom properties, each falling back
 * to a theme token (`--primary`, `--card`, …). A consumer can set them three ways, most to least
 * global:
 *
 * 1. In CSS on any ancestor — `:root { --r5-slider-accent: #16a34a; }` restyles every slider.
 * 2. In CSS on the element — `app-setting-value-slider.danger { --r5-slider-accent: red; }`.
 * 3. Through the component's colour inputs — `<app-setting-value-slider accent="#f59e0b" />`.
 *
 * Inputs win over CSS because they bind the property inline on the host. Foregrounds that sit on a
 * consumer-chosen fill are derived with `contrast-color()` (with a token fallback where the browser
 * lacks it), so any fill colour stays legible without a matching foreground token.
 */

/** Theme tokens a colour input accepts by name. */
export type ThemeTone =
  | "primary"
  | "secondary"
  | "accent"
  | "muted"
  | "foreground"
  | "destructive"
  | "success"
  | "warning";

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. The `#` is optional on input. */
export type HexColor = `#${string}`;

/**
 * A tone name, a hex colour (`#0af`, `0af`, `#ff6600cc`), a custom property (`--brand`), or any
 * other CSS colour (`oklch(…)`, `rgb(…)`, `rebeccapurple`).
 */
export type ThemeColor = ThemeTone | HexColor | `--${string}` | (string & {});

const TONES: ReadonlySet<string> = new Set<ThemeTone>([
  "primary",
  "secondary",
  "accent",
  "muted",
  "foreground",
  "destructive",
  "success",
  "warning",
]);

const HEX_RE = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * `"#FF6600"`, `"ff6600"` and `"f60"` normalise to lowercase `#`-prefixed hex; anything else is
 * `null`.
 */
export function normalizeHex(value: string): HexColor | null {
  const match = HEX_RE.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** Whether the runtime can check colours; false during SSR, where values pass through unchecked. */
const canValidate = typeof CSS !== "undefined" && typeof CSS.supports === "function";

/**
 * Resolve a colour input to a CSS value for a custom-property binding. Tone names and `--custom`
 * properties become `var(…)`, hex is normalised (so a bare `ff6600` works), and other values pass
 * through when the browser accepts them as a colour. Empty or unrecognised input yields `null`,
 * which removes the inline property so the CSS cascade (and the token fallback) applies again
 * rather than leaving the component with an invalid colour.
 */
export function themeColor(value: ThemeColor | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (TONES.has(v)) return `var(--${v})`;
  if (v.startsWith("--")) return `var(${v})`;
  const hex = normalizeHex(v);
  if (hex) return hex;
  if (v.startsWith("#")) return null;
  if (canValidate && !CSS.supports("color", v)) return null;
  return v;
}

/** Whether the browser implements `contrast-color()`; false during SSR. */
export const supportsContrastColor = canValidate && CSS.supports("color", "contrast-color(red)");

/**
 * Text colour for a fill: `contrast-color(fill)` where supported, else `fallback`. For inline
 * bindings, where a CSS `@supports` block is not available.
 */
export function contrastColor(fill: string, fallback = "var(--primary-foreground)"): string {
  return supportsContrastColor ? `contrast-color(${fill})` : fallback;
}

/**
 * Foreground fallback when the browser lacks `contrast-color()`; opaque hex fills use WCAG
 * luminance.
 */
export function contrastForegroundFallback(
  value: ThemeColor | null | undefined,
  fallback = "var(--primary-foreground)",
): string {
  const normalized = value ? normalizeHex(value.trim()) : null;
  if (normalized) {
    const hex = normalized.slice(1);
    const alpha = hex.length === 4 ? hex[3] + hex[3] : hex.length === 8 ? hex.slice(6, 8) : "ff";
    if (alpha === "ff") {
      const rgb =
        hex.length === 3 || hex.length === 4
          ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
          : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
      const [r, g, b] = rgb.map((channel) => Number.parseInt(channel, 16) / 255);
      const luminance = [r, g, b]
        .map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        )
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const blackContrast = (luminance + 0.05) / 0.05;
      const whiteContrast = 1.05 / (luminance + 0.05);
      return blackContrast >= whiteContrast ? "#000" : "#fff";
    }
  }

  switch (value?.trim()) {
    case "primary":
      return "var(--primary-foreground)";
    case "secondary":
      return "var(--secondary-foreground)";
    case "accent":
      return "var(--accent-foreground)";
    case "muted":
      return "var(--foreground)";
    case "foreground":
      return "var(--background)";
    case "destructive":
      return "var(--destructive-foreground)";
    case "success":
      return "var(--success-foreground)";
    case "warning":
      return "var(--warning-foreground)";
    default:
      return fallback;
  }
}

/**
 * Readable tinted text for a colour washed over `surface`: the colour mixed toward
 * `contrast-color(surface)` — black on light surfaces, white on dark — so the tint stays legible on
 * either without a per-mode token. Falls back to mixing toward `--foreground`. Mixed in `oklab`
 * rather than `oklch`: the ink is achromatic, and an `oklch` mix would drag the hue toward it.
 */
export function readableTint(color: string, surface = "var(--background)"): string {
  return `color-mix(in oklab, ${color} 35%, ${contrastColor(surface, "var(--foreground)")})`;
}

/**
 * CSS for component stylesheets: defines `--_ink` on the host as `contrast-color()` of the surface
 * (`--foreground` where unsupported). Mix tints toward `var(--_ink)` for readable tinted text.
 */
export const INK_STYLES = `
  :host {
    --_ink: var(--foreground);
  }
  @supports (color: contrast-color(red)) {
    :host {
      --_ink: contrast-color(var(--background));
    }
  }
`;

/** A finite, non-negative number becomes `px`; a non-empty string is used as-is. */
export function cssLength(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? `${value}px` : null;
  }
  return value.trim() ? value : null;
}

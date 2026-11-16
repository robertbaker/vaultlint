import { booleanAttribute, computed, Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";
import {
  contrastColor,
  contrastForegroundFallback,
  readableTint,
  themeColor,
  type ThemeColor,
} from "@ui/components/theme-color";

/**
 * House primitive with no upstream analogue: a compact bordered stat pill.
 *
 * Neutral by default, read from `--r5-stat-chip-bg` (`--card`), `--r5-stat-chip-border`
 * (`--border`) and `--r5-stat-chip-fg` (`--foreground`). `color` (tone, hex, `--prop`, or CSS
 * colour) tints it instead: `soft` washes the pill in the colour, `solid` fills it and picks the
 * text with `contrast-color()`. Set `--r5-stat-chip-fg` to pin the text colour for custom fills or
 * browsers without `contrast-color()`.
 *
 * `size` is `sm` / `default` / `lg`; `interactive="false"` drops the hover/press motion for
 * read-only pills.
 */
@Directive({
  selector: "[hlmStatChip]",
  host: {
    "data-slot": "stat-chip",
    "[attr.data-appearance]": "color() ? appearance() : null",
    "[style.--_sc-bg]": "_bg()",
    "[style.--_sc-border]": "_border()",
    "[style.--_sc-fg]": "_fg()",
    "[attr.data-size]": "size()",
  },
})
export class HlmStatChip {
  public readonly color = input<ThemeColor>();
  public readonly appearance = input<"soft" | "solid">("soft");
  public readonly size = input<"sm" | "default" | "lg">("default");
  public readonly interactive = input(true, { transform: booleanAttribute });

  private readonly _accent = computed(() => themeColor(this.color()));

  protected readonly _bg = computed(() => {
    const c = this._accent();
    if (!c) return "var(--r5-stat-chip-bg, var(--card))";
    return this.appearance() === "solid" ? c : `color-mix(in oklab, ${c} 12%, transparent)`;
  });
  protected readonly _border = computed(() => {
    const c = this._accent();
    if (!c) return "var(--r5-stat-chip-border, var(--border))";
    return this.appearance() === "solid" ? c : `color-mix(in oklab, ${c} 40%, transparent)`;
  });
  protected readonly _fg = computed(() => {
    const c = this._accent();
    if (!c) return "var(--r5-stat-chip-fg, var(--foreground))";
    return this.appearance() === "solid"
      ? `var(--r5-stat-chip-fg, ${contrastColor(c, contrastForegroundFallback(this.color()))})`
      : `var(--r5-stat-chip-fg, ${readableTint(c)})`;
  });

  constructor() {
    classes(() => [
      "inline-flex h-7 items-center gap-1.5 rounded-full border border-(--_sc-border) bg-(--_sc-bg) px-2.5 text-xs font-medium text-(--_sc-fg) shadow-2xs transition-all duration-[var(--av-ui-motion-fast)] ease-[var(--av-ui-easing)] select-none",
      this.interactive() && "hover:border-foreground/30 hover:scale-[1.02] active:scale-[0.98]",
      this.size() === "sm" && "h-6 gap-1 px-2 text-2xs",
      this.size() === "lg" && "h-8 gap-2 px-3 text-sm",
    ]);
  }
}

export const HlmStatChipImports = [HlmStatChip] as const;

import { booleanAttribute, computed, Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";
import { readableTint, themeColor, type ThemeColor } from "@ui/components/theme-color";

/**
 * House primitive with no upstream analogue: an inline warning callout.
 *
 * Tinted from `--r5-callout-accent` (default `--warning`) with text from `--r5-callout-fg` (default
 * `--warning-readable`, which is not part of the stock spartan palette; see
 * `src/styles/house-tokens.css`). `color` (tone, hex, `--prop`, or CSS colour) retints one box,
 * e.g. `color="destructive"` or `color="#0ea5e9"` for an error or info callout, with the text mixed
 * toward `--foreground` so it stays readable.
 *
 * `role` defaults to `alert` (announced immediately); use `status` for polite updates or `note` /
 * `null` for static copy that should not interrupt.
 */
@Directive({
  selector: "[hlmWarningBox]",
  host: {
    "data-slot": "warning-box",
    "[attr.role]": "role()",
    "[attr.data-compact]": 'compact() ? "" : null',
    "[style.--_wb]": "_accent()",
    "[style.--_wb-fg]": "_fg()",
  },
})
export class HlmWarningBox {
  /**
   * Tighter variant for boxes already inside a `gap-*` flex stack, sized to inherit the surrounding
   * text size.
   */
  public readonly compact = input(false, { transform: booleanAttribute });
  public readonly color = input<ThemeColor>();
  public readonly role = input<"alert" | "status" | "note" | null>("alert");

  private readonly _custom = computed(() => themeColor(this.color()));
  protected readonly _accent = computed(
    () => this._custom() ?? "var(--r5-callout-accent, var(--warning))",
  );
  protected readonly _fg = computed(() => {
    const c = this._custom();
    return c ? readableTint(c) : "var(--r5-callout-fg, var(--warning-readable))";
  });

  constructor() {
    classes(() =>
      this.compact()
        ? "rounded-lg border border-(--_wb)/30 bg-(--_wb)/10 p-3 text-(--_wb-fg)"
        : "mb-3 rounded-lg border border-(--_wb)/40 bg-(--_wb)/10 px-3 py-2 text-xs leading-relaxed text-(--_wb-fg)",
    );
  }
}

export const HlmWarningBoxImports = [HlmWarningBox] as const;

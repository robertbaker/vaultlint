import { computed, Directive, ElementRef, inject, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";
import {
  contrastColor,
  contrastForegroundFallback,
  readableTint,
  themeColor,
  type ThemeColor,
} from "@ui/components/theme-color";
import { cva, type VariantProps } from "class-variance-authority";

/**
 * Square icon-only button. Equivalent to `hlmBtn variant="ghost|secondary" size="icon"`, kept as
 * its own directive because it is applied to bare `<button>`s that don't want the rest of
 * `buttonVariants`.
 *
 * Hover/disabled treatments are deliberately kept in step with the generated `hlm-button` so the
 * two read identically. When `src/ui/button` is regenerated, re-check the three values below
 * against `buttonVariants`: the base radius, the `secondary` hover, and the `icon` size.
 *
 * `tint` and `solid` take any colour: `color` input (tone, hex, `--prop`, CSS colour), else
 * `--r5-icon-button-color` from CSS, else `--primary`. `solid` text is `contrast-color()` of the
 * fill; pin it with `--r5-icon-button-fg`.
 *
 * `shape="circle"` rounds the button fully; sizes run `lg` / `default` / `sm` / `xs` / `2xs`.
 */
export const iconButtonVariants = cva(
  "font-medium inline-flex shrink-0 items-center justify-center transition-all duration-150 ease-out outline-none select-none focus-visible:border-ring focus-visible:ring-ring focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 hover:scale-105 active:scale-95 active:translate-y-px [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 [&_ng-icon]:transition-transform [&_ng-icon]:duration-150 hover:[&_ng-icon]:scale-110 active:[&_ng-icon]:scale-90",
  {
    variants: {
      variant: {
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50",
        outline: "border border-border bg-background hover:bg-muted hover:text-foreground",
        danger:
          "border border-destructive/30 bg-destructive/10 text-destructive-readable hover:bg-destructive/20 hover:border-destructive/50 focus-visible:ring-ring",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-ring dark:bg-destructive/60",
        success:
          "border border-success/30 bg-success/10 text-success-readable hover:bg-success/20 hover:border-success/50 focus-visible:ring-ring",
        warning:
          "border border-warning/30 bg-warning/10 text-warning-readable hover:bg-warning/20 hover:border-warning/50 focus-visible:ring-ring",
        tint: "border border-(--_ibc)/30 bg-(--_ibc)/10 text-(--_ibc-tint) hover:bg-(--_ibc)/20 hover:border-(--_ibc)/50 focus-visible:ring-(--_ibc-focus)",
        solid:
          "bg-(--_ibc) text-(--_ibc-on) hover:bg-(--_ibc)/90 focus-visible:ring-(--_ibc-focus)",
        info: "border border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300 hover:bg-sky-500/20 hover:border-sky-500/50 focus-visible:ring-ring",
      },
      size: {
        lg: "size-9 rounded-lg text-base",
        default: "size-8 rounded-lg text-sm",
        sm: "size-7 rounded-md text-sm",
        xs: "size-6 rounded-md text-xs [&_ng-icon]:text-[length:--spacing(3)]",
        "2xs": "size-5 rounded-sm text-3xs [&_ng-icon]:text-[length:--spacing(2.5)]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export type IconButtonVariants = VariantProps<typeof iconButtonVariants>;

@Directive({
  selector: "[hlmIconButton]",
  host: {
    "data-slot": "icon-button",
    "[attr.data-variant]": "variant()",
    "[attr.data-size]": "size()",
    "[attr.data-shape]": "shape()",
    "[attr.type]": "isButton ? (type() || 'button') : null",
    "[style.--_ibc]": "_color()",
    "[style.--_ibc-on]": "_onColor()",
    "[style.--_ibc-focus]": "_focusColor()",
    "[style.--_ibc-tint]": "_tint",
  },
})
export class HlmIconButton {
  private readonly _isButton = inject(ElementRef).nativeElement.tagName === "BUTTON";

  protected get isButton(): boolean {
    return this._isButton;
  }

  public readonly type = input<string>("button");
  public readonly variant = input<IconButtonVariants["variant"]>("secondary");
  public readonly size = input<IconButtonVariants["size"]>("default");
  /** Colour for the `tint` / `solid` variants. Tone name, hex, `--custom-prop`, or CSS colour. */
  public readonly color = input<ThemeColor>();
  public readonly shape = input<"square" | "circle">("square");

  protected readonly _color = computed(
    () => themeColor(this.color()) ?? "var(--r5-icon-button-color, var(--primary))",
  );
  protected readonly _onColor = computed(
    () =>
      `var(--r5-icon-button-fg, ${contrastColor("var(--_ibc)", contrastForegroundFallback(this.color()))})`,
  );
  protected readonly _focusColor = computed(
    () => `var(--r5-icon-button-focus-ring, ${contrastColor("var(--background)", "var(--ring)")})`,
  );
  protected readonly _tint = readableTint("var(--_ibc)");

  constructor() {
    classes(() => [
      iconButtonVariants({ variant: this.variant(), size: this.size() }),
      this.shape() === "circle" && "rounded-full",
    ]);
  }
}

export const HlmIconButtonImports = [HlmIconButton] as const;

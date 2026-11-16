import { computed, Directive, input, signal } from "@angular/core";
import { BrnButton } from "@spartan-ng/brain/button";
import { classes } from "@spartan-ng/helm/utils";
import {
  contrastColor,
  contrastForegroundFallback,
  readableTint,
  themeColor,
  type ThemeColor,
} from "@ui/components/theme-color";
import { cva, type VariantProps } from "class-variance-authority";
import type { ClassValue } from "clsx";

import { injectBrnButtonConfig } from "./hlm-button.token";

export const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring data-[matches-spartan-invalid=true]:ring-destructive data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all duration-[var(--av-ui-motion-fast)] ease-[var(--av-ui-easing)] outline-none select-none disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 [&_ng-icon]:transition-transform [&_ng-icon]:duration-[var(--av-ui-motion-fast)] group-hover/button:[&_ng-icon]:scale-105 group-active/button:[&_ng-icon]:scale-95",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground dark:bg-input-fill/30 dark:border-input dark:hover:bg-input-fill/50 aria-expanded:bg-muted aria-expanded:text-foreground shadow-xs active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground shadow-xs active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]",
        ghost:
          "hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-ring dark:bg-destructive/60 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]",
        danger:
          "border border-destructive/30 bg-destructive/10 text-destructive-readable hover:bg-destructive/20 hover:border-destructive/50 focus-visible:ring-ring active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]",
        success:
          "border border-success/30 bg-success/10 text-success-readable hover:bg-success/20 hover:border-success/50 focus-visible:ring-ring active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]",
        warning:
          "border border-warning/30 bg-warning/10 text-warning-readable hover:bg-warning/20 hover:border-warning/50 focus-visible:ring-ring active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]",
        info: "border border-info/30 bg-info/10 text-info-text hover:bg-info/20 hover:border-info/50 focus-visible:ring-ring active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]",
        // House: any-colour variants. The colour is `--_btn`: the `color` input (tone, hex, `--prop`,
        // CSS colour), else `--r5-button-color` from CSS, else `--primary`.
        tint: "border border-(--_btn)/30 bg-(--_btn)/10 text-(--_btn-tint) hover:bg-(--_btn)/20 hover:border-(--_btn)/50 focus-visible:ring-(--_btn-focus) active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]",
        solid:
          "bg-(--_btn) text-(--_btn-on) shadow-xs hover:bg-(--_btn)/90 focus-visible:ring-(--_btn-focus) active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
        dashed:
          "border border-dashed border-border/80 bg-background/50 text-muted-foreground hover:bg-accent/50 hover:text-foreground hover:border-primary/50 active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]",
        link: "text-primary underline-offset-4 hover:underline active:opacity-80",
        glass:
          "glass-bg text-foreground hover:opacity-90 active:opacity-80 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.15),inset_0_1px_2px_rgba(0,0,0,0.1)] dark:active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),inset_0_1px_2px_rgba(0,0,0,0.2)]",
        glassSubtle:
          "glass-bg text-muted-foreground backdrop-blur-[var(--blur-sm)] hover:text-foreground active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.15)]",
        glassSolid:
          "bg-gradient-to-r from-primary/20 to-info/20 backdrop-blur-[var(--blur)] border border-white/30 text-foreground shadow-[var(--glass-shadow)] hover:from-primary/30 hover:to-info/30 active:from-primary/25 active:to-info/25 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
        frosted:
          "glass-frosted text-foreground hover:opacity-90 active:opacity-85 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_2px_rgba(0,0,0,0.15)]",
        fluted:
          "glass-fluted text-foreground hover:opacity-90 active:opacity-85 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
        crystal:
          "glass-crystal text-foreground active:opacity-90 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.25),inset_0_1px_2px_rgba(0,0,0,0.2)]",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3)]",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3.5)]",
        compact:
          "h-[var(--av-ui-control-compact)] gap-1 rounded-[var(--av-ui-radius-sm)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3.5)]",
        chip: "h-5 gap-1 rounded-[var(--av-ui-radius-sm)] px-1.5 text-3xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pe-1 has-data-[icon=inline-start]:ps-1 [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(2.5)]",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-3 has-data-[icon=inline-start]:ps-3",
        icon: "size-8 hover:scale-105 active:scale-95 group-hover/button:[&_ng-icon]:scale-110 group-active/button:[&_ng-icon]:scale-90",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(3)] hover:scale-105 active:scale-95 group-hover/button:[&_ng-icon]:scale-110 group-active/button:[&_ng-icon]:scale-90",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg hover:scale-105 active:scale-95 group-hover/button:[&_ng-icon]:scale-110 group-active/button:[&_ng-icon]:scale-90",
        "icon-lg":
          "size-9 hover:scale-105 active:scale-95 group-hover/button:[&_ng-icon]:scale-110 group-active/button:[&_ng-icon]:scale-90",
        "icon-2xs":
          "size-5 rounded-[min(var(--radius-sm),6px)] in-data-[slot=button-group]:rounded-sm [&_ng-icon:not([class*='text-'])]:text-[length:--spacing(2.5)] hover:scale-105 active:scale-95 group-hover/button:[&_ng-icon]:scale-110 group-active/button:[&_ng-icon]:scale-90",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: "button[hlmBtn], a[hlmBtn]",
  exportAs: "hlmBtn",
  hostDirectives: [{ directive: BrnButton, inputs: ["disabled"] }],
  host: {
    "data-slot": "button",
    "[attr.data-variant]": "variant()",
    "[attr.data-size]": "size()",
    "[style.--_btn]": "_color()",
    "[style.--_btn-on]": "_onColor()",
    "[style.--_btn-focus]": "_focusColor()",
    "[style.--_btn-tint]": "_tint",
  },
})
export class HlmButton {
  private readonly _config = injectBrnButtonConfig();

  private readonly _additionalClasses = signal<ClassValue>("");

  public readonly variant = input<ButtonVariants["variant"]>(this._config.variant);

  public readonly size = input<ButtonVariants["size"]>(this._config.size);

  /** Colour for the `tint` / `solid` variants. `solid` text is `contrast-color()` of the fill. */
  public readonly color = input<ThemeColor>();

  protected readonly _color = computed(
    () => themeColor(this.color()) ?? "var(--r5-button-color, var(--primary))",
  );
  protected readonly _onColor = computed(
    () =>
      `var(--r5-button-fg, ${contrastColor("var(--_btn)", contrastForegroundFallback(this.color()))})`,
  );
  protected readonly _focusColor = computed(
    () => `var(--r5-button-focus-ring, ${contrastColor("var(--background)", "var(--ring)")})`,
  );
  protected readonly _tint = readableTint("var(--_btn)");

  constructor() {
    classes(() => [
      buttonVariants({ variant: this.variant(), size: this.size() }),
      this._additionalClasses(),
    ]);
  }

  setClass(classes: string): void {
    this._additionalClasses.set(classes);
  }
}

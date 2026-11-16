import { Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";
import { type VariantProps, cva } from "class-variance-authority";

const badgeVariants = cva(
  "border border-transparent font-medium transition-all duration-[var(--av-ui-motion-fast)] ease-[var(--av-ui-easing)] hover:scale-105 active:scale-95 has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>ng-icon]:text-[length:--spacing(3)] group/badge focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-[3px] [&>ng-icon]:pointer-events-none [&>ng-icon]:transition-transform [&>ng-icon]:duration-[var(--av-ui-motion-fast)] group-hover/badge:[&>ng-icon]:scale-110",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 text-destructive-readable dark:bg-destructive/20 dark:hover:bg-destructive/30",
        success: "border-success/20 bg-success/10 text-success-readable hover:bg-success/20",
        warning: "border-warning/20 bg-warning/10 text-warning-readable hover:bg-warning/20",
        info: "border-info/20 bg-info/10 text-info-text hover:bg-info/20",
        outline: "border-border text-foreground hover:bg-muted hover:text-muted-foreground",
        outlineDashed:
          "border border-dashed border-border/80 bg-background/50 text-muted-foreground hover:bg-accent/50",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        glass:
          "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] text-foreground hover:opacity-90 shadow-[var(--glass-shadow-sm)]",
        glassSubtle:
          "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] text-foreground opacity-50 hover:opacity-60 shadow-[var(--glass-shadow-sm)]",
        frosted:
          "glass-frosted backdrop-blur-[var(--blur-frosted)] border border-[var(--glass-frosted-border)] text-foreground hover:opacity-90 shadow-[var(--glass-frosted-shadow)]",
        fluted:
          "glass-fluted backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-foreground hover:opacity-90 shadow-[var(--glass-shadow-sm)]",
        crystal:
          "glass-crystal backdrop-blur-[var(--blur-crystal)] border border-[var(--glass-crystal-border)] text-foreground shadow-[var(--glass-crystal-shadow)]",
      },
      size: {
        default: "h-5 gap-1 rounded-4xl px-2 py-0.5 text-xs",
        sm: "h-4 gap-0.5 rounded-full px-1.5 py-0 text-3xs [&>ng-icon]:text-[length:--spacing(2.5)]",
        chip: "h-5 gap-1 rounded-md px-1.5 py-0.5 text-3xs [&>ng-icon]:text-[length:--spacing(2.5)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type BadgeVariants = VariantProps<typeof badgeVariants>;

@Directive({
  selector: "[hlmBadge],hlm-badge",
  host: {
    "data-slot": "badge",
    "[attr.data-variant]": "variant()",
    "[attr.data-size]": "size()",
  },
})
export class HlmBadge {
  public readonly variant = input<BadgeVariants["variant"]>("default");
  public readonly size = input<BadgeVariants["size"]>("default");

  constructor() {
    classes(() => badgeVariants({ variant: this.variant(), size: this.size() }));
  }
}

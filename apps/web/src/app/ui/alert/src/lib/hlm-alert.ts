import { Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";
import { cva, type VariantProps } from "class-variance-authority";

const alertVariants = cva(
  "grid gap-0.5 rounded-lg border px-2.5 py-2 text-start text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>ng-icon]:grid-cols-[auto_1fr] has-[>ng-icon]:gap-x-2 *:[ng-icon]:row-span-2 *:[ng-icon]:translate-y-0.5 *:[ng-icon]:text-current *:[ng-icon:not([class*='text-'])]:text-[length:--spacing(4)] group/alert relative w-full",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "text-destructive-readable bg-destructive/10 border-destructive/30 *:data-[slot=alert-description]:text-destructive-readable *:[ng-icon]:text-current",
        success:
          "text-success-readable bg-success/10 border-success/30 *:data-[slot=alert-description]:text-success-readable *:[ng-icon]:text-current",
        warning:
          "text-warning-readable bg-warning/10 border-warning/30 *:data-[slot=alert-description]:text-warning-readable *:[ng-icon]:text-current",
        glass:
          "glass-bg backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-foreground shadow-[var(--glass-shadow)]",
        glassSubtle:
          "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] text-foreground opacity-50 shadow-[var(--glass-shadow)]",
        frosted:
          "glass-frosted backdrop-blur-[var(--blur-frosted)] border border-[var(--glass-frosted-border)] text-foreground shadow-[var(--glass-frosted-shadow)]",
        fluted:
          "glass-fluted backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-foreground shadow-[var(--glass-shadow)]",
        crystal:
          "glass-crystal backdrop-blur-[var(--blur-crystal)] border border-[var(--glass-crystal-border)] text-foreground shadow-[var(--glass-crystal-shadow)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type AlertVariants = VariantProps<typeof alertVariants>;

@Directive({
  selector: "hlm-alert,[hlmAlert]",
  host: {
    "data-slot": "alert",
    role: "alert",
  },
})
export class HlmAlert {
  public readonly variant = input<AlertVariants["variant"]>("default");

  constructor() {
    classes(() => alertVariants({ variant: this.variant() }));
  }
}

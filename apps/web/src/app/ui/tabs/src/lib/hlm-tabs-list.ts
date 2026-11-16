import { Directive, input } from "@angular/core";
import { BrnTabsList } from "@spartan-ng/brain/tabs";
import { classes } from "@spartan-ng/helm/utils";
import { type VariantProps, cva } from "class-variance-authority";

export const listVariants = cva(
  "rounded-lg p-[3px] group-data-horizontal/tabs:h-8 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        glass:
          "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] shadow-[var(--glass-shadow-sm)]",
        glassSubtle:
          "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] shadow-[var(--glass-shadow-sm)] opacity-50",
        frosted:
          "glass-frosted backdrop-blur-[var(--blur-frosted)] border border-[var(--glass-frosted-border)] shadow-[var(--glass-frosted-shadow)]",
        fluted:
          "glass-fluted backdrop-blur-[var(--blur)] border border-[var(--glass-border)] shadow-[var(--glass-shadow-sm)]",
        crystal:
          "glass-crystal backdrop-blur-[var(--blur-crystal)] border border-[var(--glass-crystal-border)] shadow-[var(--glass-crystal-shadow)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
type ListVariants = VariantProps<typeof listVariants>;

@Directive({
  selector: "[hlmTabsList],hlm-tabs-list",
  hostDirectives: [BrnTabsList],
  host: {
    "data-slot": "tabs-list",
    "[attr.data-variant]": "variant()",
  },
})
export class HlmTabsList {
  public readonly variant = input<ListVariants["variant"]>("default");

  constructor() {
    classes(() => listVariants({ variant: this.variant() }));
  }
}

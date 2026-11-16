import { Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";

export type SkeletonVariant = "default" | "glass";

@Directive({
  selector: "[hlmSkeleton],hlm-skeleton",
  host: {
    "data-slot": "skeleton",
    "aria-hidden": "true",
    "[attr.data-variant]": "variant()",
  },
})
export class HlmSkeleton {
  public readonly variant = input<SkeletonVariant>("default");

  constructor() {
    classes(() => [
      "rounded-md block motion-safe:animate-pulse",
      this.variant() === "glass"
        ? "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] shadow-[var(--glass-shadow-sm)]"
        : "bg-muted",
    ]);
  }
}

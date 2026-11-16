import { Directive, input } from "@angular/core";
import { BrnFieldControlDescribedBy } from "@spartan-ng/brain/field";
import { BrnTextarea } from "@spartan-ng/brain/textarea";
import { classes } from "@spartan-ng/helm/utils";

export type TextareaVariant = "default" | "glass";

@Directive({
  selector: "[hlmTextarea]",
  hostDirectives: [
    { directive: BrnTextarea, inputs: ["id", "forceInvalid"] },
    BrnFieldControlDescribedBy,
  ],
  host: {
    "data-slot": "textarea",
    "[attr.data-variant]": "variant()",
  },
})
export class HlmTextarea {
  public readonly variant = input<TextareaVariant>("default");

  constructor() {
    classes(() => [
      "focus-visible:border-ring focus-visible:ring-ring/50 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input-fill/50 dark:disabled:bg-input-fill/80 rounded-lg border px-2.5 py-2 text-base transition-colors focus-visible:ring-3 data-[matches-spartan-invalid=true]:ring-3 md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50",
      this.variant() === "glass"
        ? "glass-bg backdrop-blur-[var(--blur-sm)] border-[var(--glass-border)] text-foreground shadow-[var(--glass-shadow-sm)]"
        : "border-input bg-transparent dark:bg-input-fill/30",
    ]);
  }
}

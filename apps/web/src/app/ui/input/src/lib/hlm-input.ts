import { Directive, input } from "@angular/core";
import { BrnFieldControlDescribedBy } from "@spartan-ng/brain/field";
import { BrnInput } from "@spartan-ng/brain/input";
import { classes } from "@spartan-ng/helm/utils";

export type InputVariant = "default" | "glass" | "destructive" | "error";
export type InputSize = "default" | "sm" | "xs";

@Directive({
  selector: "[hlmInput]",
  hostDirectives: [
    { directive: BrnInput, inputs: ["id", "forceInvalid"] },
    { directive: BrnFieldControlDescribedBy, inputs: ["aria-describedby"] },
  ],
  host: {
    "data-slot": "input",
    "[attr.data-variant]": "variant()",
    "[attr.data-size]": "size()",
  },
})
export class HlmInput {
  public readonly variant = input<InputVariant>("default");
  public readonly size = input<InputSize>("default");

  constructor() {
    classes(() => [
      "focus-visible:border-ring focus-visible:ring-ring/50 data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 disabled:bg-input-fill/50 dark:disabled:bg-input-fill/80 rounded-lg border px-2.5 py-1 text-base transition-[color,box-shadow,background-color,border-color] duration-[var(--av-ui-motion-fast)] file:h-6 file:text-sm file:font-medium focus-visible:ring-3 data-[matches-spartan-invalid=true]:ring-3 md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      this.size() === "default" && "h-8",
      this.size() === "sm" && "h-7 text-xs md:text-xs",
      this.size() === "xs" && "h-6 px-2 py-0.5 text-2xs md:text-2xs",
      this.variant() === "glass"
        ? "glass-input text-foreground"
        : this.variant() === "destructive" || this.variant() === "error"
          ? "border-destructive/60 bg-destructive/5 text-foreground focus-visible:border-destructive focus-visible:ring-destructive/20"
          : "dark:bg-input-fill/30 border-input bg-transparent",
    ]);
  }
}

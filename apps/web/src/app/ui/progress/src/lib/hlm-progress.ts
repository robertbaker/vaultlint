import { Directive, input } from "@angular/core";
import { BrnProgress } from "@spartan-ng/brain/progress";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "hlm-progress,[hlmProgress]",
  hostDirectives: [{ directive: BrnProgress, inputs: ["value", "max", "getValueLabel"] }],
  host: { "data-slot": "progress", "[attr.data-size]": "size()" },
})
export class HlmProgress {
  public readonly size = input<"xs" | "sm" | "default" | "lg">("xs");

  constructor() {
    classes(() => [
      "bg-muted rounded-full relative inline-flex w-full overflow-hidden",
      {
        xs: "h-1",
        sm: "h-1.5 bg-muted/80 shadow-inner",
        default: "h-2 bg-muted/80 shadow-inner",
        lg: "h-3 bg-muted/80 shadow-inner",
      }[this.size()],
    ]);
  }
}

import { Directive, input } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";

export type CardVariant =
  | "default"
  | "glass"
  | "glassSubtle"
  | "frosted"
  | "fluted"
  | "crystal"
  | "destructive"
  | "success"
  | "warning";

import { HlmCardConfig, injectHlmCardConfig } from "./hlm-card.token";

@Directive({
  selector: "[hlmCard],hlm-card",
  host: {
    "data-slot": "card",
    "[attr.data-size]": "size()",
    "[attr.data-variant]": "variant()",
  },
})
export class HlmCard {
  private readonly _defaultConfig = injectHlmCardConfig();
  public readonly size = input<HlmCardConfig["size"]>(this._defaultConfig.size);
  public readonly variant = input<CardVariant>("default");

  constructor() {
    classes(() => [
      "gap-(--card-spacing) overflow-hidden rounded-xl py-(--card-spacing) text-sm [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col",
      this.variant() === "default" && "ring-foreground/10 bg-card text-card-foreground ring-1",
      this.variant() === "destructive" &&
        "border border-destructive/40 bg-destructive/10 text-card-foreground ring-1 ring-destructive/30",
      this.variant() === "success" &&
        "border border-success/40 bg-success/10 text-card-foreground ring-1 ring-success/30",
      this.variant() === "warning" &&
        "border border-warning/40 bg-warning/10 text-card-foreground ring-1 ring-warning/30",
      this.variant() === "glass" &&
        "glass-bg backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-card-foreground shadow-[var(--glass-shadow)]",
      this.variant() === "glassSubtle" &&
        "glass-bg backdrop-blur-[var(--blur-sm)] border border-[var(--glass-border)] text-card-foreground shadow-[var(--glass-shadow)] opacity-50",
      this.variant() === "frosted" &&
        "glass-frosted backdrop-blur-[var(--blur-frosted)] border border-[var(--glass-frosted-border)] text-card-foreground shadow-[var(--glass-frosted-shadow)]",
      this.variant() === "fluted" &&
        "glass-fluted backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-card-foreground shadow-[var(--glass-shadow)]",
      this.variant() === "crystal" &&
        "glass-crystal backdrop-blur-[var(--blur-crystal)] border border-[var(--glass-crystal-border)] text-card-foreground shadow-[var(--glass-crystal-shadow)]",
    ]);
  }
}

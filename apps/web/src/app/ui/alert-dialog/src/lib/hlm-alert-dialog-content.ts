import { Directive, input, signal } from "@angular/core";
import { injectExposesStateProvider } from "@spartan-ng/brain/core";
import { classes } from "@spartan-ng/helm/utils";

export type AlertDialogVariant = "default" | "glass" | "frosted" | "fluted" | "crystal";

@Directive({
  selector: "[hlmAlertDialogContent],hlm-alert-dialog-content",
  host: {
    "data-slot": "alert-dialog-content",
    "[attr.data-state]": "state()",
    "[attr.data-size]": "size()",
    "[attr.data-variant]": "variant()",
  },
})
export class HlmAlertDialogContent {
  private readonly _stateProvider = injectExposesStateProvider({ optional: true, host: true });
  public readonly state = this._stateProvider?.state ?? signal("closed");

  public readonly size = input<"sm" | "default">("default");
  public readonly variant = input<AlertDialogVariant>("default");

  constructor() {
    classes(() => [
      "data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 gap-4 rounded-xl p-4 duration-100 data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm group/alert-dialog-content grid w-full outline-none",
      this.variant() === "default" &&
        "bg-popover text-popover-foreground ring-foreground/10 ring-1",
      this.variant() === "glass" &&
        "glass-bg backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-foreground shadow-[var(--glass-shadow-lg)]",
      this.variant() === "frosted" &&
        "glass-frosted backdrop-blur-[var(--blur-frosted)] border border-[var(--glass-frosted-border)] text-foreground shadow-[var(--glass-frosted-shadow)]",
      this.variant() === "fluted" &&
        "glass-fluted backdrop-blur-[var(--blur)] border border-[var(--glass-border)] text-foreground shadow-[var(--glass-shadow-lg)]",
      this.variant() === "crystal" &&
        "glass-crystal backdrop-blur-[var(--blur-crystal)] border border-[var(--glass-crystal-border)] text-foreground shadow-[var(--glass-crystal-shadow)]",
    ]);
  }
}

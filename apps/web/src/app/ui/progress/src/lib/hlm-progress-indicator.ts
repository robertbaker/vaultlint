import { Directionality } from "@angular/cdk/bidi";
import { Directive, computed, inject, input } from "@angular/core";
import { BrnProgressIndicator, injectBrnProgress } from "@spartan-ng/brain/progress";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "[hlmProgressIndicator],hlm-progress-indicator",
  hostDirectives: [BrnProgressIndicator],
  host: {
    "data-slot": "progress-indicator",
    "aria-hidden": "true",
    "[attr.data-variant]": "variant()",
    "[class.animate-indeterminate]": "_indeterminate()",
    "[style.transform]": "_transform()",
  },
})
export class HlmProgressIndicator {
  private readonly _progress = injectBrnProgress();
  /** `aqua`: glossy gel gradient with animated stripes, tinted from `--aqua-accent` when set. */
  public readonly variant = input<"default" | "aqua">("default");
  private readonly _dir = inject(Directionality);
  // Offset the indicator by the unfilled remainder. In RTL the bar fills from the inline-start
  // (visually the right), so translate the opposite way to keep the fill on the correct side.
  protected readonly _transform = computed(() => {
    const offset = 100 - (this._progress.value() ?? 100);
    return `translateX(${this._dir.valueSignal() === "rtl" ? "" : "-"}${offset}%)`;
  });
  protected readonly _indeterminate = computed(
    () => this._progress.value() === null || this._progress.value() === undefined,
  );

  constructor() {
    classes(() => [
      "h-full w-full flex-1 transition-all",
      this.variant() === "aqua"
        ? "relative rounded-full bg-[linear-gradient(180deg,var(--aqua-gel-hi,#a5d0fa)_0%,var(--aqua-gel-mid,#4a95ef)_50%,var(--aqua-accent,#2f7de0)_55%,var(--aqua-gel-light,#6fb4f7)_100%)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.7)] duration-300 after:absolute after:inset-0 after:animate-[aqua-progress-stripes_0.8s_linear_infinite] after:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.35)_0px,rgba(255,255,255,0.35)_7px,transparent_7px,transparent_14px)] after:content-[''] motion-reduce:after:animate-none"
        : "bg-primary",
    ]);
  }
}

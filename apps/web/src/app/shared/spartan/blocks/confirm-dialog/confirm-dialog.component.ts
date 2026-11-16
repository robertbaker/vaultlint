import { booleanAttribute, Component, computed, effect, input, output } from "@angular/core";
import { HlmAlertDialogImports } from "@spartan-ng/helm/alert-dialog";
import {
  contrastForegroundFallback,
  cssLength,
  themeColor,
  type ThemeColor,
} from "@ui/components/theme-color";

export interface ConfirmDialogData {
  title: string;
  copy: string;
  /** Falls back to the component's `confirmLabel`. */
  confirmLabel?: string;
  /** Falls back to the component's `cancelLabel`; `null` hides the cancel button (acknowledge-only). */
  cancelLabel?: string | null;
  /**
   * Confirm-button fill for this prompt (e.g. `"destructive"` for a delete). Tone name,
   * `--custom-prop`, or any CSS colour; overrides the component's `confirmColor`.
   */
  confirmColor?: ThemeColor;
}

/**
 * Presentational confirmation dialog. The caller owns show/resolve (a Promise-based `confirm()`
 * helper drives the `data` input and awaits `resolved`); this component only renders `data` and
 * emits `resolved` with the user's choice.
 *
 * Backed by spartan's `HlmAlertDialog` (BrnAlertDialog → BrnDialog) via its controlled `[state]`
 * input, which adds real dialog a11y the old hand-rolled overlay lacked: CDK focus-trap,
 * Escape-to-dismiss, and focus restoration to the trigger. Re-skinned to the app's glass surface.
 *
 * Custom properties: `--r5-dialog-bg` (`--card` at 95%), `--r5-dialog-fg` (`--card-foreground`),
 * `--r5-dialog-border` (`--border`), `--r5-dialog-radius`, `--r5-dialog-muted-fg`, and
 * `--r5-confirm-bg` (`--primary`) for the confirm button, whose text is `contrast-color()` of that
 * fill (pin it with `--r5-confirm-fg`). The dialog renders in an overlay outside the host's DOM
 * subtree, so set these on `:root` (or use the inputs), not on an ancestor of the host.
 *
 * Content: projected children render between the copy and the footer (extra detail, a checkbox).
 * `contentClass`, `titleClass`, `copyClass`, `confirmClass` and `cancelClass` extend the matching
 * element's classes; `maxWidth` sets the panel width. `showCancel="false"` hides cancel for every
 * prompt.
 */
@Component({
  selector: "app-confirm-dialog",
  imports: [HlmAlertDialogImports],
  styles: `
    .confirm-dialog {
      --_dialog-surface: var(--r5-dialog-bg, color-mix(in oklab, var(--card) 95%, transparent));
      --_dialog-ink: var(--r5-dialog-fg, var(--r5-dialog-fg-fallback, var(--card-foreground)));
      --_dialog-muted-ink: color-mix(in oklab, var(--_dialog-ink) 80%, transparent);
      background: var(--_dialog-surface);
      color: var(--_dialog-ink);
      border-color: var(--r5-dialog-border, var(--border));
      border-radius: var(--r5-dialog-radius, var(--radius-xl, 0.75rem));
    }
    .confirm-dialog-copy {
      color: var(--r5-dialog-muted-fg, var(--_dialog-muted-ink));
    }
    @supports (color: contrast-color(red)) {
      .confirm-dialog {
        --_dialog-ink: var(--r5-dialog-fg, contrast-color(var(--_dialog-surface)));
        --_dialog-muted-ink: color-mix(in oklab, var(--_dialog-ink) 80%, transparent);
      }
    }
    .confirm-action {
      --_bg: var(--r5-confirm-bg, var(--primary));
      background: var(--_bg);
      color: var(--r5-confirm-fg, var(--r5-confirm-fg-fallback, var(--primary-foreground)));
    }
    @supports (color: contrast-color(red)) {
      .confirm-action {
        color: var(--r5-confirm-fg, contrast-color(var(--_bg)));
      }
    }
    .confirm-action:hover {
      --_hover-bg: color-mix(in oklab, var(--_bg) 90%, var(--_dialog-surface));
      background: var(--_hover-bg);
    }
    @supports (color: contrast-color(red)) {
      .confirm-action:hover {
        color: var(--r5-confirm-fg, contrast-color(var(--_hover-bg)));
      }
    }
  `,
  template: `
    <hlm-alert-dialog [state]="data() ? 'open' : 'closed'" (closed)="onDialogClosed()">
      <hlm-alert-dialog-content
        *hlmAlertDialogPortal
        class="confirm-dialog w-full max-w-md gap-4 border p-6 shadow-lg ring-0 backdrop-blur-xl"
        [class]="contentClass()"
        [style.max-width]="maxWidthValue()"
        [style.--r5-confirm-bg]="confirmValue()"
        [style.--r5-confirm-fg-fallback]="confirmForegroundFallback()"
        [style.--r5-dialog-bg]="backgroundValue()"
        [style.--r5-dialog-fg-fallback]="dialogForegroundFallback()"
      >
        @if (data(); as d) {
          <hlm-alert-dialog-header class="place-items-start text-start">
            <h2 hlmAlertDialogTitle class="text-xl font-semibold" [class]="titleClass()">
              {{ d.title }}
            </h2>
            <p hlmAlertDialogDescription class="confirm-dialog-copy mt-1" [class]="copyClass()">
              {{ d.copy }}
            </p>
          </hlm-alert-dialog-header>
          <ng-content />
          <hlm-alert-dialog-footer class="mt-2">
            @if (showCancel() && d.cancelLabel !== null) {
              <button
                type="button"
                hlmAlertDialogCancel
                [class]="cancelClass()"
                (click)="choose(false)"
              >
                {{ d.cancelLabel ?? cancelLabel() }}
              </button>
            }
            <button
              type="button"
              hlmAlertDialogAction
              class="confirm-action"
              [class]="confirmClass()"
              (click)="choose(true)"
            >
              {{ d.confirmLabel ?? confirmLabel() }}
            </button>
          </hlm-alert-dialog-footer>
        }
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class ConfirmDialogComponent {
  readonly data = input<ConfirmDialogData | null>(null);
  /** Default confirm-button fill; `data.confirmColor` overrides it per prompt. */
  readonly confirmColor = input<ThemeColor>();
  /** Dialog surface colour. */
  readonly background = input<ThemeColor>();
  /** Default button labels; `data.confirmLabel` / `data.cancelLabel` override them per prompt. */
  readonly confirmLabel = input("Confirm");
  readonly cancelLabel = input("Cancel");
  /** False hides the cancel button for every prompt (acknowledge-only dialogs). */
  readonly showCancel = input(true, { transform: booleanAttribute });
  /** Panel max width: a number is px, a string any CSS length. */
  readonly maxWidth = input<number | string>();
  readonly contentClass = input("");
  readonly titleClass = input("");
  readonly copyClass = input("");
  readonly confirmClass = input("");
  readonly cancelClass = input("");
  readonly resolved = output<boolean>();

  protected readonly backgroundValue = computed(() => themeColor(this.background()));
  protected readonly dialogForegroundFallback = computed(() =>
    contrastForegroundFallback(this.background(), "var(--card-foreground)"),
  );
  protected readonly maxWidthValue = computed(() => cssLength(this.maxWidth()));
  protected readonly confirmValue = computed(() =>
    themeColor(this.data()?.confirmColor ?? this.confirmColor()),
  );
  protected readonly confirmForegroundFallback = computed(() =>
    contrastForegroundFallback(this.data()?.confirmColor ?? this.confirmColor()),
  );

  /** Guards against a double-emit when a button choice also triggers the dialog's `closed`. */
  private settled = false;

  constructor() {
    // Reset the guard each time a new confirmation is shown.
    effect(() => {
      if (this.data()) this.settled = false;
    });
  }

  choose(confirmed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolved.emit(confirmed);
  }

  /** Escape / backdrop dismissal resolves as "cancel" (unless a button already settled it). */
  onDialogClosed(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolved.emit(false);
  }
}

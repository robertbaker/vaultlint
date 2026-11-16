import {
  ChangeDetectionStrategy,
  booleanAttribute,
  Component,
  DestroyRef,
  inject,
  ElementRef,
  computed,
  input,
  model,
  output,
  viewChild,
} from "@angular/core";
import { NgIconComponent } from "@ng-icons/core";
import { matCloseRound, matSearchRound } from "@ng-icons/material-symbols/round";
import { HlmInput, type InputVariant } from "@spartan-ng/helm/input";
import { HlmIconButton } from "@ui/components/icon-button";
import { provideHlmIcons } from "@ui/components/icons";
import {
  contrastForegroundFallback,
  themeColor,
  type ThemeColor,
} from "@ui/components/theme-color";

/**
 * Search field: leading magnifier, native input, and a clear button that swaps for an optional
 * trailing hint (project a `<kbd>` with `slot="hint"`) while the field is empty. Size the box from
 * the outside via `class` on the host (e.g. `class="w-full lg:max-w-xs"`).
 *
 * Custom properties: `--r5-search-bg` (`--card` at 60%, 40% in dark), `--r5-search-focus-bg`
 * (`--background`), `--r5-search-fg` (inherited), `--r5-search-focus-fg` and
 * `--r5-search-focus-placeholder` (contrasting foreground), `--r5-search-border` (`--border` at
 * 80%), `--r5-search-icon` (`--muted-foreground`), `--r5-search-placeholder`
 * (`--muted-foreground`), and `--r5-search-focus-icon` (contrasting foreground). `background`,
 * `focusBackground`, `borderColor` and `iconColor` set them per instance.
 *
 * `icon`, `iconSize`, `clearIcon` and `clearIconSize` swap the glyphs (register non-default icons
 * with `provideIcons` in the host); `showIcon="false"` drops the leading icon. `inputClass` extends
 * the input's classes and `variant` picks the `hlmInput` variant. `(submitted)` fires on Enter;
 * `(search)` emits after `debounce` ms of quiet (immediately on Enter and clear).
 */
@Component({
  selector: "app-search-box",
  imports: [NgIconComponent, HlmInput, HlmIconButton],
  providers: [provideHlmIcons({ matSearchRound, matCloseRound })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "relative flex items-center min-w-0",
    "[style.--r5-search-bg]": "backgroundValue()",
    "[style.--r5-search-border]": "borderValue()",
    "[style.--r5-search-icon]": "iconValue()",
    "[style.--r5-search-fg-fallback]": "foregroundFallbackValue()",
    "[style.--r5-search-focus-bg]": "focusBackgroundValue()",
    "[style.--r5-search-focus-fg-fallback]": "focusForegroundFallbackValue()",
  },
  styles: `
    :host {
      --_bg: var(--r5-search-bg, color-mix(in oklab, var(--card) 60%, transparent));
    }
    :host-context(:is(.dark, [data-theme="dark"])) {
      --_bg: var(--r5-search-bg, color-mix(in oklab, var(--card) 40%, transparent));
    }
    .search-icon,
    .search-clear {
      color: var(--r5-search-icon, var(--r5-search-fg-fallback, var(--muted-foreground)));
    }
    .search-clear:hover {
      color: var(--r5-search-fg, var(--r5-search-fg-fallback, var(--foreground)));
    }
    :host:has(.search-input:focus) .search-clear:hover {
      color: var(--r5-search-focus-fg, var(--r5-search-focus-fg-fallback, var(--foreground)));
    }
    .search-input {
      background: var(--_bg);
      color: var(--r5-search-fg, var(--r5-search-fg-fallback, var(--foreground)));
      border-color: var(--r5-search-border, color-mix(in oklab, var(--border) 80%, transparent));
    }
    .search-input:focus {
      background: var(--r5-search-focus-bg, var(--background));
      color: var(--r5-search-focus-fg, var(--r5-search-focus-fg-fallback, var(--foreground)));
    }
    .search-input::placeholder {
      color: var(--r5-search-placeholder, var(--r5-search-fg-fallback, var(--muted-foreground)));
    }
    .search-input:focus::placeholder {
      color: var(
        --r5-search-focus-placeholder,
        var(--r5-search-placeholder, var(--r5-search-focus-fg-fallback, var(--muted-foreground)))
      );
    }
    :host:has(.search-input:focus) .search-icon,
    :host:has(.search-input:focus) .search-clear {
      color: var(
        --r5-search-focus-icon,
        var(--r5-search-focus-fg-fallback, var(--muted-foreground))
      );
    }
    @supports (color: contrast-color(red)) {
      .search-input {
        color: var(--r5-search-fg, contrast-color(var(--_bg)));
      }
      .search-input:focus {
        color: var(
          --r5-search-focus-fg,
          contrast-color(var(--r5-search-focus-bg, var(--background)))
        );
      }
      .search-input::placeholder {
        color: var(--r5-search-placeholder, contrast-color(var(--_bg)));
      }
      .search-input:focus::placeholder {
        color: var(
          --r5-search-focus-placeholder,
          var(--r5-search-placeholder, contrast-color(var(--r5-search-focus-bg, var(--background))))
        );
      }
      .search-icon,
      .search-clear {
        color: var(--r5-search-icon, contrast-color(var(--_bg)));
      }
      :host:has(.search-input:focus) .search-icon,
      :host:has(.search-input:focus) .search-clear {
        color: var(
          --r5-search-focus-icon,
          var(--r5-search-icon, contrast-color(var(--r5-search-focus-bg, var(--background))))
        );
      }
      .search-clear:hover {
        color: var(
          --r5-search-focus-fg,
          contrast-color(var(--r5-search-focus-bg, var(--background)))
        );
      }
    }
  `,
  template: `
    @if (showIcon()) {
      <ng-icon
        [name]="icon()"
        [size]="iconSize() || (compact() ? '13' : '15')"
        class="search-icon pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2"
        aria-hidden="true"
      />
    }
    <input
      #field
      hlmInput
      type="search"
      inputmode="search"
      autocomplete="off"
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
      class="search-input w-full pe-14 text-xs shadow-2xs transition-all duration-150 [&::-webkit-search-cancel-button]:hidden"
      [class]="inputClass()"
      [class.ps-8]="showIcon()"
      [class.h-8]="compact()"
      [variant]="variant()"
      [disabled]="disabled()"
      [readOnly]="readonly()"
      [attr.maxlength]="maxlength() ?? null"
      [attr.id]="inputId() || null"
      [attr.name]="name() || null"
      [attr.role]="role() || null"
      [attr.placeholder]="placeholder()"
      [attr.aria-label]="ariaLabel() || placeholder() || 'Search'"
      [attr.aria-describedby]="ariaDescribedby() || null"
      [attr.aria-controls]="ariaControls() || null"
      [attr.aria-expanded]="ariaExpanded()"
      [attr.aria-activedescendant]="ariaActivedescendant() || null"
      [value]="value()"
      (input)="onInput(field.value, $event)"
      (focus)="inputFocus.emit($event)"
      (blur)="inputBlur.emit($event)"
      (keydown)="onKeydown($event)"
    />
    <div class="absolute end-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1">
      @if (hasValue() && clearable() && !disabled() && !readonly()) {
        <button
          type="button"
          hlmIconButton
          variant="ghost"
          size="2xs"
          class="search-clear size-5 rounded transition-colors"
          [attr.aria-label]="clearLabel()"
          (click)="clear()"
        >
          <ng-icon [name]="clearIcon()" [size]="clearIconSize()" aria-hidden="true" />
        </button>
      } @else {
        <span class="pointer-events-none"><ng-content select="[slot=hint]" /></span>
      }
    </div>
  `,
})
export class SearchBoxComponent {
  readonly value = model("");
  readonly placeholder = input("Search…");
  readonly ariaLabel = input("");
  readonly ariaDescribedby = input("");
  readonly clearLabel = input("Clear search");
  readonly inputId = input("");
  readonly name = input("");
  /** Set to `combobox` when the box drives a results listbox. */
  readonly role = input("");
  readonly ariaControls = input("");
  readonly ariaExpanded = input<boolean | null>(null);
  readonly ariaActivedescendant = input<string | null>(null);
  /** Shorter field (h-8) for dense toolbars. */
  readonly compact = input(false, { transform: booleanAttribute });
  /** Show the clear button while the field has a value. */
  readonly clearable = input(true, { transform: booleanAttribute });
  /** Leading icon name; register any non-default icon with `provideIcons` in the host. */
  readonly icon = input("matSearchRound");
  /** Leading icon size in px; defaults to 13 (compact) / 15. */
  readonly iconSize = input("");
  readonly showIcon = input(true, { transform: booleanAttribute });
  readonly clearIcon = input("matCloseRound");
  readonly clearIconSize = input("12");
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly readonly = input(false, { transform: booleanAttribute });
  readonly maxlength = input<number>();
  readonly variant = input<InputVariant>("default");
  /** Extra classes for the native input. */
  readonly inputClass = input("");
  /** Tone name, `--custom-prop`, or any CSS colour. */
  readonly background = input<ThemeColor>();
  /** Focused field surface; defaults to the page background. */
  readonly focusBackground = input<ThemeColor>();
  readonly borderColor = input<ThemeColor>();
  readonly iconColor = input<ThemeColor>();

  protected readonly backgroundValue = computed(() => themeColor(this.background()));
  protected readonly borderValue = computed(() => themeColor(this.borderColor()));
  protected readonly iconValue = computed(() => themeColor(this.iconColor()));
  protected readonly foregroundFallbackValue = computed(() =>
    contrastForegroundFallback(this.background(), "var(--foreground)"),
  );
  protected readonly focusBackgroundValue = computed(() => themeColor(this.focusBackground()));
  protected readonly focusForegroundFallbackValue = computed(() =>
    contrastForegroundFallback(this.focusBackground(), "var(--foreground)"),
  );

  readonly inputFocus = output<FocusEvent>();
  readonly inputBlur = output<FocusEvent>();
  readonly inputKeydown = output<KeyboardEvent>();
  readonly cleared = output<void>();
  /** Enter pressed; emits the current value. */
  readonly submitted = output<string>();
  /** Emits the value `debounce` ms after typing stops (immediately on Enter and clear). */
  readonly search = output<string>();
  /** Delay for `(search)` in ms; 0 emits on every keystroke. */
  readonly debounce = input(0);

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.debounceTimer));
  }

  protected onInput(next: string, event: Event): void {
    this.value.set(next);
    clearTimeout(this.debounceTimer);
    if (event instanceof InputEvent && event.isComposing) return;
    const delay = this.debounce();
    if (delay > 0) this.debounceTimer = setTimeout(() => this.search.emit(next), delay);
    else this.search.emit(next);
  }

  private flushSearch(): void {
    clearTimeout(this.debounceTimer);
    this.search.emit(this.value());
  }

  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");

  protected readonly hasValue = computed(() => this.value().length > 0);

  protected onKeydown(event: KeyboardEvent): void {
    this.inputKeydown.emit(event);
    if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
      this.flushSearch();
      this.submitted.emit(this.value());
    }
  }

  focus(): void {
    this.field().nativeElement.focus();
  }

  select(): void {
    this.field().nativeElement.select();
  }

  blur(): void {
    this.field().nativeElement.blur();
  }

  clear(): void {
    this.value.set("");
    this.flushSearch();
    this.cleared.emit();
    this.focus();
  }
}

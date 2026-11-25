import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmButtonGroupImports } from "@spartan-ng/helm/button-group";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import { BRAND_LINKS } from "@vaultlint/brand";
import type { VaultFormatId } from "@vaultlint/vault-formats";
import { VAULT_FORMATS } from "@vaultlint/vault-formats/metadata";

import type { ThemeMode } from "../../core/vault.models";

@Component({
  selector: "app-vault-header",
  imports: [
    NgIcon,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmButtonGroupImports,
    ...HlmNativeSelectImports,
  ],
  template: `
    <header
      #headerEl
      class="app-header"
      [class.app-header-hidden]="navigationHidden()"
      [attr.inert]="navigationHidden() ? '' : null"
    >
      @if (!hasVault()) {
        <div class="glass-nav landing-nav">
          <a class="landing-brand" href="#main-content" aria-label="vaultlint home">
            <img class="landing-brand-mark" src="favicon.svg" alt="" />
            <span>vault<span class="landing-brand-accent">lint</span></span>
          </a>
          <nav aria-label="Main navigation" class="landing-nav-links hidden md:flex">
            <a href="#feature-highlights">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#privacy-note">Privacy</a>
            <a [href]="docsUrl" target="_blank" rel="noopener">Docs</a>
          </nav>
          <div class="landing-nav-end">
            <span class="landing-version hidden lg:inline">v{{ version() }}</span>
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              (click)="startTour.emit()"
            >
              <span class="sr-only sm:not-sr-only">Quick tour</span>
              <span class="sm:hidden" aria-hidden="true">Tour</span>
            </button>
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="sm"
              class="max-md:hidden"
              data-open-changelog
              (click)="openChangelog.emit()"
            >
              What’s new<span class="sr-only"> in v{{ version() }}</span>
            </button>
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="sm"
              class="theme-toggle-btn"
              [attr.aria-label]="themeToggleLabel()"
              [attr.title]="themeToggleLabel()"
              (click)="onToggleTheme()"
            >
              <ng-icon
                name="matLightModeRound"
                class="theme-icon-light size-4"
                aria-hidden="true"
              />
              <ng-icon name="matDarkModeRound" class="theme-icon-dark size-4" aria-hidden="true" />
              <span class="sr-only">{{ themeToggleLabel() }}</span>
            </button>
            <a hlmBtn size="sm" href="#upload-vault">
              <span class="sr-only sm:not-sr-only">Import vault</span>
              <span class="sm:hidden" aria-hidden="true">Import</span>
            </a>
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="icon-sm"
              class="md:hidden"
              popovertarget="landing-mobile-menu"
              aria-label="Open menu"
            >
              <ng-icon name="matMenuRound" class="size-4" aria-hidden="true" />
            </button>
            <div
              #landingMenu
              id="landing-mobile-menu"
              popover="auto"
              class="anchored-popover w-60 space-y-2 md:hidden"
            >
              <nav aria-label="Landing menu links" class="grid gap-1">
                <a
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  href="#feature-highlights"
                  (click)="closeLandingMenu()"
                >
                  Features
                </a>
                <a
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  href="#how-it-works"
                  (click)="closeLandingMenu()"
                >
                  How it works
                </a>
                <a
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  href="#privacy-note"
                  (click)="closeLandingMenu()"
                >
                  Privacy
                </a>
                <a
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  class="justify-start"
                  [href]="docsUrl"
                  target="_blank"
                  rel="noopener"
                  (click)="closeLandingMenu()"
                >
                  Documentation
                </a>
              </nav>
              <div class="border-border border-t pt-2">
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="sm"
                  class="w-full justify-start"
                  (click)="onMobileChangelogClick()"
                >
                  <ng-icon name="matCampaignRound" class="size-4" aria-hidden="true" />
                  What’s new
                </button>
              </div>
              <p class="text-muted-foreground text-right text-xs">vaultlint v{{ version() }}</p>
            </div>
          </div>
        </div>
      } @else {
        <div class="glass-nav glass-nav-app">
          <div class="flex min-w-0 items-center gap-2">
            <img class="landing-brand-mark size-7 shrink-0" src="favicon.svg" alt="" />
            <div class="flex min-w-0 items-center gap-2">
              <h1 class="text-base leading-tight font-extrabold tracking-[-0.04em] sm:text-lg">
                vault<span class="landing-brand-accent">lint</span>
              </h1>
              @if (sourceFormatName()) {
                <span hlmBadge variant="secondary" class="hidden text-[11px] sm:inline-flex">
                  {{ sourceFormatName() }}
                </span>
              }
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <hlm-button-group>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="!canUndo()"
                (click)="undo.emit()"
                aria-keyshortcuts="Control+Z"
                title="Undo (Ctrl+Z)"
              >
                <ng-icon name="matUndoRound" class="size-4" aria-hidden="true" />
                <span class="sr-only sm:not-sr-only">Undo</span>
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="!canRedo()"
                (click)="redo.emit()"
                aria-keyshortcuts="Control+Y"
                title="Redo (Ctrl+Y)"
              >
                <ng-icon name="matRedoRound" class="size-4" aria-hidden="true" />
                <span class="sr-only sm:not-sr-only">Redo</span>
              </button>
            </hlm-button-group>

            <hlm-native-select
              size="sm"
              class="hidden max-w-48 min-w-0 md:inline-block"
              selectClass="bg-background/70 text-xs"
              [value]="exportFormat()"
              (valueChange)="onExportFormatSelected($event)"
              aria-label="Export format"
            >
              @for (fmt of formats; track fmt.id) {
                <option hlmNativeSelectOption [value]="fmt.id">{{ fmt.name }}</option>
              }
            </hlm-native-select>

            <button
              #exportVaultButton
              hlmBtn
              variant="default"
              size="sm"
              data-export-vault
              (click)="exportVault.emit()"
            >
              <ng-icon name="matDownloadRound" class="size-4" aria-hidden="true" />
              <span class="sr-only sm:not-sr-only">Export vault</span>
              <span class="text-[11px] font-semibold opacity-90 md:hidden" aria-hidden="true">
                {{ exportFormatShortLabel() }}
              </span>
            </button>

            @if (pushLabel()) {
              <button
                hlmBtn
                variant="outline"
                size="sm"
                class="max-sm:hidden"
                [disabled]="vendorBusy()"
                (click)="pushToVendor.emit()"
              >
                {{ vendorBusy() ? "Pushing..." : pushLabel() }}
              </button>
            }

            <button
              hlmBtn
              type="button"
              variant="outline"
              size="sm"
              class="relative"
              popovertarget="workspace-more-popover"
            >
              <ng-icon name="matMoreHorizRound" class="size-4" aria-hidden="true" />
              <span class="sr-only sm:not-sr-only">More</span>
              @if (hasNewChangelog()) {
                <span
                  class="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full"
                  aria-hidden="true"
                ></span>
              }
            </button>

            <div
              #morePopover
              id="workspace-more-popover"
              popover="auto"
              class="anchored-popover w-72"
            >
              <div class="grid gap-2.5">
                @if (pushLabel()) {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    class="w-full justify-start sm:hidden"
                    [disabled]="vendorBusy()"
                    (click)="onPushToVendorClick()"
                  >
                    {{ vendorBusy() ? "Pushing..." : pushLabel() }}
                  </button>
                }

                <label class="grid gap-1 text-xs font-medium md:hidden">
                  Export format
                  <select
                    class="border-input bg-input-fill text-foreground focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-3"
                    [value]="exportFormat()"
                    (change)="onExportFormatChange($event)"
                    aria-label="Target export format"
                  >
                    @for (fmt of formats; track fmt.id) {
                      <option [value]="fmt.id">{{ fmt.name }}</option>
                    }
                  </select>
                </label>

                <label class="grid gap-1 text-xs font-medium">
                  Color theme
                  <select
                    class="border-input bg-input-fill text-foreground focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-3"
                    [value]="theme()"
                    (change)="onThemeChange($event)"
                    aria-label="Color theme"
                  >
                    <option value="auto">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>

                <div class="border-border grid gap-1 border-t pt-2">
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="justify-start"
                    (click)="onCompareFormatsClick()"
                  >
                    <ng-icon name="matCompareArrowsRound" class="size-4" aria-hidden="true" />
                    Compare export formats
                  </button>
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="justify-start"
                    (click)="onExportReportClick()"
                  >
                    <ng-icon name="matDownloadRound" class="size-4" aria-hidden="true" />
                    Export audit report
                  </button>
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="justify-start"
                    aria-haspopup="dialog"
                    (click)="onStartTourClick()"
                  >
                    <ng-icon name="matHelpRound" class="size-4" aria-hidden="true" />
                    Quick tour
                  </button>
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="sm"
                    class="justify-between"
                    data-open-changelog
                    (click)="onOpenChangelogClick()"
                  >
                    <span class="inline-flex items-center gap-1.5">
                      <ng-icon name="matCampaignRound" class="size-4" aria-hidden="true" />
                      What’s new<span class="sr-only"> in v{{ version() }}</span>
                    </span>
                    @if (hasNewChangelog()) {
                      <span hlmBadge variant="default" class="px-1.5 py-0 text-[10px]">
                        New<span class="sr-only"> changes available</span>
                      </span>
                    }
                  </button>
                </div>

                <div class="border-border grid grid-cols-2 gap-1.5 border-t pt-2">
                  <a
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    class="justify-start"
                    [href]="docsUrl"
                    target="_blank"
                    rel="noopener"
                    (click)="closeMorePopover()"
                  >
                    Docs
                  </a>
                  <a
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    class="justify-start"
                    [href]="bugReportUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    (click)="closeMorePopover()"
                  >
                    Report bug
                  </a>
                </div>

                <div
                  class="border-border text-muted-foreground space-y-1 border-t pt-2 text-[11px]"
                >
                  <div class="flex items-center justify-between gap-2 font-medium">
                    <span>Source: {{ sourceFormatName() }}</span>
                    <span>v{{ version() }}</span>
                  </div>
                  <p>
                    Vault data stays in browser memory. Network checks run only when you start them.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    </header>
  `,
})
export class VaultHeaderComponent {
  protected readonly docsUrl = BRAND_LINKS.docs;
  protected readonly bugReportUrl = `${BRAND_LINKS.repository}/issues/new`;
  private readonly destroyRef = inject(DestroyRef);
  private readonly headerEl = viewChild<ElementRef<HTMLElement>>("headerEl");
  private readonly morePopover = viewChild<ElementRef<HTMLElement>>("morePopover");
  private readonly landingMenu = viewChild<ElementRef<HTMLElement>>("landingMenu");
  private readonly exportVaultButton =
    viewChild<ElementRef<HTMLButtonElement>>("exportVaultButton");
  protected readonly navigationHidden = signal(false);

  constructor() {
    afterNextRender(() => {
      let previousY = window.scrollY;
      let frame = 0;
      const handleScroll = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const currentY = window.scrollY;
          const delta = currentY - previousY;
          const header = document.querySelector(".app-header");
          const popoverOpen =
            this.isPopoverOpen(this.morePopover()?.nativeElement) ||
            this.isPopoverOpen(this.landingMenu()?.nativeElement);

          if (currentY <= 80 || delta < -5 || popoverOpen) {
            this.navigationHidden.set(false);
          } else if (delta > 5 && !header?.contains(document.activeElement)) {
            this.navigationHidden.set(true);
          }

          previousY = currentY;
        });
      };

      window.addEventListener("scroll", handleScroll, { passive: true });
      this.destroyRef.onDestroy(() => {
        window.removeEventListener("scroll", handleScroll);
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }

  readonly canUndo = input.required<boolean>();
  readonly canRedo = input.required<boolean>();
  readonly hasVault = input.required<boolean>();
  readonly theme = input.required<ThemeMode>();
  readonly version = input<string>("1.0.0");
  readonly hasNewChangelog = input<boolean>(false);
  readonly sourceFormatName = input<string>("");
  readonly exportFormat = input<VaultFormatId>("bitwarden-json");
  readonly pushLabel = input<string>("");
  readonly vendorBusy = input<boolean>(false);

  protected readonly formats = VAULT_FORMATS;
  protected readonly exportFormatShortLabel = computed(() => {
    const fmt = this.formats.find((f) => f.id === this.exportFormat());
    if (!fmt) return this.exportFormat().toUpperCase();
    const ext = fmt.extensions[0];
    return ext ? ext.replace(/^\./, "").toUpperCase() : fmt.name;
  });

  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly exportVault = output<void>();
  readonly exportFormatChange = output<VaultFormatId>();
  readonly exportReport = output<void>();
  readonly compareFormats = output<void>();
  readonly themeChange = output<ThemeMode>();
  readonly openChangelog = output<void>();
  readonly startTour = output<void>();
  readonly pushToVendor = output<void>();

  protected readonly themeToggleLabel = computed(() => {
    const mode = this.theme();
    const isDark =
      mode === "dark" ||
      (mode === "auto" &&
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    return isDark ? "Switch to light theme" : "Switch to dark theme";
  });

  private isPopoverOpen(element: HTMLElement | undefined): boolean {
    if (!element) return false;
    try {
      return element.matches(":popover-open");
    } catch {
      return false;
    }
  }

  protected closeLandingMenu(): void {
    const menu = this.landingMenu()?.nativeElement as
      | (HTMLElement & { hidePopover?: () => void })
      | undefined;
    if (menu && typeof menu.hidePopover === "function" && this.isPopoverOpen(menu)) {
      menu.hidePopover();
    }
  }

  protected closeMorePopover(): void {
    const menu = this.morePopover()?.nativeElement as
      | (HTMLElement & { hidePopover?: () => void })
      | undefined;
    if (menu && typeof menu.hidePopover === "function" && this.isPopoverOpen(menu)) {
      menu.hidePopover();
    }
  }

  protected onMobileChangelogClick(): void {
    this.closeLandingMenu();
    this.openChangelog.emit();
  }

  protected onToggleTheme(): void {
    const systemDark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = this.theme();
    const currentlyDark = current === "dark" || (current === "auto" && systemDark);
    const target: "light" | "dark" = currentlyDark ? "light" : "dark";
    const systemScheme: "light" | "dark" = systemDark ? "dark" : "light";
    this.themeChange.emit(target === systemScheme ? "auto" : target);
  }

  protected onThemeSelected(value: string | null | undefined): void {
    const mode: ThemeMode = value === "light" || value === "dark" ? value : "auto";
    this.themeChange.emit(mode);
  }

  protected onThemeChange(event: Event): void {
    this.onThemeSelected((event.currentTarget as HTMLSelectElement).value);
  }

  protected onExportFormatSelected(value: string | null | undefined): void {
    if (value) {
      this.exportFormatChange.emit(value as VaultFormatId);
    }
  }

  protected onExportFormatChange(event: Event): void {
    this.onExportFormatSelected((event.currentTarget as HTMLSelectElement).value);
  }

  protected onExportReportClick(): void {
    this.closeMorePopover();
    this.exportReport.emit();
  }

  protected onCompareFormatsClick(): void {
    this.closeMorePopover();
    this.compareFormats.emit();
  }

  protected onStartTourClick(): void {
    this.closeMorePopover();
    this.startTour.emit();
  }

  protected onOpenChangelogClick(): void {
    this.closeMorePopover();
    this.openChangelog.emit();
  }

  protected onPushToVendorClick(): void {
    this.closeMorePopover();
    this.pushToVendor.emit();
  }

  focusExport(): void {
    this.navigationHidden.set(false);
    const header = this.headerEl()?.nativeElement;
    header?.classList.remove("app-header-hidden");
    header?.removeAttribute("inert");

    const tryFocus = (attemptsLeft: number) => {
      const target = this.exportVaultButton()?.nativeElement;
      if (!target || typeof document === "undefined") return;
      target.focus();
      if (document.activeElement !== target && attemptsLeft > 0) {
        requestAnimationFrame(() => tryFocus(attemptsLeft - 1));
      }
    };
    requestAnimationFrame(() => tryFocus(15));
  }
}

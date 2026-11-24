import {
  Component,
  computed,
  effect,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { HlmButtonImports } from "@spartan-ng/helm/button";

import type { VaultTabId } from "../../core/vault.models";

export type GuidedTourAction = "upload" | "export" | VaultTabId;

@Component({
  selector: "app-guided-tour",
  host: { "(window:resize)": "reposition()", "(window:scroll)": "reposition()" },
  imports: [...HlmButtonImports],
  template: `
    <dialog
      #tourDialog
      [class]="'guided-tour-dialog is-' + placement()"
      (cancel)="onCancel()"
      aria-labelledby="guided-tour-title"
      (keydown)="onKeydown($event)"
      (pointerdown)="onBackdropPointerDown($event)"
      (pointerup)="onBackdropPointerUp($event)"
    >
      <div
        class="guided-tour-spotlight"
        [class.is-hidden]="!spot()"
        [style.top.px]="spot()?.top"
        [style.left.px]="spot()?.left"
        [style.width.px]="spot()?.width"
        [style.height.px]="spot()?.height"
        aria-hidden="true"
      ></div>
      <div class="guided-tour-content">
        <div class="guided-tour-topline">
          <p>
            Vaultlint guide <span aria-hidden="true">·</span> Step {{ step() + 1 }} of
            {{ steps.length }} <span class="guided-tour-hint">· use ← → keys</span>
          </p>
          <button type="button" class="guided-tour-close" aria-label="Close tour" (click)="close()">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div class="guided-tour-progress" role="group" aria-label="Tour progress">
          @for (tourStep of steps; track tourStep.title; let index = $index) {
            <button
              type="button"
              class="guided-tour-progress-step"
              [class.is-active]="step() === index"
              [class.is-complete]="step() > index"
              [attr.aria-current]="step() === index ? 'step' : null"
              [attr.aria-label]="'Step ' + (index + 1) + ': ' + tourStep.title"
              (click)="step.set(index)"
            >
              <span aria-hidden="true">{{ index + 1 }}</span>
              <span class="guided-tour-progress-label">{{ tourStep.shortTitle }}</span>
            </button>
          }
        </div>

        <section class="guided-tour-copy" aria-live="polite" aria-atomic="true">
          <p class="guided-tour-step-label">
            Step {{ step() + 1 }} · {{ currentStep().shortTitle }}
          </p>
          <h2 id="guided-tour-title">{{ currentStep().title }}</h2>
          <p>{{ currentStep().description }}</p>
          <ul class="guided-tour-highlights" aria-label="What you can do in this step">
            @for (item of currentStep().highlights; track item) {
              <li>{{ item }}</li>
            }
          </ul>
          <p class="guided-tour-tip">
            <span aria-hidden="true">✓</span>
            {{ currentStep().tip }}
          </p>
        </section>

        <footer class="guided-tour-footer">
          <div class="guided-tour-nav">
            <button
              hlmBtn
              type="button"
              variant="ghost"
              [disabled]="step() === 0"
              (click)="previous()"
            >
              Back
            </button>
            @if (hasVault() && step() < steps.length - 1) {
              <button hlmBtn type="button" variant="outline" (click)="next()">Next</button>
            }
          </div>
          <button
            hlmBtn
            type="button"
            variant="default"
            class="guided-tour-primary"
            (click)="advance()"
          >
            {{ primaryLabel() }}
          </button>
        </footer>
      </div>
    </dialog>
  `,
})
export class GuidedTourComponent {
  readonly hasVault = input(false);
  readonly action = output<GuidedTourAction>();

  protected readonly step = signal(0);
  protected readonly currentStep = computed(() => this.steps[this.step()]);
  protected readonly primaryLabel = computed(() => {
    if (this.step() === 3) return this.hasVault() ? "Show export options" : "Finish tour";
    if (this.step() === 0) return this.hasVault() ? "Open items" : "Choose a vault";
    if (this.hasVault()) return this.step() === 1 ? "Open vault checks" : "Open security & links";
    return "Next step";
  });

  protected readonly steps = [
    {
      shortTitle: "Import",
      target: "#upload-vault",
      title: "Bring in a vault export",
      description:
        "Choose an unencrypted export or import from a supported local CLI. Encrypted exports are rejected before they can be changed.",
      highlights: [
        "Auto-detects Bitwarden, LastPass, 1Password, KeePass, Proton Pass, Dashlane and more",
        "Drop a file or paste an export",
        "Encrypted exports are refused to prevent corruption",
      ],
      tip: "Your vault is processed in this browser.",
    },
    {
      shortTitle: "Review",
      target: "#workspace-section-review",
      title: "See what needs attention",
      description:
        "Vault checks, Duplicates, and Security & links surface formatting issues, duplicate entries, and weak or reused passwords.",
      highlights: [
        "Vault checks flag formatting and URL issues",
        "Duplicates groups entries you can merge",
        "Security & links finds weak and reused passwords",
      ],
      tip: "Network checks and cloud AI stay opt-in.",
    },
    {
      shortTitle: "Improve",
      target: "#workspace-section-organize",
      title: "Make changes with control",
      description:
        "Edit individual entries, merge duplicates, run batch updates, or strengthen passwords. Every edit can be undone.",
      highlights: [
        "Edit entries one at a time or in batches",
        "Merge duplicates with conflict review",
        "Undo any change from the activity log",
      ],
      tip: "Review each suggested fix before you apply it.",
    },
    {
      shortTitle: "Export",
      target: "[data-export-vault]",
      title: "Save a clean copy",
      description:
        "Choose the format you need and export a new file. Your original export is never modified.",
      highlights: [
        "Export to any supported manager format",
        "Passwords stay masked in reports",
        "Your original file is never touched",
      ],
      tip: "Turn on the optional encrypted local recovery copy to restore edits after a refresh.",
    },
  ] as const;

  protected readonly spot = signal<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  protected readonly placement = signal<"center" | "top" | "bottom">("center");
  private readonly isOpen = signal(false);

  constructor() {
    effect(() => {
      this.step();
      if (!this.isOpen()) return;
      // Wait for the dialog content to render before measuring.
      requestAnimationFrame(() => this.focusTarget());
    });
  }

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("tourDialog");
  private pressedOutside = false;

  open(): void {
    this.pressedOutside = false;
    this.step.set(0);
    this.dialog().nativeElement.showModal();
    this.isOpen.set(true);
  }

  protected onCancel(): void {
    this.isOpen.set(false);
    this.spot.set(null);
  }

  protected close(): void {
    this.pressedOutside = false;
    this.onCancel();
    this.dialog().nativeElement.close();
  }

  protected reposition(): void {
    if (!this.isOpen()) return;
    this.measure();
  }

  private findTarget(): HTMLElement | null {
    const selector = this.currentStep().target;
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
    return null;
  }

  private focusTarget(): void {
    const el = this.findTarget();
    if (!el) {
      this.measure();
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    this.measure();
    // Smooth scrolling is asynchronous; re-measure once it settles.
    setTimeout(() => this.measure(), 450);
  }

  private measure(): void {
    if (!this.isOpen()) return;
    const el = this.findTarget();
    if (!el) {
      this.spot.set(null);
      this.placement.set("center");
      return;
    }
    const pad = 6;
    const rect = el.getBoundingClientRect();
    this.spot.set({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });
    // Put the card on whichever side of the target has more room.
    this.placement.set(rect.top + rect.height / 2 < innerHeight / 2 ? "bottom" : "top");
  }

  protected onBackdropPointerDown(event: PointerEvent): void {
    this.pressedOutside = this.isOutsideDialog(event);
  }

  protected onBackdropPointerUp(event: PointerEvent): void {
    const wasOutside = this.pressedOutside;
    this.pressedOutside = false;
    if (!wasOutside) return;
    if (this.isOutsideDialog(event)) {
      this.close();
    }
  }

  private isOutsideDialog(event: PointerEvent): boolean {
    // The dialog fills the viewport, so a hit on the dialog itself is a hit outside the card.
    return event.target === this.dialog().nativeElement;
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.previous();
    }
  }

  protected next(): void {
    this.step.update((value) => Math.min(this.steps.length - 1, value + 1));
  }

  protected previous(): void {
    this.step.update((value) => Math.max(0, value - 1));
  }

  protected advance(): void {
    const current = this.step();
    if (current === 3) {
      this.close();
      if (this.hasVault()) this.action.emit("export");
      return;
    }

    if (current === 0) {
      if (!this.hasVault()) {
        this.close();
        this.action.emit("upload");
        return;
      }
      this.close();
      this.action.emit("explorer");
      return;
    }

    if (this.hasVault()) {
      this.close();
      this.action.emit(current === 1 ? "lint" : "security");
      return;
    }

    this.next();
  }
}

import { Component, computed, ElementRef, input, output, signal, viewChild } from "@angular/core";
import { HlmButtonImports } from "@spartan-ng/helm/button";

import type { VaultTabId } from "../../core/vault.models";

export type GuidedTourAction = "upload" | "export" | VaultTabId;

@Component({
  selector: "app-guided-tour",
  imports: [...HlmButtonImports],
  template: `
    <dialog
      #tourDialog
      class="guided-tour-dialog"
      closedby="any"
      aria-labelledby="guided-tour-title"
      (keydown)="onKeydown($event)"
      (pointerdown)="onBackdropPointerDown($event)"
      (pointerup)="onBackdropPointerUp($event)"
    >
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

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("tourDialog");
  private readonly supportsClosedBy =
    typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;
  private pressedOutside = false;

  open(): void {
    this.pressedOutside = false;
    this.step.set(0);
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.pressedOutside = false;
    this.dialog().nativeElement.close();
  }

  protected onBackdropPointerDown(event: PointerEvent): void {
    if (this.supportsClosedBy) {
      this.pressedOutside = false;
      return;
    }
    this.pressedOutside = this.isOutsideDialog(event);
  }

  protected onBackdropPointerUp(event: PointerEvent): void {
    const wasOutside = this.pressedOutside;
    this.pressedOutside = false;
    if (this.supportsClosedBy || !wasOutside) return;
    if (this.isOutsideDialog(event)) {
      this.close();
    }
  }

  private isOutsideDialog(event: PointerEvent): boolean {
    const dialog = this.dialog().nativeElement;
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
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

import { Component, type ElementRef, input, output, viewChild } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmButtonImports } from "@spartan-ng/helm/button";

import type { ToastItem } from "../../core/vault.models";

@Component({
  selector: "app-toast-region",
  imports: [NgIcon, ...HlmButtonImports],
  template: `
    <div
      #toastContainer
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      class="pointer-events-none fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] left-3 z-50 flex flex-col items-end gap-2 md:top-18 md:right-4 md:bottom-auto md:left-auto"
      (pointerenter)="setPointerInside(true)"
      (pointerleave)="setPointerInside(false)"
      (focusin)="setFocusInside(true)"
      (focusout)="onFocusOut($event)"
    >
      @for (t of toasts(); track t.id) {
        <div
          class="toast-entry border-border bg-card pointer-events-auto flex max-w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg sm:max-w-md"
        >
          <span class="min-w-0 break-words">{{ t.message }}</span>
          <button
            hlmBtn
            variant="ghost"
            size="icon-xs"
            class="touch-target"
            (click)="dismiss.emit(t.id)"
            aria-label="Close notification"
          >
            <ng-icon name="matCloseRound" class="size-3.5" aria-hidden="true" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastRegionComponent {
  readonly toasts = input.required<ToastItem[]>();
  readonly dismiss = output<number>();
  readonly pausedChange = output<boolean>();

  private readonly toastContainer = viewChild<ElementRef<HTMLElement>>("toastContainer");
  private pointerInside = false;
  private focusInside = false;

  protected setPointerInside(inside: boolean): void {
    const wasPaused = this.pointerInside || this.focusInside;
    this.pointerInside = inside;
    const isPaused = this.pointerInside || this.focusInside;
    if (wasPaused !== isPaused) this.pausedChange.emit(isPaused);
  }

  protected setFocusInside(inside: boolean): void {
    const wasPaused = this.pointerInside || this.focusInside;
    this.focusInside = inside;
    const isPaused = this.pointerInside || this.focusInside;
    if (wasPaused !== isPaused) this.pausedChange.emit(isPaused);
  }

  protected onFocusOut(event: FocusEvent): void {
    const container = this.toastContainer()?.nativeElement;
    const nextTarget = event.relatedTarget as Node | null;
    if (container && nextTarget && container.contains(nextTarget)) return;
    this.setFocusInside(false);
  }
}

import {
  booleanAttribute,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";

/**
 * Shared native `<dialog>` wrapper. Centralizes the `showModal()`/`close()` calls,
 * backdrop-click-to-dismiss, and the native `close` event that were previously copy-pasted into
 * every modal (item details, rule editor, …). Hosts project their card markup as content and drive
 * it imperatively via `open()` / `close()`:
 *
 * ```html
 * <app-modal-dialog #modal dialogClass="avh-dialog" (closed)="onClosed()">
 *   <div class="my-card">…</div>
 * </app-modal-dialog>
 * ```
 *
 * ```ts
 * readonly modal = viewChild.required(ModalDialogComponent);
 * this.modal().open();
 * ```
 *
 * `closeOnEscape="false"` makes the dialog dismissable only through `close()` (and the backdrop, if
 * enabled). `(opened)` fires after `open()`; `isOpen` reflects the current state.
 */
@Component({
  selector: "app-modal-dialog",
  template: `
    <dialog
      #dialog
      [attr.closedby]="closedBy()"
      [class]="dialogClass()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="ariaLabelledBy()"
      [attr.aria-describedby]="ariaDescribedBy()"
      (pointerdown)="onBackdropPointerDown($event)"
      (pointerup)="onBackdropPointerUp($event)"
      (cancel)="onCancel($event)"
      (close)="onClose()"
    >
      <ng-content />
    </dialog>
  `,
})
export class ModalDialogComponent {
  /** Class(es) applied to the native `<dialog>` element (styling is host-owned). */
  readonly dialogClass = input<string>("");
  readonly ariaLabel = input<string>();
  readonly ariaLabelledBy = input<string>();
  readonly ariaDescribedBy = input<string>();
  /** Dismiss on a backdrop click. */
  readonly closeOnBackdrop = input(true, { transform: booleanAttribute });
  /** Dismiss on Escape (and other platform close requests). */
  readonly closeOnEscape = input(true, { transform: booleanAttribute });
  /** Emitted whenever the dialog closes (backdrop click, Esc, or `close()`). */
  readonly closed = output<void>();
  /** Emitted after `open()` shows the dialog. */
  readonly opened = output<void>();

  private readonly _isOpen = signal(false);
  /** Whether the dialog is currently shown. */
  readonly isOpen = this._isOpen.asReadonly();

  protected readonly closedBy = computed(() => {
    if (this.closeOnBackdrop()) return this.closeOnEscape() ? "any" : null;
    return this.closeOnEscape() ? "closerequest" : "none";
  });

  private readonly supportsClosedBy =
    typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;
  private pressedOutside = false;

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");

  open(): void {
    const dialog = this.dialogRef().nativeElement;
    if (dialog.open) return;
    this.pressedOutside = false;
    dialog.showModal();
    this._isOpen.set(true);
    this.opened.emit();
  }

  protected onClose(): void {
    this.pressedOutside = false;
    this._isOpen.set(false);
    this.closed.emit();
  }

  /** Blocks Escape where `closedby` is unsupported. */
  protected onCancel(event: Event): void {
    if (!this.closeOnEscape()) event.preventDefault();
  }

  close(): void {
    this.dialogRef().nativeElement.close();
  }

  protected onBackdropPointerDown(event: PointerEvent): void {
    if (this.supportsClosedBy || !this.closeOnBackdrop()) {
      this.pressedOutside = false;
      return;
    }
    this.pressedOutside = this.isOutsideDialog(event);
  }

  protected onBackdropPointerUp(event: PointerEvent): void {
    const wasOutside = this.pressedOutside;
    this.pressedOutside = false;
    if (this.supportsClosedBy || !this.closeOnBackdrop() || !wasOutside) return;
    if (this.isOutsideDialog(event)) {
      this.close();
    }
  }

  private isOutsideDialog(event: PointerEvent): boolean {
    const dialog = this.dialogRef().nativeElement;
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
}

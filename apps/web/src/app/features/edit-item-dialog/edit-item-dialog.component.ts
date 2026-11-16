import {
  Component,
  computed,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmInputImports } from "@spartan-ng/helm/input";
import { HlmLabelImports } from "@spartan-ng/helm/label";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import { HlmTextareaImports } from "@spartan-ng/helm/textarea";
import { ModalDialogComponent } from "@ui/blocks/modal-dialog";
import type { VaultFolder, VaultItem } from "@vaultlint/vault-schema";

import type { ExplorerRow } from "../../core/vault.models";

export interface EditItemResult {
  index: number;
  /** The item as it was when the dialog opened (null when creating), used to re-locate it on save. */
  original: VaultItem | null;
  name: string;
  folderId: string | null;
  username: string;
  password: string;
  urisText: string;
  notes: string;
}

@Component({
  selector: "app-edit-item-dialog",
  imports: [
    ModalDialogComponent,
    NgIcon,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmNativeSelectImports,
    ...HlmTextareaImports,
  ],
  template: `
    <app-modal-dialog
      #modal
      dialogClass="w-[min(32rem,calc(100dvw-1.5rem))] rounded-xl border-0 bg-transparent p-0"
      ariaLabelledBy="edit-modal-title"
    >
      <form
        hlmCard
        size="sm"
        novalidate
        class="flex max-h-[85dvh] w-full flex-col overflow-hidden"
        (submit)="onSave($event)"
      >
        <div
          hlmCardHeader
          class="border-border flex shrink-0 flex-row items-center justify-between gap-2 border-b pb-3"
        >
          <h2 id="edit-modal-title" hlmCardTitle>
            {{ editingIndex() === -1 ? "Add Vault Item" : "Edit Vault Item" }}
          </h2>
          <button
            hlmBtn
            type="button"
            variant="ghost"
            size="icon-sm"
            class="touch-target shrink-0"
            aria-label="Close item dialog"
            (click)="modal.close()"
          >
            <ng-icon name="matCloseRound" class="size-4" aria-hidden="true" />
          </button>
        </div>
        <div hlmCardContent class="scroll-shadow-y flex-1 space-y-3 overflow-y-auto py-3">
          <div class="space-y-1">
            <div class="flex items-center gap-1">
              <label hlmLabel for="edit-name">Name</label>
              <span
                class="text-destructive-readable text-xs leading-none font-medium"
                aria-hidden="true"
                >*</span
              >
            </div>
            <input
              #nameInput
              hlmInput
              id="edit-name"
              autofocus
              aria-required="true"
              enterkeyhint="next"
              class="validated-field"
              [forceInvalid]="showNameError()"
              [aria-describedby]="showNameError() ? 'edit-name-error' : null"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
              (blur)="nameTouched.set(true)"
            />
            @if (showNameError()) {
              <p id="edit-name-error" class="text-destructive-readable text-xs">
                Name is required.
              </p>
            }
          </div>
          <div class="space-y-1">
            <label hlmLabel for="edit-folder">Folder</label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <hlm-native-select
                class="min-w-0 flex-1"
                selectId="edit-folder"
                [value]="folderId() || ''"
                (valueChange)="folderId.set($event || null)"
              >
                <option hlmNativeSelectOption value="">No folder</option>
                @for (f of folders(); track f.id) {
                  <option hlmNativeSelectOption [value]="f.id">{{ f.name }}</option>
                }
              </hlm-native-select>
              <div class="flex gap-2">
                <input
                  hlmInput
                  class="min-w-0 flex-1 sm:w-36 sm:flex-none"
                  placeholder="New folder..."
                  [value]="newFolderName()"
                  (input)="newFolderName.set($any($event.target).value)"
                  (keydown.enter)="onNewFolderEnter($event)"
                  aria-label="New folder name"
                />
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="sm"
                  [disabled]="!newFolderName().trim()"
                  (click)="onCreateFolder()"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
          <div class="space-y-1">
            <label hlmLabel for="edit-username">Username</label>
            <input
              hlmInput
              id="edit-username"
              autocomplete="off"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              enterkeyhint="next"
              [value]="username()"
              (input)="username.set($any($event.target).value)"
            />
          </div>
          <div class="space-y-1">
            <label hlmLabel for="edit-password">Password</label>
            <div class="flex flex-wrap gap-2">
              <input
                hlmInput
                id="edit-password"
                class="min-w-44 flex-1"
                autocomplete="off"
                spellcheck="false"
                [type]="showPassword() ? 'text' : 'password'"
                [value]="password()"
                (input)="password.set($any($event.target).value)"
              />
              <div class="flex shrink-0 gap-2">
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="sm"
                  [attr.aria-pressed]="showPassword()"
                  aria-controls="edit-password"
                  (click)="showPassword.set(!showPassword())"
                >
                  {{ showPassword() ? "Hide" : "Show" }}
                </button>
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="sm"
                  (click)="requestGeneratePassword.emit()"
                >
                  Generate
                </button>
              </div>
            </div>
            @if (password()) {
              <div class="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                <span
                  hlmBadge
                  [variant]="passwordStrength().strong ? 'success' : 'warning'"
                  size="sm"
                >
                  {{ passwordStrength().strong ? "Strong" : "Weak" }}
                </span>
                @if (!passwordStrength().strong) {
                  <span class="text-muted-foreground">
                    Missing: {{ passwordStrength().missing.join(", ") }}
                  </span>
                }
              </div>
            }
          </div>
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-2">
              <label hlmLabel for="edit-uris">URIs (one per line)</label>
              @if (uriCount() > 0) {
                <span hlmBadge variant="secondary" size="sm" class="tabular-nums">
                  {{ uriCount() }}
                </span>
              }
            </div>
            <textarea
              hlmTextarea
              id="edit-uris"
              rows="3"
              class="auto-grow-textarea font-mono text-xs"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              [value]="uris()"
              (input)="uris.set($any($event.target).value)"
            ></textarea>
          </div>
          <div class="space-y-1">
            <label hlmLabel for="edit-notes">Notes</label>
            <textarea
              hlmTextarea
              id="edit-notes"
              rows="2"
              class="auto-grow-textarea"
              [value]="notes()"
              (input)="notes.set($any($event.target).value)"
            ></textarea>
          </div>
        </div>
        <div hlmCardFooter class="border-border shrink-0 justify-end gap-2 border-t pt-3">
          <button hlmBtn type="button" variant="outline" (click)="modal.close()">Cancel</button>
          <button hlmBtn type="submit" variant="default">
            {{ editingIndex() === -1 ? "Add Item" : "Save Changes" }}
          </button>
        </div>
      </form>
    </app-modal-dialog>
  `,
})
export class EditItemDialogComponent {
  readonly folders = input<VaultFolder[]>([]);
  readonly saved = output<EditItemResult>();
  readonly requestGeneratePassword = output<void>();
  readonly createFolder = output<string>();

  private readonly modal = viewChild.required<ModalDialogComponent>("modal");
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>("nameInput");
  protected readonly editingIndex = signal(-1);
  protected readonly showPassword = signal(false);
  protected readonly nameTouched = signal(false);
  private originalItem: VaultItem | null = null;

  protected readonly name = signal("");
  protected readonly showNameError = computed(() => this.nameTouched() && !this.name().trim());
  protected readonly folderId = signal<string | null>(null);
  protected readonly newFolderName = signal("");
  protected readonly username = signal("");
  protected readonly password = signal("");
  protected readonly uris = signal("");
  protected readonly uriCount = computed(
    () =>
      this.uris()
        .split(/\r?\n/)
        .filter((u) => u.trim()).length,
  );
  protected readonly notes = signal("");

  protected readonly passwordStrength = computed(() => {
    const pw = this.password();
    const missing: string[] = [];
    if (pw.length < 12) missing.push("12+ chars");
    if (!/\d/.test(pw)) missing.push("digit");
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=[\]\\/;']/.test(pw)) missing.push("special char");
    return { strong: missing.length === 0, missing };
  });

  openCreate(): void {
    this.nameTouched.set(false);
    this.newFolderName.set("");
    this.editingIndex.set(-1);
    this.originalItem = null;
    this.showPassword.set(false);
    this.name.set("");
    this.folderId.set(null);
    this.username.set("");
    this.password.set("");
    this.uris.set("");
    this.notes.set("");
    this.modal().open();
  }

  open(row: ExplorerRow): void {
    this.nameTouched.set(false);
    this.newFolderName.set("");
    this.editingIndex.set(row.index);
    this.originalItem = structuredClone(row.item);
    this.showPassword.set(false);
    this.name.set(row.item.name || "");
    this.folderId.set(row.item.folderId ?? null);
    this.username.set(row.username);
    this.password.set(row.password);
    this.uris.set(row.uris.join("\n"));
    this.notes.set(row.item.notes || "");
    this.modal().open();
  }

  setPassword(nextPassword: string): void {
    this.password.set(nextPassword);
  }

  selectFolder(id: string | null): void {
    this.folderId.set(id);
  }

  /** Enter in the new-folder field adds the folder instead of submitting (saving) the whole form. */
  protected onNewFolderEnter(event: Event): void {
    const kb = event as KeyboardEvent;
    event.preventDefault();
    if (kb.isComposing || kb.keyCode === 229) return;
    this.onCreateFolder();
  }

  protected onCreateFolder(): void {
    const name = this.newFolderName().trim();
    if (!name) return;
    this.createFolder.emit(name);
    this.newFolderName.set("");
  }

  protected onSave(event: Event): void {
    event.preventDefault();
    if (!this.name().trim()) {
      this.nameTouched.set(true);
      this.nameInput()?.nativeElement.focus();
      return;
    }
    this.saved.emit({
      index: this.editingIndex(),
      original: this.originalItem,
      name: this.name(),
      folderId: this.folderId(),
      username: this.username(),
      password: this.password(),
      urisText: this.uris(),
      notes: this.notes(),
    });
    this.modal().close();
  }
}

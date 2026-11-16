import { Component, output, signal } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";

import { parseErrorMessage } from "../../core/parse-error";

@Component({
  selector: "app-aegis-import-panel",
  imports: [NgIcon, ...HlmBadgeImports, ...HlmButtonImports, ...HlmCardImports],
  template: `
    <section
      hlmCard
      size="sm"
      [class]="dragOver() ? 'border-primary bg-muted/30 transition-colors' : 'transition-colors'"
      (dragover)="onDragOver($event)"
      (dragleave)="dragOver.set(false)"
      (drop)="onDrop($event)"
    >
      <div hlmCardHeader>
        <h3 hlmCardTitle>Import Passkeys and FIDO Credentials</h3>
        <p hlmCardDescription>
          Drop or select an unencrypted JSON export containing Aegis or compatible FIDO2 passkey
          entries. Entries match by item ID or a unique username; ambiguous usernames are skipped.
        </p>
      </div>
      <div hlmCardContent class="space-y-3">
        <div
          class="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3.5"
        >
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-muted-foreground">Recognized arrays:</span>
            <span hlmBadge variant="secondary" size="sm">fidoKeys</span>
            <span hlmBadge variant="secondary" size="sm">fido2Credentials</span>
            <span hlmBadge variant="secondary" size="sm">credentials</span>
            <span hlmBadge variant="secondary" size="sm">keys</span>
          </div>
          <label
            hlmBtn
            variant="default"
            size="sm"
            class="focus-within:ring-ring cursor-pointer focus-within:ring-2 focus-within:ring-offset-2"
          >
            <ng-icon name="matKeyRound" class="size-4" aria-hidden="true" />
            Select FIDO JSON Export
            <input
              type="file"
              accept=".json,application/json"
              class="sr-only"
              (change)="onFileSelected($event)"
            />
          </label>
        </div>

        @if (statusMessage()) {
          <p class="text-muted-foreground text-sm" role="status">{{ statusMessage() }}</p>
        }
      </div>
    </section>
  `,
})
export class AegisImportPanelComponent {
  readonly aegisLoaded = output<unknown>();
  readonly parseError = output<string>();
  protected readonly statusMessage = signal("");
  protected readonly dragOver = signal(false);

  setStatus(message: string): void {
    this.statusMessage.set(message);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.readFile(file);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.readFile(file);
    input.value = "";
  }

  private async readFile(file: File): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      this.aegisLoaded.emit(parsed);
    } catch (err) {
      this.parseError.emit(parseErrorMessage(err));
    }
  }
}

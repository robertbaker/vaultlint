import { Component, computed, input, output, signal } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { buttonVariants, HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";

import { parseErrorMessage } from "../../core/parse-error";
import type { VendorCliId, VendorCliProviderInfo } from "../../core/vault.models";

/** Vault exports are small; refuse anything big enough to freeze the tab while it is read. */
export const MAX_VAULT_FILE_BYTES = 200 * 1024 * 1024;

export interface VaultFilePayload {
  raw?: string | Uint8Array;
  parsed?: unknown;
  fileName: string;
}

@Component({
  selector: "app-vault-upload",
  imports: [NgIcon, ...HlmButtonImports, ...HlmCardImports],
  template: `
    @if (compact()) {
      <section
        hlmCard
        size="sm"
        [class]="
          dragOver()
            ? 'border-primary bg-muted/40 border-dashed transition-colors'
            : 'transition-colors'
        "
        (dragover)="onDragOver($event)"
        (dragleave)="dragOver.set(false)"
        (drop)="onDrop($event)"
        aria-label="Session and vault file controls"
      >
        <div
          hlmCardContent
          class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-3 py-2.5 sm:px-4"
        >
          <div class="min-w-0 flex-1">
            <ng-content />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <ng-content select="[slot=actions]" />
            <button hlmBtn variant="outline" size="xs" type="button" (click)="reloadInput.click()">
              <ng-icon name="matUploadFileRound" class="size-3.5" aria-hidden="true" />
              Load another vault
            </button>
            <input
              #reloadInput
              type="file"
              accept=".json,.csv,.xml,.1pux,.kdbx,.bramble,application/json,text/csv,application/xml,application/zip"
              class="sr-only"
              tabindex="-1"
              aria-hidden="true"
              (change)="onFileSelected($event)"
            />
            <button hlmBtn variant="outline" size="xs" (click)="loadSample.emit()">
              Reload sample
            </button>
            <button
              hlmBtn
              variant="outline"
              size="xs"
              class="hover:text-destructive-readable"
              (click)="clearVault.emit()"
            >
              Clear
            </button>
          </div>
        </div>
      </section>
    } @else {
      <section
        hlmCard
        size="sm"
        [class]="
          dragOver()
            ? 'landing-dropzone border-primary bg-muted/40 border-2 border-dashed transition-colors'
            : 'landing-dropzone border-2 border-dashed transition-colors'
        "
        (dragover)="onDragOver($event)"
        (dragleave)="dragOver.set(false)"
        (drop)="onDrop($event)"
        aria-label="Load password manager vault"
      >
        <div hlmCardContent class="flex flex-col items-center gap-3 py-8 text-center">
          <div class="landing-upload-icon-badge" aria-hidden="true">
            <ng-icon name="matUploadFileRound" class="landing-upload-icon" />
          </div>
          <div>
            <h2 class="text-base font-semibold">Start with a vault export</h2>
            <p class="text-muted-foreground text-sm">
              Drop a file or choose one. It is read in this browser; optional AI and network checks
              only run when you start them.
            </p>
          </div>
          <div class="flex flex-wrap justify-center gap-2">
            <label [class]="fileButtonClasses">
              Choose an export
              <input
                type="file"
                accept=".json,.csv,.xml,.1pux,.kdbx,.bramble,application/json,text/csv,application/xml,application/zip"
                class="sr-only"
                (change)="onFileSelected($event)"
              />
            </label>
            <button hlmBtn variant="outline" (click)="loadSample.emit()">
              Try the sample vault
            </button>
          </div>
          <p class="text-muted-foreground landing-upload-help text-xs">
            JSON, CSV, XML, and 1PUX supported. Encrypted exports are rejected; export CSV or XML
            from KeePass first.
          </p>
          @if (readableProviders().length > 0) {
            <details class="landing-cli-import animated-details">
              <summary>
                <span>Import from a local CLI</span>
                <span class="landing-cli-count">{{ readableProviders().length }} available</span>
              </summary>
              <div class="landing-cli-provider-list">
                @for (p of readableProviders(); track p.id) {
                  <button
                    hlmBtn
                    variant="outline"
                    size="xs"
                    [disabled]="vendorBusy()"
                    (click)="loadVendorCli.emit(p.id)"
                  >
                    Import from {{ p.displayName }} ({{ p.binary }})
                  </button>
                }
              </div>
            </details>
          }
        </div>
      </section>
    }
  `,
})
export class VaultUploadComponent {
  protected readonly fileButtonClasses = buttonVariants({
    variant: "default",
    size: "lg",
    class:
      "landing-file-button cursor-pointer focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
  });

  readonly compact = input(false);
  readonly vendorProviders = input<VendorCliProviderInfo[]>([]);
  readonly vendorBusy = input(false);
  protected readonly readableProviders = computed(() =>
    this.vendorProviders().filter((p) => p.read),
  );

  readonly fileLoaded = output<VaultFilePayload>();
  readonly parseError = output<string>();
  readonly loadSample = output<void>();
  readonly clearVault = output<void>();
  readonly loadVendorCli = output<VendorCliId>();

  protected readonly dragOver = signal(false);
  private readRequestId = 0;

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
    if (file) await this.readFile(file);
    input.value = "";
  }

  private async readFile(file: File): Promise<void> {
    const requestId = ++this.readRequestId;
    if (file.size > MAX_VAULT_FILE_BYTES) {
      this.parseError.emit(
        `${file.name} is too large (${Math.round(file.size / 1024 / 1024)} MB). Vault exports are normally a few MB.`,
      );
      return;
    }
    try {
      const lower = file.name.toLowerCase();
      const raw: string | Uint8Array =
        lower.endsWith(".1pux") ||
        lower.endsWith(".kdbx") ||
        lower.endsWith(".bramble") ||
        lower.endsWith(".zip")
          ? new Uint8Array(await file.arrayBuffer())
          : await file.text();
      if (requestId !== this.readRequestId) return;
      this.fileLoaded.emit({ raw, fileName: file.name });
    } catch (err) {
      if (requestId !== this.readRequestId) return;
      this.parseError.emit(parseErrorMessage(err));
    }
  }
}

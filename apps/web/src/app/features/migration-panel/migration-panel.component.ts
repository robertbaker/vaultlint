import { Component, computed, effect, input, output, signal, untracked } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import { parseVaultAsync } from "@vaultlint/vault-formats";
import {
  buildVaultMigrationDecisionReport,
  previewVaultMigration,
  type MigrationConflictPreference,
  type VaultMigrationOptions,
} from "@vaultlint/vault-ops";
import type { VaultData } from "@vaultlint/vault-schema";

import { downloadBlob } from "../../core/download";
import { parseErrorMessage } from "../../core/parse-error";

@Component({
  selector: "app-migration-panel",
  imports: [
    NgIcon,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmNativeSelectImports,
  ],
  template: `
    <div class="@container space-y-4">
      <section
        hlmCard
        size="sm"
        [class]="dragOver() ? 'border-primary bg-muted/30 transition-colors' : 'transition-colors'"
        (dragover)="onDragOver($event)"
        (dragleave)="dragOver.set(false)"
        (drop)="onDrop($event)"
      >
        <div hlmCardHeader>
          <h3 hlmCardTitle>Compare and merge another vault</h3>
          <p hlmCardDescription>
            Drop or choose an unencrypted export. vaultlint previews matching entries and adds only
            entries that do not match the current vault. Choose how to handle fields that differ.
          </p>
        </div>
        <div hlmCardContent class="space-y-4">
          <div
            class="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3.5"
          >
            <div class="flex flex-wrap items-center gap-1.5 text-xs">
              <span class="text-muted-foreground">Supported exports:</span>
              <span hlmBadge variant="secondary" size="sm">.json</span>
              <span hlmBadge variant="secondary" size="sm">.csv</span>
              <span hlmBadge variant="secondary" size="sm">.xml</span>
              <span hlmBadge variant="secondary" size="sm">.1pux</span>
            </div>
            <label
              hlmBtn
              variant="outline"
              size="sm"
              class="focus-within:ring-ring cursor-pointer focus-within:ring-2 focus-within:ring-offset-2"
            >
              <ng-icon name="matCompareArrowsRound" class="size-4" aria-hidden="true" />
              Choose second vault
              <input
                type="file"
                accept=".json,.csv,.xml,.1pux,application/json,text/csv,application/xml,application/zip"
                class="sr-only"
                (change)="onFileSelected($event)"
              />
            </label>
          </div>

          @if (error()) {
            <p class="text-destructive text-sm" role="alert">{{ error() }}</p>
          }

          @if (preview(); as result) {
            <div class="grid grid-cols-2 gap-2.5 @md:grid-cols-4" aria-live="polite">
              <div class="border-border bg-background/60 rounded-lg border p-3">
                <span class="text-muted-foreground block text-xs">Incoming</span>
                <strong class="mt-0.5 block text-lg font-bold tabular-nums">{{
                  result.incomingCount
                }}</strong>
              </div>
              <div class="border-border bg-background/60 rounded-lg border p-3">
                <span class="text-muted-foreground block text-xs">New items</span>
                <strong class="mt-0.5 block text-lg font-bold tabular-nums">{{
                  selectedAdditions(result)
                }}</strong>
              </div>
              <div class="border-border bg-background/60 rounded-lg border p-3">
                <span class="text-muted-foreground block text-xs">Matched</span>
                <strong class="mt-0.5 block text-lg font-bold tabular-nums">{{
                  result.matches.length
                }}</strong>
              </div>
              <div class="border-border bg-background/60 rounded-lg border p-3">
                <span class="text-muted-foreground block text-xs">Needs review</span>
                <strong class="mt-0.5 block text-lg font-bold tabular-nums">{{
                  result.candidates.length
                }}</strong>
              </div>
            </div>

            @if (conflictingMatches().length > 0) {
              <div class="border-border space-y-3 rounded-lg border p-3.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h4 class="text-sm font-semibold">Choose values for matched entries</h4>
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="xs"
                      (click)="setAllMatchedConflicts(result, 'current')"
                    >
                      Keep all current
                    </button>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="xs"
                      (click)="setAllMatchedConflicts(result, 'incoming')"
                    >
                      Use all incoming
                    </button>
                  </div>
                </div>

                <div class="divide-border divide-y">
                  @for (match of conflictingMatches(); track match.incomingIndex) {
                    <div class="space-y-2 py-2.5 first:pt-0 last:pb-0">
                      <div>
                        <p class="text-sm font-medium">{{ match.currentName }}</p>
                        <p class="text-muted-foreground text-xs">
                          {{ match.confidence }} confidence · {{ match.reasons.join(", ") }}
                        </p>
                      </div>
                      @for (field of match.conflicts; track field) {
                        <label class="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span class="font-medium">{{ field }}</span>
                          <hlm-native-select
                            size="sm"
                            [value]="fieldChoice(match.incomingIndex, field)"
                            (valueChange)="setFieldChoiceValue(match.incomingIndex, field, $event)"
                            [attr.aria-label]="field + ' choice for ' + match.currentName"
                          >
                            <option hlmNativeSelectOption value="current">Keep current</option>
                            <option hlmNativeSelectOption value="incoming">Use incoming</option>
                          </hlm-native-select>
                        </label>
                      }
                    </div>
                  }
                </div>
              </div>
            }

            @if (result.candidates.length > 0) {
              <div class="border-border space-y-2 rounded-lg border p-3.5">
                <h4 class="text-sm font-semibold">Possible matches need review</h4>
                <p class="text-muted-foreground text-xs">
                  These entries are added separately by default. Review the match reason before
                  choosing to merge.
                </p>
                <div class="divide-border divide-y">
                  @for (candidate of result.candidates; track candidate.incomingIndex) {
                    <div class="space-y-2 py-2.5 last:pb-0">
                      <label class="flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-sm">
                        <input
                          type="checkbox"
                          class="accent-primary mt-0.5 size-4 shrink-0"
                          [disabled]="!candidateCanMerge(candidate)"
                          [checked]="candidateSelected(candidate.incomingIndex)"
                          (change)="toggleCandidate(candidate.incomingIndex, $event)"
                        />
                        <span class="min-w-0">
                          Merge <strong>{{ candidate.incomingName }}</strong> with
                          <strong>{{ candidate.currentName }}</strong>
                          <span class="text-muted-foreground block text-xs">
                            {{ candidate.confidence }} confidence ·
                            {{ candidate.reasons.join(", ") }}
                          </span>
                        </span>
                      </label>
                      @if (!candidateCanMerge(candidate)) {
                        <p class="text-warning-readable ml-6 text-xs">
                          Several possible matches were found. This entry will be added separately.
                        </p>
                      }
                      @if (candidateSelected(candidate.incomingIndex)) {
                        @for (field of candidate.conflicts; track field) {
                          <label
                            class="ml-6 flex flex-wrap items-center justify-between gap-2 text-xs"
                          >
                            <span class="font-medium">{{ field }}</span>
                            <hlm-native-select
                              size="sm"
                              [value]="fieldChoice(candidate.incomingIndex, field)"
                              (valueChange)="
                                setFieldChoiceValue(candidate.incomingIndex, field, $event)
                              "
                              [attr.aria-label]="field + ' choice for ' + candidate.incomingName"
                            >
                              <option hlmNativeSelectOption value="current">Keep current</option>
                              <option hlmNativeSelectOption value="incoming">Use incoming</option>
                            </hlm-native-select>
                          </label>
                        }
                      }
                    </div>
                  }
                </div>
              </div>
            }

            <div class="flex flex-wrap gap-2">
              <button
                hlmBtn
                type="button"
                variant="default"
                [disabled]="!hasChanges(result)"
                (click)="applyMigration()"
              >
                Apply migration ({{ selectedAdditions(result) }} new item(s))
              </button>
              <button
                hlmBtn
                type="button"
                variant="outline"
                (click)="downloadDecisionReport(result)"
              >
                Download decision report
              </button>
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class MigrationPanelComponent {
  readonly current = input<VaultData | null>(null);
  readonly apply = output<{ incoming: VaultData; options: VaultMigrationOptions }>();
  protected readonly candidateSelections = signal<Record<number, boolean>>({});
  protected readonly choices = signal<
    Record<number, Partial<Record<string, MigrationConflictPreference>>>
  >({});
  protected readonly incoming = signal<VaultData | null>(null);
  protected readonly preview = signal<ReturnType<typeof previewVaultMigration> | null>(null);
  protected readonly error = signal("");
  protected readonly dragOver = signal(false);
  private fileReadRevision = 0;

  protected readonly conflictingMatches = computed(
    () => this.preview()?.matches.filter((match) => match.conflicts.length > 0) ?? [],
  );

  constructor() {
    // The preview is computed against a specific vault state; refresh it (and drop selections)
    // when the open vault changes (edit, undo/redo, replace, clear) so stale matches never apply.
    effect(() => {
      const current = this.current();
      untracked(() => {
        const incoming = this.incoming();
        if (!incoming) return;
        this.candidateSelections.set({});
        this.choices.set({});
        if (current) {
          this.preview.set(previewVaultMigration(current, incoming));
        } else {
          this.incoming.set(null);
          this.preview.set(null);
        }
      });
    });
  }

  protected applyMigration(): void {
    const incoming = this.incoming();
    if (!incoming) return;
    const options = this.mergeOptions();
    this.apply.emit({ incoming, options });
    this.incoming.set(null);
    this.preview.set(null);
  }

  protected candidateSelected(index: number): boolean {
    return this.candidateSelections()[index] ?? false;
  }

  protected candidateCanMerge(candidate: { reasons: string[] }): boolean {
    return !candidate.reasons.some((reason) => reason.startsWith("ambiguous:"));
  }

  protected toggleCandidate(index: number, event: Event): void {
    const selected = (event.target as HTMLInputElement).checked;
    this.candidateSelections.update((previous) => ({ ...previous, [index]: selected }));
  }

  protected fieldChoice(index: number, field: string): MigrationConflictPreference {
    return this.choices()[index]?.[field] ?? "current";
  }

  protected setFieldChoiceValue(
    index: number,
    field: string,
    value: string | null | undefined,
  ): void {
    if (value !== "current" && value !== "incoming") return;
    this.choices.update((previous) => ({
      ...previous,
      [index]: { ...previous[index], [field]: value },
    }));
  }

  protected setAllMatchedConflicts(
    result: NonNullable<ReturnType<typeof this.preview>>,
    preference: MigrationConflictPreference,
  ): void {
    this.choices.update((previous) => {
      const next = { ...previous };
      for (const match of result.matches) {
        if (match.conflicts.length === 0) continue;
        const fields = { ...next[match.incomingIndex] };
        for (const field of match.conflicts) fields[field] = preference;
        next[match.incomingIndex] = fields;
      }
      return next;
    });
  }

  protected selectedAdditions(result: NonNullable<ReturnType<typeof this.preview>>): number {
    const merged = new Set(this.mergeOptions().mergeCandidateIndices);
    return (
      result.additions.length - result.additionIndices.filter((index) => merged.has(index)).length
    );
  }

  protected hasChanges(result: NonNullable<ReturnType<typeof this.preview>>): boolean {
    const selected = new Set([
      ...result.matches.map((match) => match.incomingIndex),
      ...result.candidates
        .filter((candidate) => this.candidateSelected(candidate.incomingIndex))
        .map((candidate) => candidate.incomingIndex),
    ]);
    const hasIncomingChoices = Object.entries(this.choices()).some(
      ([index, fields]) =>
        selected.has(Number(index)) && Object.values(fields).includes("incoming"),
    );
    const hasReviewedCandidate = result.candidates.some((candidate) =>
      this.candidateSelected(candidate.incomingIndex),
    );
    return this.selectedAdditions(result) > 0 || hasIncomingChoices || hasReviewedCandidate;
  }

  private mergeOptions(): VaultMigrationOptions {
    return {
      mergeCandidateIndices: Object.entries(this.candidateSelections())
        .filter(([, selected]) => selected)
        .map(([index]) => Number(index)),
      fieldChoices: this.choices(),
    };
  }

  protected downloadDecisionReport(result: NonNullable<ReturnType<typeof this.preview>>): void {
    const report = buildVaultMigrationDecisionReport(result, this.mergeOptions());
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    downloadBlob(blob, "vaultlint-migration-decisions.json");
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.readIncomingFile(file);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      input.value = "";
      return;
    }
    try {
      await this.readIncomingFile(file);
    } finally {
      input.value = "";
    }
  }

  private async readIncomingFile(file: File): Promise<void> {
    const revision = ++this.fileReadRevision;
    try {
      const parsed = await parseVaultAsync(new Uint8Array(await file.arrayBuffer()), {
        fileName: file.name,
      });
      if (revision !== this.fileReadRevision) return;
      const current = this.current();
      if (!current) throw new Error("Load a vault before opening the migration preview.");
      this.incoming.set(parsed.vault);
      this.preview.set(previewVaultMigration(current, parsed.vault));
      this.candidateSelections.set({});
      this.choices.set({});
      this.error.set("");
    } catch (err) {
      if (revision !== this.fileReadRevision) return;
      this.incoming.set(null);
      this.preview.set(null);
      this.error.set(parseErrorMessage(err));
    }
  }
}

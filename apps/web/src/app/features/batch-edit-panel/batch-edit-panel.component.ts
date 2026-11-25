import { Component, computed, input, output, signal } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmInputImports } from "@spartan-ng/helm/input";
import { HlmLabelImports } from "@spartan-ng/helm/label";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import { HlmWarningBox } from "@ui/components/warning-box";
import { type BatchEditTargetMode } from "@vaultlint/vault-ops";

import type { BatchMatchPreview } from "../../core/vault.models";

export interface BatchEditRequest {
  field: string;
  pattern: string;
  replacement: string;
  targetMode: BatchEditTargetMode;
}

@Component({
  selector: "app-batch-edit-panel",
  imports: [
    NgIcon,
    HlmWarningBox,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmNativeSelectImports,
  ],
  template: `
    <div class="@container space-y-4">
      <div class="grid gap-4 @2xl:grid-cols-2">
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Regex Batch Edit</h3>
            <p hlmCardDescription>Preview regex replacements before applying them.</p>
          </div>
          <div hlmCardContent class="space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1.5">
                <label hlmLabel for="batch-field">Target Field</label>
                <hlm-native-select
                  class="w-full"
                  selectId="batch-field"
                  [value]="field()"
                  (valueChange)="field.set($event || 'name')"
                >
                  <option hlmNativeSelectOption value="name">Name</option>
                  <option hlmNativeSelectOption value="uri">URI</option>
                  <option hlmNativeSelectOption value="username">Username</option>
                  <option hlmNativeSelectOption value="notes">Notes</option>
                </hlm-native-select>
              </div>
              <div class="space-y-1.5">
                <label hlmLabel for="batch-target-mode">Target Mode</label>
                <hlm-native-select
                  class="w-full"
                  selectId="batch-target-mode"
                  [value]="targetMode()"
                  (valueChange)="onTargetModeChange($event)"
                >
                  <option hlmNativeSelectOption value="all">All values</option>
                  <option hlmNativeSelectOption value="non-empty">Non-empty only</option>
                  <option hlmNativeSelectOption value="empty">Empty only</option>
                  <option hlmNativeSelectOption value="clear">Clear matching</option>
                </hlm-native-select>
              </div>
            </div>
            <div class="space-y-1.5">
              <label hlmLabel for="batch-pattern">Regex Pattern</label>
              <input
                hlmInput
                id="batch-pattern"
                placeholder="e.g. ^https?://www."
                [value]="pattern()"
                (input)="pattern.set($any($event.target).value)"
              />
            </div>
            <div class="space-y-1.5">
              <label hlmLabel for="batch-replacement">Replacement</label>
              <input
                hlmInput
                id="batch-replacement"
                [placeholder]="replacementPlaceholder"
                [value]="replacement()"
                (input)="replacement.set($any($event.target).value)"
              />
              <p class="text-muted-foreground text-[11px]">
                Variables: <code>{{ varHint }}</code>
              </p>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <button
                hlmBtn
                type="button"
                variant="outline"
                size="xs"
                (click)="applyPreset('uri', '^http://', 'https://')"
              >
                Preset: HTTP &rarr; HTTPS
              </button>
              <button
                hlmBtn
                type="button"
                variant="outline"
                size="xs"
                (click)="applyPreset('uri', '^(https?://)www\\\\.', '$1')"
              >
                Preset: Strip www.
              </button>
              <button
                hlmBtn
                type="button"
                variant="outline"
                size="xs"
                (click)="applyPreset('uri', '\\\\?.*$', '')"
              >
                Preset: Strip Query Params
              </button>
            </div>

            <div class="flex flex-wrap gap-2 pt-1">
              <button hlmBtn type="button" variant="outline" size="sm" (click)="onPreview()">
                Preview Matches
              </button>
              <button
                hlmBtn
                type="button"
                [variant]="pattern().trim() ? 'default' : 'outline'"
                size="sm"
                [disabled]="!pattern().trim()"
                (click)="onApply()"
              >
                Apply Batch Edit
              </button>
              <button
                hlmBtn
                type="button"
                variant="secondary"
                size="sm"
                (click)="normalizeAll.emit()"
              >
                Normalize All Names &amp; URIs
              </button>
            </div>

            @if (previewError()) {
              <div hlmWarningBox color="destructive" compact="true">
                {{ previewError() }}
              </div>
            }

            @if (previewMatches().length > 0) {
              <div class="border-border bg-muted/40 space-y-2 rounded-md border p-2.5 text-xs">
                <p class="text-muted-foreground font-medium">
                  Showing {{ Math.min(15, previewMatches().length) }} of
                  {{ previewMatches().length }} match(es)
                </p>
                <ul class="divide-border divide-y">
                  @for (m of previewMatches().slice(0, 15); track $index) {
                    <li class="py-1.5 first:pt-0 last:pb-0">
                      <div class="font-medium">{{ m.label }}</div>
                      <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono">
                        <span class="text-muted-foreground break-all line-through">{{
                          m.before || "(empty)"
                        }}</span>
                        <span aria-hidden="true">&rarr;</span>
                        <span class="text-primary-readable font-medium break-all">{{
                          m.after || "(empty)"
                        }}</span>
                      </div>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>
        </section>

        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Domain Mappings</h3>
            <p hlmCardDescription>
              Map subdomains (e.g. <code>mail.google.com</code>) to a primary domain
              (<code>google.com</code>).
            </p>
          </div>
          <div hlmCardContent class="space-y-3">
            <div class="flex flex-wrap gap-2">
              <input
                hlmInput
                class="min-w-40 flex-1"
                placeholder="From (mail.google.com)"
                [value]="mapFrom()"
                (input)="mapFrom.set($any($event.target).value)"
                aria-label="Source domain"
              />
              <input
                hlmInput
                class="min-w-36 flex-1"
                placeholder="To (google.com)"
                [value]="mapTo()"
                (input)="mapTo.set($any($event.target).value)"
                aria-label="Target domain"
              />
              <button hlmBtn type="button" variant="outline" size="sm" (click)="onAddMapping()">
                <ng-icon name="matAddRound" class="size-4" aria-hidden="true" />
                Add
              </button>
            </div>

            @if (mappingEntries().length === 0) {
              <p class="text-muted-foreground rounded-md border border-dashed px-3 py-2.5 text-xs">
                No domain mappings configured yet. Add a pair above or detect subdomains from your
                vault.
              </p>
            } @else {
              <ul class="space-y-1.5">
                @for (entry of mappingEntries(); track entry[0]) {
                  <li
                    class="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs"
                  >
                    <span class="min-w-0 font-mono break-all"
                      >{{ entry[0] }} &rarr; {{ entry[1] }}</span
                    >
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="xs"
                      class="hover:text-destructive-readable"
                      (click)="removeMapping.emit(entry[0])"
                    >
                      Remove
                    </button>
                  </li>
                }
              </ul>
            }

            <div class="flex flex-wrap gap-2">
              <button
                hlmBtn
                type="button"
                variant="default"
                size="sm"
                [disabled]="mappingEntries().length === 0"
                (click)="applyMappings.emit()"
              >
                Apply Domain Mappings
              </button>
              <button
                hlmBtn
                type="button"
                variant="outline"
                size="sm"
                (click)="suggestMappings.emit()"
              >
                Detect Subdomains
              </button>
            </div>
          </div>
        </section>
      </div>

      <section
        hlmCard
        size="sm"
        class="border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      >
        <div class="flex items-center gap-2.5 text-xs">
          <ng-icon
            name="matSmartToyRound"
            class="text-primary size-4 shrink-0"
            aria-hidden="true"
          />
          <span> Want AI folder suggestions, name cleanup, or semantic duplicate checks? </span>
        </div>
        <button hlmBtn type="button" variant="outline" size="xs" (click)="openAi.emit()">
          Open AI Assistant
        </button>
      </section>
    </div>
  `,
})
export class BatchEditPanelComponent {
  protected readonly Math = Math;

  readonly mappings = input.required<Record<string, string>>();
  readonly previewFn =
    input.required<
      (
        field: string,
        pattern: string,
        replacement: string,
        targetMode: BatchEditTargetMode,
      ) => BatchMatchPreview[]
    >();

  readonly applyBatch = output<BatchEditRequest>();
  readonly normalizeAll = output<void>();
  readonly addMapping = output<{ from: string; to: string }>();
  readonly removeMapping = output<string>();
  readonly applyMappings = output<void>();
  readonly suggestMappings = output<void>();
  readonly openAi = output<void>();

  protected readonly field = signal("name");
  protected readonly targetMode = signal<BatchEditTargetMode>("all");
  protected readonly replacementPlaceholder = "e.g. https:// or {{domain.tld}}";
  protected readonly varHint =
    "{{domain.tld}}, {{sub.domain.tld}}, {{hostname}}, {{username}}, {{name}}";
  protected readonly pattern = signal("");
  protected readonly replacement = signal("");
  protected readonly previewMatches = signal<BatchMatchPreview[]>([]);
  protected readonly previewError = signal("");

  protected readonly mapFrom = signal("");
  protected readonly mapTo = signal("");

  protected readonly mappingEntries = computed(() => Object.entries(this.mappings()));

  protected onTargetModeChange(value: string | null | undefined): void {
    const mode = value as BatchEditTargetMode;
    if (mode === "all" || mode === "non-empty" || mode === "empty" || mode === "clear") {
      this.targetMode.set(mode);
    }
  }

  protected onPreview(): void {
    this.previewError.set("");
    if (!this.pattern()) {
      this.previewMatches.set([]);
      this.previewError.set("Enter a pattern to preview matches.");
      return;
    }
    try {
      const fn = this.previewFn();
      this.previewMatches.set(
        fn(this.field(), this.pattern(), this.replacement(), this.targetMode()),
      );
    } catch (err) {
      this.previewMatches.set([]);
      this.previewError.set(`Invalid regex: ${(err as Error).message}`);
    }
  }

  protected applyPreset(field: string, pattern: string, replacement: string): void {
    this.field.set(field);
    this.targetMode.set("all");
    this.pattern.set(pattern);
    this.replacement.set(replacement);
    this.onPreview();
  }

  protected onApply(): void {
    this.applyBatch.emit({
      field: this.field(),
      pattern: this.pattern(),
      replacement: this.replacement(),
      targetMode: this.targetMode(),
    });
    this.previewMatches.set([]);
  }

  protected onAddMapping(): void {
    const from = this.mapFrom().trim();
    const to = this.mapTo().trim();
    if (!from || !to) return;
    this.addMapping.emit({ from, to });
    this.mapFrom.set("");
    this.mapTo.set("");
  }
}

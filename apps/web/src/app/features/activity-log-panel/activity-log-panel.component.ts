import { Component, computed, input, output, signal } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { SearchBoxComponent } from "@ui/blocks/search-box";

import type { AuditLogEntry } from "../../core/vault.models";

@Component({
  selector: "app-activity-log-panel",
  imports: [
    NgIcon,
    SearchBoxComponent,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmEmptyImports,
  ],
  template: `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-sm font-semibold">Session Activity Log</h3>
            @if (entries().length > 0) {
              <span hlmBadge variant="secondary" size="sm" class="tabular-nums">
                {{ entries().length }}
              </span>
            }
          </div>
          <p class="text-muted-foreground text-xs">
            Recent local operations performed on your vault during this session.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          @if (entries().length > 0) {
            <button hlmBtn variant="ghost" size="sm" (click)="clearLog.emit()">Clear Log</button>
          }
          <button hlmBtn variant="outline" size="sm" (click)="exportReport.emit()">
            <ng-icon name="matDownloadRound" class="size-4" aria-hidden="true" />
            Export Audit Report (JSON)
          </button>
          <button hlmBtn variant="outline" size="sm" (click)="exportMarkdown.emit()">
            <ng-icon name="matDownloadRound" class="size-4" aria-hidden="true" />
            Export Markdown (.md)
          </button>
        </div>
      </div>

      @if (entries().length >= 5) {
        <search aria-label="Filter activity log" class="block">
          <app-search-box
            compact
            class="max-w-sm"
            placeholder="Filter session activity..."
            ariaLabel="Filter session activity"
            [value]="query()"
            (search)="query.set($event)"
          />
        </search>
      }

      @if (entries().length === 0) {
        <hlm-empty class="border">
          <div hlmEmptyHeader>
            <div hlmEmptyTitle>No actions recorded yet</div>
            <div hlmEmptyDescription>
              Local edits, merges, and exports performed in this session will appear here.
            </div>
          </div>
        </hlm-empty>
      } @else if (filteredEntries().length === 0) {
        <hlm-empty class="border">
          <div hlmEmptyHeader>
            <div hlmEmptyTitle>No matching activity entries</div>
            <div hlmEmptyDescription>No activity entries match your current filter query.</div>
          </div>
          <div hlmEmptyContent>
            <button hlmBtn type="button" variant="outline" size="sm" (click)="query.set('')">
              Clear Filter
            </button>
          </div>
        </hlm-empty>
      } @else {
        <section hlmCard size="sm">
          <div hlmCardContent class="divide-border divide-y py-1">
            @for (entry of filteredEntries(); track entry.id) {
              <div class="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                <div class="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    class="bg-primary/60 size-1.5 shrink-0 rounded-full"
                    aria-hidden="true"
                  ></span>
                  <span class="min-w-0 font-medium break-words">{{ entry.action }}</span>
                </div>
                <span
                  hlmBadge
                  variant="secondary"
                  size="sm"
                  class="shrink-0 font-mono tabular-nums"
                >
                  {{ entry.timestamp }}
                </span>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class ActivityLogPanelComponent {
  readonly entries = input.required<AuditLogEntry[]>();
  readonly exportReport = output<void>();
  readonly exportMarkdown = output<void>();
  readonly clearLog = output<void>();

  protected readonly query = signal("");
  protected readonly filteredEntries = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.entries();
    if (!q) return list;
    return list.filter(
      (entry) =>
        entry.action.toLowerCase().includes(q) || entry.timestamp.toLowerCase().includes(q),
    );
  });
}

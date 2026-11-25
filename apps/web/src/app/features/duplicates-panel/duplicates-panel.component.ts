import { Component, computed, input, output } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmWarningBox } from "@ui/components/warning-box";
import { getUriString } from "@vaultlint/vault-schema";

import type { DuplicateGroup } from "../../core/vault.models";

@Component({
  selector: "app-duplicates-panel",
  imports: [
    NgIcon,
    HlmWarningBox,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmEmptyImports,
  ],
  template: `
    <div class="@container space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">Duplicate Entries</h3>
          <p class="text-muted-foreground text-xs">
            @if (groups().length > 0) {
              Merging all combines {{ groups().length }}
              {{ groups().length === 1 ? "group" : "groups" }} and removes
              {{ removableCount() }} duplicate entr{{ removableCount() === 1 ? "y" : "ies" }},
              keeping the most recently modified credentials and unique URIs.
            } @else {
              Compare matching entries below. Merging combines unique URIs and keeps the most
              recently modified credentials.
            }
          </p>
        </div>
        <button
          hlmBtn
          [variant]="hasAnyConflicts() ? 'outline' : 'default'"
          size="sm"
          [disabled]="groups().length === 0"
          (click)="mergeAll.emit()"
        >
          <ng-icon name="matMergeRound" class="size-4" aria-hidden="true" />
          Merge All Duplicates
        </button>
      </div>

      @for (group of groups(); track group.groupKey ?? group.key) {
        @let keeperIndex = newestIndex(group);
        <section hlmCard size="sm">
          <div hlmCardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <h4 hlmCardTitle>{{ group.name }}</h4>
              <span hlmBadge variant="warning" size="sm">{{ group.items.length }} entries</span>
              @if (group.conflicts.hasDifferentUsernames) {
                <span hlmBadge variant="destructive" size="sm">Different usernames</span>
              }
              @if (group.conflicts.hasDifferentPasswords) {
                <span hlmBadge variant="destructive" size="sm">Different passwords</span>
              }
              @if (group.conflicts.hasDifferentSubdomains) {
                <span hlmBadge variant="secondary" size="sm">Different subdomains</span>
              }
            </div>
            <button hlmBtn variant="outline" size="sm" (click)="mergeGroup.emit(group)">
              Merge Group
            </button>
          </div>
          <div hlmCardContent class="space-y-2.5 pt-2">
            @if (
              group.conflicts.hasDifferentUsernames ||
              group.conflicts.hasDifferentPasswords ||
              group.conflicts.hasDifferentSubdomains
            ) {
              <div hlmWarningBox color="warning" compact="true">
                {{ conflictMessage(group) }}
              </div>
            }
            <div class="grid gap-2 @lg:grid-cols-2">
              @for (entry of group.items; track entry.index) {
                <div
                  [class]="
                    'min-w-0 rounded-md border p-2.5 text-xs ' +
                    (entry.index === keeperIndex
                      ? 'border-primary/45 bg-primary/5'
                      : 'border-border bg-muted/30')
                  "
                >
                  <div class="flex flex-wrap items-center justify-between gap-2 font-medium">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span class="truncate">{{
                        entry.item.login?.username || "(no username)"
                      }}</span>
                      @if (entry.index === keeperIndex) {
                        <span hlmBadge variant="success" size="sm">Newest · kept</span>
                      }
                    </div>
                    <time
                      class="text-muted-foreground shrink-0 tabular-nums"
                      [attr.datetime]="entry.item.lastModified || entry.item.revisionDate || null"
                    >
                      {{ formatTimestamp(entry.item.lastModified || entry.item.revisionDate) }}
                    </time>
                  </div>
                  <p class="text-muted-foreground mt-1 break-all">
                    {{ formatUris(entry.item.login?.uris) }}
                  </p>
                  @if (group.conflicts.hasDifferentPasswords && entry.item.login?.password) {
                    <p class="text-muted-foreground mt-1 font-mono">
                      Password: •••••••• ({{ entry.item.login?.password?.length }} chars)
                    </p>
                  }
                  @if (
                    entry.item.login?.totp ||
                    (entry.item.login?.fido2Credentials?.length ?? 0) > 0 ||
                    entry.item.notes?.trim() ||
                    ((entry.item.type === 1 || entry.item.login) && !entry.item.login?.password)
                  ) {
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      @if (entry.item.login?.totp) {
                        <span hlmBadge variant="info" size="sm">TOTP</span>
                      }
                      @if ((entry.item.login?.fido2Credentials?.length ?? 0) > 0) {
                        <span hlmBadge variant="info" size="sm">FIDO</span>
                      }
                      @if (entry.item.notes?.trim()) {
                        <span hlmBadge variant="secondary" size="sm">Notes</span>
                      }
                      @if (
                        (entry.item.type === 1 || entry.item.login) && !entry.item.login?.password
                      ) {
                        <span hlmBadge variant="outline" size="sm">No password</span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </section>
      } @empty {
        <hlm-empty class="border">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon name="matCheckCircleRound" class="text-success-readable size-5" />
            </div>
            <div hlmEmptyTitle>No duplicate entries detected</div>
            <div hlmEmptyDescription>
              Entries with matching names and login types will appear here for side-by-side merging.
            </div>
          </div>
        </hlm-empty>
      }
    </div>
  `,
})
export class DuplicatesPanelComponent {
  readonly groups = input.required<DuplicateGroup[]>();
  readonly mergeGroup = output<DuplicateGroup>();
  readonly mergeAll = output<void>();

  protected readonly removableCount = computed(() =>
    this.groups().reduce((sum, g) => sum + Math.max(0, g.items.length - 1), 0),
  );
  protected readonly hasAnyConflicts = computed(() =>
    this.groups().some(
      (g) =>
        g.conflicts.hasDifferentUsernames ||
        g.conflicts.hasDifferentPasswords ||
        g.conflicts.hasDifferentSubdomains,
    ),
  );

  protected newestIndex(group: DuplicateGroup): number {
    if (group.items.length === 0) return -1;
    let bestIndex = group.items[0].index;
    let bestMs =
      new Date(
        group.items[0].item.lastModified ?? group.items[0].item.revisionDate ?? 0,
      ).getTime() || 0;
    for (let i = 1; i < group.items.length; i++) {
      const entry = group.items[i];
      const ms = new Date(entry.item.lastModified ?? entry.item.revisionDate ?? 0).getTime() || 0;
      if (ms > bestMs) {
        bestMs = ms;
        bestIndex = entry.index;
      }
    }
    return bestIndex;
  }

  protected conflictMessage(group: DuplicateGroup): string {
    const reasons: string[] = [];
    if (group.conflicts.hasDifferentUsernames) reasons.push("different usernames");
    if (group.conflicts.hasDifferentPasswords) reasons.push("different passwords");
    if (group.conflicts.hasDifferentSubdomains) {
      reasons.push(`subdomains (${group.conflicts.distinctHostnames.join(", ")})`);
    }
    return `Review before merging: entries have ${reasons.join(", ")}.`;
  }

  protected formatTimestamp(raw: string | null | undefined): string {
    if (!raw) return "no date";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
  }

  protected formatUris(uris: unknown): string {
    if (!Array.isArray(uris) || uris.length === 0) return "No URIs";
    return (
      uris
        .map((u) => getUriString(u))
        .filter(Boolean)
        .join(", ") || "No URIs"
    );
  }
}

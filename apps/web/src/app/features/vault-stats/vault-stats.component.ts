import { Component, input, output } from "@angular/core";
import { HlmButtonImports } from "@spartan-ng/helm/button";

import type { ExplorerFilterMode, VaultTabId } from "../../core/vault.models";

export interface StatJumpEvent {
  tab: VaultTabId;
  filter?: ExplorerFilterMode;
}

@Component({
  selector: "app-vault-stats",
  imports: [...HlmButtonImports],
  template: `
    <section
      class="border-border bg-card @container rounded-xl border p-3.5 shadow-2xs sm:p-4"
      aria-label="Vault health summary"
    >
      <div class="flex flex-col gap-4 @3xl:flex-row @3xl:items-center @3xl:justify-between">
        <div class="flex min-w-0 items-start gap-3.5 sm:items-center">
          <div class="progress-ring-wrapper">
            <progress
              class="progress-ring"
              [value]="healthScore()"
              max="100"
              aria-label="Password health score"
              [attr.aria-valuetext]="healthScore() + '% password health'"
              [style.--value]="healthScore()"
              [style.--fill-color]="
                healthScore() >= 80
                  ? 'var(--success)'
                  : healthScore() >= 50
                    ? 'var(--warning)'
                    : 'var(--destructive)'
              "
            ></progress>
            <span
              class="progress-ring-content flex flex-col items-center leading-none"
              aria-hidden="true"
            >
              <span class="text-xs font-bold">{{ healthScore() }}%</span>
              <span class="text-muted-foreground text-[9px] font-semibold">Health</span>
            </span>
          </div>

          <div class="min-w-0 flex-1 space-y-1.5">
            <div>
              <h2 class="text-sm font-semibold">
                @if (duplicateCount() + weakCount() > 0) {
                  Review items that need attention
                } @else {
                  Vault password health looks good
                }
              </h2>
              <p class="text-muted-foreground text-sm">
                @if (duplicateCount() > 0 || weakCount() > 0) {
                  @if (duplicateCount() > 0) {
                    {{ duplicateCount() }} duplicate group{{ duplicateCount() === 1 ? "" : "s" }}
                  }
                  @if (duplicateCount() > 0 && weakCount() > 0) {
                    ·
                  }
                  @if (weakCount() > 0) {
                    {{ weakCount() }} weak password{{ weakCount() === 1 ? "" : "s" }}
                  }
                  {{ duplicateCount() + weakCount() === 1 ? "needs" : "need" }} review. Choose a
                  finding to start.
                } @else {
                  No duplicate groups or weak passwords detected. Run vault checks for a wider
                  audit.
                }
              </p>
            </div>

            <div class="flex flex-wrap gap-2">
              @if (duplicateCount() > 0) {
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="xs"
                  (click)="jumpTo.emit({ tab: 'duplicates' })"
                >
                  Review duplicates
                </button>
              }
              @if (weakCount() > 0) {
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="xs"
                  (click)="jumpTo.emit({ tab: 'security' })"
                >
                  Improve passwords
                </button>
              }
              @if (duplicateCount() === 0 && weakCount() === 0) {
                <button
                  hlmBtn
                  type="button"
                  variant="default"
                  size="xs"
                  (click)="jumpTo.emit({ tab: 'lint' })"
                >
                  Run vault checks
                  @if (lintCount() > 0) {
                    ({{ lintCount() }})
                  }
                </button>
              } @else if (lintCount() > 0) {
                <button
                  hlmBtn
                  type="button"
                  variant="outline"
                  size="xs"
                  (click)="jumpTo.emit({ tab: 'lint' })"
                >
                  Vault checks ({{ lintCount() }})
                </button>
              }
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 @lg:grid-cols-4 @3xl:shrink-0">
          <button
            type="button"
            class="border-border bg-background/60 hover:border-foreground/30 hover:bg-muted/50 focus-visible:ring-ring flex min-h-12 cursor-pointer flex-col items-start justify-between gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:shadow-2xs focus-visible:ring-2"
            (click)="jumpTo.emit({ tab: 'explorer', filter: 'all' })"
          >
            <span class="text-muted-foreground text-xs font-medium">Total Items</span>
            <strong class="text-lg leading-tight font-bold tabular-nums">{{ totalItems() }}</strong>
          </button>

          <button
            type="button"
            [class]="
              'focus-visible:ring-ring flex min-h-12 cursor-pointer flex-col items-start justify-between gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:shadow-2xs focus-visible:ring-2 ' +
              (duplicateCount() > 0
                ? 'border-warning/40 bg-warning/10 text-warning-readable hover:bg-warning/15'
                : 'border-border bg-background/60 hover:border-foreground/30 hover:bg-muted/50')
            "
            (click)="jumpTo.emit({ tab: 'duplicates' })"
          >
            <span class="text-xs font-medium">Duplicate Groups</span>
            <strong class="text-lg leading-tight font-bold tabular-nums">{{
              duplicateCount()
            }}</strong>
          </button>

          <button
            type="button"
            [class]="
              'focus-visible:ring-ring flex min-h-12 cursor-pointer flex-col items-start justify-between gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:shadow-2xs focus-visible:ring-2 ' +
              (weakCount() > 0
                ? 'border-destructive/40 bg-destructive/10 text-destructive-readable hover:bg-destructive/15'
                : 'border-border bg-background/60 hover:border-foreground/30 hover:bg-muted/50')
            "
            (click)="jumpTo.emit({ tab: 'security' })"
          >
            <span class="text-xs font-medium">Weak Passwords</span>
            <strong class="text-lg leading-tight font-bold tabular-nums">{{ weakCount() }}</strong>
          </button>

          <button
            type="button"
            [class]="
              'focus-visible:ring-ring flex min-h-12 cursor-pointer flex-col items-start justify-between gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors outline-none hover:shadow-2xs focus-visible:ring-2 ' +
              (fidoCount() > 0
                ? 'border-info/40 bg-info/10 text-info-text hover:bg-info/15'
                : 'border-border bg-background/60 hover:border-foreground/30 hover:bg-muted/50')
            "
            (click)="jumpTo.emit({ tab: 'explorer', filter: 'fido' })"
          >
            <span class="text-xs font-medium">FIDO2 Keys</span>
            <strong class="text-lg leading-tight font-bold tabular-nums">{{ fidoCount() }}</strong>
          </button>
        </div>
      </div>
    </section>
  `,
})
export class VaultStatsComponent {
  readonly totalItems = input.required<number>();
  readonly duplicateCount = input.required<number>();
  readonly weakCount = input.required<number>();
  readonly fidoCount = input.required<number>();
  readonly healthScore = input<number>(100);
  readonly lintCount = input<number>(0);

  readonly jumpTo = output<StatJumpEvent>();
}

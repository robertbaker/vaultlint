import { Component, computed, input, model, output, signal } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";

import type {
  InvalidUriInfo,
  ReusedPasswordGroup,
  VaultChartBreakdown,
  WeakItemInfo,
  WebDeadLinkFinding,
  WebMobileUriFinding,
  WebRedirectFinding,
} from "../../core/vault.models";

@Component({
  selector: "app-security-panel",
  imports: [
    NgIcon,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmNativeSelectImports,
  ],
  template: `
    <div class="@container space-y-5">
      <!-- Top Overview: Password Health + Item Breakdown -->
      <div class="grid gap-4 @2xl:grid-cols-2">
        <section hlmCard size="sm" class="flex flex-col justify-between">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Password Health &amp; Generator</h3>
            <p hlmCardDescription>
              @if (chartBreakdown(); as chart) {
                Local breakdown across {{ chart.totalItems }} vault
                {{ chart.totalItems === 1 ? "item" : "items" }}.
              } @else {
                Local password strength summary.
              }
            </p>
          </div>

          <div hlmCardContent class="space-y-4">
            <div class="flex items-center gap-4">
              <div class="progress-ring-wrapper">
                <progress
                  class="progress-ring"
                  [value]="healthScore()"
                  max="100"
                  aria-label="Vault Password Health Score"
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
                <span class="progress-ring-content text-xs font-bold" aria-hidden="true">
                  {{ healthScore() }}%
                </span>
              </div>

              @if (chartBreakdown(); as chart) {
                <div class="min-w-0 flex-1 space-y-2.5">
                  <div class="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
                    @if (chart.strongCount > 0) {
                      <div
                        class="bg-success h-full transition-all"
                        [style.width.%]="pct(chart.strongCount, chart.totalItems)"
                        title="Strong"
                      ></div>
                    }
                    @if (chart.weakCount > 0) {
                      <div
                        class="bg-destructive h-full transition-all"
                        [style.width.%]="pct(chart.weakCount, chart.totalItems)"
                        title="Weak"
                      ></div>
                    }
                    @if (chart.reusedCount > 0) {
                      <div
                        class="bg-warning h-full transition-all"
                        [style.width.%]="pct(chart.reusedCount, chart.totalItems)"
                        title="Reused"
                      ></div>
                    }
                  </div>
                  <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
                    <div class="flex items-center justify-between">
                      <span class="flex items-center gap-1.5">
                        <span class="bg-success inline-block size-2 rounded-full"></span>
                        Strong
                      </span>
                      <span class="font-medium">{{ chart.strongCount }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="flex items-center gap-1.5">
                        <span class="bg-destructive inline-block size-2 rounded-full"></span>
                        Weak
                      </span>
                      <span class="font-medium">{{ chart.weakCount }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="flex items-center gap-1.5">
                        <span class="bg-warning inline-block size-2 rounded-full"></span>
                        Reused
                      </span>
                      <span class="font-medium">{{ chart.reusedCount }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="flex items-center gap-1.5">
                        <span
                          class="bg-muted-foreground/40 inline-block size-2 rounded-full"
                        ></span>
                        No Password
                      </span>
                      <span class="font-medium">{{ chart.noPasswordCount }}</span>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>

          <div hlmCardFooter class="flex flex-wrap items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-xs font-medium">
              <span class="text-muted-foreground">Length</span>
              <hlm-native-select
                size="sm"
                [value]="String(passwordLength())"
                (valueChange)="onLengthChange($event)"
                aria-label="Generated password length"
              >
                <option hlmNativeSelectOption value="16">16 chars</option>
                <option hlmNativeSelectOption value="20">20 chars</option>
                <option hlmNativeSelectOption value="24">24 chars</option>
                <option hlmNativeSelectOption value="32">32 chars</option>
              </hlm-native-select>
            </label>
            <button
              hlmBtn
              type="button"
              variant="default"
              size="sm"
              [disabled]="weakItems().length === 0"
              (click)="regenerateAll.emit()"
            >
              <ng-icon name="matRefreshRound" class="size-4" aria-hidden="true" />
              Regenerate All Weak
            </button>
          </div>
        </section>

        @if (chartBreakdown(); as chart) {
          <section hlmCard size="sm">
            <div hlmCardHeader>
              <h3 hlmCardTitle>Vault Item Categories</h3>
              <p hlmCardDescription>Logins, mobile apps, cards, notes, and identities.</p>
            </div>
            <div hlmCardContent class="space-y-2.5 text-xs">
              @for (bar of typeBars(); track bar.label) {
                <div class="space-y-1">
                  <div class="flex items-center justify-between">
                    <span>{{ bar.label }}</span>
                    <span class="text-muted-foreground font-medium tabular-nums">
                      {{ bar.count }}
                      @if (chart.totalItems > 0) {
                        · {{ pct(bar.count, chart.totalItems) }}%
                      }
                    </span>
                  </div>
                  <div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      class="bg-primary h-full transition-all"
                      [style.width.%]="pct(bar.count, chart.totalItems)"
                    ></div>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </div>

      <!-- Opt-In Network Checks -->
      <section hlmCard size="sm">
        <div hlmCardHeader>
          <div class="flex flex-wrap items-center gap-2">
            <h3 hlmCardTitle>Opt-In Network Checks</h3>
            <span hlmBadge variant="outline" size="sm">External · Opt-in</span>
          </div>
          <p hlmCardDescription>
            Nothing runs automatically. Each external lookup runs only when you start it.
          </p>
        </div>
        <div hlmCardContent class="grid gap-3 @xl:grid-cols-3">
          <div
            class="border-border bg-muted/20 flex flex-col justify-between gap-3 rounded-lg border p-3"
          >
            <div class="space-y-1">
              <div class="flex items-center gap-1.5 text-xs font-semibold">
                <ng-icon name="matSecurityRound" class="text-primary size-4" aria-hidden="true" />
                <span>Breach check (HIBP)</span>
              </div>
              <p class="text-muted-foreground text-xs">
                Sends only the 5-character SHA-1 prefix (k-anonymity); passwords stay local.
              </p>
            </div>
            <button
              hlmBtn
              type="button"
              variant="outline"
              size="sm"
              class="w-full"
              [disabled]="checkingHibp()"
              (click)="checkHibp.emit()"
            >
              <ng-icon name="matSecurityRound" class="size-4" aria-hidden="true" />
              {{ checkingHibp() ? "Checking HIBP..." : "Check Breaches (HIBP)" }}
            </button>
          </div>

          <div
            class="border-border bg-muted/20 flex flex-col justify-between gap-3 rounded-lg border p-3"
          >
            <div class="space-y-1">
              <div class="flex items-center gap-1.5 text-xs font-semibold">
                <ng-icon name="matLinkRound" class="text-primary size-4" aria-hidden="true" />
                <span>Redirects &amp; dead links</span>
              </div>
              <p class="text-muted-foreground text-xs">
                Checks whether saved HTTPS URLs redirect to a new location or fail to respond.
              </p>
            </div>
            <button
              hlmBtn
              type="button"
              variant="outline"
              size="sm"
              class="w-full"
              [disabled]="checkingLinks()"
              (click)="checkLinks.emit()"
            >
              <ng-icon name="matLinkRound" class="size-4" aria-hidden="true" />
              {{ checkingLinks() ? "Checking Links..." : "Check Redirects / Dead Links" }}
            </button>
          </div>

          <div
            class="border-border bg-muted/20 flex flex-col justify-between gap-3 rounded-lg border p-3"
          >
            <div class="space-y-1">
              <div class="flex items-center gap-1.5 text-xs font-semibold">
                <ng-icon name="matDevicesRound" class="text-primary size-4" aria-hidden="true" />
                <span>Mobile app URIs</span>
              </div>
              <p class="text-muted-foreground text-xs">
                Validates <code>androidapp://</code> &amp; <code>iosapp://</code> IDs and suggests
                official app links.
              </p>
            </div>
            <button
              hlmBtn
              type="button"
              variant="outline"
              size="sm"
              class="w-full"
              [disabled]="checkingMobileUris()"
              (click)="checkMobileUris.emit()"
            >
              <ng-icon name="matDevicesRound" class="size-4" aria-hidden="true" />
              {{ checkingMobileUris() ? "Checking Apps..." : "Validate Mobile App URIs" }}
            </button>
          </div>
        </div>
      </section>

      <!-- Findings Filter Strip -->
      <div class="scroll-fade-x flex max-w-full flex-nowrap items-center gap-2 py-0.5">
        <button
          hlmBtn
          type="button"
          size="xs"
          class="shrink-0 tabular-nums"
          [variant]="findingFilter() === 'all' ? 'default' : 'outline'"
          [attr.aria-pressed]="findingFilter() === 'all'"
          (click)="findingFilter.set('all')"
        >
          All
        </button>
        <button
          hlmBtn
          type="button"
          size="xs"
          class="shrink-0 tabular-nums"
          [variant]="findingFilter() === 'weak' ? 'default' : 'outline'"
          [attr.aria-pressed]="findingFilter() === 'weak'"
          (click)="findingFilter.set('weak')"
        >
          Weak ({{ weakItems().length }})
        </button>
        <button
          hlmBtn
          type="button"
          size="xs"
          class="shrink-0 tabular-nums"
          [variant]="findingFilter() === 'reused' ? 'default' : 'outline'"
          [attr.aria-pressed]="findingFilter() === 'reused'"
          (click)="findingFilter.set('reused')"
        >
          Reused ({{ reusedGroups().length }})
        </button>
        <button
          hlmBtn
          type="button"
          size="xs"
          class="shrink-0 tabular-nums"
          [variant]="findingFilter() === 'uris' ? 'default' : 'outline'"
          [attr.aria-pressed]="findingFilter() === 'uris'"
          (click)="findingFilter.set('uris')"
        >
          Invalid URIs ({{ invalidUriItems().length }})
        </button>
        @if (networkFindingsCount() > 0) {
          <button
            hlmBtn
            type="button"
            size="xs"
            class="shrink-0 tabular-nums"
            [variant]="findingFilter() === 'network' ? 'default' : 'outline'"
            [attr.aria-pressed]="findingFilter() === 'network'"
            (click)="findingFilter.set('network')"
          >
            Links &amp; Apps ({{ networkFindingsCount() }})
          </button>
        }
      </div>

      <!-- Weak Passwords -->
      @if (findingFilter() === "all" || findingFilter() === "weak") {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Weak Passwords ({{ weakItems().length }})</h3>
            <p hlmCardDescription>
              Passwords shorter than 12 characters or missing numbers and symbols.
            </p>
          </div>
          <div hlmCardContent class="pt-0">
            @if (weakItems().length === 0) {
              <p class="text-muted-foreground flex items-center gap-2 text-sm">
                <ng-icon
                  name="matCheckCircleRound"
                  class="text-success-readable size-4 shrink-0"
                  aria-hidden="true"
                />
                All passwords meet strength requirements (12+ chars, digits, special characters).
              </p>
            } @else {
              <div class="divide-border divide-y">
                @for (weak of weakItems(); track weak.index) {
                  <div
                    class="content-auto flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div class="min-w-0 flex-1 space-y-0.5">
                      <div class="text-sm font-medium">
                        {{ weak.item.name || "Unnamed" }}
                        <span class="text-muted-foreground font-normal">
                          ({{ weak.item.login?.username || "no username" }})
                        </span>
                      </div>
                      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span class="text-muted-foreground">Issues:</span>
                        @for (reason of weak.reasons; track reason) {
                          <span hlmBadge variant="outline" size="sm">{{ reason }}</span>
                        }
                      </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <button
                        hlmBtn
                        type="button"
                        variant="outline"
                        size="sm"
                        class="min-h-9"
                        (click)="regenerateOne.emit(weak.index)"
                      >
                        Generate Strong Password
                      </button>
                      <button
                        hlmBtn
                        type="button"
                        variant="outline"
                        size="sm"
                        class="min-h-9"
                        (click)="editItem.emit(weak.index)"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </section>
      }

      <!-- Reused Passwords -->
      @if (findingFilter() === "all" || findingFilter() === "reused") {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>
              Reused Passwords ({{ reusedGroups().length }}
              {{ reusedGroups().length === 1 ? "group" : "groups" }})
            </h3>
            <p hlmCardDescription>
              Logins sharing the same password should be rotated to distinct values.
            </p>
          </div>
          <div hlmCardContent class="pt-0">
            @if (reusedGroups().length === 0) {
              <p class="text-muted-foreground flex items-center gap-2 text-sm">
                <ng-icon
                  name="matCheckCircleRound"
                  class="text-success-readable size-4 shrink-0"
                  aria-hidden="true"
                />
                No reused passwords detected — every login in your vault uses a distinct password.
              </p>
            } @else {
              <div class="space-y-3">
                @for (group of reusedGroups(); track $index) {
                  <div class="border-border rounded-lg border p-3">
                    <div class="mb-2 flex items-center gap-2">
                      <span class="text-xs font-semibold">Shared Password</span>
                      <span hlmBadge variant="warning" size="sm"
                        >{{ group.items.length }} items</span
                      >
                    </div>
                    <div class="divide-border divide-y">
                      @for (entry of group.items; track entry.index) {
                        <div
                          class="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs"
                        >
                          <span>
                            <strong>{{ entry.item.name || "Unnamed" }}</strong>
                            <span class="text-muted-foreground">
                              ({{ entry.item.login?.username || "no username" }})
                            </span>
                          </span>
                          <button
                            hlmBtn
                            type="button"
                            variant="outline"
                            size="xs"
                            class="min-h-8"
                            (click)="regenerateOne.emit(entry.index)"
                          >
                            Make Unique
                          </button>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </section>
      }

      <!-- Invalid URIs -->
      @if (findingFilter() === "all" || findingFilter() === "uris") {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Invalid / Malformed URIs ({{ invalidUriItems().length }})</h3>
            <p hlmCardDescription>URIs missing a valid scheme or host.</p>
          </div>
          <div hlmCardContent class="pt-0">
            @if (invalidUriItems().length === 0) {
              <p class="text-muted-foreground flex items-center gap-2 text-sm">
                <ng-icon
                  name="matCheckCircleRound"
                  class="text-success-readable size-4 shrink-0"
                  aria-hidden="true"
                />
                All vault URIs are valid.
              </p>
            } @else {
              <div class="divide-border divide-y">
                @for (entry of invalidUriItems(); track entry.index) {
                  <div
                    class="content-auto flex flex-wrap items-center justify-between gap-3 py-2.5"
                  >
                    <div class="min-w-0 flex-1 space-y-0.5">
                      <div class="text-sm font-medium">{{ entry.item.name || "Unnamed" }}</div>
                      <p class="text-muted-foreground text-xs break-all">
                        {{ entry.invalidUris.length === 1 ? "Invalid URI:" : "Invalid URIs:" }}
                        {{ entry.invalidUris.join(", ") }}
                      </p>
                    </div>
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="sm"
                      class="min-h-9"
                      (click)="editItem.emit(entry.index)"
                    >
                      Edit URI
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        </section>
      }

      <!-- Opt-in Redirects & Dead Links -->
      @if (
        (findingFilter() === "all" || findingFilter() === "network") &&
        (redirectFindings().length > 0 || deadLinkFindings().length > 0)
      ) {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>
              Redirects ({{ redirectFindings().length }}) &amp; Unreachable Links ({{
                deadLinkFindings().length
              }})
            </h3>
          </div>
          <div hlmCardContent class="divide-border divide-y pt-0">
            @for (redir of redirectFindings(); track $index) {
              <div class="content-auto flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div class="min-w-0 flex-1 space-y-0.5">
                  <div class="text-sm font-medium">{{ redir.itemName }}</div>
                  <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs">
                    <span class="text-muted-foreground break-all line-through">{{
                      redir.originalUri
                    }}</span>
                    <span aria-hidden="true">&rarr;</span>
                    <span class="text-primary-readable font-medium break-all">{{
                      redir.redirectedUri
                    }}</span>
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    hlmBtn
                    type="button"
                    variant="outline"
                    size="xs"
                    class="min-h-8"
                    (click)="applyRedirect.emit({ finding: redir, replaceOriginal: false })"
                  >
                    Add Redirected URI
                  </button>
                  <button
                    hlmBtn
                    type="button"
                    variant="secondary"
                    size="xs"
                    class="min-h-8"
                    (click)="applyRedirect.emit({ finding: redir, replaceOriginal: true })"
                  >
                    Replace URI
                  </button>
                </div>
              </div>
            }
            @for (dead of deadLinkFindings(); track $index) {
              <div class="content-auto flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div class="min-w-0 flex-1 space-y-0.5">
                  <div class="text-sm font-medium">{{ dead.itemName }}</div>
                  <p class="text-muted-foreground text-xs break-all">
                    {{ dead.uri }} ({{ dead.reason }})
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    hlmBtn
                    type="button"
                    variant="outline"
                    size="xs"
                    class="min-h-8"
                    (click)="editItem.emit(dead.itemIndex)"
                  >
                    Edit
                  </button>
                  <button
                    hlmBtn
                    type="button"
                    variant="danger"
                    size="xs"
                    class="min-h-8"
                    (click)="removeDeadUri.emit(dead)"
                  >
                    Remove URI
                  </button>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <!-- Mobile App URI Findings & Suggestions -->
      @if (
        (findingFilter() === "all" || findingFilter() === "network") &&
        mobileUriFindings().length > 0
      ) {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Mobile App URIs ({{ mobileUriFindings().length }})</h3>
          </div>
          <div hlmCardContent class="divide-border divide-y pt-0">
            @for (finding of mobileUriFindings(); track $index) {
              <div class="content-auto flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div class="min-w-0 flex-1 space-y-0.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium">{{ finding.itemName }}</span>
                    <span
                      hlmBadge
                      size="sm"
                      [variant]="
                        finding.status === 'invalid'
                          ? 'destructive'
                          : finding.status === 'suggested'
                            ? 'secondary'
                            : finding.status === 'unverified'
                              ? 'warning'
                              : 'default'
                      "
                    >
                      {{ finding.status }}
                    </span>
                  </div>
                  <p class="text-muted-foreground text-xs break-all">
                    {{ finding.uri }} — {{ finding.detail }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  @if (finding.status === "suggested") {
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="xs"
                      class="min-h-8"
                      (click)="applySuggestedMobileUri.emit(finding)"
                    >
                      Add App URI
                    </button>
                  } @else {
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="xs"
                      class="min-h-8"
                      (click)="editItem.emit(finding.itemIndex)"
                    >
                      Edit
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
})
export class SecurityPanelComponent {
  protected readonly String = String;

  readonly weakItems = input.required<WeakItemInfo[]>();
  readonly reusedGroups = input.required<ReusedPasswordGroup[]>();
  readonly invalidUriItems = input<InvalidUriInfo[]>([]);
  readonly healthScore = input.required<number>();
  readonly checkingHibp = input.required<boolean>();
  readonly checkingLinks = input(false);
  readonly checkingMobileUris = input(false);
  readonly chartBreakdown = input<VaultChartBreakdown | null>(null);
  readonly redirectFindings = input<WebRedirectFinding[]>([]);
  readonly deadLinkFindings = input<WebDeadLinkFinding[]>([]);
  readonly mobileUriFindings = input<WebMobileUriFinding[]>([]);
  readonly passwordLength = model(16);

  readonly checkHibp = output<void>();
  readonly checkLinks = output<void>();
  readonly checkMobileUris = output<void>();
  readonly regenerateOne = output<number>();
  readonly regenerateAll = output<void>();
  readonly editItem = output<number>();
  readonly applyRedirect = output<{ finding: WebRedirectFinding; replaceOriginal: boolean }>();
  readonly removeDeadUri = output<WebDeadLinkFinding>();
  readonly applySuggestedMobileUri = output<WebMobileUriFinding>();

  protected readonly findingFilter = signal<"all" | "weak" | "reused" | "uris" | "network">("all");
  protected readonly networkFindingsCount = computed(
    () =>
      this.redirectFindings().length +
      this.deadLinkFindings().length +
      this.mobileUriFindings().length,
  );

  protected readonly typeBars = computed(() => {
    const c = this.chartBreakdown();
    if (!c) return [];
    return [
      { label: "Logins", count: c.loginCount },
      { label: "Mobile Apps", count: c.appCount },
      { label: "Cards", count: c.cardCount },
      { label: "Secure Notes", count: c.noteCount },
      { label: "Identities", count: c.identityCount },
    ];
  });

  protected pct(part: number, total: number): number {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  protected onLengthChange(value: string | null | undefined): void {
    const len = Number(value) || 16;
    this.passwordLength.set(len);
  }
}

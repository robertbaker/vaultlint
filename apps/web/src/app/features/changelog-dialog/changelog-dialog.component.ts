import { Component, computed, inject, input, output, signal, viewChild } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmAlertImports } from "@spartan-ng/helm/alert";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmSkeletonImports } from "@spartan-ng/helm/skeleton";
import { ModalDialogComponent } from "@ui/blocks/modal-dialog";
import { SearchBoxComponent } from "@ui/blocks/search-box";

import {
  CHANGELOG_CACHE_KEY,
  CHANGELOG_PAGE_URL,
  CHANGELOG_READ_KEY,
  CHANGELOG_SEEN_KEY,
  CHANGELOG_URL,
  SECTION_KIND_LABELS,
  countItems,
  filterReleases,
  findRelease,
  isOlderThanLatest,
  parseChangelog,
  presentKinds,
  releasesSince,
  sectionKind,
  shortHash,
  type ChangelogRelease,
  type SectionKind,
} from "../../core/changelog";
import { BROWSER_STORAGE } from "../../core/storage.token";

const MAX_RELEASES = 20;
const OPEN_BY_DEFAULT = 2;
const FETCH_TIMEOUT_MS = 8000;

interface CachedChangelog {
  text: string;
  fetchedAt: string;
}

@Component({
  selector: "app-changelog-dialog",
  imports: [
    ModalDialogComponent,
    SearchBoxComponent,
    NgIcon,
    ...HlmAlertImports,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmEmptyImports,
    ...HlmSkeletonImports,
  ],
  template: `
    <app-modal-dialog
      #modal
      dialogClass="max-w-3xl w-[calc(100dvw-1.5rem)] rounded-xl border-0 bg-transparent p-0"
      ariaLabelledBy="changelog-title"
      ariaDescribedBy="changelog-sub"
      (closed)="onClosed()"
    >
      <div
        hlmCard
        size="sm"
        class="flex max-h-[85dvh] w-full flex-col overflow-hidden"
        id="changelog-dialog"
      >
        <div hlmCardHeader class="border-border shrink-0 space-y-3 border-b pb-4">
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 id="changelog-title" hlmCardTitle class="text-lg">What's new</h2>
                @if (badgeText()) {
                  <span hlmBadge [variant]="newCount() > 0 ? 'default' : 'secondary'" role="status">
                    {{ badgeText() }}
                  </span>
                }
              </div>
              <p id="changelog-sub" class="text-muted-foreground text-xs">
                Read from vaultlint's changelog on GitHub.
              </p>
            </div>
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close changelog"
              (click)="close()"
            >
              <ng-icon name="matCloseRound" class="size-4" />
            </button>
          </div>

          <search
            aria-label="Filter changelog"
            class="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <app-search-box
              inputId="changelog-search"
              class="flex-1"
              placeholder="Search changes"
              ariaLabel="Search the changelog"
              compact
              [value]="query()"
              (search)="query.set($event)"
            />

            @if (kinds().length >= 2) {
              <div
                class="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Show only these types of change"
              >
                @for (kind of kinds(); track kind) {
                  <button
                    hlmBtn
                    type="button"
                    size="xs"
                    [variant]="selectedKinds().has(kind) ? 'default' : 'outline'"
                    [attr.aria-pressed]="selectedKinds().has(kind)"
                    (click)="toggleKind(kind)"
                  >
                    {{ kindLabels[kind] }}
                  </button>
                }
              </div>
            }
          </search>
        </div>

        <div
          id="changelog-content"
          class="scroll-shadow-y flex-1 space-y-3 overflow-y-auto p-4"
          tabindex="0"
          role="region"
          aria-label="Release notes"
          aria-live="polite"
          [attr.aria-busy]="loading()"
        >
          @if (loading()) {
            <p class="sr-only" role="status">Loading the changelog…</p>
            @for (item of [0, 1]; track item) {
              <div class="border-border space-y-2 rounded-lg border p-4" aria-hidden="true">
                <hlm-skeleton class="h-5 w-32" />
                <hlm-skeleton class="h-3.5 w-full" />
                <hlm-skeleton class="h-3.5 w-4/5" />
              </div>
            }
          } @else if (errorMessage()) {
            <div id="changelog-error" hlmAlert variant="destructive">
              <h3 hlmAlertTitle>Could not load the changelog</h3>
              <p hlmAlertDescription>{{ errorMessage() }}</p>
              <div class="col-start-2 mt-2 flex flex-wrap gap-2">
                <button hlmBtn type="button" size="sm" (click)="reload()">Try again</button>
                <a
                  hlmBtn
                  variant="outline"
                  size="sm"
                  [href]="changelogPageUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open it on GitHub
                </a>
              </div>
            </div>
          } @else {
            @if (shownReleases().length >= 2) {
              <nav class="flex flex-wrap gap-1.5 pb-1" aria-label="Jump to a release">
                @for (release of shownReleases(); track release.version; let i = $index) {
                  <button
                    hlmBtn
                    type="button"
                    variant="outline"
                    size="xs"
                    [attr.aria-label]="'Jump to version ' + release.version"
                    (click)="jumpTo(i)"
                  >
                    v{{ release.version }}
                  </button>
                }
              </nav>
            }

            @for (message of statusMessages(); track message) {
              <p
                class="bg-muted/60 text-muted-foreground rounded-md px-3 py-2 text-xs"
                role="status"
              >
                {{ message }}
              </p>
            }

            @if (shownReleases().length > 0) {
              @for (release of shownReleases(); track release.version; let i = $index) {
                <details
                  [id]="'cl-release-' + i"
                  class="border-border bg-card rounded-lg border"
                  [open]="isFiltering() || i < openByDefault"
                >
                  <summary
                    class="hover:bg-muted/40 flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-semibold">v{{ release.version }}</span>
                      @if (release.date) {
                        <time class="text-muted-foreground text-xs" [attr.datetime]="release.date">
                          {{ formatDate(release.date) }}
                        </time>
                      }
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      @if (newVersions().has(release.version)) {
                        <span hlmBadge variant="default">New</span>
                      }
                      @if (release.version === currentVersion()) {
                        <span hlmBadge variant="secondary">You are here</span>
                      }
                      <span class="text-muted-foreground text-xs">
                        {{ countItems(release) }}
                        {{ countItems(release) === 1 ? "change" : "changes" }}
                      </span>
                    </div>
                  </summary>

                  <div class="border-border space-y-3 border-t px-4 py-3">
                    @for (section of release.sections; track section.title) {
                      <section
                        class="space-y-1.5"
                        [attr.data-kind]="sectionKind(section.title)"
                        [attr.aria-label]="section.title + ', version ' + release.version"
                      >
                        <h4
                          class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
                        >
                          <span>{{ section.title }}</span>
                          <span class="text-muted-foreground/70">({{ section.items.length }})</span>
                        </h4>
                        <ul class="space-y-1.5 text-sm">
                          @for (item of section.items; track $index) {
                            <li class="flex flex-wrap items-baseline gap-1.5">
                              @if (item.scope) {
                                <span
                                  class="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs font-medium"
                                >
                                  {{ item.scope }}
                                </span>
                              }
                              <span>{{ item.text }}</span>
                              @if (item.commits.length > 0) {
                                <span class="inline-flex gap-1 font-mono text-xs">
                                  @for (commit of item.commits; track commit.hash) {
                                    @if (commit.url) {
                                      <a
                                        class="text-primary hover:underline"
                                        [href]="commit.url"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        [attr.aria-label]="
                                          'Commit ' + shortHash(commit.hash) + ' on GitHub'
                                        "
                                      >
                                        {{ shortHash(commit.hash) }}
                                      </a>
                                    } @else {
                                      <span class="text-muted-foreground">{{
                                        shortHash(commit.hash)
                                      }}</span>
                                    }
                                  }
                                </span>
                              }
                            </li>
                          }
                        </ul>
                      </section>
                    }

                    @if (release.url) {
                      <p class="pt-1 text-xs">
                        <a
                          class="text-primary hover:underline"
                          [href]="release.url"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Compare changes on GitHub
                        </a>
                      </p>
                    }
                  </div>
                </details>
              }
            } @else if (releases().length > 0) {
              <hlm-empty class="border">
                <div hlmEmptyHeader>
                  <div hlmEmptyTitle>No changes match.</div>
                  <div hlmEmptyDescription>Try a different word or turn off a type filter.</div>
                </div>
                <div hlmEmptyContent>
                  <button hlmBtn type="button" variant="outline" size="sm" (click)="clearFilters()">
                    Clear search and filters
                  </button>
                </div>
              </hlm-empty>
            } @else {
              <hlm-empty class="border">
                <div hlmEmptyHeader>
                  <div hlmEmptyTitle>No releases yet</div>
                  <div hlmEmptyDescription>The changelog has no releases yet.</div>
                </div>
              </hlm-empty>
            }

            <p class="pt-2 text-center text-xs">
              <a
                class="text-primary hover:underline"
                [href]="changelogPageUrl"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{
                  releases().length > maxReleases
                    ? "See all releases on GitHub"
                    : "Open the changelog on GitHub"
                }}
              </a>
            </p>
          }
        </div>
      </div>
    </app-modal-dialog>
  `,
})
export class ChangelogDialogComponent {
  readonly currentVersion = input.required<string>();
  readonly opened = output<void>();

  private readonly storage = inject(BROWSER_STORAGE);
  private readonly modal = viewChild.required(ModalDialogComponent);

  protected readonly changelogPageUrl = CHANGELOG_PAGE_URL;
  protected readonly kindLabels = SECTION_KIND_LABELS;
  protected readonly maxReleases = MAX_RELEASES;
  protected readonly openByDefault = OPEN_BY_DEFAULT;
  protected readonly countItems = countItems;
  protected readonly sectionKind = sectionKind;
  protected readonly shortHash = shortHash;

  protected readonly releases = signal<ChangelogRelease[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly note = signal<string | null>(null);
  protected readonly seenVersion = signal<string | null>(null);
  protected readonly query = signal("");
  protected readonly selectedKinds = signal<ReadonlySet<SectionKind>>(new Set());

  private requestId = 0;

  protected readonly isFiltering = computed(
    () => this.selectedKinds().size > 0 || this.query().trim() !== "",
  );

  protected readonly kinds = computed(() => presentKinds(this.releases().slice(0, MAX_RELEASES)));

  protected readonly shownReleases = computed(() =>
    filterReleases(this.releases().slice(0, MAX_RELEASES), {
      kinds: this.selectedKinds(),
      query: this.query(),
    }),
  );

  protected readonly newVersions = computed(
    () => new Set(releasesSince(this.releases(), this.seenVersion()).map((r) => r.version)),
  );

  protected readonly newCount = computed(() => this.newVersions().size);

  protected readonly badgeText = computed(() => {
    if (this.loading() || this.errorMessage()) return "";
    const count = this.newCount();
    if (count > 0 && this.seenVersion()) {
      return `${count} new since v${this.seenVersion()}`;
    }
    return this.releases().length > 0 ? "You are up to date" : "";
  });

  protected readonly statusMessages = computed(() => {
    const all = this.releases();
    const current = this.currentVersion();
    const messages: string[] = [];
    const customNote = this.note();
    if (customNote) messages.push(customNote);
    if (all.length > 0) {
      if (!findRelease(all, current)) {
        messages.push(
          `Version ${current} is not in the changelog yet, so it includes changes that have not been released.`,
        );
      } else if (isOlderThanLatest(all, current)) {
        messages.push(
          `A newer version, ${all[0]!.version}, is available. Reload the page to get it.`,
        );
      }
    }
    return messages;
  });

  open(): void {
    const current = this.currentVersion();
    this.seenVersion.set(this.safeReadStorage(CHANGELOG_READ_KEY));
    this.query.set("");
    this.selectedKinds.set(new Set());
    this.errorMessage.set(null);
    this.note.set(null);
    this.modal().open();
    this.safeWriteStorage(CHANGELOG_SEEN_KEY, current);
    this.safeWriteStorage(CHANGELOG_READ_KEY, current);
    this.opened.emit();
    void this.load();
  }

  close(): void {
    this.modal().close();
  }

  protected reload(): void {
    void this.load();
  }

  protected onClosed(): void {
    this.requestId += 1;
  }

  protected toggleKind(kind: SectionKind): void {
    const next = new Set(this.selectedKinds());
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    this.selectedKinds.set(next);
  }

  protected clearFilters(): void {
    this.query.set("");
    this.selectedKinds.set(new Set());
  }

  protected jumpTo(index: number): void {
    const target = document.getElementById(`cl-release-${index}`) as HTMLDetailsElement | null;
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }

  protected formatDate(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? date
      : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  private async load(): Promise<void> {
    const id = ++this.requestId;
    const cached = this.readCache();
    this.errorMessage.set(null);
    if (cached) {
      this.releases.set(parseChangelog(cached.text));
      this.loading.set(false);
    } else {
      this.releases.set([]);
      this.loading.set(true);
    }

    try {
      const response = await fetch(CHANGELOG_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-cache",
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
      const text = await response.text();
      if (id !== this.requestId) return;
      this.safeWriteStorage(
        CHANGELOG_CACHE_KEY,
        JSON.stringify({ text, fetchedAt: new Date().toISOString() }),
      );
      this.releases.set(parseChangelog(text));
      this.note.set(null);
      this.loading.set(false);
    } catch (error) {
      if (id !== this.requestId) return;
      const reason =
        error instanceof Error && error.name !== "AbortError" && error.name !== "TimeoutError"
          ? error.message
          : "It took too long to answer.";
      this.loading.set(false);
      if (cached) {
        this.releases.set(parseChangelog(cached.text));
        this.note.set(
          `Could not reach GitHub (${reason}) Showing the copy saved on ${new Date(cached.fetchedAt).toLocaleDateString()}.`,
        );
      } else {
        this.errorMessage.set(reason);
      }
    }
  }

  private readCache(): CachedChangelog | null {
    try {
      const parsed = JSON.parse(
        this.safeReadStorage(CHANGELOG_CACHE_KEY) ?? "null",
      ) as Partial<CachedChangelog> | null;
      return parsed && typeof parsed.text === "string" && typeof parsed.fetchedAt === "string"
        ? { text: parsed.text, fetchedAt: parsed.fetchedAt }
        : null;
    } catch {
      return null;
    }
  }

  private safeReadStorage(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private safeWriteStorage(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      // Ignore storage quota or private-browsing errors.
    }
  }
}

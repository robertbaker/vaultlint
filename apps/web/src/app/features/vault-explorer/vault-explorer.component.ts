import { NgTemplateOutlet } from "@angular/common";
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmInputImports } from "@spartan-ng/helm/input";
import { HlmKbdImports } from "@spartan-ng/helm/kbd";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import { HlmTableImports } from "@spartan-ng/helm/table";
import {
  type ColumnDef,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  injectTable,
  type PaginationState,
  rowPaginationFeature,
  rowSelectionFeature,
  type RowSelectionState,
  rowSortingFeature,
  sortFns,
  type SortingState,
  tableFeatures,
} from "@tanstack/angular-table";
import { SearchBoxComponent } from "@ui/blocks/search-box";
import type { VaultFolder } from "@vaultlint/vault-schema";

import type { ExplorerFilterMode, ExplorerRow, ExplorerTypeFilter } from "../../core/vault.models";

const FILTER_MODE_LABELS: Record<Exclude<ExplorerFilterMode, "all">, string> = {
  weak: "Weak passwords",
  reused: "Reused passwords",
  duplicate: "Duplicates",
  fido: "Has FIDO key",
  favorite: "Favorites",
};

const TYPE_FILTER_LABELS: Record<Exclude<ExplorerTypeFilter, "all">, string> = {
  login: "Logins",
  app: "Mobile apps",
  card: "Cards",
  note: "Secure notes",
  identity: "Identities",
};

// TanStack Table v9 only sorts and paginates when the row-model factories are registered here.
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});
const columnHelper = createColumnHelper<typeof features, ExplorerRow>();

@Component({
  selector: "app-vault-explorer",
  imports: [
    NgIcon,
    NgTemplateOutlet,
    FlexRender,
    SearchBoxComponent,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmEmptyImports,
    ...HlmInputImports,
    ...HlmKbdImports,
    ...HlmNativeSelectImports,
    ...HlmTableImports,
  ],
  host: {
    "(document:keydown)": "onKeydown($event)",
  },
  template: `
    <div class="@container space-y-3.5">
      <!-- Primary search & filter toolbar -->
      <search aria-label="Filter vault items" class="block space-y-2.5">
        <div class="flex flex-wrap items-center gap-2.5">
          <div #searchContainer class="min-w-48 flex-1">
            <app-search-box
              #searchBox
              class="w-full"
              placeholder="Search names, users, sites"
              ariaLabel="Search vault items"
              [value]="searchQuery()"
              (search)="onSearchInput($event)"
            >
              <kbd hlmKbd slot="hint" class="hidden @[44rem]:inline-flex">/</kbd>
            </app-search-box>
          </div>

          <button
            hlmBtn
            type="button"
            variant="outline"
            size="sm"
            class="@[44rem]:hidden"
            [attr.aria-expanded]="mobileFiltersOpen()"
            (click)="mobileFiltersOpen.set(!mobileFiltersOpen())"
          >
            <ng-icon name="matFilterListRound" class="size-4" aria-hidden="true" />
            Filters
            @if (activeFilterCount() > 0) {
              <span hlmBadge variant="default" size="sm">{{ activeFilterCount() }}</span>
            }
          </button>

          <div class="hidden @[44rem]:contents">
            <ng-container
              [ngTemplateOutlet]="filterControls"
              [ngTemplateOutletContext]="{ mobile: false }"
            />
          </div>

          @if (hasActiveFilters()) {
            <button
              hlmBtn
              type="button"
              variant="ghost"
              size="sm"
              class="hidden @[44rem]:inline-flex"
              (click)="clearFilters()"
            >
              Reset Filters
            </button>
          }

          <button hlmBtn type="button" variant="default" size="sm" (click)="addItem.emit()">
            <ng-icon name="matAddRound" class="size-4" aria-hidden="true" />
            Add Item
          </button>
        </div>

        <!-- Collapsible mobile filter & sort drawer -->
        @if (mobileFiltersOpen()) {
          <div
            class="border-border bg-muted/30 grid grid-cols-1 gap-2.5 rounded-lg border p-3 sm:grid-cols-2 @[44rem]:hidden"
          >
            <ng-container
              [ngTemplateOutlet]="filterControls"
              [ngTemplateOutletContext]="{ mobile: true }"
            />
            <label class="grid gap-1 text-xs font-medium">
              <span>Sort by</span>
              <hlm-native-select
                class="w-full"
                [value]="mobileSortValue()"
                (valueChange)="onMobileSortChange($event)"
                aria-label="Sort vault items"
              >
                <option hlmNativeSelectOption value="default">Default order</option>
                <option hlmNativeSelectOption value="name-asc">Name (A–Z)</option>
                <option hlmNativeSelectOption value="name-desc">Name (Z–A)</option>
                <option hlmNativeSelectOption value="username-asc">Username (A–Z)</option>
                <option hlmNativeSelectOption value="status-desc">Issues first</option>
              </hlm-native-select>
            </label>
          </div>
        }
      </search>

      <!-- Summary, active filter chips & mobile select-all -->
      <div class="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <div class="flex flex-wrap items-center gap-2">
          <span aria-live="polite" aria-atomic="true">
            {{ rows().length }} matching item{{ rows().length === 1 ? "" : "s" }}
          </span>
          @if (filterMode() !== "all") {
            <button
              type="button"
              hlmBtn
              variant="secondary"
              size="xs"
              class="rounded-full"
              (click)="filterMode.set('all')"
            >
              {{ filterModeLabel(filterMode()) }} ×
            </button>
          }
          @if (typeFilter() !== "all") {
            <button
              type="button"
              hlmBtn
              variant="secondary"
              size="xs"
              class="rounded-full"
              (click)="typeFilter.set('all')"
            >
              {{ typeFilterLabel(typeFilter()) }} ×
            </button>
          }
          @if (folderFilter() !== "all") {
            <button
              type="button"
              hlmBtn
              variant="secondary"
              size="xs"
              class="rounded-full"
              (click)="folderFilter.set('all')"
            >
              Folder: {{ folderLabel(folderFilter()) }} ×
            </button>
          }
          @if (searchQuery().trim()) {
            <button
              type="button"
              hlmBtn
              variant="secondary"
              size="xs"
              class="rounded-full"
              (click)="searchQuery.set('')"
            >
              “{{ searchQuery().trim() }}” ×
            </button>
          }
          @if (hasActiveFilters()) {
            <button
              type="button"
              hlmBtn
              variant="ghost"
              size="xs"
              class="@[44rem]:hidden"
              (click)="clearFilters()"
            >
              Clear all
            </button>
          }
        </div>

        @if (table.getRowModel().rows.length > 0) {
          <label
            class="text-foreground inline-flex min-h-9 cursor-pointer items-center gap-2 font-medium @[44rem]:hidden"
          >
            <input
              type="checkbox"
              class="accent-primary size-4"
              [checked]="table.getIsAllPageRowsSelected()"
              [indeterminate]="table.getIsSomePageRowsSelected()"
              (change)="table.toggleAllPageRowsSelected($any($event.target).checked)"
            />
            <span>Select page</span>
          </label>
        }
      </div>

      <!-- Bulk action bar -->
      @if (selectedIndices().length > 0) {
        <div
          class="border-border bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <span class="font-medium">
            {{ selectedIndices().length }}
            {{ selectedIndices().length === 1 ? "item" : "items" }} selected
          </span>
          <div class="flex flex-wrap items-center gap-2">
            @if (folders().length > 0) {
              <hlm-native-select
                size="sm"
                [value]="bulkFolderTarget()"
                (valueChange)="bulkFolderTarget.set($event || '')"
                aria-label="Target folder for selected items"
              >
                <option hlmNativeSelectOption value="">No folder</option>
                @for (f of folders(); track f.id) {
                  <option hlmNativeSelectOption [value]="f.id">{{ f.name }}</option>
                }
              </hlm-native-select>
              <button hlmBtn variant="outline" size="xs" (click)="onBulkMove()">
                Move to Folder
              </button>
            }
            <button hlmBtn variant="outline" size="xs" (click)="onBulkRegenerate()">
              <ng-icon name="matRefreshRound" class="size-3.5" aria-hidden="true" />
              Regenerate Passwords
            </button>
            <button hlmBtn variant="danger" size="xs" (click)="onBulkDelete()">
              <ng-icon name="matDeleteRound" class="size-3.5" aria-hidden="true" />
              Delete Selected
            </button>
            <button hlmBtn variant="ghost" size="xs" (click)="rowSelection.set({})">
              Clear Selection
            </button>
          </div>
        </div>
      }

      @if (table.getRowModel().rows.length === 0) {
        <hlm-empty class="border">
          <div hlmEmptyHeader>
            <div hlmEmptyTitle>No vault items match</div>
            <div hlmEmptyDescription>
              Try a different search query or clear your active filters.
            </div>
          </div>
          @if (hasActiveFilters()) {
            <div hlmEmptyContent>
              <button hlmBtn variant="outline" size="sm" (click)="clearFilters()">
                Clear Filters
              </button>
            </div>
          }
        </hlm-empty>
      } @else {
        <!-- Touch-friendly mobile card list -->
        <div role="list" aria-label="Vault items" class="space-y-2.5 @[44rem]:hidden">
          @for (row of table.getRowModel().rows; track row.original.key) {
            <article
              role="listitem"
              class="border-border bg-card rounded-lg border p-3 shadow-xs transition-colors"
              [class.border-primary/50]="row.getIsSelected()"
              [class.bg-primary/5]="row.getIsSelected()"
            >
              <div class="-mt-1 -ml-2 flex items-center gap-1">
                <label class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md">
                  <input
                    type="checkbox"
                    class="accent-primary size-[1.125rem]"
                    [checked]="row.getIsSelected()"
                    (change)="row.toggleSelected($any($event.target).checked)"
                    [attr.aria-label]="'Select ' + row.original.name"
                  />
                </label>
                <button
                  type="button"
                  class="hover:bg-muted grid size-11 shrink-0 place-items-center rounded-md text-xl leading-none"
                  [class.text-warning]="row.original.isFavorite"
                  [class.text-muted-foreground]="!row.original.isFavorite"
                  [attr.aria-pressed]="row.original.isFavorite"
                  (click)="toggleFavorite.emit(row.original.index)"
                  [attr.aria-label]="
                    row.original.isFavorite
                      ? 'Unstar ' + row.original.name
                      : 'Favorite ' + row.original.name
                  "
                >
                  {{ row.original.isFavorite ? "★" : "☆" }}
                </button>
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    class="max-w-full truncate text-left text-sm font-semibold hover:underline"
                    (click)="editRow.emit(row.original)"
                  >
                    {{ row.original.name }}
                  </button>
                  <span hlmBadge variant="secondary" size="sm">
                    {{ itemTypeLabel(row.original) }}
                  </span>
                  @if (row.original.folderName) {
                    <span hlmBadge variant="outline" size="sm">{{ row.original.folderName }}</span>
                  }
                </div>
              </div>

              <div class="mt-1 space-y-1.5">
                @if (row.original.username) {
                  <div class="flex min-w-0 items-center gap-2 text-sm">
                    <span class="text-muted-foreground shrink-0 text-xs">User</span>
                    <span class="min-w-0 flex-1 truncate">{{ row.original.username }}</span>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      (click)="onCopyField(row.original.key, 'username', row.original.username)"
                      [attr.aria-label]="'Copy username for ' + row.original.name"
                    >
                      <ng-icon
                        [name]="
                          copiedKey() === row.original.key + ':username'
                            ? 'matCheckRound'
                            : 'matContentCopyRound'
                        "
                        [class]="
                          copiedKey() === row.original.key + ':username'
                            ? 'text-success-readable size-3.5'
                            : 'size-3.5'
                        "
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                }
                @if (row.original.uris.length > 0) {
                  <div class="flex items-center gap-1.5 text-xs">
                    <p
                      class="text-muted-foreground min-w-0 flex-1 truncate"
                      [title]="row.original.uris.join(', ')"
                    >
                      {{ row.original.uris[0] }}
                    </p>
                    @if (extraUriCount(row.original.uris) > 0) {
                      <span hlmBadge variant="outline" size="sm" class="shrink-0 tabular-nums">
                        +{{ extraUriCount(row.original.uris) }}
                      </span>
                    }
                  </div>
                }
                @if (row.original.password) {
                  <div class="flex items-center gap-2 text-xs">
                    <span class="text-muted-foreground shrink-0">Pass</span>
                    <span class="min-w-0 flex-1 truncate font-mono">
                      {{
                        revealedIds().has(row.original.key) ? row.original.password : "••••••••••••"
                      }}
                    </span>
                  </div>
                }
                <div>
                  <ng-container
                    [ngTemplateOutlet]="statusBadges"
                    [ngTemplateOutletContext]="{ $implicit: row.original }"
                  />
                </div>
              </div>

              <div
                class="border-border mt-2.5 flex items-center justify-between gap-1.5 border-t pt-2"
              >
                <div class="flex items-center gap-1">
                  @if (row.original.password) {
                    <button
                      hlmBtn
                      variant="ghost"
                      size="xs"
                      class="min-h-9"
                      (click)="toggleReveal.emit(row.original.key)"
                      [attr.aria-label]="
                        (revealedIds().has(row.original.key) ? 'Hide' : 'Show') +
                        ' password for ' +
                        row.original.name
                      "
                    >
                      <ng-icon
                        [name]="
                          revealedIds().has(row.original.key)
                            ? 'matVisibilityOffRound'
                            : 'matVisibilityRound'
                        "
                        class="size-4"
                        aria-hidden="true"
                      />
                      {{ revealedIds().has(row.original.key) ? "Hide" : "Show" }}
                    </button>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="xs"
                      class="min-h-9"
                      (click)="onCopyField(row.original.key, 'password', row.original.password)"
                      [attr.aria-label]="'Copy password for ' + row.original.name"
                    >
                      <ng-icon
                        [name]="
                          copiedKey() === row.original.key + ':password'
                            ? 'matCheckRound'
                            : 'matContentCopyRound'
                        "
                        [class]="
                          copiedKey() === row.original.key + ':password'
                            ? 'text-success-readable size-4'
                            : 'size-4'
                        "
                        aria-hidden="true"
                      />
                      {{ copiedKey() === row.original.key + ":password" ? "Copied" : "Copy" }}
                    </button>
                  }
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    hlmBtn
                    variant="outline"
                    size="xs"
                    class="min-h-9"
                    (click)="editRow.emit(row.original)"
                    [attr.aria-label]="'Edit ' + row.original.name"
                  >
                    <ng-icon name="matEditRound" class="size-3.5" aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    hlmBtn
                    variant="danger"
                    size="xs"
                    class="min-h-9"
                    (click)="deleteRow.emit(row.original)"
                    [attr.aria-label]="'Delete ' + row.original.name"
                  >
                    <ng-icon name="matDeleteRound" class="size-3.5" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          }
        </div>

        <!-- Dense sticky-header desktop data table -->
        <div
          hlmTableContainer
          tabindex="0"
          role="region"
          aria-label="Vault items table"
          class="border-border scroll-shadow-y hidden max-h-[560px] [scrollbar-gutter:stable] overscroll-contain rounded-md border @[44rem]:block"
        >
          <table hlmTable>
            <thead hlmTHead class="bg-card/95 sticky top-0 z-10 backdrop-blur">
              @for (headerGroup of table.getHeaderGroups(); track headerGroup.id) {
                <tr hlmTr>
                  @for (header of headerGroup.headers; track header.id) {
                    <th
                      hlmTh
                      scope="col"
                      [attr.aria-sort]="
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : null
                      "
                      [class]="header.id === 'actions' ? 'text-right' : ''"
                    >
                      @if (!header.isPlaceholder) {
                        @if (header.column.getCanSort()) {
                          <button
                            type="button"
                            class="hover:text-foreground inline-flex min-h-6 items-center gap-1 font-medium"
                            (click)="header.column.getToggleSortingHandler()?.($event)"
                          >
                            <ng-container *flexRenderHeader="header; let text">
                              {{ text }}
                            </ng-container>
                            @if (header.column.getIsSorted() === "asc") {
                              <span aria-hidden="true">↑</span>
                            } @else if (header.column.getIsSorted() === "desc") {
                              <span aria-hidden="true">↓</span>
                            }
                          </button>
                        } @else {
                          <ng-container *flexRenderHeader="header; let text">
                            {{ text }}
                          </ng-container>
                        }
                      }
                    </th>
                  }
                </tr>
              }
            </thead>
            <tbody hlmTBody>
              @for (row of table.getRowModel().rows; track row.original.key) {
                <tr
                  hlmTr
                  class="content-auto"
                  [attr.data-state]="row.getIsSelected() ? 'selected' : null"
                >
                  @for (cell of row.getAllCells(); track cell.id) {
                    <td hlmTd [class]="cell.column.id === 'actions' ? 'text-right' : ''">
                      <ng-container *flexRenderCell="cell; let value">
                        {{ value }}
                      </ng-container>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Pagination Controls -->
      @if (rows().length > 0) {
        <div
          class="text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <span class="tabular-nums">
            Page {{ pagination().pageIndex + 1 }} of {{ table.getPageCount() }} ·
            {{ rows().length }} {{ rows().length === 1 ? "item" : "items" }}
          </span>
          <div class="flex items-center gap-2">
            <hlm-native-select
              size="sm"
              [value]="String(pagination().pageSize)"
              (valueChange)="onPageSizeChange($event)"
              aria-label="Rows per page"
            >
              <option hlmNativeSelectOption value="10">10 / page</option>
              <option hlmNativeSelectOption value="25">25 / page</option>
              <option hlmNativeSelectOption value="50">50 / page</option>
            </hlm-native-select>
            <button
              hlmBtn
              variant="outline"
              size="xs"
              class="min-h-8"
              [disabled]="!table.getCanPreviousPage()"
              (click)="table.previousPage()"
            >
              Previous
            </button>
            <button
              hlmBtn
              variant="outline"
              size="xs"
              class="min-h-8"
              [disabled]="!table.getCanNextPage()"
              (click)="table.nextPage()"
            >
              Next
            </button>
          </div>
        </div>
      }
    </div>

    <ng-template #statusFilterSelect let-mobile="mobile">
      <hlm-native-select
        [class.w-full]="mobile"
        [value]="filterMode()"
        (valueChange)="onFilterChange($event)"
        aria-label="Filter items"
      >
        <option hlmNativeSelectOption value="all">All items</option>
        <option hlmNativeSelectOption value="weak">Weak passwords</option>
        <option hlmNativeSelectOption value="reused">Reused passwords</option>
        <option hlmNativeSelectOption value="duplicate">Duplicates</option>
        <option hlmNativeSelectOption value="fido">Has FIDO key</option>
        <option hlmNativeSelectOption value="favorite">Favorites</option>
      </hlm-native-select>
    </ng-template>

    <ng-template #typeFilterSelect let-mobile="mobile">
      <hlm-native-select
        [class.w-full]="mobile"
        [value]="typeFilter()"
        (valueChange)="onTypeFilterChange($event)"
        aria-label="Filter by item type"
      >
        <option hlmNativeSelectOption value="all">All types</option>
        <option hlmNativeSelectOption value="login">Logins</option>
        <option hlmNativeSelectOption value="app">Mobile Apps</option>
        <option hlmNativeSelectOption value="card">Cards</option>
        <option hlmNativeSelectOption value="note">Secure Notes</option>
        <option hlmNativeSelectOption value="identity">Identities</option>
      </hlm-native-select>
    </ng-template>

    <ng-template #folderFilterSelect let-mobile="mobile">
      <hlm-native-select
        [class.w-full]="mobile"
        [value]="folderFilter()"
        (valueChange)="onFolderFilterChange($event)"
        aria-label="Filter by folder"
      >
        <option hlmNativeSelectOption value="all">All folders</option>
        @for (f of folders(); track f.id) {
          <option hlmNativeSelectOption [value]="f.id">{{ f.name }}</option>
        }
      </hlm-native-select>
    </ng-template>

    <ng-template #filterFieldWrapper let-mobile="mobile" let-label="label" let-control="control">
      @if (mobile) {
        <label class="grid gap-1 text-xs font-medium">
          <span>{{ label }}</span>
          <ng-container [ngTemplateOutlet]="control" [ngTemplateOutletContext]="{ mobile }" />
        </label>
      } @else {
        <ng-container [ngTemplateOutlet]="control" [ngTemplateOutletContext]="{ mobile }" />
      }
    </ng-template>

    <ng-template #filterControls let-mobile="mobile">
      <ng-container
        [ngTemplateOutlet]="filterFieldWrapper"
        [ngTemplateOutletContext]="{
          mobile,
          label: 'Status filter',
          control: statusFilterSelect,
        }"
      />
      <ng-container
        [ngTemplateOutlet]="filterFieldWrapper"
        [ngTemplateOutletContext]="{
          mobile,
          label: 'Item type',
          control: typeFilterSelect,
        }"
      />
      @if (folders().length > 0) {
        <ng-container
          [ngTemplateOutlet]="filterFieldWrapper"
          [ngTemplateOutletContext]="{
            mobile,
            label: 'Folder',
            control: folderFilterSelect,
          }"
        />
      }
    </ng-template>

    <ng-template #statusBadges let-row>
      <div class="flex flex-wrap gap-1">
        @if (row.isWeak) {
          <span hlmBadge variant="destructive" size="sm">Weak</span>
        }
        @if (row.isReused) {
          <span hlmBadge variant="warning" size="sm">Reused</span>
        }
        @if (row.isBreached) {
          <span hlmBadge variant="destructive" size="sm">Breached</span>
        }
        @if (row.isDup) {
          <span hlmBadge variant="warning" size="sm">Duplicate</span>
        }
        @if (row.hasFido) {
          <span hlmBadge variant="info" size="sm">FIDO</span>
        }
        @if (!row.isWeak && !row.isReused && !row.isBreached && !row.isDup && !row.hasFido) {
          <span hlmBadge variant="success" size="sm">OK</span>
        }
      </div>
    </ng-template>

    <ng-template #selectHeader>
      <label class="inline-flex size-6 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          class="accent-primary size-4"
          [checked]="table.getIsAllPageRowsSelected()"
          [indeterminate]="table.getIsSomePageRowsSelected()"
          (change)="table.toggleAllPageRowsSelected($any($event.target).checked)"
          aria-label="Select all rows on page"
        />
      </label>
    </ng-template>

    <ng-template #selectCell let-context>
      <label class="inline-flex size-6 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          class="accent-primary size-4"
          [checked]="context.row.getIsSelected()"
          (change)="context.row.toggleSelected($any($event.target).checked)"
          [attr.aria-label]="'Select ' + context.row.original.name"
        />
      </label>
    </ng-template>

    <ng-template #nameCell let-context>
      <div class="flex min-w-0 flex-nowrap items-center gap-1.5">
        <button
          type="button"
          class="touch-target inline-flex size-6 shrink-0 items-center justify-center rounded text-sm leading-none transition-colors hover:scale-110"
          [class]="context.row.original.isFavorite ? 'text-warning' : 'text-muted-foreground/50'"
          (click)="toggleFavorite.emit(context.row.original.index)"
          [attr.aria-pressed]="context.row.original.isFavorite"
          [attr.aria-label]="
            context.row.original.isFavorite
              ? 'Unstar ' + context.row.original.name
              : 'Favorite ' + context.row.original.name
          "
        >
          {{ context.row.original.isFavorite ? "★" : "☆" }}
        </button>
        <button
          type="button"
          class="min-h-6 max-w-44 truncate text-left hover:underline"
          (click)="editRow.emit(context.row.original)"
        >
          <span class="font-medium">{{ context.row.original.name }}</span>
        </button>
        @if (context.row.original.itemType !== 1 || context.row.original.isMobileApp) {
          <span hlmBadge variant="secondary" size="sm" class="shrink-0">
            {{ itemTypeLabel(context.row.original) }}
          </span>
        }
        @if (context.row.original.folderName) {
          <span hlmBadge variant="outline" size="sm" class="max-w-28 shrink-0 truncate">{{
            context.row.original.folderName
          }}</span>
        }
      </div>
    </ng-template>

    <ng-template #usernameCell let-context>
      <div class="flex items-center gap-1.5">
        <span class="max-w-44 truncate">{{ context.row.original.username || "—" }}</span>
        @if (context.row.original.username) {
          <button
            hlmBtn
            variant="ghost"
            size="icon-xs"
            (click)="
              onCopyField(context.row.original.key, 'username', context.row.original.username)
            "
            [attr.aria-label]="'Copy username for ' + context.row.original.name"
          >
            <ng-icon
              [name]="
                copiedKey() === context.row.original.key + ':username'
                  ? 'matCheckRound'
                  : 'matContentCopyRound'
              "
              [class]="
                copiedKey() === context.row.original.key + ':username'
                  ? 'text-success-readable size-3.5'
                  : 'size-3.5'
              "
              aria-hidden="true"
            />
          </button>
        }
      </div>
    </ng-template>

    <ng-template #passwordCell let-context>
      <div class="flex items-center gap-1.5 font-mono text-xs">
        <span>
          {{
            context.row.original.password
              ? revealedIds().has(context.row.original.key)
                ? context.row.original.password
                : "••••••••••••"
              : "—"
          }}
        </span>
        @if (context.row.original.password) {
          <button
            hlmBtn
            variant="ghost"
            size="icon-xs"
            (click)="toggleReveal.emit(context.row.original.key)"
            [attr.aria-label]="
              (revealedIds().has(context.row.original.key) ? 'Hide' : 'Show') +
              ' password for ' +
              context.row.original.name
            "
          >
            <ng-icon
              [name]="
                revealedIds().has(context.row.original.key)
                  ? 'matVisibilityOffRound'
                  : 'matVisibilityRound'
              "
              class="size-3.5"
              aria-hidden="true"
            />
          </button>
          <button
            hlmBtn
            variant="ghost"
            size="icon-xs"
            (click)="
              onCopyField(context.row.original.key, 'password', context.row.original.password)
            "
            [attr.aria-label]="'Copy password for ' + context.row.original.name"
          >
            <ng-icon
              [name]="
                copiedKey() === context.row.original.key + ':password'
                  ? 'matCheckRound'
                  : 'matContentCopyRound'
              "
              [class]="
                copiedKey() === context.row.original.key + ':password'
                  ? 'text-success-readable size-3.5'
                  : 'size-3.5'
              "
              aria-hidden="true"
            />
          </button>
        }
      </div>
    </ng-template>

    <ng-template #urisCell let-context>
      @if (context.row.original.uris.length > 0) {
        <div class="flex max-w-52 items-center gap-1.5 text-xs">
          <span
            class="text-muted-foreground min-w-0 truncate"
            [title]="context.row.original.uris.join(', ')"
          >
            {{ context.row.original.uris[0] }}
          </span>
          @if (extraUriCount(context.row.original.uris) > 0) {
            <span hlmBadge variant="outline" size="sm" class="shrink-0 tabular-nums">
              +{{ extraUriCount(context.row.original.uris) }}
            </span>
          }
        </div>
      } @else {
        <span class="text-muted-foreground text-xs">—</span>
      }
    </ng-template>

    <ng-template #statusCell let-context>
      <ng-container
        [ngTemplateOutlet]="statusBadges"
        [ngTemplateOutletContext]="{ $implicit: context.row.original }"
      />
    </ng-template>

    <ng-template #actionsCell let-context>
      <div class="inline-flex gap-1.5">
        <button
          hlmBtn
          variant="outline"
          size="xs"
          [attr.aria-label]="'Edit ' + context.row.original.name"
          (click)="editRow.emit(context.row.original)"
        >
          <ng-icon name="matEditRound" class="size-3.5" aria-hidden="true" />
          Edit
        </button>
        <button
          hlmBtn
          variant="danger"
          size="xs"
          [attr.aria-label]="'Delete ' + context.row.original.name"
          (click)="deleteRow.emit(context.row.original)"
        >
          <ng-icon name="matDeleteRound" class="size-3.5" aria-hidden="true" />
          Delete
        </button>
      </div>
    </ng-template>
  `,
})
export class VaultExplorerComponent {
  protected readonly String = String;

  readonly rows = input.required<ExplorerRow[]>();
  /** Changes whenever the open vault is replaced or cleared; drops selection from the old vault. */
  readonly vaultGeneration = input(0);
  readonly folders = input<VaultFolder[]>([]);
  readonly revealedIds = input.required<Set<string>>();
  readonly searchQuery = model("");
  readonly filterMode = model<ExplorerFilterMode>("all");
  readonly typeFilter = model<ExplorerTypeFilter>("all");
  readonly folderFilter = model<string>("all");

  readonly toggleReveal = output<string>();
  readonly toggleFavorite = output<number>();
  readonly copyValue = output<{ label: string; value: string }>();
  readonly addItem = output<void>();
  readonly editRow = output<ExplorerRow>();
  readonly deleteRow = output<ExplorerRow>();
  readonly bulkDelete = output<number[]>();
  readonly bulkRegenerate = output<number[]>();
  readonly bulkMoveFolder = output<{ indices: number[]; folderId: string | null }>();

  private readonly searchBox = viewChild<SearchBoxComponent>("searchBox");
  private readonly searchContainer = viewChild<ElementRef<HTMLElement>>("searchContainer");
  private readonly selectHeader = viewChild.required<TemplateRef<unknown>>("selectHeader");
  private readonly selectCell = viewChild.required<TemplateRef<unknown>>("selectCell");
  private readonly nameCell = viewChild.required<TemplateRef<unknown>>("nameCell");
  private readonly usernameCell = viewChild.required<TemplateRef<unknown>>("usernameCell");
  private readonly passwordCell = viewChild.required<TemplateRef<unknown>>("passwordCell");
  private readonly urisCell = viewChild.required<TemplateRef<unknown>>("urisCell");
  private readonly statusCell = viewChild.required<TemplateRef<unknown>>("statusCell");
  private readonly actionsCell = viewChild.required<TemplateRef<unknown>>("actionsCell");

  protected readonly sorting = signal<SortingState>([]);
  protected readonly pagination = signal<PaginationState>({ pageIndex: 0, pageSize: 10 });
  protected readonly rowSelection = signal<RowSelectionState>({});
  protected readonly bulkFolderTarget = signal("");
  protected readonly mobileFiltersOpen = signal(false);
  protected readonly copiedKey = signal<string | null>(null);
  private readonly destroyRef = inject(DestroyRef);
  private copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly hasActiveFilters = computed(
    () =>
      Boolean(this.searchQuery().trim()) ||
      this.filterMode() !== "all" ||
      this.typeFilter() !== "all" ||
      this.folderFilter() !== "all",
  );

  protected readonly activeFilterCount = computed(
    () =>
      (this.filterMode() !== "all" ? 1 : 0) +
      (this.typeFilter() !== "all" ? 1 : 0) +
      (this.folderFilter() !== "all" ? 1 : 0),
  );

  protected readonly mobileSortValue = computed(() => {
    const active = this.sorting()[0];
    if (!active) return "default";
    if (active.id === "name") return active.desc ? "name-desc" : "name-asc";
    if (active.id === "username") return "username-asc";
    if (active.id === "status") return "status-desc";
    return "default";
  });

  private readonly columns = [
    columnHelper.display({
      id: "select",
      header: () => this.selectHeader(),
      cell: () => this.selectCell(),
    }),
    columnHelper.accessor("name", {
      header: "Name",
      enableSorting: true,
      cell: () => this.nameCell(),
    }),
    columnHelper.accessor((row) => row.username || "—", {
      id: "username",
      header: "Username",
      enableSorting: true,
      cell: () => this.usernameCell(),
    }),
    columnHelper.display({
      id: "password",
      header: "Password",
      cell: () => this.passwordCell(),
    }),
    columnHelper.display({
      id: "uris",
      header: "URIs",
      cell: () => this.urisCell(),
    }),
    columnHelper.accessor(
      (row) =>
        (row.isBreached ? 16 : 0) +
        (row.isWeak ? 8 : 0) +
        (row.isReused ? 4 : 0) +
        (row.isDup ? 2 : 0) +
        (row.hasFido ? 1 : 0),
      {
        id: "status",
        header: "Status",
        enableSorting: true,
        cell: () => this.statusCell(),
      },
    ),
    columnHelper.display({
      id: "actions",
      header: "Actions",
      cell: () => this.actionsCell(),
    }),
  ] as unknown as ColumnDef<typeof features, ExplorerRow, unknown>[];

  protected readonly table = injectTable(() => ({
    features,
    columns: this.columns,
    data: this.rows(),
    getRowId: (row) => row.key,
    state: {
      sorting: this.sorting(),
      pagination: this.pagination(),
      rowSelection: this.rowSelection(),
    },
    onSortingChange: (updater) =>
      typeof updater === "function" ? this.sorting.update(updater) : this.sorting.set(updater),
    onPaginationChange: (updater) =>
      typeof updater === "function"
        ? this.pagination.update(updater)
        : this.pagination.set(updater),
    onRowSelectionChange: (updater) =>
      typeof updater === "function"
        ? this.rowSelection.update(updater)
        : this.rowSelection.set(updater),
  }));

  protected readonly selectedIndices = computed(() => {
    const selection = this.rowSelection();
    const keyToIndex = new Map(this.rows().map((r) => [r.key, r.index]));
    const indices: number[] = [];
    for (const [key, isSelected] of Object.entries(selection)) {
      if (isSelected && keyToIndex.has(key)) {
        indices.push(keyToIndex.get(key)!);
      }
    }
    return indices;
  });

  /** Previous row set and the item snapshots of selected id-less rows (see selection effect). */
  private previousRows: ExplorerRow[] = [];
  private readonly selectedSnapshots = new Map<string, string>();

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.copyResetTimer));

    effect(() => {
      this.vaultGeneration();
      untracked(() => {
        this.rowSelection.set({});
        this.selectedSnapshots.clear();
        this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
      });
    });

    // Any filter change (including ones made by the parent, e.g. stat-card jumps or a vault
    // replace) restarts at the first page.
    effect(() => {
      this.searchQuery();
      this.filterMode();
      this.typeFilter();
      this.folderFilter();
      untracked(() => {
        if (this.pagination().pageIndex !== 0) {
          this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
        }
      });
    });

    // Deleting/merging/undoing shrinks the row set; never strand the table on a page that no
    // longer exists (it would render as "no items" while items remain).
    effect(() => {
      const total = this.rows().length;
      const { pageIndex, pageSize } = this.pagination();
      const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
      if (pageIndex > lastPage) {
        untracked(() => this.pagination.update((p) => ({ ...p, pageIndex: lastPage })));
      }
    });

    // Rows are keyed by item id, or by position for id-less items. A positional key can start
    // pointing at a different item once the list shifts, so a selection of an id-less row only
    // survives while that row still holds the item that was selected.
    effect(() => {
      const rows = this.rows();
      const selection = this.rowSelection();
      untracked(() => {
        const previous = new Map(this.previousRows.map((row) => [row.key, row]));
        const current = new Map(rows.map((row) => [row.key, row]));
        const next = { ...selection };
        let changed = false;
        for (const [key, selected] of Object.entries(selection)) {
          if (!selected) {
            this.selectedSnapshots.delete(key);
            continue;
          }
          if (!this.selectedSnapshots.has(key)) {
            const source = previous.get(key) ?? current.get(key);
            if (source && !source.item.id) {
              this.selectedSnapshots.set(key, JSON.stringify(source.item));
            }
          }
          const snapshot = this.selectedSnapshots.get(key);
          const row = current.get(key);
          if (row && snapshot !== undefined && JSON.stringify(row.item) !== snapshot) {
            delete next[key];
            this.selectedSnapshots.delete(key);
            changed = true;
          }
        }
        for (const key of this.selectedSnapshots.keys()) {
          if (!selection[key]) this.selectedSnapshots.delete(key);
        }
        this.previousRows = rows;
        if (changed) this.rowSelection.set(next);
      });
    });
  }

  protected itemTypeLabel(row: ExplorerRow): string {
    switch (row.itemType) {
      case 2:
        return "Note";
      case 3:
        return "Card";
      case 4:
        return "Identity";
      default:
        return row.isMobileApp ? "Mobile app" : "Login";
    }
  }

  protected filterModeLabel(mode: ExplorerFilterMode): string {
    return mode === "all" ? "All items" : FILTER_MODE_LABELS[mode];
  }

  protected typeFilterLabel(type: ExplorerTypeFilter): string {
    return type === "all" ? "All types" : TYPE_FILTER_LABELS[type];
  }

  protected folderLabel(folderId: string): string {
    return this.folders().find((f) => f.id === folderId)?.name || folderId;
  }

  protected onMobileSortChange(value: string | null | undefined): void {
    switch (value) {
      case "name-asc":
        this.sorting.set([{ id: "name", desc: false }]);
        break;
      case "name-desc":
        this.sorting.set([{ id: "name", desc: true }]);
        break;
      case "username-asc":
        this.sorting.set([{ id: "username", desc: false }]);
        break;
      case "status-desc":
        this.sorting.set([{ id: "status", desc: true }]);
        break;
      default:
        this.sorting.set([]);
        break;
    }
    this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
  }

  protected onKeydown(e: KeyboardEvent): void {
    const target = document.activeElement as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector("dialog[open], [role='dialog'], [role='alertdialog']")) return;
    if (e.key === "/") {
      const containerEl = this.searchContainer()?.nativeElement;
      const box = this.searchBox();
      // The explorer tab is kept in the DOM while hidden; do not swallow "/" for an invisible field.
      if (!box || !containerEl || containerEl.getClientRects().length === 0) return;
      e.preventDefault();
      box.focus();
    }
  }

  protected onBulkRegenerate(): void {
    const indices = this.selectedIndices();
    if (indices.length === 0) return;
    this.bulkRegenerate.emit(indices);
    this.rowSelection.set({});
  }

  protected onBulkDelete(): void {
    const indices = this.selectedIndices();
    if (indices.length === 0) return;
    this.bulkDelete.emit(indices);
    this.rowSelection.set({});
  }

  protected onBulkMove(): void {
    const indices = this.selectedIndices();
    if (indices.length === 0) return;
    this.bulkMoveFolder.emit({
      indices,
      folderId: this.bulkFolderTarget() || null,
    });
    this.rowSelection.set({});
  }

  protected onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
  }

  protected onFilterChange(value: string | null | undefined): void {
    const next: ExplorerFilterMode =
      value === "weak" ||
      value === "reused" ||
      value === "duplicate" ||
      value === "fido" ||
      value === "favorite"
        ? value
        : "all";
    this.filterMode.set(next);
    this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
  }

  protected onTypeFilterChange(value: string | null | undefined): void {
    const next: ExplorerTypeFilter =
      value === "login" ||
      value === "note" ||
      value === "card" ||
      value === "identity" ||
      value === "app"
        ? value
        : "all";
    this.typeFilter.set(next);
    this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
  }

  protected onFolderFilterChange(value: string | null | undefined): void {
    this.folderFilter.set(value || "all");
    this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
  }

  protected onPageSizeChange(value: string | null | undefined): void {
    const pageSize = Number(value) || 10;
    this.pagination.set({ pageIndex: 0, pageSize });
  }

  protected clearFilters(): void {
    this.searchQuery.set("");
    this.filterMode.set("all");
    this.typeFilter.set("all");
    this.folderFilter.set("all");
    this.pagination.update((p) => ({ ...p, pageIndex: 0 }));
  }

  protected onCopyField(rowKey: string, label: "username" | "password", value: string): void {
    this.copyValue.emit({ label, value });
    clearTimeout(this.copyResetTimer);
    this.copiedKey.set(`${rowKey}:${label}`);
    this.copyResetTimer = setTimeout(() => {
      if (this.copiedKey() === `${rowKey}:${label}`) {
        this.copiedKey.set(null);
      }
    }, 1800);
  }

  protected extraUriCount(uris: string[]): number {
    return Math.max(0, uris.length - 1);
  }
}

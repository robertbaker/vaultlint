import { Component, computed, inject, input, OnInit, output, signal } from "@angular/core";
import { NgIcon } from "@ng-icons/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmButtonGroupImports } from "@spartan-ng/helm/button-group";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmInputImports } from "@spartan-ng/helm/input";
import { HlmLabelImports } from "@spartan-ng/helm/label";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import {
  LINT_RULE_MAP,
  LINT_RULES,
  parseLintConfigJson,
  type ActiveLintSeverity,
  type LintFinding,
  type LintFixMode,
  type LintPresetName,
  type LintResult,
  type LintRuleId,
  type LintSeverity,
  type VaultLintConfig,
} from "@vaultlint/vault-ops";

import { downloadBlob } from "../../core/download";
import { BROWSER_STORAGE } from "../../core/storage.token";

interface NamedLintProfile {
  id: string;
  name: string;
  config: VaultLintConfig;
}

interface SavedLintProfiles {
  version: 1;
  selectedId: string;
  profiles: NamedLintProfile[];
}

interface GroupedLintRule {
  ruleId: LintRuleId;
  title: string;
  description: string;
  severity: ActiveLintSeverity;
  fixable: LintFixMode;
  findings: LintFinding[];
}

const SEVERITY_RANK: Record<ActiveLintSeverity, number> = {
  error: 0,
  warning: 1,
  hint: 2,
};

@Component({
  selector: "app-lint-panel",
  imports: [
    NgIcon,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmButtonGroupImports,
    ...HlmCardImports,
    ...HlmEmptyImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmNativeSelectImports,
  ],
  template: `
    <div class="@container space-y-4">
      <!-- Compact Primary Toolbar -->
      <section hlmCard size="sm">
        <div hlmCardContent class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div class="flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-2 text-xs font-medium">
              <span>Ruleset</span>
              <hlm-native-select
                size="sm"
                [value]="ruleset()"
                (valueChange)="onRulesetChange($event)"
                aria-label="Lint ruleset preset"
              >
                <option hlmNativeSelectOption value="recommended">Recommended</option>
                <option hlmNativeSelectOption value="strict">Strict</option>
                <option hlmNativeSelectOption value="minimal">Minimal</option>
              </hlm-native-select>
            </label>

            <label class="flex items-center gap-2 text-xs font-medium">
              <span>Profile</span>
              <hlm-native-select
                size="sm"
                [value]="selectedProfileId()"
                (valueChange)="selectProfile($event)"
                aria-label="Named lint profile"
              >
                @for (profile of profiles(); track profile.id) {
                  <option hlmNativeSelectOption [value]="profile.id">{{ profile.name }}</option>
                }
              </hlm-native-select>
            </label>

            <button
              hlmBtn
              type="button"
              variant="outline"
              size="sm"
              [attr.aria-expanded]="showRulesConfig()"
              (click)="showRulesConfig.set(!showRulesConfig())"
            >
              <ng-icon name="matTuneRound" class="size-4" aria-hidden="true" />
              <span>{{ showRulesConfig() ? "Hide Settings" : "Profiles & Rules" }}</span>
              @if (overrideCount() > 0) {
                <span hlmBadge variant="secondary" size="sm" class="tabular-nums">
                  {{ overrideCount() }}
                </span>
              }
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              hlmBtn
              type="button"
              [variant]="(lintResult()?.counts?.fixableSafe ?? 0) > 0 ? 'default' : 'outline'"
              size="sm"
              [disabled]="(lintResult()?.counts?.fixableSafe ?? 0) === 0"
              (click)="autofixSafe.emit()"
            >
              Auto-Fix Safe ({{ lintResult()?.counts?.fixableSafe ?? 0 }})
            </button>
            <button
              hlmBtn
              type="button"
              [variant]="
                (lintResult()?.counts?.fixableSafe ?? 0) === 0 &&
                (lintResult()?.counts?.fixableUnsafe ?? 0) > 0
                  ? 'default'
                  : 'outline'
              "
              size="sm"
              [disabled]="
                (lintResult()?.counts?.fixableSafe ?? 0) +
                  (lintResult()?.counts?.fixableUnsafe ?? 0) ===
                0
              "
              (click)="autofixAll.emit()"
            >
              Auto-Fix All incl. Unsafe ({{
                (lintResult()?.counts?.fixableSafe ?? 0) +
                  (lintResult()?.counts?.fixableUnsafe ?? 0)
              }})
            </button>
          </div>
        </div>
      </section>

      <!-- Collapsible Profiles & Rule Severities Panel -->
      @if (showRulesConfig()) {
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h3 hlmCardTitle>Profiles &amp; Rule Severities</h3>
            <p hlmCardDescription>
              Save named lint profiles locally or customize individual rule levels (error, warning,
              hint, or off).
            </p>
          </div>
          <div hlmCardContent class="space-y-4">
            <div class="border-border bg-muted/20 space-y-3 rounded-lg border p-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1">
                  <label hlmLabel for="lint-new-profile" class="text-xs">Save as new profile</label>
                  <div class="flex gap-2">
                    <input
                      hlmInput
                      id="lint-new-profile"
                      class="h-8 flex-1 text-xs"
                      [value]="newProfileName()"
                      (input)="newProfileName.set($any($event.target).value)"
                      placeholder="Profile name"
                    />
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="sm"
                      [disabled]="!newProfileName().trim()"
                      (click)="saveAsNewProfile()"
                    >
                      Save As
                    </button>
                  </div>
                </div>

                <div class="space-y-1">
                  <label hlmLabel for="lint-rename-profile" class="text-xs"
                    >Rename current profile</label
                  >
                  <div class="flex gap-2">
                    <input
                      hlmInput
                      id="lint-rename-profile"
                      class="h-8 flex-1 text-xs"
                      [value]="renameProfileName()"
                      (input)="renameProfileName.set($any($event.target).value)"
                      placeholder="Rename profile"
                    />
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="sm"
                      [disabled]="!renameProfileName().trim()"
                      (click)="renameSelectedProfile()"
                    >
                      Rename
                    </button>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button hlmBtn type="button" variant="outline" size="xs" (click)="exportProfile()">
                  Export JSON
                </button>
                <label
                  hlmBtn
                  variant="outline"
                  size="xs"
                  class="focus-within:ring-ring cursor-pointer focus-within:ring-2 focus-within:ring-offset-2"
                >
                  Import JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    class="sr-only"
                    (change)="importProfileFile($event)"
                  />
                </label>
                <button
                  hlmBtn
                  type="button"
                  variant="ghost"
                  size="xs"
                  [disabled]="profiles().length < 2"
                  (click)="deleteSelectedProfile()"
                >
                  Delete Profile
                </button>
                @if (hasOverrides()) {
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="xs"
                    (click)="resetCurrentOverrides()"
                  >
                    Reset Overrides
                  </button>
                }
              </div>
            </div>

            <div class="grid gap-2 sm:grid-cols-2">
              @for (rule of allRules; track rule.id) {
                <div
                  class="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-xs font-semibold">{{ rule.id }}</span>
                      @if (rule.fixable) {
                        <span hlmBadge variant="secondary" class="text-[10px]">
                          {{ rule.fixable }} fix
                        </span>
                      }
                    </div>
                    <p class="text-muted-foreground truncate text-xs" [title]="rule.description">
                      {{ rule.description }}
                    </p>
                  </div>
                  <hlm-native-select
                    size="sm"
                    [value]="effectiveSeverity(rule.id)"
                    (valueChange)="onRuleSeverityChange(rule.id, $event)"
                    [attr.aria-label]="'Severity for ' + rule.id"
                  >
                    <option hlmNativeSelectOption value="error">error</option>
                    <option hlmNativeSelectOption value="warning">warning</option>
                    <option hlmNativeSelectOption value="hint">hint</option>
                    <option hlmNativeSelectOption value="off">off</option>
                  </hlm-native-select>
                </div>
              }
            </div>
          </div>
        </section>
      }

      <!-- Summary Chips, Severity Filter & View Mode -->
      @if (lintResult(); as res) {
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="scroll-fade-x flex max-w-full flex-nowrap items-center gap-2 py-0.5">
            <button
              hlmBtn
              type="button"
              class="shrink-0 tabular-nums"
              [variant]="severityFilter() === 'all' ? 'default' : 'outline'"
              size="sm"
              (click)="severityFilter.set('all')"
            >
              All ({{ res.counts.total }})
            </button>
            <button
              hlmBtn
              type="button"
              class="shrink-0 tabular-nums"
              [variant]="severityFilter() === 'error' ? 'destructive' : 'outline'"
              size="sm"
              (click)="severityFilter.set('error')"
            >
              Errors ({{ res.counts.error }})
            </button>
            <button
              hlmBtn
              type="button"
              class="shrink-0 tabular-nums"
              [variant]="severityFilter() === 'warning' ? 'default' : 'outline'"
              size="sm"
              (click)="severityFilter.set('warning')"
            >
              Warnings ({{ res.counts.warning }})
            </button>
            <button
              hlmBtn
              type="button"
              class="shrink-0 tabular-nums"
              [variant]="severityFilter() === 'hint' ? 'default' : 'outline'"
              size="sm"
              (click)="severityFilter.set('hint')"
            >
              Hints ({{ res.counts.hint }})
            </button>
          </div>

          <hlm-button-group aria-label="Findings view mode">
            <button
              hlmBtn
              type="button"
              size="xs"
              [variant]="viewMode() === 'grouped' ? 'default' : 'outline'"
              [attr.aria-pressed]="viewMode() === 'grouped'"
              (click)="viewMode.set('grouped')"
            >
              By rule
            </button>
            <button
              hlmBtn
              type="button"
              size="xs"
              [variant]="viewMode() === 'flat' ? 'default' : 'outline'"
              [attr.aria-pressed]="viewMode() === 'flat'"
              (click)="viewMode.set('flat')"
            >
              All findings
            </button>
          </hlm-button-group>
        </div>

        <!-- Findings Presentation -->
        @if (filteredFindings().length === 0) {
          <hlm-empty class="border">
            <div hlmEmptyHeader>
              <div hlmEmptyMedia variant="icon">
                <ng-icon name="matCheckCircleRound" class="text-success-readable size-5" />
              </div>
              <div hlmEmptyTitle>No lint findings</div>
              <div hlmEmptyDescription>No lint findings match the current filter and ruleset.</div>
            </div>
          </hlm-empty>
        } @else if (viewMode() === "grouped") {
          <div class="space-y-2.5">
            @for (group of groupedFindings(); track group.ruleId; let i = $index) {
              <details
                class="animated-details group border-border bg-card rounded-lg border"
                [open]="i < 3"
              >
                <summary
                  class="hover:bg-muted/40 flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden"
                >
                  <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <ng-icon
                      name="matKeyboardArrowDownRound"
                      class="text-muted-foreground size-4 shrink-0 -rotate-90 transition-transform duration-150 group-open:rotate-0"
                      aria-hidden="true"
                    />
                    <span
                      hlmBadge
                      [variant]="
                        group.severity === 'error'
                          ? 'destructive'
                          : group.severity === 'warning'
                            ? 'warning'
                            : 'outline'
                      "
                      class="uppercase"
                    >
                      {{ group.severity }}
                    </span>
                    <span class="font-mono text-xs font-semibold">{{ group.ruleId }}</span>
                    <span hlmBadge variant="secondary" size="sm" class="tabular-nums">
                      {{ group.findings.length }} item{{ group.findings.length === 1 ? "" : "s" }}
                    </span>
                    @if (group.fixable) {
                      <span hlmBadge variant="outline" size="sm">
                        {{ group.fixable }} autofix
                      </span>
                    }
                    <span class="text-muted-foreground hidden text-xs sm:inline">
                      {{ group.description }}
                    </span>
                  </div>
                  @if (group.fixable === "safe") {
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="xs"
                      (click)="onFixRuleClick($event, group.ruleId)"
                    >
                      Fix all ({{ group.findings.length }})
                    </button>
                  }
                </summary>

                <div class="border-border divide-border divide-y border-t px-3.5">
                  @for (finding of group.findings; track $index) {
                    <div
                      class="content-auto flex flex-wrap items-center justify-between gap-2 py-2.5"
                    >
                      <div class="min-w-0 flex-1 space-y-0.5">
                        <div class="text-sm font-medium">{{ finding.itemName }}</div>
                        <p class="text-muted-foreground text-xs">{{ finding.message }}</p>
                      </div>
                      <button
                        hlmBtn
                        type="button"
                        variant="outline"
                        size="sm"
                        class="min-h-9"
                        (click)="editItem.emit(finding.itemIndex)"
                      >
                        Edit Item
                      </button>
                    </div>
                  }
                </div>
              </details>
            }
          </div>
        } @else {
          <section hlmCard size="sm">
            <div hlmCardContent class="divide-border divide-y py-1">
              @for (finding of filteredFindings(); track $index) {
                <div class="content-auto flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div class="min-w-0 flex-1 space-y-0.5">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        hlmBadge
                        [variant]="
                          finding.severity === 'error'
                            ? 'destructive'
                            : finding.severity === 'warning'
                              ? 'warning'
                              : 'outline'
                        "
                        class="uppercase"
                      >
                        {{ finding.severity }}
                      </span>
                      <span class="font-mono text-xs font-semibold">{{ finding.ruleId }}</span>
                      <span class="text-sm font-medium">{{ finding.itemName }}</span>
                      @if (finding.fixable) {
                        <span hlmBadge variant="outline" class="text-[10px]">
                          {{ finding.fixable }} autofix
                        </span>
                      }
                    </div>
                    <p class="text-muted-foreground text-xs">{{ finding.message }}</p>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (finding.fixable === "safe") {
                      <button
                        hlmBtn
                        type="button"
                        variant="outline"
                        size="sm"
                        class="min-h-9"
                        (click)="autofixRule.emit(finding.ruleId)"
                      >
                        Fix Rule
                      </button>
                    }
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      size="sm"
                      class="min-h-9"
                      (click)="editItem.emit(finding.itemIndex)"
                    >
                      Edit Item
                    </button>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class LintPanelComponent implements OnInit {
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly savedProfiles = this.loadProfiles();
  readonly lintResult = input<LintResult | null>(null);
  readonly ruleset = input<LintPresetName>("recommended");
  readonly overrides = input<Partial<Record<LintRuleId, LintSeverity>>>({});

  readonly rulesetChange = output<LintPresetName>();
  readonly ruleSeverityChange = output<{ ruleId: LintRuleId; severity: LintSeverity }>();
  readonly resetRules = output<void>();
  readonly profileImported = output<VaultLintConfig>();
  /** Re-applies the saved profile on mount without announcing it. */
  readonly profileRestored = output<VaultLintConfig>();
  readonly profileImportFailed = output<string>();
  readonly autofixSafe = output<void>();
  readonly autofixAll = output<void>();
  readonly autofixRule = output<LintRuleId>();
  readonly editItem = output<number>();

  protected readonly allRules = LINT_RULES;
  protected readonly showRulesConfig = signal(false);
  protected readonly viewMode = signal<"grouped" | "flat">("grouped");
  protected readonly severityFilter = signal<"all" | ActiveLintSeverity>("all");
  protected readonly profiles = signal<NamedLintProfile[]>(this.savedProfiles.profiles);
  protected readonly selectedProfileId = signal(this.savedProfiles.selectedId);
  protected readonly newProfileName = signal("");
  protected readonly renameProfileName = signal("");

  protected readonly overrideCount = computed(() => Object.keys(this.overrides()).length);
  protected readonly hasOverrides = computed(() => this.overrideCount() > 0);

  ngOnInit(): void {
    const selected = this.profiles().find((profile) => profile.id === this.selectedProfileId());
    if (selected) {
      this.renameProfileName.set(selected.name);
      this.profileRestored.emit(selected.config);
    }
  }

  protected readonly filteredFindings = computed(() => {
    const res = this.lintResult();
    if (!res) return [];
    const filter = this.severityFilter();
    return filter === "all" ? res.findings : res.findings.filter((f) => f.severity === filter);
  });

  protected readonly groupedFindings = computed<GroupedLintRule[]>(() => {
    const groups = new Map<LintRuleId, GroupedLintRule>();
    for (const finding of this.filteredFindings()) {
      const existing = groups.get(finding.ruleId);
      if (existing) {
        existing.findings.push(finding);
        if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
          existing.severity = finding.severity;
        }
        if (finding.fixable === "safe") existing.fixable = "safe";
        else if (finding.fixable === "unsafe" && !existing.fixable) existing.fixable = "unsafe";
      } else {
        const meta = LINT_RULE_MAP.get(finding.ruleId);
        groups.set(finding.ruleId, {
          ruleId: finding.ruleId,
          title: meta?.title ?? finding.ruleId,
          description: meta?.description ?? "",
          severity: finding.severity,
          fixable: finding.fixable,
          findings: [finding],
        });
      }
    }
    return [...groups.values()].sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.findings.length - a.findings.length,
    );
  });

  protected effectiveSeverity(ruleId: LintRuleId): LintSeverity {
    return this.lintResult()?.effectiveRules[ruleId] ?? "off";
  }

  protected onFixRuleClick(event: Event, ruleId: LintRuleId): void {
    event.preventDefault();
    event.stopPropagation();
    this.autofixRule.emit(ruleId);
  }

  protected onRulesetChange(value: string | null | undefined): void {
    if (value === "recommended" || value === "strict" || value === "minimal") {
      this.rulesetChange.emit(value as LintPresetName);
      this.persistCurrentConfig({ extends: value, rules: {} });
    }
  }

  protected onRuleSeverityChange(ruleId: LintRuleId, value: string | null | undefined): void {
    if (value === "error" || value === "warning" || value === "hint" || value === "off") {
      this.ruleSeverityChange.emit({ ruleId, severity: value as LintSeverity });
      this.persistCurrentConfig({
        extends: this.ruleset(),
        rules: { ...this.overrides(), [ruleId]: value },
      });
    }
  }

  protected resetCurrentOverrides(): void {
    this.resetRules.emit();
    this.persistCurrentConfig({ extends: this.ruleset(), rules: {} });
  }

  protected exportProfile(): void {
    const profile = this.profiles().find((entry) => entry.id === this.selectedProfileId());
    const config = profile?.config ?? { extends: this.ruleset(), rules: this.overrides() };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${this.safeFileName(profile?.name ?? "vaultlint-profile")}.json`);
  }

  protected async importProfileFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const config = parseLintConfigJson(await file.text());
      const name = file.name.replace(/\.json$/i, "").trim() || "Imported profile";
      const profile = { id: this.newId(), name, config };
      this.profiles.update((profiles) => [...profiles, profile]);
      this.selectedProfileId.set(profile.id);
      this.renameProfileName.set(name);
      this.persistProfiles();
      this.profileImported.emit(config);
    } catch (err) {
      this.profileImportFailed.emit((err as Error).message);
    }
    input.value = "";
  }

  protected selectProfile(id: string | null | undefined): void {
    if (!id) return;
    const profile = this.profiles().find((entry) => entry.id === id);
    if (!profile) return;
    this.selectedProfileId.set(id);
    this.renameProfileName.set(profile.name);
    this.persistProfiles();
    this.profileImported.emit(profile.config);
  }

  protected saveAsNewProfile(): void {
    const name = this.newProfileName().trim();
    if (!name) return;
    const profile = {
      id: this.newId(),
      name,
      config: { extends: this.ruleset(), rules: this.overrides() },
    } satisfies NamedLintProfile;
    this.profiles.update((profiles) => [...profiles, profile]);
    this.selectedProfileId.set(profile.id);
    this.newProfileName.set("");
    this.renameProfileName.set(name);
    this.persistProfiles();
  }

  protected renameSelectedProfile(): void {
    const name = this.renameProfileName().trim();
    if (!name) return;
    this.profiles.update((profiles) =>
      profiles.map((profile) =>
        profile.id === this.selectedProfileId() ? { ...profile, name } : profile,
      ),
    );
    this.persistProfiles();
  }

  protected deleteSelectedProfile(): void {
    const profiles = this.profiles();
    if (profiles.length < 2) return;
    const remaining = profiles.filter((profile) => profile.id !== this.selectedProfileId());
    const selected = remaining[0];
    this.profiles.set(remaining);
    this.selectedProfileId.set(selected.id);
    this.renameProfileName.set(selected.name);
    this.persistProfiles();
    this.profileImported.emit(selected.config);
  }

  private persistCurrentConfig(config: VaultLintConfig): void {
    this.profiles.update((profiles) =>
      profiles.map((profile) =>
        profile.id === this.selectedProfileId() ? { ...profile, config } : profile,
      ),
    );
    this.persistProfiles();
  }

  private loadProfiles(): SavedLintProfiles {
    try {
      const raw = this.storage.getItem("vaultlint-named-lint-profiles");
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedLintProfiles>;
        if (saved.version === 1 && Array.isArray(saved.profiles)) {
          const profiles = saved.profiles.flatMap((entry) => {
            if (!entry || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
            try {
              const config = parseLintConfigJson(JSON.stringify(entry.config));
              return [{ id: entry.id, name: entry.name, config }];
            } catch {
              return [];
            }
          });
          if (profiles.length) {
            const selectedId = profiles.some((profile) => profile.id === saved.selectedId)
              ? saved.selectedId!
              : profiles[0].id;
            return { version: 1, selectedId, profiles };
          }
        }
      }
    } catch {}
    const id = "default-recommended";
    return {
      version: 1,
      selectedId: id,
      profiles: [{ id, name: "Recommended", config: { extends: "recommended", rules: {} } }],
    };
  }

  private persistProfiles(): void {
    this.storage.setItem(
      "vaultlint-named-lint-profiles",
      JSON.stringify({
        version: 1,
        selectedId: this.selectedProfileId(),
        profiles: this.profiles(),
      } satisfies SavedLintProfiles),
    );
  }

  private newId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  private safeFileName(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "vaultlint-profile"
    );
  }
}

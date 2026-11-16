import { Component, computed, input, output, signal } from "@angular/core";
import { HlmBadgeImports } from "@spartan-ng/helm/badge";
import { HlmButtonImports } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmInputImports } from "@spartan-ng/helm/input";
import { HlmLabelImports } from "@spartan-ng/helm/label";
import { HlmNativeSelectImports } from "@spartan-ng/helm/native-select";
import { HlmWarningBox } from "@ui/components/warning-box";
import {
  AI_PROVIDER_REGISTRY,
  buildAiItemRefs,
  type AiHygieneFinding,
  type AiProviderConfig,
  type AiProviderId,
  type AiUriSuggestion,
  isNonLocalAiEndpoint,
} from "@vaultlint/ai";
import { getUriString, type VaultItem } from "@vaultlint/vault-schema";

import type { AiResolvedDuplicateGroup } from "../../core/vault.models";

@Component({
  selector: "app-ai-assistant-panel",
  imports: [
    HlmWarningBox,
    ...HlmBadgeImports,
    ...HlmButtonImports,
    ...HlmCardImports,
    ...HlmInputImports,
    ...HlmLabelImports,
    ...HlmNativeSelectImports,
  ],
  template: `
    <div class="@container space-y-4">
      <section hlmCard size="sm">
        <div hlmCardHeader>
          <div class="flex flex-wrap items-center gap-2">
            <h3 hlmCardTitle>AI Vault Assistant (Opt-In)</h3>
            @if (isNonLocalEndpoint()) {
              <span hlmBadge variant="warning" size="sm">Cloud · Names &amp; hostnames only</span>
            } @else {
              <span hlmBadge variant="success" size="sm">Local · Offline</span>
            }
          </div>
          <p hlmCardDescription>
            Sends only item names and hostnames to your chosen provider or local Ollama. Passwords,
            usernames, TOTP secrets, FIDO keys, notes, folder names, and item IDs are never sent;
            API keys stay in memory only.
          </p>
        </div>
        <div hlmCardContent class="space-y-3">
          <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-3">
            <div class="space-y-1.5">
              <label hlmLabel for="ai-tab-provider">Provider</label>
              <hlm-native-select
                class="w-full"
                selectId="ai-tab-provider"
                [value]="aiProvider()"
                (valueChange)="onProviderChange($event)"
              >
                @for (p of aiProviders; track p.id) {
                  <option hlmNativeSelectOption [value]="p.id">{{ p.displayName }}</option>
                }
              </hlm-native-select>
            </div>
            <div class="space-y-1.5">
              <label hlmLabel for="ai-tab-model">Model</label>
              <input
                hlmInput
                id="ai-tab-model"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                [placeholder]="selectedProviderMeta().defaultModel"
                [value]="aiModel()"
                (input)="aiModel.set($any($event.target).value)"
              />
            </div>
            @if (selectedProviderMeta().requiresApiKey) {
              <div class="space-y-1.5">
                <label hlmLabel for="ai-tab-api-key">API Key (in-memory only)</label>
                <input
                  hlmInput
                  id="ai-tab-api-key"
                  type="password"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  placeholder="Enter provider API key"
                  [value]="aiApiKey()"
                  (input)="aiApiKey.set($any($event.target).value)"
                />
              </div>
            }
            <div class="space-y-1.5">
              <label hlmLabel for="ai-tab-base-url">Base URL (optional)</label>
              <input
                hlmInput
                id="ai-tab-base-url"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                [placeholder]="selectedProviderMeta().defaultBaseUrl"
                [value]="aiBaseUrl()"
                (input)="aiBaseUrl.set($any($event.target).value)"
              />
            </div>
          </div>

          @if (isNonLocalEndpoint()) {
            <div hlmWarningBox color="warning" compact="true">
              <strong>Non-Local (Cloud) AI Disclaimer:</strong> Running actions with
              <strong>{{ selectedProviderMeta().displayName }}</strong> sends item names and
              hostnames over the network, subject to that provider's privacy terms. Secrets and item
              IDs stay in this browser. Select <strong>Ollama (Local)</strong> on
              <code>127.0.0.1</code> to keep requests offline.
            </div>
          } @else {
            <p class="text-muted-foreground text-xs">
              Running locally at
              <code>{{ aiBaseUrl().trim() || selectedProviderMeta().defaultBaseUrl }}</code>. No
              vault metadata leaves your machine. All edits support Undo / Redo.
            </p>
          }
        </div>
      </section>

      <div class="grid gap-4 @2xl:grid-cols-2">
        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h4 hlmCardTitle>Folder suggestions and name cleanup</h4>
            <p hlmCardDescription>
              Assign concise folders (reusing existing ones) and clean up messy imported item names
              like "Login - GitHub (2023)".
            </p>
          </div>
          <div hlmCardContent class="space-y-3">
            <div class="flex flex-wrap gap-2">
              <button
                hlmBtn
                variant="default"
                size="sm"
                [disabled]="aiRunning()"
                (click)="organizeAi.emit(buildConfig())"
              >
                {{
                  aiActiveTask() === "organize" ? "Organizing..." : "Organize Folders & Clean Names"
                }}
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="aiRunning()"
                (click)="categorizeAi.emit(buildConfig())"
              >
                {{
                  aiActiveTask() === "categorize" ? "Categorizing..." : "Categorize Folders Only"
                }}
              </button>
            </div>
            @if (organizeSummary()) {
              <p class="text-muted-foreground text-xs">{{ organizeSummary() }}</p>
            }
          </div>
        </section>

        <section hlmCard size="sm">
          <div hlmCardHeader>
            <h4 hlmCardTitle>Missing URI Suggestions</h4>
            <p hlmCardDescription>
              Infer candidate HTTPS login URIs for missing URLs. Review each suggestion before
              applying it.
            </p>
          </div>
          <div hlmCardContent class="space-y-3">
            <p class="text-muted-foreground text-xs">
              Verify each domain on the service's official site before applying it; an incorrect
              login URI can expose credentials if autofill is used.
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                hlmBtn
                variant="default"
                size="sm"
                [disabled]="aiRunning()"
                (click)="suggestUrisAi.emit(buildConfig())"
              >
                {{ aiActiveTask() === "suggest-uris" ? "Scanning..." : "Suggest Missing URIs" }}
              </button>
              @if (uriSuggestions().length > 0) {
                <button hlmBtn variant="outline" size="sm" (click)="applyAllUris.emit()">
                  Apply All ({{ uriSuggestions().length }})
                </button>
              }
            </div>

            @if (uriSuggestions().length > 0) {
              <div class="divide-border divide-y rounded-md border px-3">
                @for (s of uriSuggestions(); track s.itemId) {
                  <div class="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <div class="min-w-0 flex-1">
                      <div class="font-medium">{{ itemNameFor(s.itemId) }}</div>
                      <div class="font-mono font-medium break-all">{{ s.suggestedUri }}</div>
                      <div class="text-muted-foreground">{{ s.reason }}</div>
                    </div>
                    <button hlmBtn variant="outline" size="sm" (click)="applyUri.emit(s)">
                      Apply
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        </section>
      </div>

      <section hlmCard size="sm">
        <div hlmCardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
          <div class="min-w-[min(100%,14rem)] flex-1">
            <h4 hlmCardTitle>Possible duplicates</h4>
            <p hlmCardDescription>
              Find entries that may refer to the same service, even when their names differ. Review
              each group before merging.
            </p>
          </div>
          <button
            hlmBtn
            variant="default"
            size="sm"
            [disabled]="aiRunning()"
            (click)="detectDuplicatesAi.emit(buildConfig())"
          >
            {{ aiActiveTask() === "duplicates" ? "Checking..." : "Find Possible Duplicates" }}
          </button>
        </div>
        @if (duplicateGroups().length > 0) {
          <div hlmCardContent class="space-y-3">
            @for (
              resolved of duplicateGroups();
              track resolved.group.groupKey ?? resolved.group.key
            ) {
              <div class="border-border space-y-2 rounded-md border p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold">{{ resolved.group.name }}</span>
                    <span hlmBadge [variant]="confidenceVariant(resolved.confidence)" size="sm">
                      {{ resolved.confidence }} confidence
                    </span>
                    <span hlmBadge variant="secondary" size="sm">
                      {{ resolved.group.items.length }} items
                    </span>
                    @if (resolved.group.conflicts.hasDifferentUsernames) {
                      <span hlmBadge variant="destructive" size="sm">Different usernames</span>
                    }
                    @if (resolved.group.conflicts.hasDifferentPasswords) {
                      <span hlmBadge variant="destructive" size="sm">Different passwords</span>
                    }
                    @if (resolved.group.conflicts.hasDifferentSubdomains) {
                      <span hlmBadge variant="secondary" size="sm">Different subdomains</span>
                    }
                  </div>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    (click)="mergeDuplicate.emit(resolved)"
                  >
                    Merge Group
                  </button>
                </div>
                <p class="text-muted-foreground text-xs">{{ resolved.reason }}</p>
                @if (
                  resolved.group.conflicts.hasDifferentUsernames ||
                  resolved.group.conflicts.hasDifferentPasswords
                ) {
                  <div hlmWarningBox color="warning" compact="true">
                    Review before merging: entries have differing credentials.
                  </div>
                }
                <div class="grid gap-2 @lg:grid-cols-2">
                  @for (entry of resolved.group.items; track entry.index) {
                    <div class="border-border bg-muted/30 min-w-0 rounded border p-2 text-xs">
                      <div class="font-medium">{{ entry.item.name || "(unnamed)" }}</div>
                      <div class="text-muted-foreground break-all">
                        {{ entry.item.login?.username || "(no username)" }} ·
                        {{ formatUris(entry.item.login?.uris) }}
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        }
      </section>

      <section hlmCard size="sm">
        <div hlmCardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
          <div class="min-w-[min(100%,14rem)] flex-1">
            <h4 hlmCardTitle>AI review suggestions</h4>
            <p hlmCardDescription>Find naming, folder, and domain patterns to review.</p>
          </div>
          <button
            hlmBtn
            variant="default"
            size="sm"
            [disabled]="aiRunning()"
            (click)="analyzeHygieneAi.emit(buildConfig())"
          >
            {{ aiActiveTask() === "hygiene" ? "Checking..." : "Review vault patterns" }}
          </button>
        </div>
        <div hlmCardContent class="space-y-3">
          <p class="text-muted-foreground text-xs">
            AI output can be inaccurate. Review suggestions before acting; current service status
            and security claims are not verified.
          </p>
          @if (hygieneFindings().length > 0) {
            <div class="space-y-2.5">
              @for (finding of hygieneFindings(); track finding.title + finding.category) {
                <div class="border-border space-y-1.5 rounded-md border p-3 text-xs">
                  <div class="flex flex-wrap items-center gap-2">
                    <span hlmBadge [variant]="severityVariant(finding.severity)" size="sm">
                      {{ finding.severity }}
                    </span>
                    <span hlmBadge variant="secondary" size="sm">{{ finding.category }}</span>
                    <span class="text-sm font-semibold">{{ finding.title }}</span>
                    @if (finding.itemIds.length > 0) {
                      <span class="text-muted-foreground">
                        ({{ finding.itemIds.length }} item(s))
                      </span>
                    }
                  </div>
                  <p class="text-muted-foreground">{{ finding.description }}</p>
                  <p class="font-medium">Recommendation: {{ finding.recommendation }}</p>
                </div>
              }
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class AiAssistantPanelComponent {
  protected readonly aiProviders = Object.values(AI_PROVIDER_REGISTRY);

  readonly aiRunning = input(false);
  readonly aiActiveTask = input<string | null>(null);
  readonly organizeSummary = input<string | null>(null);
  readonly duplicateGroups = input<AiResolvedDuplicateGroup[]>([]);
  readonly uriSuggestions = input<AiUriSuggestion[]>([]);
  readonly vaultItems = input<VaultItem[]>([]);
  readonly hygieneFindings = input<AiHygieneFinding[]>([]);

  /** Local item references (unique ID, else `index:<position>`) mapped to display names. */
  private readonly nameByRef = computed(() => {
    const items = this.vaultItems();
    const refs = buildAiItemRefs({ items: [...items] });
    return new Map(refs.map((ref, index) => [ref, items[index]?.name?.trim() ?? ""] as const));
  });

  protected itemNameFor(itemId: string): string {
    return this.nameByRef().get(itemId) || itemId;
  }

  readonly categorizeAi = output<AiProviderConfig>();
  readonly organizeAi = output<AiProviderConfig>();
  readonly detectDuplicatesAi = output<AiProviderConfig>();
  readonly mergeDuplicate = output<AiResolvedDuplicateGroup>();
  readonly suggestUrisAi = output<AiProviderConfig>();
  readonly applyUri = output<AiUriSuggestion>();
  readonly applyAllUris = output<void>();
  readonly analyzeHygieneAi = output<AiProviderConfig>();

  protected readonly aiProvider = signal<AiProviderId>("openai");
  protected readonly aiModel = signal("");
  protected readonly aiApiKey = signal("");
  protected readonly aiBaseUrl = signal("");
  protected readonly selectedProviderMeta = computed(() => AI_PROVIDER_REGISTRY[this.aiProvider()]);
  protected readonly isNonLocalEndpoint = computed(() =>
    isNonLocalAiEndpoint(this.aiProvider(), this.aiBaseUrl()),
  );

  protected onProviderChange(value: string | null | undefined): void {
    if (value && Object.hasOwn(AI_PROVIDER_REGISTRY, value)) {
      if (value !== this.aiProvider()) this.aiApiKey.set("");
      this.aiProvider.set(value as AiProviderId);
      this.aiModel.set("");
      this.aiBaseUrl.set("");
    }
  }

  protected buildConfig(): AiProviderConfig {
    return {
      provider: this.aiProvider(),
      model: this.aiModel().trim() || undefined,
      apiKey: this.aiApiKey().trim() || undefined,
      baseUrl: this.aiBaseUrl().trim() || undefined,
    };
  }

  protected confidenceVariant(
    confidence: string,
  ): "default" | "secondary" | "destructive" | "warning" {
    if (confidence === "high") return "default";
    if (confidence === "low") return "warning";
    return "secondary";
  }

  protected severityVariant(severity: string): "default" | "secondary" | "destructive" | "warning" {
    if (severity === "high") return "destructive";
    if (severity === "medium") return "warning";
    return "secondary";
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

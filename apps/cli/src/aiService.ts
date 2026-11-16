import {
  AI_PROVIDER_REGISTRY,
  type AiDuplicateGroupSuggestion,
  type AiHygieneFinding,
  type AiProviderConfig,
  AiProviderContainer,
  type AiProviderId,
  type AiUriSuggestion,
  type IAiProvider,
  type SanitizedVaultItem,
  applyCategorySuggestions,
  applyOrganizeSuggestions,
  applyUriSuggestions,
  createDefaultAiContainer,
  restoreAiItemIdRecord,
  restoreAiItemIds,
  sanitizeVaultItemsForAi,
} from "@vaultlint/ai";
import type { VaultData } from "@vaultlint/vault-schema";

export interface AiEnhancementOptions {
  provider?: AiProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  container?: AiProviderContainer;
}

/**
 * Resolve an API key or base URL from explicit options first, then provider-specific environment
 * variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`,
 * `GEMINI_API_KEY`, `OLLAMA_HOST`).
 */
export function resolveAiConfig(options: AiEnhancementOptions = {}): AiProviderConfig {
  const providerId: AiProviderId = options.provider ?? "openai";
  const meta = AI_PROVIDER_REGISTRY[providerId];
  if (!meta) {
    throw new Error(
      `Unsupported AI provider "${String(providerId)}". Valid options: ${Object.keys(AI_PROVIDER_REGISTRY).join(", ")}`,
    );
  }

  const envValue = meta.envVarName ? process.env[meta.envVarName] : undefined;
  const apiKey = options.apiKey ?? (meta.requiresApiKey ? envValue : undefined);
  let baseUrl = options.baseUrl ?? (!meta.requiresApiKey ? envValue : undefined);
  // OLLAMA_HOST is conventionally a bare `host:port`; fetch needs a scheme.
  if (
    baseUrl &&
    options.baseUrl === undefined &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl.trim())
  ) {
    baseUrl = `http://${baseUrl.trim()}`;
  }

  return {
    provider: providerId,
    apiKey,
    model: options.model,
    baseUrl,
  };
}

function createAiContext(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
): { provider: IAiProvider; config: AiProviderConfig; sanitized: SanitizedVaultItem[] } {
  const config = resolveAiConfig(options);
  const container = options.container ?? createDefaultAiContainer();
  const provider = container.resolve(config.provider);
  const sanitized = sanitizeVaultItemsForAi(vaultData);
  return { provider, config, sanitized };
}

/**
 * Apply AI-powered folder categorization suggestions using any registered `IAiProvider` via the IoC
 * `AiProviderContainer`. Sends only item names and hostnames. Item positions are kept locally to
 * map suggestions back to the vault (never sending persistent IDs, folder names, passwords, or
 * usernames).
 */
export async function applyAIEnhancements(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
): Promise<VaultData> {
  await categorizeVaultWithAi(vaultData, options);
  return vaultData;
}

/** Like {@link applyAIEnhancements} but reports how many items/folders were changed. */
export async function categorizeVaultWithAi(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
): Promise<{ suggestedCount: number; categorizedCount: number; createdFolders: number }> {
  const { provider, config, sanitized } = createAiContext(vaultData, options);
  const categories = restoreAiItemIdRecord(await provider.categorize(sanitized, config), vaultData);
  const suggestedCount = Object.keys(categories).length;
  if (suggestedCount === 0) return { suggestedCount, categorizedCount: 0, createdFolders: 0 };
  return { suggestedCount, ...applyCategorySuggestions(vaultData, categories) };
}

/** Categorize items into folders and clean up messy item names in-place using AI. */
export async function organizeVaultWithAi(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
): Promise<{
  categorizedCount: number;
  createdFolders: number;
  renamedCount: number;
  summary?: string;
}> {
  const { provider, config, sanitized } = createAiContext(vaultData, options);
  const aiResult = await provider.organize(sanitized, config);
  const result = {
    ...aiResult,
    categories: restoreAiItemIdRecord(aiResult.categories, vaultData),
    renames: restoreAiItemIdRecord(aiResult.renames, vaultData),
  };
  const applied = applyOrganizeSuggestions(vaultData, result);
  return { ...applied, summary: result.summary };
}

/** Detect semantic duplicates (brand rebrands, domain aliases, naming variations) using AI. */
export async function detectDuplicatesWithAi(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
): Promise<AiDuplicateGroupSuggestion[]> {
  const { provider, config, sanitized } = createAiContext(vaultData, options);
  const groups = await provider.detectDuplicates(sanitized, config);
  return groups.map((group) => ({ ...group, itemIds: restoreAiItemIds(group.itemIds, vaultData) }));
}

/** Suggest and apply missing login URIs for items without URIs using AI. */
export async function suggestUrisWithAi(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
  apply = false,
): Promise<{ suggestions: AiUriSuggestion[]; updatedCount: number }> {
  const { provider, config, sanitized } = createAiContext(vaultData, options);
  const suggestions = (await provider.suggestUris(sanitized, config)).flatMap((suggestion) => {
    const [itemId] = restoreAiItemIds([suggestion.itemId], vaultData);
    return itemId ? [{ ...suggestion, itemId }] : [];
  });
  const updatedCount = apply ? applyUriSuggestions(vaultData, suggestions).updatedCount : 0;
  return { suggestions, updatedCount };
}

/** Review sanitized vault metadata for naming, folder, and domain patterns. */
export async function analyzeHygieneWithAi(
  vaultData: VaultData,
  options: AiEnhancementOptions = {},
): Promise<AiHygieneFinding[]> {
  const { provider, config, sanitized } = createAiContext(vaultData, options);
  const findings = await provider.analyzeHygiene(sanitized, config);
  return findings.map((finding) => ({
    ...finding,
    itemIds: restoreAiItemIds(finding.itemIds, vaultData),
  }));
}

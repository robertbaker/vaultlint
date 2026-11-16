export type AiProviderId = "openai" | "anthropic" | "openrouter" | "grok" | "gemini" | "ollama";

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

/** Dependency-inverted HTTP client abstraction for CLI, Browser, and test mocks. */
export interface IHttpClient {
  request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
}

export interface AiProviderMeta {
  id: AiProviderId;
  displayName: string;
  isLocal: boolean;
  requiresApiKey: boolean;
  defaultModel: string;
  defaultBaseUrl: string;
  envVarName?: string;
}

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Override the number of vault items sent per AI request. */
  batchSize?: number;
}

export interface AiCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface SanitizedVaultItem {
  /** Local-only correlation used to match model output; stripped from every provider request. */
  id?: string;
  name?: string;
  uris: string[];
}

export interface AiOrganizeResult {
  categories: Record<string, string>;
  renames: Record<string, string>;
  summary?: string;
}

export type AiDuplicateConfidence = "high" | "medium" | "low";

export interface AiDuplicateGroupSuggestion {
  itemIds: string[];
  suggestedName: string;
  reason: string;
  confidence: AiDuplicateConfidence;
}

export interface AiUriSuggestion {
  itemId: string;
  suggestedUri: string;
  reason: string;
}

export type AiHygieneCategory = "naming-inconsistency" | "domain-consolidation";

export type AiHygieneSeverity = "high" | "medium" | "low";

export interface AiHygieneFinding {
  category: AiHygieneCategory;
  severity: AiHygieneSeverity;
  title: string;
  description: string;
  itemIds: string[];
  recommendation: string;
}

export interface IAiProvider {
  readonly meta: AiProviderMeta;
  complete(request: AiCompletionRequest): Promise<string>;
  categorize(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<Record<string, string>>;
  organize(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiOrganizeResult>;
  detectDuplicates(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiDuplicateGroupSuggestion[]>;
  suggestUris(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiUriSuggestion[]>;
  analyzeHygiene(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiHygieneFinding[]>;
}

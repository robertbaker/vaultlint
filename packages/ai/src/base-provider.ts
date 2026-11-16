import {
  buildVaultItemRefs,
  extractDomainParts,
  getUriString,
  type VaultData,
} from "@vaultlint/vault-schema";

import { HttpStatusError } from "./http-client";
import type {
  AiCompletionRequest,
  AiDuplicateConfidence,
  AiDuplicateGroupSuggestion,
  AiHygieneCategory,
  AiHygieneFinding,
  AiHygieneSeverity,
  AiOrganizeResult,
  AiProviderConfig,
  AiProviderMeta,
  AiUriSuggestion,
  IAiProvider,
  IHttpClient,
  SanitizedVaultItem,
} from "./types";

const CATEGORIZATION_SYSTEM_PROMPT =
  'Categorize each Bitwarden item into a concise folder name (e.g., Social, Finance, Work, Shopping, Dev, Entertainment, Other). Use the zero-based position in the supplied array as the response key. Return ONLY valid JSON: {"categories": {"<index>": "<folder>"}}.';

const ORGANIZE_SYSTEM_PROMPT =
  'Organize these password vault items using only their names and hostnames. For each item: (1) assign a concise folder name (e.g., Dev, Finance, Social, Work, Shopping, Cloud, Entertainment, Other), and (2) suggest a clean, standardized item name in "renames" ONLY when the current name is messy (e.g., strip "Login - ", "- Sign In", raw URLs, or redundant suffixes). Use each item’s zero-based position in the supplied array as its key. Return ONLY valid JSON: {"categories": {"<index>": "<folder>"}, "renames": {"<index>": "<cleanName>"}, "summary": "<short summary>"}.';

const DUPLICATES_SYSTEM_PROMPT =
  'Detect semantic duplicate vault items that likely belong to the same service or account group, including brand rebrands (e.g. Twitter/X), domain aliases (e.g. gmail.com/google.com, aws/amazon), and naming variations (e.g. "GitHub" vs "GitHub Work" vs "github.com"). Only group 2 or more items. Identify them by their zero-based positions in the supplied array. Return ONLY valid JSON: {"duplicates": [{"itemIndices": ["<index1>", "<index2>"], "suggestedName": "<name>", "reason": "<short reason>", "confidence": "high"|"medium"|"low"}]}.';

const SUGGEST_URIS_SYSTEM_PROMPT =
  'For each vault item that has no URIs (empty uris array), infer the most likely canonical HTTPS login URL from its item name if it is a recognizable service. Only include items you are confident about. Identify each item by its zero-based position in the supplied array. Return ONLY valid JSON: {"suggestions": [{"itemIndex": "<index>", "suggestedUri": "https://example.com", "reason": "<short reason>"}]}.';

const HYGIENE_SYSTEM_PROMPT =
  'Review these sanitized vault metadata entries (names and hostnames) only for patterns directly supported by the supplied data: naming inconsistencies and possible domain consolidation. Do not make claims about current folder structure, service status, security breaches, or other facts that cannot be verified from these fields. Treat every finding as an unverified suggestion and recommend human review. Never invent passwords or secrets. Identify items by their zero-based positions in the supplied array. Return ONLY valid JSON: {"findings": [{"category": "naming-inconsistency"|"domain-consolidation", "severity": "high"|"medium"|"low", "title": "<short title>", "description": "<details>", "itemIndices": ["<index>"], "recommendation": "<actionable fix>"}]}.';

const MAX_MODEL_TEXT_LENGTH = 500;
const MAX_SUGGESTED_URI_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const MODEL_CONTROL_REGEX = /[\u0000-\u001f\u007f-\u009f]/g;

function cleanModelText(value: string, maxLength = MAX_MODEL_TEXT_LENGTH): string {
  return value.replace(MODEL_CONTROL_REGEX, " ").trim().slice(0, maxLength);
}

function normalizeSafeSuggestedLoginUri(value: string): string | null {
  if (value.length > MAX_SUGGESTED_URI_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Derive a bare hostname from a stored login URI. Accepts scheme-less entries such as
 * `example.com/login` (common in vault exports) but refuses single-label scheme-less values, which
 * are more likely to be pasted secrets or free text than hosts. Never returns paths, queries,
 * ports, or embedded credentials.
 */
function hostnameForAi(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed || /\s/.test(trimmed.split(/[/?#]/)[0] ?? "")) return "";
  const { hostname } = extractDomainParts(trimmed);
  if (!hostname) return "";
  if (!trimmed.includes("://") && !hostname.includes(".") && !hostname.startsWith("[")) return "";
  return hostname;
}

/** Strip passwords, usernames, TOTP secrets, FIDO keys, and notes before any AI call. */
export function sanitizeVaultItemsForAi(vaultData: VaultData): SanitizedVaultItem[] {
  return vaultData.items.map((item, idx) => {
    const hosts = (item.login?.uris ?? []).map((u) => hostnameForAi(getUriString(u)));
    return {
      // Local-only correlation; BaseAiProvider strips this before sending the request.
      id: String(idx),
      name: item.name,
      uris: [...new Set(hosts.filter(Boolean))],
    };
  });
}

/**
 * Collision-free local reference for every item: its vault ID when that ID is non-empty and unique
 * within the vault, otherwise `index:<position>`. Duplicate IDs, empty IDs, and IDs that mimic a
 * fallback reference therefore never alias another item.
 */
export function buildAiItemRefs(vaultData: VaultData): string[] {
  return buildVaultItemRefs(vaultData);
}

function restoreWithRefs(aiId: string, refs: readonly string[]): string | null {
  const index = Number(aiId);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== aiId) return null;
  return refs[index] ?? null;
}

/** Map an AI response's positional item reference back to a local item reference. */
export function restoreAiItemId(aiId: string, vaultData: VaultData): string | null {
  return restoreWithRefs(aiId, buildAiItemRefs(vaultData));
}

/** Restore positional IDs in a model-produced item-keyed record. */
export function restoreAiItemIdRecord(
  record: Record<string, string>,
  vaultData: VaultData,
): Record<string, string> {
  const refs = buildAiItemRefs(vaultData);
  const restored = Object.create(null) as Record<string, string>;
  for (const [aiId, value] of Object.entries(record)) {
    const localId = restoreWithRefs(aiId, refs);
    if (localId !== null) restored[localId] = value;
  }
  return restored;
}

/** Restore positional IDs in a model-produced item list. */
export function restoreAiItemIds(aiIds: readonly string[], vaultData: VaultData): string[] {
  const refs = buildAiItemRefs(vaultData);
  return aiIds.flatMap((aiId) => {
    const localId = restoreWithRefs(aiId, refs);
    return localId === null ? [] : [localId];
  });
}

/** Extract a top-level JSON object from an LLM response (handling optional markdown code fences). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Raised when a model response is empty, truncated, or not the JSON shape that was requested. */
export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

/** Like {@link extractJsonObject} but throws when the response is unusable (e.g. truncated). */
function requireJsonObject(
  raw: string,
  expectedKey: string,
  what: string,
): Record<string, unknown> {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    throw new AiResponseError(
      `AI ${what} response was empty, truncated, or not valid JSON; nothing was applied. Try again, use a model with a larger output limit, or reduce the vault size.`,
    );
  }
  if (!(expectedKey in parsed) && Object.keys(parsed).length > 0) {
    throw new AiResponseError(
      `AI ${what} response did not contain the expected "${expectedKey}" field; nothing was applied.`,
    );
  }
  return parsed;
}

function parseStringRecord(rawObj: unknown): Record<string, string> {
  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) return {};
  const out = Object.create(null) as Record<string, string>;
  for (const [id, val] of Object.entries(rawObj as Record<string, unknown>)) {
    if (typeof val === "string") {
      const cleaned = cleanModelText(val, 128);
      if (cleaned) out[id] = cleaned;
    }
  }
  return out;
}

/** Extract `{ [inputPosition]: folderName }` from an LLM response. */
export function parseCategoryJson(raw: string): Record<string, string> {
  const parsed = extractJsonObject(raw);
  return parsed ? parseStringRecord(parsed["categories"]) : {};
}

/** Extract `{ categories, renames, summary }` from an LLM organize response. */
export function parseOrganizeJson(raw: string): AiOrganizeResult {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { categories: {}, renames: {} };
  const summary =
    typeof parsed["summary"] === "string" ? cleanModelText(parsed["summary"]) : undefined;
  return {
    categories: parseStringRecord(parsed["categories"]),
    renames: parseStringRecord(parsed["renames"]),
    ...(summary ? { summary } : {}),
  };
}

const VALID_CONFIDENCES = new Set<AiDuplicateConfidence>(["high", "medium", "low"]);

/** Extract validated semantic duplicate groups from an LLM response. */
export function parseDuplicatesJson(
  raw: string,
  validPositions?: ReadonlySet<string>,
): AiDuplicateGroupSuggestion[] {
  const parsed = extractJsonObject(raw);
  const list = parsed?.["duplicates"];
  if (!Array.isArray(list)) return [];

  const results: AiDuplicateGroupSuggestion[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    if (!Array.isArray(obj["itemIndices"])) continue;

    const dedupedIds = [
      ...new Set(
        obj["itemIndices"]
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim())
          .filter((id) => !validPositions || validPositions.has(id)),
      ),
    ];
    if (dedupedIds.length < 2) continue;

    const confidence = VALID_CONFIDENCES.has(obj["confidence"] as AiDuplicateConfidence)
      ? (obj["confidence"] as AiDuplicateConfidence)
      : "medium";
    const suggestedName =
      typeof obj["suggestedName"] === "string" && cleanModelText(obj["suggestedName"])
        ? cleanModelText(obj["suggestedName"], 128)
        : "Duplicate Group";
    const reason =
      typeof obj["reason"] === "string" && cleanModelText(obj["reason"])
        ? cleanModelText(obj["reason"])
        : "Semantically similar entries";

    results.push({ itemIds: dedupedIds, suggestedName, reason, confidence });
  }
  return results;
}

/** Extract validated HTTPS URI suggestions from an LLM response. */
export function parseUriSuggestionsJson(
  raw: string,
  validPositions?: ReadonlySet<string>,
): AiUriSuggestion[] {
  const parsed = extractJsonObject(raw);
  const list = parsed?.["suggestions"];
  if (!Array.isArray(list)) return [];

  const results: AiUriSuggestion[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const itemId = typeof obj["itemIndex"] === "string" ? obj["itemIndex"].trim() : "";
    const rawSuggestedUri =
      typeof obj["suggestedUri"] === "string" ? obj["suggestedUri"].trim() : "";
    if (!itemId || !rawSuggestedUri) continue;
    if (validPositions && !validPositions.has(itemId)) continue;

    const suggestedUri = normalizeSafeSuggestedLoginUri(rawSuggestedUri);
    if (!suggestedUri) continue;

    const reason =
      typeof obj["reason"] === "string" && cleanModelText(obj["reason"])
        ? cleanModelText(obj["reason"])
        : "Inferred from item name";
    results.push({ itemId, suggestedUri, reason });
  }
  return results;
}

const VALID_HYGIENE_CATEGORIES = new Set<AiHygieneCategory>([
  "naming-inconsistency",
  "domain-consolidation",
]);
const VALID_HYGIENE_SEVERITIES = new Set<AiHygieneSeverity>(["high", "medium", "low"]);

/** Extract validated hygiene audit findings from an LLM response. */
export function parseHygieneJson(
  raw: string,
  validPositions?: ReadonlySet<string>,
): AiHygieneFinding[] {
  const parsed = extractJsonObject(raw);
  const list = parsed?.["findings"];
  if (!Array.isArray(list)) return [];

  const results: AiHygieneFinding[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const title = typeof obj["title"] === "string" ? cleanModelText(obj["title"], 128) : "";
    const description =
      typeof obj["description"] === "string" ? cleanModelText(obj["description"]) : "";
    if (!title || !description) continue;

    if (!VALID_HYGIENE_CATEGORIES.has(obj["category"] as AiHygieneCategory)) continue;
    const category = obj["category"] as AiHygieneCategory;
    const severity = VALID_HYGIENE_SEVERITIES.has(obj["severity"] as AiHygieneSeverity)
      ? (obj["severity"] as AiHygieneSeverity)
      : "medium";
    const recommendation =
      typeof obj["recommendation"] === "string" && cleanModelText(obj["recommendation"])
        ? cleanModelText(obj["recommendation"])
        : "Review affected items.";
    const itemIds = Array.isArray(obj["itemIndices"])
      ? [
          ...new Set(
            obj["itemIndices"]
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((id) => id.trim())
              .filter((id) => !validPositions || validPositions.has(id)),
          ),
        ]
      : [];

    results.push({ category, severity, title, description, itemIds, recommendation });
  }
  return results;
}

const DEFAULT_AI_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delay before retrying a rate-limited / temporarily unavailable response, or `undefined` to give
 * up.
 */
function retryDelayMs(error: unknown, attempt: number): number | undefined {
  if (attempt >= MAX_RETRIES || !(error instanceof HttpStatusError)) return undefined;
  if (error.status !== 429 && error.status !== 503) return undefined;
  const backoff = 1000 * 2 ** attempt;
  const delay = error.retryAfterMs ?? backoff;
  return delay > MAX_RETRY_DELAY_MS ? undefined : delay;
}

/** Split items into batches limited by item count and serialized size. */
export function chunkItems<T>(items: readonly T[], maxItems: number, maxChars = 40_000): T[][] {
  const limit = Math.max(1, Math.floor(maxItems) || 1);
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 2;
  for (const item of items) {
    const serializedItem = JSON.stringify(item);
    if (serializedItem === undefined) {
      throw new TypeError("AI batch items must be JSON-serializable values.");
    }
    const itemSize = serializedItem.length + 1;
    if (2 + itemSize > maxChars) {
      throw new RangeError(`AI batch item exceeds the ${maxChars}-character payload limit.`);
    }
    if (current.length > 0 && (current.length >= limit || size + itemSize > maxChars)) {
      batches.push(current);
      current = [];
      size = 2;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const CLUSTER_STOPWORDS = new Set(["the", "my", "login", "www", "app", "web", "com", "net", "org"]);

function nameKey(item: SanitizedVaultItem): string {
  return (item.name ?? "").toLowerCase();
}

/** Local grouping keys that make likely duplicates / domain aliases land in the same batch. */
function clusterKeys(item: SanitizedVaultItem): string[] {
  const keys = new Set<string>();
  const name = nameKey(item);
  const squashed = name.replace(/[^a-z0-9]+/g, "");
  if (squashed.length >= 3) keys.add(`n:${squashed}`);
  const firstToken = name.match(/[a-z0-9]+/)?.[0];
  if (firstToken && firstToken.length >= 3 && !CLUSTER_STOPWORDS.has(firstToken)) {
    keys.add(`n:${firstToken}`);
  }
  for (const uri of item.uris) {
    const labels = uri
      .toLowerCase()
      .replace(/^www\./, "")
      .split(".")
      .filter(Boolean);
    // Second-level label ("github" for gist.github.com); skip bare IPs and single labels.
    const sld = labels.length >= 2 ? labels[labels.length - 2] : undefined;
    if (sld && sld.length >= 3 && !/^\d+$/.test(sld) && !CLUSTER_STOPWORDS.has(sld)) {
      keys.add(`n:${sld.replace(/[^a-z0-9]+/g, "")}`);
    }
  }
  return [...keys];
}

/**
 * Group items that share a normalized name or host label (union-find), so that groups which would
 * otherwise straddle batch boundaries are analyzed together. Clusters are ordered by name.
 */
export function clusterItemsForAi<T extends SanitizedVaultItem>(items: readonly T[]): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner = new Map<string, number>();
  items.forEach((item, i) => {
    for (const key of clusterKeys(item)) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });
  const clusters = new Map<number, T[]>();
  items.forEach((item, i) => {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(item);
    else clusters.set(root, [item]);
  });
  const sortItems = (list: T[]) =>
    list.sort((a, b) => (nameKey(a) < nameKey(b) ? -1 : nameKey(a) > nameKey(b) ? 1 : 0));
  return [...clusters.values()]
    .map(sortItems)
    .sort((a, b) => (nameKey(a[0]) < nameKey(b[0]) ? -1 : nameKey(a[0]) > nameKey(b[0]) ? 1 : 0));
}

/**
 * Batch items for whole-vault tasks (duplicates, hygiene) keeping each local cluster in one batch
 * whenever it fits; only clusters larger than a batch are split.
 */
export function chunkClusteredItems<T extends SanitizedVaultItem>(
  items: readonly T[],
  maxItems: number,
  maxChars = 40_000,
): T[][] {
  const limit = Math.max(1, Math.floor(maxItems) || 1);
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 2;
  const flush = () => {
    if (current.length > 0) batches.push(current);
    current = [];
    size = 2;
  };
  for (const cluster of clusterItemsForAi(items)) {
    const clusterSize = cluster.reduce((sum, item) => sum + JSON.stringify(item).length + 1, 2);
    if (cluster.length > limit || clusterSize > maxChars) {
      flush();
      batches.push(...chunkItems(cluster, limit, maxChars));
      continue;
    }
    if (
      current.length > 0 &&
      (current.length + cluster.length > limit || size + clusterSize > maxChars)
    ) {
      flush();
    }
    current.push(...cluster);
    size += clusterSize;
  }
  flush();
  return batches;
}

/** The model sees no identifiers; its output positions are resolved to local references here. */
function indexSet(batch: readonly SanitizedVaultItem[]): ReadonlySet<string> {
  return new Set(batch.map((_, index) => String(index)));
}

function localRefAt(batch: readonly SanitizedVaultItem[], position: string): string | null {
  const index = Number(position);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== position) return null;
  return batch[index]?.id ?? (index < batch.length ? String(index) : null);
}

function mapRecordPositionsToLocalRefs(
  values: Record<string, string>,
  batch: readonly SanitizedVaultItem[],
): Record<string, string> {
  const mapped = Object.create(null) as Record<string, string>;
  for (const [position, value] of Object.entries(values)) {
    const localRef = localRefAt(batch, position);
    if (localRef !== null) mapped[localRef] = value;
  }
  return mapped;
}

function mergeRecords(records: readonly Record<string, string>[]): Record<string, string> {
  const merged = Object.create(null) as Record<string, string>;
  for (const record of records) Object.assign(merged, record);
  return merged;
}

/**
 * Abstract base class for AI providers using template-method hooks and constructor-injected
 * `IHttpClient`.
 */
export abstract class BaseAiProvider implements IAiProvider {
  abstract readonly meta: AiProviderMeta;
  protected readonly http: IHttpClient;

  constructor(http: IHttpClient) {
    this.http = http;
  }

  protected abstract buildEndpoint(request: AiCompletionRequest): string;
  protected abstract buildHeaders(request: AiCompletionRequest): Record<string, string>;
  protected abstract buildBody(request: AiCompletionRequest): unknown;
  protected abstract extractContent(data: unknown): string;

  async complete(request: AiCompletionRequest): Promise<string> {
    if (this.meta.requiresApiKey && !request.apiKey?.trim()) {
      throw new Error(
        `${this.meta.displayName} API key is required.${this.meta.envVarName ? ` Set ${this.meta.envVarName} or pass an API key.` : ""}`,
      );
    }

    let response;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          response = await this.http.request({
            url: this.buildEndpoint(request),
            method: "POST",
            headers: this.buildHeaders(request),
            body: this.buildBody(request),
            timeoutMs: request.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
          });
          break;
        } catch (error) {
          const delay = retryDelayMs(error, attempt);
          if (delay === undefined) throw error;
          await sleep(delay);
        }
      }
    } catch (error) {
      // Providers sometimes echo (part of) the submitted key in their error text.
      const apiKey = request.apiKey?.trim();
      const message = error instanceof Error ? error.message : String(error);
      if (apiKey && message.includes(apiKey)) {
        throw new Error(message.split(apiKey).join("[redacted API key]"));
      }
      throw error;
    }

    return this.extractContent(response.data);
  }

  private async completeJsonPrompt(
    systemPrompt: string,
    payload: unknown,
    config: AiProviderConfig,
  ): Promise<string> {
    return this.complete({
      systemPrompt,
      userPrompt: JSON.stringify(payload),
      model: config.model?.trim() || this.meta.defaultModel,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    });
  }

  /** Strip local-only correlations before building any provider request. */
  private requestItems(batch: readonly SanitizedVaultItem[]): Array<{
    name?: string;
    uris: string[];
  }> {
    return batch.map(({ name, uris }) => ({ name, uris }));
  }

  /** Max items per request for per-item tasks (categorize, organize, suggest URIs). */
  protected readonly itemBatchSize: number = 50;
  /** Max items per request for tasks that need a global view (duplicates, hygiene). */
  protected readonly globalBatchSize: number = 300;
  /** Hard cap on serialized request payload size per batch. */
  protected readonly maxBatchChars: number = 40_000;

  /** Run `parse` over each batch, attributing failures to the batch that caused them. */
  private async runBatches<R>(
    batches: readonly (readonly SanitizedVaultItem[])[],
    systemPrompt: string,
    config: AiProviderConfig,
    parse: (raw: string, batch: readonly SanitizedVaultItem[]) => R,
  ): Promise<R[]> {
    const results: R[] = [];
    for (const [index, batch] of batches.entries()) {
      const raw = await this.completeJsonPrompt(systemPrompt, this.requestItems(batch), config);
      try {
        results.push(parse(raw, batch));
      } catch (error) {
        if (error instanceof AiResponseError && batches.length > 1) {
          throw new AiResponseError(`${error.message} (batch ${index + 1} of ${batches.length})`);
        }
        throw error;
      }
    }
    return results;
  }

  async categorize(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<Record<string, string>> {
    if (items.length === 0) return {};
    const parts = await this.runBatches(
      chunkItems(items, config.batchSize ?? this.itemBatchSize, this.maxBatchChars),
      CATEGORIZATION_SYSTEM_PROMPT,
      config,
      (raw, batch) =>
        mapRecordPositionsToLocalRefs(
          parseStringRecord(requireJsonObject(raw, "categories", "categorization")["categories"]),
          batch,
        ),
    );
    return mergeRecords(parts);
  }

  async organize(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiOrganizeResult> {
    if (items.length === 0) return { categories: {}, renames: {} };
    const parts = await this.runBatches(
      chunkItems(items, config.batchSize ?? this.itemBatchSize, this.maxBatchChars),
      ORGANIZE_SYSTEM_PROMPT,
      config,
      (raw, batch) => {
        requireJsonObject(raw, "categories", "organize");
        const result = parseOrganizeJson(raw);
        return {
          ...result,
          categories: mapRecordPositionsToLocalRefs(result.categories, batch),
          renames: mapRecordPositionsToLocalRefs(result.renames, batch),
        };
      },
    );
    const summaries = [
      ...new Set(parts.map((p) => p.summary).filter((x): x is string => Boolean(x))),
    ];
    return {
      categories: mergeRecords(parts.map((p) => p.categories)),
      renames: mergeRecords(parts.map((p) => p.renames)),
      ...(summaries.length > 0 ? { summary: cleanModelText(summaries.join(" ")) } : {}),
    };
  }

  async detectDuplicates(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiDuplicateGroupSuggestion[]> {
    if (items.length < 2) return [];
    // Locally pre-clustered (shared name/host label) so likely duplicates share a batch.
    const parts = await this.runBatches(
      chunkClusteredItems(items, config.batchSize ?? this.globalBatchSize, this.maxBatchChars),
      DUPLICATES_SYSTEM_PROMPT,
      config,
      (raw, batch) => {
        requireJsonObject(raw, "duplicates", "duplicate-detection");
        return parseDuplicatesJson(raw, indexSet(batch)).map((group) => ({
          ...group,
          itemIds: group.itemIds.flatMap((position) => {
            const localRef = localRefAt(batch, position);
            return localRef === null ? [] : [localRef];
          }),
        }));
      },
    );
    return parts.flat();
  }

  async suggestUris(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiUriSuggestion[]> {
    const missingUriItems = items.filter((item) => item.uris.length === 0 && item.name?.trim());
    if (missingUriItems.length === 0) return [];
    const parts = await this.runBatches(
      chunkItems(missingUriItems, config.batchSize ?? this.itemBatchSize, this.maxBatchChars),
      SUGGEST_URIS_SYSTEM_PROMPT,
      config,
      (raw, batch) => {
        requireJsonObject(raw, "suggestions", "URI-suggestion");
        return parseUriSuggestionsJson(raw, indexSet(batch)).flatMap((suggestion) => {
          const localRef = localRefAt(batch, suggestion.itemId);
          return localRef === null ? [] : [{ ...suggestion, itemId: localRef }];
        });
      },
    );
    return parts.flat();
  }

  async analyzeHygiene(
    items: readonly SanitizedVaultItem[],
    config: AiProviderConfig,
  ): Promise<AiHygieneFinding[]> {
    if (items.length === 0) return [];
    const parts = await this.runBatches(
      chunkClusteredItems(items, config.batchSize ?? this.globalBatchSize, this.maxBatchChars),
      HYGIENE_SYSTEM_PROMPT,
      config,
      (raw, batch) => {
        requireJsonObject(raw, "findings", "hygiene");
        return parseHygieneJson(raw, indexSet(batch)).map((finding) => ({
          ...finding,
          itemIds: finding.itemIds.flatMap((position) => {
            const localRef = localRefAt(batch, position);
            return localRef === null ? [] : [localRef];
          }),
        }));
      },
    );
    return parts.flat();
  }
}

/** Shared base class for OpenAI-compatible `/chat/completions` providers. */
export abstract class OpenAiCompatibleProvider extends BaseAiProvider {
  protected buildEndpoint(request: AiCompletionRequest): string {
    const base = (request.baseUrl?.trim() || this.meta.defaultBaseUrl).replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }

  protected buildHeaders(request: AiCompletionRequest): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (request.apiKey?.trim()) {
      headers["Authorization"] = `Bearer ${request.apiKey.trim()}`;
    }
    return headers;
  }

  protected buildBody(request: AiCompletionRequest): unknown {
    return {
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
    };
  }

  protected extractContent(data: unknown): string {
    const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const content = choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }
}

/** Apply `{ [itemId]: folderName }` suggestions to a `VaultData` object in-place. */
export function applyCategorySuggestions(
  vaultData: VaultData,
  categories: Record<string, string>,
): { categorizedCount: number; createdFolders: number } {
  vaultData.folders = vaultData.folders ?? [];
  const folderByName = new Map<string, string>(
    vaultData.folders.map((f) => [f.name.toLowerCase(), f.id]),
  );
  const usedFolderIds = new Set(vaultData.folders.map((folder) => folder.id));

  let categorizedCount = 0;
  let createdFolders = 0;

  const refs = buildAiItemRefs(vaultData);
  vaultData.items.forEach((item, idx) => {
    const lookupKey = refs[idx];
    const rawSuggestedFolder = Object.hasOwn(categories, lookupKey)
      ? categories[lookupKey]
      : undefined;
    const suggestedFolder = rawSuggestedFolder ? cleanModelText(rawSuggestedFolder, 128) : "";
    if (!suggestedFolder) return;

    const key = suggestedFolder.toLowerCase();
    let folderId = folderByName.get(key);
    if (!folderId) {
      const baseId = `ai-${key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "folder"}`;
      folderId = baseId;
      let suffix = 2;
      while (usedFolderIds.has(folderId)) folderId = `${baseId}-${suffix++}`;
      vaultData.folders!.push({ id: folderId, name: suggestedFolder });
      folderByName.set(key, folderId);
      usedFolderIds.add(folderId);
      createdFolders++;
    }
    if (item.folderId !== folderId) {
      item.folderId = folderId;
      categorizedCount++;
    }
  });

  return { categorizedCount, createdFolders };
}

/**
 * Apply AI organize suggestions (folder categorization + clean item renames) to a `VaultData`
 * in-place.
 */
export function applyOrganizeSuggestions(
  vaultData: VaultData,
  result: AiOrganizeResult,
): { categorizedCount: number; createdFolders: number; renamedCount: number } {
  const { categorizedCount, createdFolders } = applyCategorySuggestions(
    vaultData,
    result.categories,
  );

  let renamedCount = 0;
  const refs = buildAiItemRefs(vaultData);
  vaultData.items.forEach((item, idx) => {
    const lookupKey = refs[idx];
    const nextName = Object.hasOwn(result.renames, lookupKey)
      ? result.renames[lookupKey]?.trim()
      : undefined;
    const cleanedName = nextName ? cleanModelText(nextName, 128) : "";
    if (cleanedName && cleanedName !== item.name) {
      item.name = cleanedName;
      renamedCount++;
    }
  });

  return { categorizedCount, createdFolders, renamedCount };
}

/** Apply AI URI suggestions to items missing those URIs in `VaultData` in-place. */
export function applyUriSuggestions(
  vaultData: VaultData,
  suggestions: readonly AiUriSuggestion[],
): { updatedCount: number } {
  const byId = new Map<string, string>();
  for (const s of suggestions) {
    const safeUri = normalizeSafeSuggestedLoginUri(s.suggestedUri);
    if (s.itemId && safeUri) {
      byId.set(s.itemId, safeUri);
    }
  }

  let updatedCount = 0;
  const refs = buildAiItemRefs(vaultData);
  vaultData.items.forEach((item, idx) => {
    const lookupKey = refs[idx];
    const suggested = byId.get(lookupKey);
    if (!suggested) return;

    item.login = item.login ?? {};
    const existing = item.login.uris ?? [];
    if (existing.length > 0) return;

    item.login.uris = [...existing, { uri: suggested }];
    updatedCount++;
  });

  return { updatedCount };
}

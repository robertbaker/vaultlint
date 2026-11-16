import { FetchHttpClient } from "./http-client";
import {
  AnthropicProvider,
  GeminiProvider,
  GrokProvider,
  OllamaProvider,
  OpenAiProvider,
  OpenRouterProvider,
} from "./providers";
import type { AiProviderId, AiProviderMeta, IAiProvider, IHttpClient } from "./types";

export type AiProviderFactory = (http: IHttpClient) => IAiProvider;

/**
 * IoC container for resolving AI providers by ID. Decouples callers from concrete HTTP/vendor
 * implementations and allows injecting mock `IHttpClient` or custom `IAiProvider` factories.
 */
export class AiProviderContainer {
  private readonly factories = new Map<AiProviderId, AiProviderFactory>();
  private readonly instances = new Map<AiProviderId, IAiProvider>();
  private readonly http: IHttpClient;

  constructor(http: IHttpClient = new FetchHttpClient()) {
    this.http = http;
  }

  register(id: AiProviderId, factory: AiProviderFactory): this {
    this.factories.set(id, factory);
    this.instances.delete(id);
    return this;
  }

  has(id: string): id is AiProviderId {
    return this.factories.has(id as AiProviderId);
  }

  resolve(id: AiProviderId): IAiProvider {
    const cached = this.instances.get(id);
    if (cached) return cached;

    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`Unsupported AI provider "${id}". Available: ${this.listIds().join(", ")}`);
    }
    const instance = factory(this.http);
    this.instances.set(id, instance);
    return instance;
  }

  listIds(): AiProviderId[] {
    return [...this.factories.keys()];
  }

  listMeta(): AiProviderMeta[] {
    return this.listIds().map((id) => this.resolve(id).meta);
  }
}

/** Create an `AiProviderContainer` pre-registered with all built-in AI providers. */
export function createDefaultAiContainer(
  http: IHttpClient = new FetchHttpClient(),
): AiProviderContainer {
  return new AiProviderContainer(http)
    .register("openai", (client) => new OpenAiProvider(client))
    .register("anthropic", (client) => new AnthropicProvider(client))
    .register("openrouter", (client) => new OpenRouterProvider(client))
    .register("grok", (client) => new GrokProvider(client))
    .register("gemini", (client) => new GeminiProvider(client))
    .register("ollama", (client) => new OllamaProvider(client));
}

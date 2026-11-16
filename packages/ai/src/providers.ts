import { BaseAiProvider, OpenAiCompatibleProvider } from "./base-provider";
import { AI_PROVIDER_REGISTRY } from "./registry";
import type { AiCompletionRequest } from "./types";

export class OpenAiProvider extends OpenAiCompatibleProvider {
  readonly meta = AI_PROVIDER_REGISTRY.openai;

  protected override buildBody(request: AiCompletionRequest): unknown {
    return {
      ...(super.buildBody(request) as Record<string, unknown>),
      response_format: { type: "json_object" },
    };
  }
}

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  readonly meta = AI_PROVIDER_REGISTRY.openrouter;

  protected override buildHeaders(request: AiCompletionRequest): Record<string, string> {
    return {
      ...super.buildHeaders(request),
      "X-Title": "vaultlint",
    };
  }
}

export class GrokProvider extends OpenAiCompatibleProvider {
  readonly meta = AI_PROVIDER_REGISTRY.grok;
}

export class GeminiProvider extends OpenAiCompatibleProvider {
  readonly meta = AI_PROVIDER_REGISTRY.gemini;
}

export class AnthropicProvider extends BaseAiProvider {
  readonly meta = AI_PROVIDER_REGISTRY.anthropic;

  protected buildEndpoint(request: AiCompletionRequest): string {
    const base = (request.baseUrl?.trim() || this.meta.defaultBaseUrl).replace(/\/+$/, "");
    return `${base}/messages`;
  }

  protected buildHeaders(request: AiCompletionRequest): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": request.apiKey?.trim() ?? "",
      "anthropic-version": "2023-06-01",
    };
  }

  protected buildBody(request: AiCompletionRequest): unknown {
    return {
      model: request.model,
      max_tokens: 8192,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
    };
  }

  protected extractContent(data: unknown): string {
    const content = (data as { content?: Array<{ type?: string; text?: unknown }> })?.content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n")
      .trim();
  }
}

export class OllamaProvider extends BaseAiProvider {
  readonly meta = AI_PROVIDER_REGISTRY.ollama;

  protected buildEndpoint(request: AiCompletionRequest): string {
    const base = (request.baseUrl?.trim() || this.meta.defaultBaseUrl).replace(/\/+$/, "");
    return `${base}/api/chat`;
  }

  protected buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
    };
  }

  protected buildBody(request: AiCompletionRequest): unknown {
    return {
      model: request.model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
    };
  }

  protected extractContent(data: unknown): string {
    const msg = (data as { message?: { content?: unknown } })?.message?.content;
    return typeof msg === "string" ? msg : "";
  }
}

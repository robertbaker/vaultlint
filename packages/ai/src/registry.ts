/**
 * Provider metadata and endpoint helpers, kept apart from the adapter classes so UIs can show
 * provider pickers without bundling every adapter (the Web UI lazy-loads `./container`).
 */
import type { AiProviderId, AiProviderMeta } from "./types";

export const AI_PROVIDER_REGISTRY: Readonly<Record<AiProviderId, AiProviderMeta>> = Object.freeze({
  openai: {
    id: "openai",
    displayName: "OpenAI",
    isLocal: false,
    requiresApiKey: true,
    defaultModel: "gpt-6-luna",
    defaultBaseUrl: "https://api.openai.com/v1",
    envVarName: "OPENAI_API_KEY",
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic Claude",
    isLocal: false,
    requiresApiKey: true,
    defaultModel: "claude-haiku-5-5",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    envVarName: "ANTHROPIC_API_KEY",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    isLocal: false,
    requiresApiKey: true,
    defaultModel: "openai/gpt-6-luna",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    envVarName: "OPENROUTER_API_KEY",
  },
  grok: {
    id: "grok",
    displayName: "xAI Grok",
    isLocal: false,
    requiresApiKey: true,
    defaultModel: "grok-4.7",
    defaultBaseUrl: "https://api.x.ai/v1",
    envVarName: "XAI_API_KEY",
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    isLocal: false,
    requiresApiKey: true,
    defaultModel: "gemini-4-hydrogen",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVarName: "GEMINI_API_KEY",
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama (Local)",
    isLocal: true,
    requiresApiKey: false,
    defaultModel: "gemma4:e4b",
    defaultBaseUrl: "http://127.0.0.1:11434",
    envVarName: "OLLAMA_HOST",
  },
});

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Returns `true` if the selected provider/baseUrl sends data to a non-local (remote/cloud)
 * endpoint.
 */
export function isNonLocalAiEndpoint(providerId: AiProviderId, baseUrl?: string): boolean {
  const meta = AI_PROVIDER_REGISTRY[providerId];
  const effectiveUrl = baseUrl?.trim() || meta.defaultBaseUrl;
  try {
    const { hostname } = new URL(effectiveUrl);
    if (LOOPBACK_HOSTS.has(hostname.toLowerCase())) {
      return false;
    }
    return true;
  } catch {
    return !meta.isLocal;
  }
}

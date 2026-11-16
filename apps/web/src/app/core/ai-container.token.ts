import { InjectionToken } from "@angular/core";
import type { AiProviderContainer } from "@vaultlint/ai";

/**
 * Angular DI token for the shared IoC `AiProviderContainer`.
 *
 * Deliberately has no default factory: AI is opt-in, so the provider adapters are code-split and
 * only downloaded the first time an AI task runs (see `loadDefaultAiContainer`). Tests and hosts
 * can still provide a container explicitly.
 */
export const AI_CONTAINER = new InjectionToken<AiProviderContainer>("AI_CONTAINER");

/** Lazily loads the provider adapters and builds the default container. */
export async function loadDefaultAiContainer(): Promise<AiProviderContainer> {
  const { createDefaultAiContainer } = await import("@vaultlint/ai/container");
  return createDefaultAiContainer();
}

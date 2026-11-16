import { TestBed } from "@angular/core/testing";
import type { AiProviderConfig } from "@vaultlint/ai";
import { describe, expect, it } from "vitest";

import { AiAssistantPanelComponent } from "./ai-assistant-panel.component";

describe("AiAssistantPanelComponent", () => {
  it("clears the previous provider's API key when switching providers", () => {
    TestBed.configureTestingModule({ imports: [AiAssistantPanelComponent] });
    const fixture = TestBed.createComponent(AiAssistantPanelComponent);
    const component = fixture.componentInstance as unknown as {
      aiApiKey: { set(value: string): void };
      buildConfig(): AiProviderConfig;
      onProviderChange(value: string): void;
    };
    component.aiApiKey.set("sk-secret-for-openai");

    component.onProviderChange("anthropic");

    expect(component.buildConfig().apiKey).toBeUndefined();
    fixture.destroy();
  });
});

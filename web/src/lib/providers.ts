export type ProviderId = "openai" | "anthropic" | "google" | "xai";

export type ProviderCatalogItem = {
  id: ProviderId;
  label: string;
  defaultModel: string;
  models: string[];
};

export const PROVIDERS: ProviderCatalogItem[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"]
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    models: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-3-7-sonnet-latest"]
  },
  {
    id: "google",
    label: "Google",
    defaultModel: "gemini-2.5-pro",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]
  },
  {
    id: "xai",
    label: "xAI",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-3", "grok-3-mini"]
  }
];

export function providerLabel(providerId: string): string {
  return PROVIDERS.find((provider) => provider.id === providerId)?.label ?? providerId;
}

export function providerDefaultModel(providerId: string): string {
  return PROVIDERS.find((provider) => provider.id === providerId)?.defaultModel ?? "";
}

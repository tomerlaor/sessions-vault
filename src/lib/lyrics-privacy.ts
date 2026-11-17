import type { AIConfig, AIProvider, LyricsAIConfig } from "../types";
import { resolveIsDecisionsModel } from "./openrouter-decisions";

export const CLOUD_AI_PROVIDERS: AIProvider[] = [
  "openai",
  "anthropic",
  "openrouter",
];
export const LOCAL_AI_PROVIDERS: AIProvider[] = ["ollama", "lmstudio"];

export function isCloudProvider(provider: AIProvider): boolean {
  return CLOUD_AI_PROVIDERS.includes(provider);
}

export function isLocalProvider(provider: AIProvider): boolean {
  return LOCAL_AI_PROVIDERS.includes(provider);
}

export function cloudProviderLabel(provider: AIProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "openrouter":
      return "OpenRouter";
    default:
      return provider;
  }
}

export function localProviderLabel(provider: AIProvider): string {
  return provider === "lmstudio" ? "LM Studio" : "Ollama";
}

export const LOCAL_PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234",
};

// True once the lyrics helper would send a cloud request without the user
// ever having agreed to it — either never granted, or granted for a
// provider that has since changed.
export function needsCloudConsent(
  provider: AIProvider | null | undefined,
  cloudConsentAt: number | null | undefined,
): boolean {
  return !!provider && isCloudProvider(provider) && !cloudConsentAt;
}

// Used by the consent modal's "Switch to local" action: keeps the current
// provider if it's already local, otherwise defaults to Ollama.
export function pickLocalProvider(current: AIProvider): AIProvider {
  return isLocalProvider(current) ? current : "ollama";
}

// Builds the AIConfig to persist when the user chooses "Switch to local" in
// the consent modal, preserving whatever baseUrl was already configured.
export function switchToLocalAIConfig(current: AIConfig): AIConfig {
  const provider = pickLocalProvider(current.provider);
  return {
    ...current,
    provider,
    // Keys and per-feature model overrides are provider-specific, same as
    // the provider-switch reset in Settings → AI Assistant.
    apiKey: "",
    model: "",
    lyricsModel: "",
    tabAgentModel: "",
    baseUrl: current.baseUrl || LOCAL_PROVIDER_DEFAULT_BASE_URL[provider],
  };
}

export type LyricsAiGate =
  | { status: "opted_out" }
  | { status: "disabled" }
  | { status: "needs_consent"; provider: AIProvider }
  | { status: "ok" };

// The single gate LyricsAiOverlay consults before reading the API key from
// the keychain or making any cloud request.
export function gateLyricsAi(
  projectAiOptOut: boolean,
  cfg: LyricsAIConfig,
  provider: AIProvider | null | undefined,
): LyricsAiGate {
  if (projectAiOptOut) return { status: "opted_out" };
  if (!cfg.enabled) return { status: "disabled" };
  if (provider && needsCloudConsent(provider, cfg.cloudConsentAt)) {
    return { status: "needs_consent", provider };
  }
  return { status: "ok" };
}

// Lyrics toolbar badge. Callers should resolve the lyrics model override
// (see resolveFeatureConfig in lib/ai.ts) before passing cfg in. This is a
// best-effort, synchronous check (pattern-only, no catalog fetch) — it can
// under-detect a decisions model that's only in the live catalog, in which
// case the badge just shows the single model as usual.
export function aiBadgeLabel(cfg: AIConfig | null): string | null {
  if (!cfg) return null;
  if (isLocalProvider(cfg.provider)) return "AI · Local";
  const model = cfg.model || "default";
  if (
    cfg.provider === "openrouter" &&
    resolveIsDecisionsModel(model, cfg.lyricsDecisionsMode)
  ) {
    const generator = cfg.lyricsGeneratorModel || "default generator";
    return `AI · Cloud: ${cfg.provider}/${model} + ${generator}`;
  }
  return `AI · Cloud: ${cfg.provider}/${model}`;
}

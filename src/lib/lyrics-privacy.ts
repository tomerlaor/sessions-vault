import type { AIConfig, AIFeature, AIProvider, LyricsAIConfig } from "../types";
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

// True once a feature would send a cloud request without the user ever
// having agreed to it for the *current* provider — never granted, granted
// for a provider that has since changed, or a legacy timestamp with no
// stored provider (re-ask; the disclosure names a specific provider).
export function needsCloudConsent(
  provider: AIProvider | null | undefined,
  cloudConsentAt: number | null | undefined,
  cloudConsentProvider?: AIProvider | null,
): boolean {
  if (!provider || !isCloudProvider(provider)) return false;
  if (!cloudConsentAt) return true;
  if (!cloudConsentProvider) return true;
  return cloudConsentProvider !== provider;
}

// Used by the consent modal's "Switch to local" action: keeps the current
// provider if it's already local, otherwise defaults to Ollama.
export function pickLocalProvider(current: AIProvider): AIProvider {
  return isLocalProvider(current) ? current : "ollama";
}

// Builds the AIConfig to persist when the user switches provider in
// Settings → AI Assistant. Clears the key, per-feature model overrides,
// and Tab Agent consent so a disclosure for the previous provider cannot
// unlock the new one. Lyrics consent lives on LyricsAIConfig and is
// re-checked by needsCloudConsent via cloudConsentProvider.
export function switchAIProvider(
  current: AIConfig,
  nextProvider: AIProvider,
): AIConfig {
  return {
    ...current,
    provider: nextProvider,
    apiKey: "",
    model: "",
    lyricsModel: "",
    tabAgentModel: "",
    tabAgentCloudConsentAt: undefined,
    tabAgentCloudConsentProvider: undefined,
  };
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

// How the probe talks to the local server, and why a failure is not always
// "the server is down":
//
// The app has no Tauri HTTP plugin and no Rust command for Ollama / LM
// Studio. Real lyrics and Tab Agent requests already go through the webview
// via the AI SDK (`createOpenAI` + a localhost baseURL in src/lib/ai.ts),
// so this probe uses the same `fetch` path. A new Rust/reqwest probe would
// bypass CORS and could report "up" even when the webview cannot actually
// call the server.
//
// CORS still matters: LM Studio has CORS off by default, and Ollama only
// allows certain origins, so a running server can make webview `fetch`
// throw. That case is returned as `unverified` (not `unreachable`) so the
// dialog can warn and still let the user switch. An HTTP error response
// means we reached something that isn't a healthy local API, so that stays
// a hard `unreachable`.
export type LocalProbeResult =
  | { status: "ok" }
  | { status: "unreachable"; message: string }
  | { status: "unverified"; message: string };

export async function probeLocalAIServer(
  provider: AIProvider,
  baseUrl?: string,
): Promise<LocalProbeResult> {
  const base = (
    baseUrl ||
    LOCAL_PROVIDER_DEFAULT_BASE_URL[provider] ||
    ""
  ).replace(/\/+$/, "");
  const label = localProviderLabel(provider);
  if (!base) {
    return {
      status: "unreachable",
      message: `No server URL configured for ${label}.`,
    };
  }
  const path = provider === "lmstudio" ? "/v1/models" : "/api/tags";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${base}${path}`, { signal: controller.signal });
    if (res.ok) return { status: "ok" };
    return {
      status: "unreachable",
      message: `${label} isn't running at ${base}. Start ${label} and try again, or keep using the cloud.`,
    };
  } catch {
    // Network error, abort, or a CORS failure (the browser hides the
    // response). We cannot tell a down server from a CORS block.
    return {
      status: "unverified",
      message: `${label} couldn't be verified at ${base}. It may be running, but this window couldn't reach it. You can switch anyway.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Decides what the consent dialog should do after a probe. `mounted` is
// false if the dialog was closed (or unmounted) while the probe was in
// flight — in that case a late result must not switch the provider.
export function applyLocalProbeResult(
  mounted: boolean,
  result: LocalProbeResult,
): "switch" | "block" | "warn_allow_anyway" | "ignore" {
  if (!mounted) return "ignore";
  if (result.status === "ok") return "switch";
  if (result.status === "unverified") return "warn_allow_anyway";
  return "block";
}

// Esc on the consent dialog: always swallow the key (so the Tab Agent and
// the app-level "leave project view" handlers don't also fire), but do not
// dismiss while a save or probe is in flight.
export function handleConsentEscape(
  e: { key: string; preventDefault: () => void; stopPropagation: () => void },
  opts: { disabled: boolean; onDismiss: () => void },
): void {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  if (opts.disabled) return;
  opts.onDismiss();
}

// Settings → AI Assistant "Revoke" for the lyrics helper: clears only the
// lyrics consent fields, leaving provider/key/model untouched.
export function revokeLyricsCloudConsent(cfg: LyricsAIConfig): LyricsAIConfig {
  return { ...cfg, cloudConsentAt: undefined, cloudConsentProvider: undefined };
}

// Settings → AI Assistant "Revoke" for the Tab Agent: clears only the Tab
// Agent consent fields, leaving provider/key/model untouched.
export function revokeTabAgentCloudConsent(cfg: AIConfig): AIConfig {
  return {
    ...cfg,
    tabAgentCloudConsentAt: undefined,
    tabAgentCloudConsentProvider: undefined,
  };
}

// Tab tab's disabled-AI-button copy (empty-state primary button and the
// compact parts-bar button use the same explanation, different lengths).
export function tabAgentOptOutButton({ compact }: { compact: boolean }): {
  label: string;
  title: string;
} {
  return {
    label: compact ? "AI off" : "AI off for this song",
    title:
      "AI is off for this song. Turn it back on with the AI toggle in the Lyrics tab.",
  };
}

export type CloudAiGate =
  | { status: "opted_out" }
  | { status: "disabled" }
  | { status: "needs_consent"; provider: AIProvider }
  | { status: "ok" };

export type LyricsAiGate = CloudAiGate;

// The single gate every cloud-AI feature (lyrics, tab agent) consults before
// reading the API key from the keychain or making any cloud request.
export function gateCloudAi(
  feature: AIFeature,
  project: { aiOptOut: boolean },
  provider: AIProvider | null | undefined,
  opts: {
    cloudConsentAt?: number | null;
    cloudConsentProvider?: AIProvider | null;
    enabled?: boolean;
  },
): CloudAiGate {
  if (project.aiOptOut) return { status: "opted_out" };
  if (feature === "lyrics" && opts.enabled === false) {
    return { status: "disabled" };
  }
  if (
    provider &&
    needsCloudConsent(provider, opts.cloudConsentAt, opts.cloudConsentProvider)
  ) {
    return { status: "needs_consent", provider };
  }
  return { status: "ok" };
}

// Thin wrapper kept for the lyrics helper's existing call sites/tests.
export function gateLyricsAi(
  projectAiOptOut: boolean,
  cfg: LyricsAIConfig,
  provider: AIProvider | null | undefined,
): CloudAiGate {
  return gateCloudAi("lyrics", { aiOptOut: projectAiOptOut }, provider, {
    cloudConsentAt: cfg.cloudConsentAt,
    cloudConsentProvider: cfg.cloudConsentProvider,
    enabled: cfg.enabled,
  });
}

export type TabAgentLoadDecision =
  | { kind: "opted_out" }
  | { kind: "no_config" }
  | { kind: "needs_consent"; provider: AIProvider }
  | { kind: "ok"; readKeychain: boolean };

// The Tab Agent modal's mount-time decision: whether it's safe to read the
// keychain and start the wizard, or whether it must stop and show opt-out,
// no-config, or consent UI first. `readKeychain` tells the caller whether
// it still needs getAIConfigFor (cloud) or can skip straight to
// resolveFeatureConfig on cfgNoKey (local — no key to read).
export function resolveTabAgentLoad(
  project: { aiOptOut: boolean },
  cfgNoKey: AIConfig | null,
): TabAgentLoadDecision {
  if (project.aiOptOut) return { kind: "opted_out" };
  const gate = gateCloudAi("tabAgent", project, cfgNoKey?.provider ?? null, {
    cloudConsentAt: cfgNoKey?.tabAgentCloudConsentAt,
    cloudConsentProvider: cfgNoKey?.tabAgentCloudConsentProvider,
  });
  if (gate.status === "needs_consent") {
    return { kind: "needs_consent", provider: gate.provider };
  }
  if (!cfgNoKey) return { kind: "no_config" };
  return { kind: "ok", readKeychain: !isLocalProvider(cfgNoKey.provider) };
}

// What an already-open Tab Agent should do when AI config changes (for
// example, Settings revoked Tab Agent cloud consent). "reconsent" means
// drop the loaded config so no further cloud request can go out.
export type TabAgentConfigChange =
  | { action: "reconsent"; provider: AIProvider }
  | { action: "opted_out" }
  | { action: "no_config" }
  | { action: "use_local" }
  | { action: "keep" };

export function tabAgentOnAIConfigChange(
  project: { aiOptOut: boolean },
  cfgNoKey: AIConfig | null,
): TabAgentConfigChange {
  const decision = resolveTabAgentLoad(project, cfgNoKey);
  if (decision.kind === "needs_consent") {
    return { action: "reconsent", provider: decision.provider };
  }
  if (decision.kind === "opted_out") return { action: "opted_out" };
  if (decision.kind === "no_config") return { action: "no_config" };
  if (decision.kind === "ok" && !decision.readKeychain) {
    return { action: "use_local" };
  }
  return { action: "keep" };
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

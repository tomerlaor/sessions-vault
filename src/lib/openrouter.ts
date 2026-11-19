import type { AIConfig, LyricsReasoningSetting } from "../types";

export interface OpenRouterModel {
  id: string;
  name: string;
  // OpenRouter's reasoning-capability metadata, present on catalog entries
  // that support the unified `reasoning` request field (see
  // https://openrouter.ai/docs/use-cases/reasoning-tokens). `mandatory`
  // models reject `effort:"none"` outright — see resolveReasoningParam.
  reasoning?: {
    mandatory?: boolean;
    supported_efforts?: string[];
  };
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Missing/undefined means true (deny) — the safer default.
export function openRouterDataCollection(cfg: AIConfig): "deny" | "allow" {
  return cfg.openRouterDenyDataCollection === false ? "allow" : "deny";
}

// ── Reasoning control ────────────────────────────────────────────────────────

interface ReasoningCapability {
  mandatory?: boolean;
  supportedEfforts?: string[];
}

// Covers Haiku 5.5 for the window between app start and the catalog fetch
// resolving (getCachedOpenRouterModels warms it in the background but never
// blocks a request on it). Anything not matched here with no resolved
// catalog entry gets no `reasoning` param at all, which is the safe default.
const STATIC_REASONING_SEED: {
  pattern: RegExp;
  capability: ReasoningCapability;
}[] = [
  {
    pattern: /^anthropic\/claude-.*-5\.5(:|$)/,
    capability: { mandatory: false, supportedEfforts: ["none"] },
  },
];

function findReasoningCapability(
  modelId: string,
): ReasoningCapability | undefined {
  const found = getCachedOpenRouterModels()?.find((m) => m.id === modelId);
  if (found) {
    return found.reasoning
      ? {
          mandatory: found.reasoning.mandatory,
          supportedEfforts: found.reasoning.supported_efforts,
        }
      : undefined;
  }
  return STATIC_REASONING_SEED.find((s) => s.pattern.test(modelId))?.capability;
}

function isDevEnv(): boolean {
  return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
}

// Resolves what (if anything) to send as the request body's `reasoning`
// field for a given model under a given per-feature setting. Mirrors
// isDecisionsModelId's approach: catalog metadata (or, until it resolves,
// the static seed above) is the source of truth for what a model accepts —
// a blind `effort:"none"` 400s on mandatory-reasoning models (145 of 471 in
// OpenRouter's catalog as of the diagnosis). `capability` is overridable for
// tests; production call sites always rely on the default lookup.
export function resolveReasoningParam(
  modelId: string,
  setting: LyricsReasoningSetting,
  capability: ReasoningCapability | undefined = findReasoningCapability(
    modelId,
  ),
): { effort: string } | undefined {
  if (setting === "provider-default") return undefined;
  const effort = setting === "off" ? "none" : setting;
  if (!capability) return undefined;
  if (capability.mandatory) {
    if (isDevEnv()) {
      console.warn(
        `[openrouter] not sending reasoning:${effort} to "${modelId}" — the catalog marks it mandatory`,
      );
    }
    return undefined;
  }
  if (!capability.supportedEfforts?.includes(effort)) return undefined;
  return { effort };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

// OpenRouter restricts routing to providers that don't collect/train on
// prompts via a `provider.data_collection` field in the JSON request body
// (see https://openrouter.ai/docs/guides/routing/provider-selection), and
// turns off adaptive reasoning via a `reasoning` field (see
// resolveReasoningParam above). @ai-sdk/openai's providerOptions don't
// surface either OpenRouter-specific field, so they're injected here via a
// custom fetch that rewrites the body. Only requests that look like a chat
// completions call (right URL, JSON body with a `model`) are touched — the
// decisions ranker (src/lib/openrouter-decisions.ts) posts to
// /api/alpha/decisions with plain fetch and must never see a `reasoning`
// field meant for a chat model.
export function createOpenRouterFetch(
  options: {
    dataCollection: "deny" | "allow";
    // Per-feature setting (undefined means "don't touch reasoning at all" —
    // used for the Tab Agent, tab structure, and testAIConnection).
    reasoning?: LyricsReasoningSetting;
  },
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (
          requestUrl(input).endsWith("/chat/completions") &&
          typeof body.model === "string"
        ) {
          body.provider = {
            ...body.provider,
            data_collection: options.dataCollection,
          };
          // Never overwrite a caller-supplied reasoning field.
          if (options.reasoning !== undefined && body.reasoning === undefined) {
            const reasoning = resolveReasoningParam(
              body.model,
              options.reasoning,
            );
            if (reasoning) body.reasoning = reasoning;
          }
          return baseFetch(input, { ...init, body: JSON.stringify(body) });
        }
      } catch {
        // Not a JSON body — pass through unchanged.
      }
    }
    return baseFetch(input, init);
  };
}

function parseReasoningMetadata(raw: unknown): OpenRouterModel["reasoning"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { mandatory?: unknown; supported_efforts?: unknown };
  return {
    mandatory: typeof r.mandatory === "boolean" ? r.mandatory : undefined,
    supported_efforts: Array.isArray(r.supported_efforts)
      ? r.supported_efforts.filter((e): e is string => typeof e === "string")
      : undefined,
  };
}

export function parseOpenRouterModels(json: unknown): OpenRouterModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (m): m is { id: string; name?: string; reasoning?: unknown } =>
        typeof m?.id === "string",
    )
    .map((m) => ({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
      reasoning: parseReasoningMetadata(m.reasoning),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Every whitespace-separated term must appear in the id or display name.
// Generic so callers that merge in extra fields (e.g. the decisions-model
// `isDecisions` tag in OpenRouterModelPicker) don't lose them through the
// filter.
export function filterOpenRouterModels<T extends OpenRouterModel>(
  models: T[],
  query: string,
): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return models;
  return models.filter((m) => {
    const hay = `${m.id} ${m.name}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

let cache: Promise<OpenRouterModel[]> | null = null;
let resolvedModels: OpenRouterModel[] | null = null;

// The catalog endpoint needs no API key. Cached for the session; a failed
// fetch is not cached so the next call retries.
export function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (!cache) {
    cache = fetch(`${OPENROUTER_BASE_URL}/models`)
      .then((r) => {
        if (!r.ok) throw new Error(`OpenRouter returned ${r.status}`);
        return r.json();
      })
      .then(parseOpenRouterModels)
      .then((models) => {
        resolvedModels = models;
        return models;
      })
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

// Non-blocking accessor for reasoning-capability lookups: returns the
// catalog only if it has already resolved (never awaits it — the inline
// lyrics path has a 5s first-token timeout), and kicks off (or reuses) the
// background fetch otherwise so a later call benefits from it.
export function getCachedOpenRouterModels(): OpenRouterModel[] | null {
  if (!resolvedModels) void fetchOpenRouterModels().catch(() => {});
  return resolvedModels;
}

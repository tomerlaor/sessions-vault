import type { AIConfig } from "../types";

export interface OpenRouterModel {
  id: string;
  name: string;
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Missing/undefined means true (deny) — the safer default.
export function openRouterDataCollection(cfg: AIConfig): "deny" | "allow" {
  return cfg.openRouterDenyDataCollection === false ? "allow" : "deny";
}

// OpenRouter restricts routing to providers that don't collect/train on
// prompts via a `provider.data_collection` field in the JSON request body
// (see https://openrouter.ai/docs/guides/routing/provider-selection).
// @ai-sdk/openai's providerOptions don't surface this OpenRouter-specific
// field, so it's injected here via a custom fetch that rewrites the body.
export function createOpenRouterFetch(
  dataCollection: "deny" | "allow",
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.provider = { ...body.provider, data_collection: dataCollection };
        return baseFetch(input, { ...init, body: JSON.stringify(body) });
      } catch {
        // Not a JSON body — pass through unchanged.
      }
    }
    return baseFetch(input, init);
  };
}

export function parseOpenRouterModels(json: unknown): OpenRouterModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (m): m is { id: string; name?: string } => typeof m?.id === "string",
    )
    .map((m) => ({
      id: m.id,
      name: typeof m.name === "string" ? m.name : m.id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Every whitespace-separated term must appear in the id or display name.
export function filterOpenRouterModels(
  models: OpenRouterModel[],
  query: string,
): OpenRouterModel[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return models;
  return models.filter((m) => {
    const hay = `${m.id} ${m.name}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

let cache: Promise<OpenRouterModel[]> | null = null;

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
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export interface OpenRouterModel {
  id: string;
  name: string;
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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

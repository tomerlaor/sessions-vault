// OpenRouter's Decisions API (https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).
// Decisions models (e.g. typesafe/jev-1.14) don't generate text — they answer
// typed yes/no, multiple-choice, or ordered-score questions about a `state`
// payload. This is the single module to update if OpenRouter changes the
// alpha shape; everything else (src/lib/ai.ts, the eval CLI, settings UI)
// goes through the exports here.
import type { AIConfig, LyricsDecisionsMode } from "../types";
import {
  OPENROUTER_BASE_URL,
  openRouterDataCollection,
  parseOpenRouterModels,
  type OpenRouterModel,
} from "./openrouter";
import { logAI, shouldLogAI } from "./ai";

// Alpha: not under /api/v1, and the request/response shape may still change.
export const OPENROUTER_DECISIONS_URL =
  "https://openrouter.ai/api/alpha/decisions";
export const OPENROUTER_DECISIONS_MODELS_URL = `${OPENROUTER_BASE_URL}/models?output_modalities=decisions`;

// ── Request/response types ──────────────────────────────────────────────────

// `instructions` and every criterion accept a plain string or a JSON
// structure (object/array) per the OpenAPI spec — callers in this codebase
// only ever send strings, but the wider type keeps this module honest.
type DecisionsText = string | Record<string, unknown> | unknown[];

export interface DecisionsNoulQuestion {
  type: "noul";
  instructions: DecisionsText;
  criteria?: { true?: DecisionsText; false?: DecisionsText };
}

export interface DecisionsChoiceQuestion {
  type: "choice";
  instructions: DecisionsText;
  criteria: Record<string, DecisionsText>;
}

export interface DecisionsScoreQuestion {
  type: "score";
  instructions: DecisionsText;
  criteria: DecisionsText[]; // ordered, lowest level first
}

// `box` (Jev 1.14 only, image bounding boxes) is intentionally omitted —
// nothing in this app asks an image question.
export type DecisionsQuestion =
  DecisionsNoulQuestion | DecisionsChoiceQuestion | DecisionsScoreQuestion;

export interface DecisionsRequestBody {
  model: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, DecisionsQuestion>;
  provider?: { data_collection?: "allow" | "deny"; [key: string]: unknown };
  session_id?: string;
  user?: string;
}

export interface DecisionsNoulAnswer {
  type: "noul";
  noul: number;
  confidence?: number;
}

export interface DecisionsChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface DecisionsScoreAnswer {
  type: "score";
  score: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface DecisionsRefusalAnswer {
  type: "refusal";
}

export type DecisionsAnswer =
  | DecisionsNoulAnswer
  | DecisionsChoiceAnswer
  | DecisionsScoreAnswer
  | DecisionsRefusalAnswer;

export interface DecisionsUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
}

export interface DecisionsResponseBody {
  id?: string;
  model: string;
  provider?: string;
  answers: Record<string, DecisionsAnswer>;
  usage: DecisionsUsage;
}

export class OpenRouterDecisionsError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "OpenRouterDecisionsError";
  }
}

// Thrown when the model declines to answer a question this module needed
// (e.g. the ranking question) — distinct from a transport/parse error so
// callers can decide whether a refusal should fall back silently.
export class DecisionsRefusalError extends Error {
  constructor(public questionId: string) {
    super(`Decisions model refused to answer "${questionId}"`);
    this.name = "DecisionsRefusalError";
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

// Decisions models aren't listed by the default /models endpoint, so a model
// ID can look exactly like a chat model's. These patterns catch the known
// families even when the catalog fetch fails or hasn't resolved yet; the
// catalog (fetchOpenRouterDecisionsModels) is the source of truth otherwise.
const KNOWN_DECISIONS_ID_PATTERNS: RegExp[] = [
  /^typesafe\/jev-/,
  /^~typesafe\/jev-/,
];

export function isDecisionsModelId(
  id: string,
  knownDecisionIds?: Set<string>,
): boolean {
  if (!id) return false;
  if (knownDecisionIds?.has(id)) return true;
  return KNOWN_DECISIONS_ID_PATTERNS.some((re) => re.test(id));
}

// Applies the user's lyricsDecisionsMode override (if any) before falling
// back to isDecisionsModelId. Shared by the app pipeline and the eval CLI so
// "auto"/"on"/"off" mean the same thing in both.
export function resolveIsDecisionsModel(
  modelId: string,
  mode: LyricsDecisionsMode | undefined,
  knownDecisionIds?: Set<string>,
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return isDecisionsModelId(modelId, knownDecisionIds);
}

let decisionsCache: Promise<OpenRouterModel[]> | null = null;

// Mirrors fetchOpenRouterModels in ./openrouter: no API key needed, cached
// for the session, and a failed fetch is not cached so the next call retries.
export function fetchOpenRouterDecisionsModels(
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterModel[]> {
  if (!decisionsCache) {
    decisionsCache = fetchImpl(OPENROUTER_DECISIONS_MODELS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`OpenRouter returned ${r.status}`);
        return r.json();
      })
      .then(parseOpenRouterModels)
      .catch((e) => {
        decisionsCache = null;
        throw e;
      });
  }
  return decisionsCache;
}

// ── Transport ────────────────────────────────────────────────────────────────

function extractErrorMessage(json: unknown, status: number): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error
    ?.message;
  return typeof message === "string"
    ? message
    : `OpenRouter decisions request failed (${status})`;
}

function parseDecisionsResponse(json: unknown): DecisionsResponseBody {
  const obj = json as Partial<DecisionsResponseBody> | null;
  if (
    !obj ||
    typeof obj !== "object" ||
    typeof obj.model !== "string" ||
    !obj.answers ||
    typeof obj.answers !== "object" ||
    !obj.usage ||
    typeof obj.usage.input_tokens !== "number" ||
    typeof obj.usage.output_tokens !== "number"
  ) {
    throw new OpenRouterDecisionsError(
      "OpenRouter decisions response is missing required fields",
    );
  }
  // Per-answer `type` is validated by callers when they read a specific
  // answer (see rankLyricCandidates) — the spec says to treat a missing key
  // or unexpected type as an error there, not to default it here.
  return obj as DecisionsResponseBody;
}

// POSTs to the Decisions endpoint with the OpenRouter bearer key and the
// same privacy (data_collection) and identification headers as the chat
// path. Never logs the key; dev-only request/response logging via logAI.
export async function callOpenRouterDecisions(
  cfg: AIConfig,
  body: DecisionsRequestBody,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DecisionsResponseBody> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const requestBody: DecisionsRequestBody = {
    ...body,
    provider: {
      ...body.provider,
      data_collection: openRouterDataCollection(cfg),
    },
  };

  const t0 = Date.now();
  const res = await fetchImpl(OPENROUTER_DECISIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      "X-Title": "Sessions",
    },
    body: JSON.stringify(requestBody),
    signal: opts.signal,
  });
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new OpenRouterDecisionsError(
      extractErrorMessage(json, res.status),
      res.status,
    );
  }

  const parsed = parseDecisionsResponse(json);
  if (shouldLogAI()) {
    logAI("callOpenRouterDecisions", {
      model: body.model,
      prompt: JSON.stringify(body.state).slice(0, 200),
      servedBy: parsed.model,
      durationMs: Date.now() - t0,
    });
  }
  return parsed;
}

// Trivial connectivity probe used by testAIConnection when the configured
// model is a decisions model (it can't answer a chat "say ok" prompt).
export function pingDecisionsModel(
  cfg: AIConfig,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DecisionsResponseBody> {
  return callOpenRouterDecisions(
    cfg,
    {
      model: cfg.model,
      state: "ping",
      questions: { ok: { type: "noul", instructions: "Answer true." } },
    },
    opts,
  );
}

// ── Lyric candidate ranking ──────────────────────────────────────────────────

export interface RankLyricCandidatesInput {
  // The exact system/prompt sent to the generator model — already carries
  // the song title, lyrics so far, mode and language, so the ranking
  // question is asked against the same context the candidates were written
  // from, without this module needing to know LyricsSuggestionInput's shape.
  system: string;
  prompt: string;
  candidates: string[];
}

export interface RankLyricCandidatesResult {
  // Candidates reordered best-first (or in `choice` order with no change
  // when probabilities are absent — see rankCandidatesByProbability).
  ranked: string[];
  topProbability?: number;
  servedModel: string;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
  cost?: number;
}

// Caps how much of the writer's lyrics ride along with every ranking
// request — keeps `state` small and cheap without losing the recent context
// a ranking judgement actually needs.
const MAX_STATE_PROMPT_CHARS = 4000;

function clip(text: string, max: number): string {
  return text.length > max ? `…${text.slice(-max)}` : text;
}

function rankCandidatesByProbability(
  keyToCandidate: Record<string, string>,
  answer: DecisionsChoiceAnswer,
): string[] {
  const keys = Object.keys(keyToCandidate);
  if (answer.probabilities) {
    const probs = answer.probabilities;
    return [...keys]
      .sort((a, b) => (probs[b] ?? -1) - (probs[a] ?? -1))
      .map((k) => keyToCandidate[k]);
  }
  // No probabilities on the answer — at least put the model's chosen
  // candidate first, keep the rest in their original order.
  const chosen = keyToCandidate[answer.choice];
  if (chosen === undefined) return Object.values(keyToCandidate);
  return [
    chosen,
    ...keys.filter((k) => k !== answer.choice).map((k) => keyToCandidate[k]),
  ];
}

// Asks the decisions model to pick the best of several already-generated
// lyric candidates. One request per call — the "decide" half of the
// "generate, then decide" pipeline in src/lib/ai.ts.
export async function rankLyricCandidates(
  cfg: AIConfig,
  input: RankLyricCandidatesInput,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<RankLyricCandidatesResult> {
  const criteria: Record<string, string> = {};
  input.candidates.forEach((text, i) => {
    criteria[`c${i}`] = text;
  });

  const t0 = Date.now();
  const response = await callOpenRouterDecisions(
    cfg,
    {
      model: cfg.model,
      state: {
        task: clip(input.system, MAX_STATE_PROMPT_CHARS),
        context: clip(input.prompt, MAX_STATE_PROMPT_CHARS),
      },
      questions: {
        best: {
          type: "choice",
          instructions:
            "Pick the best lyric suggestion to use next. A good suggestion fits the song's meter and rhyme scheme, is written in the same language as the rest of the song, avoids clichés, does not repeat or copy an earlier line, and contains only the lyric text itself — no chatty preamble or explanation.",
          criteria,
        },
      },
    },
    opts,
  );
  const durationMs = Date.now() - t0;

  const answer = response.answers.best;
  if (!answer || typeof answer !== "object" || !("type" in answer)) {
    throw new OpenRouterDecisionsError(
      'Decisions response is missing the "best" answer',
    );
  }
  if (answer.type === "refusal") throw new DecisionsRefusalError("best");
  if (answer.type !== "choice") {
    throw new OpenRouterDecisionsError(
      `Expected a "choice" answer for "best", got "${answer.type}"`,
    );
  }

  return {
    ranked: rankCandidatesByProbability(criteria, answer),
    topProbability: answer.probabilities?.[answer.choice],
    servedModel: response.model,
    durationMs,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    cost: response.usage.cost,
  };
}

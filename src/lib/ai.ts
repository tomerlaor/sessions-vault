import {
  generateObject,
  generateText,
  streamText,
  wrapLanguageModel,
} from "ai";
import type { LanguageModelUsage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { AIConfig, AIFeature, Instrument } from "../types";
import {
  OPENROUTER_BASE_URL,
  openRouterDataCollection,
  createOpenRouterFetch,
} from "./openrouter";
import {
  isDecisionsModelId,
  fetchOpenRouterDecisionsModels,
  rankLyricCandidates,
  pingDecisionsModel,
} from "./openrouter-decisions";
import {
  extractJsonText,
  parseNextWordOptions,
  rawTextFromObjectError,
  repairAiJsonText,
} from "./parse-ai-json";
import { isLocalProvider } from "./lyrics-privacy";
import {
  createTraceContext,
  createTracingMiddleware,
  hashPrompt,
  scrubError,
  type SpanMode,
  type SpanRecord,
  type SpanStatus,
  type TraceContext,
} from "./ai-trace";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5-20251001",
  openrouter: "anthropic/claude-haiku-4.5",
  ollama: "llama3",
  lmstudio: "local-model",
};

export const OPENAI_MODELS = [
  // GPT-4.1 family
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  // GPT-4o family
  "gpt-4o",
  "gpt-4o-mini",
  // o-series reasoning
  "o4-mini",
  "o3",
  "o3-mini",
  "o3-pro",
  "o1",
  "o1-mini",
  "o1-pro",
];
export const ANTHROPIC_MODELS = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-7",
];

// Vite inlines import.meta.env at build time (DEV is boolean false in
// production). Under the Node CLI (tsx / `npm run ai`) it is undefined, so
// every default argument must tolerate a missing env object.
export function resolveAiLogEnv(
  env?: { DEV?: boolean },
  metaEnv?: { DEV?: boolean },
): { DEV?: boolean } {
  return env ?? metaEnv ?? {};
}

// Release builds must never print prompts or responses to the console.
export function shouldLogAI(env?: { DEV?: boolean }): boolean {
  return !!resolveAiLogEnv(env, import.meta.env).DEV;
}

// DEV console sink of a completed trace SpanRecord (T1, #89) — never prints
// prompt/system/output text because SpanRecord never carries it. This is
// the only overload new code should reach for; the string-label overload
// below is kept so existing call sites compile unchanged.
export function logAI(span: SpanRecord, env?: { DEV?: boolean }): void;
export function logAI(
  fn: string,
  fields: {
    model: string;
    system?: string;
    prompt?: string;
    messages?: { role: string; content: string }[];
    usage?: LanguageModelUsage;
    finishReason?: string;
    text?: string;
    durationMs: number;
    // Model that actually answered, as reported by the provider. For routers
    // such as typesafe/jev-router this may differ from `model`, or just echo it.
    servedBy?: string;
  },
  env?: { DEV?: boolean },
): void;
export function logAI(
  fnOrSpan: string | SpanRecord,
  fieldsOrEnv?:
    | {
        model: string;
        system?: string;
        prompt?: string;
        messages?: { role: string; content: string }[];
        usage?: LanguageModelUsage;
        finishReason?: string;
        text?: string;
        durationMs: number;
        servedBy?: string;
      }
    | { DEV?: boolean },
  maybeEnv?: { DEV?: boolean },
): void {
  if (typeof fnOrSpan !== "string") {
    const span = fnOrSpan;
    const env = fieldsOrEnv as { DEV?: boolean } | undefined;
    if (!shouldLogAI(env)) return;
    console.group(
      `%c[AI] span ${span.operation}`,
      "color:#ff7a45;font-weight:700",
    );
    console.log(
      "feature    :",
      span.feature,
      span.mode ? `(${span.mode})` : "",
    );
    console.log(
      "provider   :",
      span.provider ?? "(unknown)",
      span.locality ? `· ${span.locality}` : "",
    );
    console.log("model      :", span.requestModel ?? "(unknown)");
    if (span.responseModel) console.log("served by  :", span.responseModel);
    console.log("status     :", span.status, `(attempts: ${span.attempts})`);
    if (span.durationMs !== undefined) {
      console.log("duration   :", `${span.durationMs}ms`);
    }
    if (span.ttftMs !== undefined && span.ttftMs !== null) {
      console.log("ttft       :", `${span.ttftMs}ms`);
    }
    if (span.inputTokens !== undefined || span.outputTokens !== undefined) {
      console.log(
        "tokens     :",
        `${span.inputTokens ?? "?"} in + ${span.outputTokens ?? "?"} out`,
      );
    }
    if (span.finishReason) console.log("finish     :", span.finishReason);
    if (span.promptHash) console.log("prompt hash:", span.promptHash);
    if (span.errorType) {
      console.log("error      :", span.errorType, span.errorMessage ?? "");
    }
    console.groupEnd();
    return;
  }

  const fn = fnOrSpan;
  const {
    model,
    system,
    prompt,
    messages,
    usage,
    finishReason,
    text,
    durationMs,
    servedBy,
  } = fieldsOrEnv as {
    model: string;
    system?: string;
    prompt?: string;
    messages?: { role: string; content: string }[];
    usage?: LanguageModelUsage;
    finishReason?: string;
    text?: string;
    durationMs: number;
    servedBy?: string;
  };
  const env = maybeEnv;
  if (!shouldLogAI(env)) return;
  const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);
  console.group(`%c[AI] ${fn}`, "color:#ff7a45;font-weight:700");
  console.log("model      :", model);
  console.log("served by  :", servedBy ?? "(not reported)");
  if (system) console.log("system     :", clip(system));
  if (prompt) console.log("prompt     :", clip(prompt));
  if (messages?.length) {
    console.group("messages");
    messages.forEach((m) =>
      console.log(`  ${m.role.padEnd(9)}:`, clip(m.content)),
    );
    console.groupEnd();
  }
  console.log("duration   :", `${durationMs}ms`);
  if (usage) {
    const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    console.log(
      "tokens     :",
      `${usage.inputTokens ?? "?"} in + ${usage.outputTokens ?? "?"} out = ${total} total`,
    );
  }
  if (finishReason) console.log("finish     :", finishReason);
  if (text) console.log("response   :", clip(text));
  console.groupEnd();
}

// Returns cfg with `model` replaced by the feature's override, if one is set.
export function resolveFeatureConfig(
  cfg: AIConfig,
  feature: AIFeature,
): AIConfig {
  const override = feature === "lyrics" ? cfg.lyricsModel : cfg.tabAgentModel;
  return override ? { ...cfg, model: override } : cfg;
}

function buildProviderModel(cfg: AIConfig, model: string) {
  switch (cfg.provider) {
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey })(model);

    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(model);

    case "openrouter":
      return createOpenAI({
        baseURL: OPENROUTER_BASE_URL,
        apiKey: cfg.apiKey,
        headers: { "X-Title": "Sessions" },
        // OpenRouter's stable API is chat completions, not the Responses API
        // that createOpenAI(...)(model) targets by default.
        fetch: createOpenRouterFetch(openRouterDataCollection(cfg)),
      }).chat(model);

    case "ollama":
      return createOpenAI({
        baseURL: (cfg.baseUrl || "http://localhost:11434") + "/v1",
        apiKey: "ollama",
      })(model);

    case "lmstudio":
      return createOpenAI({
        baseURL: (cfg.baseUrl || "http://localhost:1234") + "/v1",
        apiKey: "lm-studio",
      })(model);
  }
}

// The single choke point every provider client goes through (T1, #89). When
// a trace is given, the resulting model is wrapped with the tracing
// middleware, so every one of the 7 call sites below is observed the same
// way regardless of provider. There is no persistence here — a trace with
// no `store` just records attempts/usage onto `trace.span` in memory.
function buildProvider(cfg: AIConfig, trace?: TraceContext) {
  const model = cfg.model || DEFAULT_MODELS[cfg.provider];
  const base = buildProviderModel(cfg, model);
  if (!trace) return base;

  trace.span.provider = cfg.provider;
  trace.span.locality = isLocalProvider(cfg.provider) ? "local" : "cloud";
  trace.span.requestModel = model;

  return wrapLanguageModel({
    model: base,
    middleware: createTracingMiddleware(trace),
  });
}

// Used by every one of the 7 call sites below when the caller didn't thread
// a TraceContext through (no caller does yet in this PR — that's T2's job).
// Still wraps the provider via buildProvider so untraced call sites remain
// visible to a DEV console warning instead of silently skipping tracing.
function resolveTrace(
  trace: TraceContext | undefined,
  meta: { operation: string; mode?: SpanMode },
): TraceContext {
  if (trace) return trace;
  if (shouldLogAI()) {
    console.warn(
      `[ai-trace] ${meta.operation} called without a trace context; recording as feature:"unknown"`,
    );
  }
  return createTraceContext({
    feature: "unknown",
    operation: meta.operation,
    mode: meta.mode,
  });
}

// Shared by every call site's outer catch: classifies the final (possibly
// already-transformed, e.g. by generateObjectLenient's fallback) error onto
// the operation-level span. Tracing must never throw, so this swallows its
// own failures — the original error is always rethrown by the caller.
function finalizeTraceError(trace: TraceContext, err: unknown): void {
  try {
    const { errorType, errorMessage } = scrubError(err);
    const status: SpanStatus =
      errorType === "abort"
        ? err instanceof Error && err.name === "TimeoutError"
          ? "timeout"
          : "cancelled"
        : "error";
    trace.span.status = status;
    trace.span.errorType = errorType;
    trace.span.errorMessage = errorMessage;
  } catch {
    // tracing failures must never break the model call
  }
}

// Fills in the span metadata ai.ts's wrappers can know without ever storing
// prompt/system/output text itself — only char counts, params and (when a
// salt is available on the trace) a keyed hash.
async function annotateTrace(
  trace: TraceContext,
  opts: {
    system?: string;
    prompt?: string;
    params?: Record<string, unknown>;
  },
): Promise<void> {
  if (opts.system !== undefined) trace.span.systemChars = opts.system.length;
  if (opts.prompt !== undefined) trace.span.promptChars = opts.prompt.length;
  if (opts.params) trace.span.paramsJson = JSON.stringify(opts.params);
  if (trace.salt && opts.system !== undefined && opts.prompt !== undefined) {
    try {
      trace.span.promptHash = await hashPrompt(
        trace.salt,
        opts.system,
        opts.prompt,
      );
    } catch {
      // never block a call on a hashing failure
    }
  }
}

// ── OpenRouter decisions: "generate, then decide" ───────────────────────────
// A decisions model (e.g. typesafe/jev-1.14) can't write text, so wherever
// one is configured as the (feature-resolved) model, a separate chat
// "generator" model produces the actual text and the decisions model only
// ranks/judges it. See src/lib/openrouter-decisions.ts for the API itself.

export const DEFAULT_LYRICS_CANDIDATE_COUNT = 4;
const MIN_LYRICS_CANDIDATE_COUNT = 2;
const MAX_LYRICS_CANDIDATE_COUNT = 8;

function clampCandidateCount(n: number | undefined): number {
  const v = Math.round(n ?? DEFAULT_LYRICS_CANDIDATE_COUNT);
  return Math.min(
    MAX_LYRICS_CANDIDATE_COUNT,
    Math.max(MIN_LYRICS_CANDIDATE_COUNT, v),
  );
}

// The config the generator stage runs with: same connection, but the
// user's chosen (or default) generator model instead of the decisions model.
function buildGeneratorConfig(cfg: AIConfig): AIConfig {
  return {
    ...cfg,
    model: cfg.lyricsGeneratorModel || DEFAULT_MODELS.openrouter,
  };
}

// Resolves whether `cfg.model` (already feature-resolved by the caller) is
// an OpenRouter decisions model: the user's lyricsDecisionsMode override
// wins, then the built-in pattern list (no network needed), then the
// catalog fetch as a last resort. A failed catalog fetch (offline) resolves
// to false rather than throwing, since callers treat "not decisions" as the
// safe default (same behavior as before this feature existed).
export async function isLyricsModelDecisions(cfg: AIConfig): Promise<boolean> {
  if (cfg.provider !== "openrouter") return false;
  const model = cfg.model || DEFAULT_MODELS.openrouter;
  if (cfg.lyricsDecisionsMode === "on") return true;
  if (cfg.lyricsDecisionsMode === "off") return false;
  if (isDecisionsModelId(model)) return true;
  try {
    const catalog = await fetchOpenRouterDecisionsModels();
    return catalog.some((m) => m.id === model);
  } catch {
    return false;
  }
}

// Swaps in the generator config when `cfg` is a decisions model, for the
// call sites that only ever need plain text (style summary, tab agent) and
// have no ranking step of their own.
async function ensureTextCapableConfig(cfg: AIConfig): Promise<AIConfig> {
  if (cfg.provider !== "openrouter") return cfg;
  return (await isLyricsModelDecisions(cfg)) ? buildGeneratorConfig(cfg) : cfg;
}

function emptyUsage(): LanguageModelUsage {
  return {
    inputTokens: 0,
    inputTokenDetails: {
      noCacheTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 0,
    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
    totalTokens: 0,
  };
}

// Sums two usage objects. Defensive about missing nested fields because
// test mocks (and possibly some providers) return a bare `{}`.
function addUsage(
  a: LanguageModelUsage | undefined,
  b: LanguageModelUsage | undefined,
): LanguageModelUsage {
  const base = a ?? emptyUsage();
  if (!b) return base;
  return {
    inputTokens: (base.inputTokens ?? 0) + (b.inputTokens ?? 0),
    inputTokenDetails: {
      noCacheTokens:
        (base.inputTokenDetails?.noCacheTokens ?? 0) +
        (b.inputTokenDetails?.noCacheTokens ?? 0),
      cacheReadTokens:
        (base.inputTokenDetails?.cacheReadTokens ?? 0) +
        (b.inputTokenDetails?.cacheReadTokens ?? 0),
      cacheWriteTokens:
        (base.inputTokenDetails?.cacheWriteTokens ?? 0) +
        (b.inputTokenDetails?.cacheWriteTokens ?? 0),
    },
    outputTokens: (base.outputTokens ?? 0) + (b.outputTokens ?? 0),
    outputTokenDetails: {
      textTokens:
        (base.outputTokenDetails?.textTokens ?? 0) +
        (b.outputTokenDetails?.textTokens ?? 0),
      reasoningTokens:
        (base.outputTokenDetails?.reasoningTokens ?? 0) +
        (b.outputTokenDetails?.reasoningTokens ?? 0),
    },
    totalTokens: (base.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}

// Converts the Decisions API's plain {input_tokens, output_tokens} usage
// into the shape the rest of this file (and LyricsCallMetrics) use.
function decisionsUsageAsLanguageModelUsage(usage: {
  inputTokens: number;
  outputTokens: number;
}): LanguageModelUsage {
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: usage.inputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: { textTokens: usage.outputTokens, reasoningTokens: 0 },
    totalTokens: usage.inputTokens + usage.outputTokens,
  };
}

export interface LyricsRankerStageMetrics {
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
  cost?: number;
  model: string;
}

export interface LyricsGeneratorStageMetrics {
  durationMs: number;
  usage?: LanguageModelUsage;
  model: string;
  count?: number;
}

// Ranks already-generated text items by the decisions model and reorders
// `items` to match (best first). Falls back to the original order — and
// logs in dev only — if the ranking call fails for any reason other than
// an abort, so the lyrics helper/eval still works when ranking errors.
async function rankByDecisions<T extends { text: string }>(
  cfg: AIConfig,
  system: string,
  prompt: string,
  items: T[],
  signal: AbortSignal | undefined,
): Promise<{ items: T[]; ranker?: LyricsRankerStageMetrics }> {
  if (items.length < 2) return { items };
  try {
    const result = await rankLyricCandidates(
      cfg,
      { system, prompt, candidates: items.map((it) => it.text) },
      { signal },
    );
    // Duplicate candidate texts are matched in order via per-text queues,
    // so a repeated suggestion doesn't get assigned to the wrong item.
    const queues = new Map<string, T[]>();
    for (const item of items) {
      const queue = queues.get(item.text) ?? [];
      queue.push(item);
      queues.set(item.text, queue);
    }
    const reordered: T[] = [];
    for (const text of result.ranked) {
      const queue = queues.get(text);
      const next = queue?.shift();
      if (next) reordered.push(next);
    }
    for (const queue of queues.values()) reordered.push(...queue);
    return {
      items: reordered,
      ranker: {
        durationMs: result.durationMs,
        usage: result.usage,
        cost: result.cost,
        model: result.servedModel,
      },
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    if (shouldLogAI()) {
      logAI("rankByDecisions", {
        model: cfg.model,
        text: `ranking failed, using unranked order: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
      });
    }
    return { items };
  }
}

// R1 capped next_word answers at 60 tokens. Structured JSON for 4 short
// options needs a small envelope on top of those words; this stays a tight
// cap, not an open-ended completion.
export const NEXT_WORD_MAX_OUTPUT_TOKENS = 120;

const JSON_ONLY_INSTRUCTION =
  "Return only a single JSON object that matches the required schema. No markdown fences and no commentary.";

async function generateObjectLenient<S extends z.ZodTypeAny>({
  provider,
  schema,
  system,
  prompt,
  maxOutputTokens,
  maxRetries,
  signal,
  parseObject,
}: {
  provider: ReturnType<typeof buildProvider>;
  schema: S;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  // Optional lenient parser tried before the schema, so recovery can accept
  // aliases or salvage a truncated reply. The generateObject call itself
  // still uses `schema` so the model is shown the canonical JSON shape.
  parseObject?: (text: string) => z.infer<S> | null;
}): Promise<{
  object: z.infer<S>;
  usage?: LanguageModelUsage;
  finishReason?: string;
  response?: { modelId?: string };
}> {
  const parseFromText = (text: string): z.infer<S> | null => {
    if (parseObject) {
      const custom = parseObject(text);
      if (custom) return custom;
    }
    const extracted = extractJsonText(text);
    if (!extracted) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(extracted));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  try {
    const result = await generateObject({
      model: provider,
      schema,
      system,
      prompt,
      maxOutputTokens,
      maxRetries,
      abortSignal: signal,
      experimental_repairText: repairAiJsonText,
    });
    return {
      object: result.object,
      usage: result.usage,
      finishReason: result.finishReason,
      response: result.response,
    };
  } catch (error) {
    if (signal?.aborted) throw error;

    const raw = rawTextFromObjectError(error);
    const recovered = raw ? parseFromText(raw) : null;
    if (recovered) {
      return { object: recovered };
    }

    const fallback = await generateText({
      model: provider,
      system: [system, JSON_ONLY_INSTRUCTION].filter(Boolean).join("\n\n"),
      prompt,
      maxOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
    });
    const fromText = parseFromText(fallback.text);
    if (fromText) {
      return {
        object: fromText,
        usage: fallback.usage,
        finishReason: fallback.finishReason,
        response: fallback.response,
      };
    }

    const rawCombined = (fallback.text || raw).trim();
    const snippet = rawCombined.slice(0, 500);
    const base =
      error instanceof Error
        ? error.message
        : "No object generated: could not parse the response.";
    const err = new Error(
      snippet ? `${base} Raw text: ${snippet}` : base,
    ) as Error & {
      text?: string;
    };
    if (rawCombined) err.text = rawCombined;
    throw err;
  }
}

export async function testAIConnection(
  cfg: AIConfig,
  options?: { trace?: TraceContext },
): Promise<void> {
  const trace = resolveTrace(options?.trace, { operation: "test_connection" });
  try {
    if (cfg.provider === "openrouter" && (await isLyricsModelDecisions(cfg))) {
      const t0 = Date.now();
      const response = await pingDecisionsModel(cfg);
      trace.span.provider = cfg.provider;
      trace.span.requestModel = cfg.model || cfg.provider;
      trace.span.responseModel = response.model;
      trace.span.durationMs = Date.now() - t0;
      logAI("testAIConnection", {
        model: cfg.model || cfg.provider,
        prompt: "decisions ping (noul question)",
        servedBy: response.model,
        durationMs: trace.span.durationMs,
      });
      return;
    }
    const provider = buildProvider(cfg, trace);
    const t0 = Date.now();
    await generateText({
      model: provider,
      prompt: "Reply with the single word: ok",
      onFinish({ text, usage, finishReason, response }) {
        trace.span.durationMs = Date.now() - t0;
        trace.span.outputChars = text.length;
        logAI("testAIConnection", {
          model: cfg.model || cfg.provider,
          prompt: "Reply with the single word: ok",
          usage,
          finishReason,
          servedBy: response?.modelId,
          text,
          durationMs: trace.span.durationMs,
        });
      },
    });
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export interface TabGenerationInput {
  sectionName: string;
  instruments: Instrument[];
  chords: string;
  bars: number;
  timeSignature: string;
  styleNote: string;
}

export const tabPartsSchema = z.object({
  parts: z.array(
    z.object({
      instrument: z.enum(["guitar", "bass", "drums"]),
      name: z.string(),
      content: z.string(),
    }),
  ),
});

export type GeneratedParts = z.infer<typeof tabPartsSchema>;

export async function generateTabStructure(
  cfg: AIConfig,
  input: TabGenerationInput,
  options?: { trace?: TraceContext },
): Promise<GeneratedParts> {
  const trace = resolveTrace(options?.trace, { operation: "tab_structure" });
  // Decisions models can't write text — fall back to the generator model.
  const effectiveCfg = await ensureTextCapableConfig(cfg);
  const provider = buildProvider(effectiveCfg, trace);

  const instList = input.instruments.join(", ");
  const styleClause = input.styleNote ? `\nStyle/feel: ${input.styleNote}` : "";

  const prompt = `Generate blank ASCII tablature structure for the following song section.
Do NOT fill in any notes or fret numbers — use only dashes for empty beats.
Use | to mark bar lines. Each bar should have exactly 4 beats in ${input.timeSignature} time (adjust beat count accordingly).
Put the section name as a comment on the first line using // notation.

Section: ${input.sectionName}
Instruments: ${instList}
Chord progression: ${input.chords}
Number of bars: ${input.bars}
Time signature: ${input.timeSignature}${styleClause}

Rules per instrument:
- guitar: 6 strings labeled e B G D A E (high to low), one line each, bar lines with |
- bass: 4 strings labeled G D A E, one line each, bar lines with |
- drums: rows labeled BD SN HH (add OH CY if useful), bar lines with |, use - for empty beats

Name each part as "<SectionName> <Instrument>" (e.g. "Verse Guitar").
Return exactly ${input.instruments.length} part(s), one per requested instrument.`;

  await annotateTrace(trace, {
    prompt,
    params: { schema: "tabParts" },
  });
  const t0 = Date.now();
  try {
    const result = await generateObjectLenient({
      provider,
      schema: tabPartsSchema,
      prompt,
    });
    trace.span.durationMs = Date.now() - t0;
    trace.span.outputChars = JSON.stringify(result.object).length;
    logAI("generateTabStructure", {
      model: effectiveCfg.model || effectiveCfg.provider,
      prompt,
      usage: result.usage,
      finishReason: result.finishReason,
      servedBy: result.response?.modelId,
      text: JSON.stringify(result.object),
      durationMs: trace.span.durationMs,
    });

    return result.object;
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export async function chatWithTabAgent(
  cfg: AIConfig,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
  options?: { trace?: TraceContext },
): Promise<string> {
  const trace = resolveTrace(options?.trace, { operation: "tab_chat" });
  // Decisions models can't write text — fall back to the generator model.
  const effectiveCfg = await ensureTextCapableConfig(cfg);
  const provider = buildProvider(effectiveCfg, trace);
  await annotateTrace(trace, { system, params: { maxOutputTokens: 400 } });
  const t0 = Date.now();
  try {
    const result = await generateText({
      model: provider,
      system,
      messages,
      maxOutputTokens: 400,
      onFinish({ text, usage, finishReason, response }) {
        trace.span.durationMs = Date.now() - t0;
        trace.span.outputChars = text.length;
        logAI("chatWithTabAgent", {
          model: effectiveCfg.model || effectiveCfg.provider,
          system,
          messages,
          usage,
          finishReason,
          servedBy: response?.modelId,
          text,
          durationMs: trace.span.durationMs,
        });
      },
    });
    return result.text.trim();
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

// ── Lyrics AI ─────────────────────────────────────────────────────────────────

// Timing/usage for a single model call, collected for the eval harness
// (scripts/lyrics-eval). Optional and additive — existing callers that don't
// pass a callback see no behavior change.
export interface LyricsCallMetrics {
  ttftMs: number | null; // time to first stream chunk; null if none arrived
  totalMs: number; // end-to-end total, including the ranker stage if any
  usage?: LanguageModelUsage; // end-to-end total, summed across stages
  // Present only on the OpenRouter decisions "generate, then decide" path.
  generator?: LyricsGeneratorStageMetrics;
  ranker?: LyricsRankerStageMetrics;
  // Generator-order texts, before the ranker reorders them. The eval uses
  // these to score every candidate and measure picker accuracy. `pickedIndex`
  // is the index in this array of the suggestion that was actually returned
  // (0 when ranking is skipped or falls back to the unranked order).
  unrankedCandidates?: string[];
  pickedIndex?: number;
}

interface CandidateResult {
  text: string;
  usage?: LanguageModelUsage;
}

async function generateOneLyricCandidate(
  generatorCfg: AIConfig,
  system: string,
  prompt: string,
  signal: AbortSignal | undefined,
  trace: TraceContext,
): Promise<CandidateResult> {
  const provider = buildProvider(generatorCfg, trace);
  const result = await generateText({
    model: provider,
    system,
    prompt,
    maxOutputTokens: 80,
    maxRetries: 0,
    abortSignal: signal,
  });
  return { text: result.text.trim(), usage: result.usage };
}

// Decisions variant of streamLyricsSuggestion: generates
// `lyricsCandidateCount` candidates in parallel with the generator model,
// has the decisions model rank them, and yields only the winner once (no
// incremental tokens — the ranking step needs the full candidate text).
async function* streamLyricsSuggestionViaDecisions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal: AbortSignal | undefined,
  onMetrics: ((metrics: LyricsCallMetrics) => void) | undefined,
  trace: TraceContext,
): AsyncGenerator<string> {
  try {
    const generatorCfg = buildGeneratorConfig(cfg);
    const count = clampCandidateCount(cfg.lyricsCandidateCount);
    const t0 = Date.now();

    const settled = await Promise.allSettled(
      Array.from({ length: count }, () =>
        generateOneLyricCandidate(generatorCfg, system, prompt, signal, trace),
      ),
    );
    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<CandidateResult> =>
        r.status === "fulfilled",
    );
    if (fulfilled.length === 0) {
      const firstRejected = settled.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      throw firstRejected
        ? firstRejected.reason
        : new Error("All candidate generations failed");
    }

    const generatorMs = Date.now() - t0;
    const genUsage = fulfilled.reduce(
      (acc, r) => addUsage(acc, r.value.usage),
      emptyUsage(),
    );
    if (shouldLogAI()) {
      logAI("streamLyricsSuggestion (generator stage)", {
        model: generatorCfg.model,
        system,
        prompt,
        usage: genUsage,
        durationMs: generatorMs,
      });
    }

    const candidates = fulfilled
      .map((r) => r.value.text)
      .filter((t) => t.length > 0);
    if (candidates.length === 0) {
      trace.span.durationMs = Date.now() - t0;
      onMetrics?.({ ttftMs: null, totalMs: Date.now() - t0, usage: genUsage });
      return;
    }

    const unrankedItems = candidates.map((text) => ({ text }));
    const { items: ranked, ranker } = await rankByDecisions(
      cfg,
      system,
      prompt,
      unrankedItems,
      signal,
    );
    const picked = ranked[0] ?? unrankedItems[0];
    const pickedIndex = picked ? unrankedItems.indexOf(picked) : 0;
    trace.span.durationMs = Date.now() - t0;
    trace.span.outputChars = (picked?.text ?? candidates[0]).length;
    yield picked?.text ?? candidates[0];

    if (onMetrics) {
      const totalMs = Date.now() - t0;
      const usage = ranker
        ? addUsage(genUsage, decisionsUsageAsLanguageModelUsage(ranker.usage))
        : genUsage;
      // One emission once ranking completes — no earlier partial token to
      // time, so ttftMs and totalMs are the same here.
      onMetrics({
        ttftMs: totalMs,
        totalMs,
        usage,
        generator: {
          durationMs: generatorMs,
          usage: genUsage,
          model: generatorCfg.model,
          count,
        },
        ranker,
        unrankedCandidates: candidates,
        pickedIndex: pickedIndex < 0 ? 0 : pickedIndex,
      });
    }
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export async function* streamLyricsSuggestion(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal?: AbortSignal,
  onMetrics?: (metrics: LyricsCallMetrics) => void,
  options?: { trace?: TraceContext },
): AsyncGenerator<string> {
  const trace = resolveTrace(options?.trace, {
    operation: "stream_suggestion",
  });
  await annotateTrace(trace, {
    system,
    prompt,
    params: { maxOutputTokens: 80, maxRetries: 0 },
  });

  if (cfg.provider === "openrouter" && (await isLyricsModelDecisions(cfg))) {
    yield* streamLyricsSuggestionViaDecisions(
      cfg,
      system,
      prompt,
      signal,
      onMetrics,
      trace,
    );
    return;
  }
  const provider = buildProvider(cfg, trace);
  const t0 = Date.now();
  let ttftMs: number | null = null;
  try {
    // streamText is intentionally not awaited — result.textStream is consumed lazily
    const result = streamText({
      model: provider,
      system,
      prompt,
      maxOutputTokens: 80,
      maxRetries: 0,
      abortSignal: signal,
      onFinish({ text, usage, finishReason, response }) {
        trace.span.durationMs = Date.now() - t0;
        trace.span.outputChars = text.length;
        logAI("streamLyricsSuggestion", {
          model: cfg.model || cfg.provider,
          system,
          prompt,
          usage,
          finishReason,
          servedBy: response?.modelId,
          text,
          durationMs: trace.span.durationMs,
        });
      },
    });
    for await (const chunk of result.textStream) {
      if (ttftMs === null) ttftMs = Date.now() - t0;
      yield chunk;
    }
    // Await usage after the stream is fully consumed so the eval harness
    // (and any other onMetrics caller) does not race onFinish.
    if (onMetrics) {
      const usage = await result.usage;
      onMetrics({ ttftMs, totalMs: Date.now() - t0, usage });
    }
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export const nextWordOptionsSchema = z.object({
  options: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["rhyme", "continuation"]),
    }),
  ),
});

async function generateNextWordOptionsViaDecisions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal: AbortSignal | undefined,
  onMetrics: ((metrics: LyricsCallMetrics) => void) | undefined,
  trace: TraceContext,
): Promise<z.infer<typeof nextWordOptionsSchema>> {
  try {
    const generatorCfg = buildGeneratorConfig(cfg);
    const t0 = Date.now();
    const provider = buildProvider(generatorCfg, trace);
    const result = await generateObjectLenient({
      provider,
      schema: nextWordOptionsSchema,
      system,
      prompt,
      maxOutputTokens: NEXT_WORD_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      signal,
      parseObject: parseNextWordOptions,
    });
    const generatorMs = Date.now() - t0;
    logAI("generateNextWordOptions (generator stage)", {
      model: generatorCfg.model,
      system,
      prompt,
      usage: result.usage,
      finishReason: result.finishReason,
      servedBy: result.response?.modelId,
      text: JSON.stringify(result.object),
      durationMs: generatorMs,
    });

    const unranked = result.object.options;
    const { items: ranked, ranker } = await rankByDecisions(
      cfg,
      system,
      prompt,
      unranked,
      signal,
    );
    const pickedIndex = ranked[0] ? unranked.indexOf(ranked[0]) : 0;

    const totalMs = Date.now() - t0;
    const usage = ranker
      ? addUsage(result.usage, decisionsUsageAsLanguageModelUsage(ranker.usage))
      : result.usage;
    trace.span.durationMs = totalMs;
    trace.span.outputChars = JSON.stringify(ranked).length;
    onMetrics?.({
      ttftMs: totalMs,
      totalMs,
      usage,
      generator: {
        durationMs: generatorMs,
        usage: result.usage,
        model: generatorCfg.model,
      },
      ranker,
      unrankedCandidates: unranked.map((o) => o.text),
      pickedIndex: pickedIndex < 0 ? 0 : pickedIndex,
    });
    return { options: ranked };
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export async function generateNextWordOptions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal?: AbortSignal,
  onMetrics?: (metrics: LyricsCallMetrics) => void,
  options?: { trace?: TraceContext },
): Promise<z.infer<typeof nextWordOptionsSchema>> {
  const trace = resolveTrace(options?.trace, { operation: "next_word" });
  await annotateTrace(trace, {
    system,
    prompt,
    params: {
      maxOutputTokens: NEXT_WORD_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      schema: "nextWordOptions",
    },
  });

  if (cfg.provider === "openrouter" && (await isLyricsModelDecisions(cfg))) {
    return generateNextWordOptionsViaDecisions(
      cfg,
      system,
      prompt,
      signal,
      onMetrics,
      trace,
    );
  }
  try {
    const provider = buildProvider(cfg, trace);
    const t0 = Date.now();
    const result = await generateObjectLenient({
      provider,
      schema: nextWordOptionsSchema,
      system,
      prompt,
      maxOutputTokens: NEXT_WORD_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      signal,
      parseObject: parseNextWordOptions,
    });
    const durationMs = Date.now() - t0;
    trace.span.durationMs = durationMs;
    trace.span.outputChars = JSON.stringify(result.object).length;
    logAI("generateNextWordOptions", {
      model: cfg.model || cfg.provider,
      system,
      prompt,
      usage: result.usage,
      finishReason: result.finishReason,
      servedBy: result.response?.modelId,
      text: JSON.stringify(result.object),
      durationMs,
    });
    // generateObject resolves once, with no partial results — TTFT == total.
    onMetrics?.({
      ttftMs: durationMs,
      totalMs: durationMs,
      usage: result.usage,
    });
    return result.object;
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export const popupSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      mode: z.enum(["completion", "alternative", "next_line", "next_word"]),
      text: z.string(),
    }),
  ),
});

export type PopupSuggestions = z.infer<typeof popupSuggestionsSchema>;

async function generatePopupSuggestionsViaDecisions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal: AbortSignal | undefined,
  trace: TraceContext,
): Promise<PopupSuggestions> {
  try {
    const generatorCfg = buildGeneratorConfig(cfg);
    const t0 = Date.now();
    const provider = buildProvider(generatorCfg, trace);
    const result = await generateObjectLenient({
      provider,
      schema: popupSuggestionsSchema,
      system,
      prompt,
      maxOutputTokens: 300,
      maxRetries: 1,
      signal,
    });
    logAI("generatePopupSuggestions (generator stage)", {
      model: generatorCfg.model,
      system,
      prompt,
      usage: result.usage,
      finishReason: result.finishReason,
      servedBy: result.response?.modelId,
      text: JSON.stringify(result.object),
      durationMs: Date.now() - t0,
    });

    // Rank within the list — the popup shows every suggestion, best first.
    const { items: ranked } = await rankByDecisions(
      cfg,
      system,
      prompt,
      result.object.suggestions,
      signal,
    );
    trace.span.durationMs = Date.now() - t0;
    trace.span.outputChars = JSON.stringify(ranked).length;
    return { suggestions: ranked };
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export async function generatePopupSuggestions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal?: AbortSignal,
  options?: { trace?: TraceContext },
): Promise<PopupSuggestions> {
  const trace = resolveTrace(options?.trace, { operation: "popup" });
  await annotateTrace(trace, {
    system,
    prompt,
    params: { maxOutputTokens: 300, maxRetries: 1, schema: "popupSuggestions" },
  });

  if (cfg.provider === "openrouter" && (await isLyricsModelDecisions(cfg))) {
    return generatePopupSuggestionsViaDecisions(
      cfg,
      system,
      prompt,
      signal,
      trace,
    );
  }
  try {
    const provider = buildProvider(cfg, trace);
    const t0 = Date.now();
    const result = await generateObjectLenient({
      provider,
      schema: popupSuggestionsSchema,
      system,
      prompt,
      maxOutputTokens: 300,
      maxRetries: 1,
      signal,
    });
    trace.span.durationMs = Date.now() - t0;
    trace.span.outputChars = JSON.stringify(result.object).length;
    logAI("generatePopupSuggestions", {
      model: cfg.model || cfg.provider,
      system,
      prompt,
      usage: result.usage,
      finishReason: result.finishReason,
      servedBy: result.response?.modelId,
      text: JSON.stringify(result.object),
      durationMs: trace.span.durationMs,
    });
    return result.object;
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

export async function generateStyleSummary(
  cfg: AIConfig,
  recentAccepted: string[],
  signal?: AbortSignal,
  options?: { trace?: TraceContext },
): Promise<string> {
  if (recentAccepted.length === 0) return "";
  const trace = resolveTrace(options?.trace, { operation: "style_summary" });
  // Decisions models can't write text — fall back to the generator model.
  const effectiveCfg = await ensureTextCapableConfig(cfg);
  const provider = buildProvider(effectiveCfg, trace);
  const t0 = Date.now();
  const prompt = `Analyse the following song lyric lines written by a musician. Write a 1-2 sentence description of their lyric writing style — focus on rhyme scheme, line length, imagery, tone, and vocabulary register. Be concise and specific.\n\nLines:\n${recentAccepted.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nDescription:`;
  await annotateTrace(trace, {
    prompt,
    params: { maxOutputTokens: 60, maxRetries: 1 },
  });
  try {
    const result = await generateText({
      model: provider,
      prompt,
      maxOutputTokens: 60,
      maxRetries: 1,
      abortSignal: signal,
      onFinish({ text, usage, finishReason, response }) {
        trace.span.durationMs = Date.now() - t0;
        trace.span.outputChars = text.length;
        logAI("generateStyleSummary", {
          model: effectiveCfg.model || effectiveCfg.provider,
          prompt: `${recentAccepted.length} lyric lines`,
          usage,
          finishReason,
          servedBy: response?.modelId,
          text,
          durationMs: trace.span.durationMs,
        });
      },
    });
    return result.text.trim();
  } catch (err) {
    finalizeTraceError(trace, err);
    throw err;
  }
}

import { generateObject, generateText, streamText } from "ai";
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
  extractJsonText,
  rawTextFromObjectError,
  repairAiJsonText,
} from "./parse-ai-json";

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

export function logAI(
  fn: string,
  {
    model,
    system,
    prompt,
    messages,
    usage,
    finishReason,
    text,
    durationMs,
    servedBy,
  }: {
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
) {
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

function buildProvider(cfg: AIConfig) {
  const model = cfg.model || DEFAULT_MODELS[cfg.provider];

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
}: {
  provider: ReturnType<typeof buildProvider>;
  schema: S;
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}): Promise<{
  object: z.infer<S>;
  usage?: LanguageModelUsage;
  finishReason?: string;
  response?: { modelId?: string };
}> {
  const parseFromText = (text: string): z.infer<S> | null => {
    const extracted = extractJsonText(text);
    if (!extracted) return null;
    const parsed = schema.safeParse(JSON.parse(extracted));
    return parsed.success ? parsed.data : null;
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

export async function testAIConnection(cfg: AIConfig): Promise<void> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  await generateText({
    model: provider,
    prompt: "Reply with the single word: ok",
    onFinish({ text, usage, finishReason, response }) {
      logAI("testAIConnection", {
        model: cfg.model || cfg.provider,
        prompt: "Reply with the single word: ok",
        usage,
        finishReason,
        servedBy: response?.modelId,
        text,
        durationMs: Date.now() - t0,
      });
    },
  });
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
): Promise<GeneratedParts> {
  const provider = buildProvider(cfg);

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

  const t0 = Date.now();
  const result = await generateObjectLenient({
    provider,
    schema: tabPartsSchema,
    prompt,
  });
  logAI("generateTabStructure", {
    model: cfg.model || cfg.provider,
    prompt,
    usage: result.usage,
    finishReason: result.finishReason,
    servedBy: result.response?.modelId,
    text: JSON.stringify(result.object),
    durationMs: Date.now() - t0,
  });

  return result.object;
}

export async function chatWithTabAgent(
  cfg: AIConfig,
  system: string,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  const result = await generateText({
    model: provider,
    system,
    messages,
    maxOutputTokens: 400,
    onFinish({ text, usage, finishReason, response }) {
      logAI("chatWithTabAgent", {
        model: cfg.model || cfg.provider,
        system,
        messages,
        usage,
        finishReason,
        servedBy: response?.modelId,
        text,
        durationMs: Date.now() - t0,
      });
    },
  });
  return result.text.trim();
}

// ── Lyrics AI ─────────────────────────────────────────────────────────────────

// Timing/usage for a single model call, collected for the eval harness
// (scripts/lyrics-eval). Optional and additive — existing callers that don't
// pass a callback see no behavior change.
export interface LyricsCallMetrics {
  ttftMs: number | null; // time to first stream chunk; null if none arrived
  totalMs: number;
  usage?: LanguageModelUsage;
}

export async function* streamLyricsSuggestion(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal?: AbortSignal,
  onMetrics?: (metrics: LyricsCallMetrics) => void,
): AsyncGenerator<string> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  let ttftMs: number | null = null;
  // streamText is intentionally not awaited — result.textStream is consumed lazily
  const result = streamText({
    model: provider,
    system,
    prompt,
    maxOutputTokens: 80,
    maxRetries: 0,
    abortSignal: signal,
    onFinish({ text, usage, finishReason, response }) {
      logAI("streamLyricsSuggestion", {
        model: cfg.model || cfg.provider,
        system,
        prompt,
        usage,
        finishReason,
        servedBy: response?.modelId,
        text,
        durationMs: Date.now() - t0,
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
}

export const nextWordOptionsSchema = z.object({
  options: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(["rhyme", "continuation"]),
    }),
  ),
});

export async function generateNextWordOptions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal?: AbortSignal,
  onMetrics?: (metrics: LyricsCallMetrics) => void,
): Promise<z.infer<typeof nextWordOptionsSchema>> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  const result = await generateObjectLenient({
    provider,
    schema: nextWordOptionsSchema,
    system,
    prompt,
    maxOutputTokens: NEXT_WORD_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    signal,
  });
  const durationMs = Date.now() - t0;
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
  onMetrics?.({ ttftMs: durationMs, totalMs: durationMs, usage: result.usage });
  return result.object;
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

export async function generatePopupSuggestions(
  cfg: AIConfig,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<PopupSuggestions> {
  const provider = buildProvider(cfg);
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
  logAI("generatePopupSuggestions", {
    model: cfg.model || cfg.provider,
    system,
    prompt,
    usage: result.usage,
    finishReason: result.finishReason,
    servedBy: result.response?.modelId,
    text: JSON.stringify(result.object),
    durationMs: Date.now() - t0,
  });
  return result.object;
}

export async function generateStyleSummary(
  cfg: AIConfig,
  recentAccepted: string[],
  signal?: AbortSignal,
): Promise<string> {
  if (recentAccepted.length === 0) return "";
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  const result = await generateText({
    model: provider,
    prompt: `Analyse the following song lyric lines written by a musician. Write a 1-2 sentence description of their lyric writing style — focus on rhyme scheme, line length, imagery, tone, and vocabulary register. Be concise and specific.\n\nLines:\n${recentAccepted.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nDescription:`,
    maxOutputTokens: 60,
    maxRetries: 1,
    abortSignal: signal,
    onFinish({ text, usage, finishReason, response }) {
      logAI("generateStyleSummary", {
        model: cfg.model || cfg.provider,
        prompt: `${recentAccepted.length} lyric lines`,
        usage,
        finishReason,
        servedBy: response?.modelId,
        text,
        durationMs: Date.now() - t0,
      });
    },
  });
  return result.text.trim();
}

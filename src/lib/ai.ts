import { generateObject, generateText, streamText } from "ai";
import type { LanguageModelUsage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { AIConfig, Instrument } from "../types";

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5-20251001",
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

function logAI(
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
  }: {
    model: string;
    system?: string;
    prompt?: string;
    messages?: { role: string; content: string }[];
    usage?: LanguageModelUsage;
    finishReason?: string;
    text?: string;
    durationMs: number;
  },
) {
  const clip = (s: string, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);
  console.group(`%c[AI] ${fn}`, "color:#ff7a45;font-weight:700");
  console.log("model      :", model);
  if (system) console.log("system     :", clip(system));
  if (prompt) console.log("prompt     :", clip(prompt));
  if (messages?.length) {
    console.group("messages");
    messages.forEach((m) => console.log(`  ${m.role.padEnd(9)}:`, clip(m.content)));
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

function buildProvider(cfg: AIConfig) {
  const model = cfg.model || DEFAULT_MODELS[cfg.provider];

  switch (cfg.provider) {
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey })(model);

    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(model);

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

export async function testAIConnection(cfg: AIConfig): Promise<void> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  await generateText({
    model: provider,
    prompt: "Reply with the single word: ok",
    onFinish({ text, usage, finishReason }) {
      logAI("testAIConnection", {
        model: cfg.model || cfg.provider,
        prompt: "Reply with the single word: ok",
        usage,
        finishReason,
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
  const result = await generateObject({
    model: provider,
    schema: tabPartsSchema,
    prompt,
  });
  logAI("generateTabStructure", {
    model: cfg.model || cfg.provider,
    prompt,
    usage: result.usage,
    finishReason: result.finishReason,
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
    onFinish({ text, usage, finishReason }) {
      logAI("chatWithTabAgent", {
        model: cfg.model || cfg.provider,
        system,
        messages,
        usage,
        finishReason,
        text,
        durationMs: Date.now() - t0,
      });
    },
  });
  return result.text.trim();
}

// ── Lyrics AI ─────────────────────────────────────────────────────────────────

export async function* streamLyricsSuggestion(
  cfg: AIConfig,
  system: string,
  prompt: string,
): AsyncGenerator<string> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  // streamText is intentionally not awaited — result.textStream is consumed lazily
  const result = streamText({
    model: provider,
    system,
    prompt,
    maxOutputTokens: 80,
    onFinish({ text, usage, finishReason }) {
      logAI("streamLyricsSuggestion", {
        model: cfg.model || cfg.provider,
        system,
        prompt,
        usage,
        finishReason,
        text,
        durationMs: Date.now() - t0,
      });
    },
  });
  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

export const popupSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      mode: z.enum(["completion", "alternative", "next_line"]),
      text: z.string(),
    }),
  ),
});

export type PopupSuggestions = z.infer<typeof popupSuggestionsSchema>;

export async function generatePopupSuggestions(
  cfg: AIConfig,
  system: string,
  prompt: string,
): Promise<PopupSuggestions> {
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  const result = await generateObject({
    model: provider,
    schema: popupSuggestionsSchema,
    system,
    prompt,
  });
  logAI("generatePopupSuggestions", {
    model: cfg.model || cfg.provider,
    system,
    prompt,
    usage: result.usage,
    finishReason: result.finishReason,
    text: JSON.stringify(result.object),
    durationMs: Date.now() - t0,
  });
  return result.object;
}

export async function generateStyleSummary(
  cfg: AIConfig,
  recentAccepted: string[],
): Promise<string> {
  if (recentAccepted.length === 0) return "";
  const provider = buildProvider(cfg);
  const t0 = Date.now();
  const result = await generateText({
    model: provider,
    prompt: `Analyse the following song lyric lines written by a musician. Write a 1-2 sentence description of their lyric writing style — focus on rhyme scheme, line length, imagery, tone, and vocabulary register. Be concise and specific.\n\nLines:\n${recentAccepted.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nDescription:`,
    maxOutputTokens: 60,
    onFinish({ text, usage, finishReason }) {
      logAI("generateStyleSummary", {
        model: cfg.model || cfg.provider,
        prompt: `${recentAccepted.length} lyric lines`,
        usage,
        finishReason,
        text,
        durationMs: Date.now() - t0,
      });
    },
  });
  return result.text.trim();
}

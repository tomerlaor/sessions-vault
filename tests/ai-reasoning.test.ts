// Exercises the real `ai` package (unlike tests/ai.test.ts, which mocks it
// entirely) against a stubbed global fetch, so these assertions cover the
// actual request bodies OpenRouter would receive — including everything
// `createOpenRouterFetch`'s default `baseFetch = fetch` picks up implicitly.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  streamLyricsSuggestion,
  generateNextWordOptions,
  generatePopupSuggestions,
  generateStyleSummary,
  chatWithTabAgent,
  generateTabStructure,
  testAIConnection,
} from "../src/lib/ai";
import {
  requestStreamSuggestion,
  LruCache,
} from "../src/lib/lyrics-ai-request";
import type { AIConfig } from "../src/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Matches the static seed in src/lib/openrouter.ts, so these tests don't
// depend on the (never-awaited) OpenRouter catalog fetch resolving.
const SEEDED_MODEL = "anthropic/claude-haiku-5.5";

function baseCfg(overrides: Partial<AIConfig> = {}): AIConfig {
  return {
    provider: "openrouter",
    apiKey: "test-key",
    baseUrl: "",
    model: SEEDED_MODEL,
    ...overrides,
  };
}

type FetchCall = { url: string; body: Record<string, unknown> };

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "mock",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const SSE_HELLO =
  'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"},"index":0,"finish_reason":null}]}\n\n' +
  'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}\n\n' +
  "data: [DONE]\n\n";

const SSE_EMPTY =
  'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{},"index":0,"finish_reason":"length"}]}\n\n' +
  "data: [DONE]\n\n";

// A single fetch stand-in for everything these call sites hit: OpenRouter
// chat completions (streaming and non-streaming), the OpenRouter model
// catalog (this module's own, and the separate decisions-models one — both
// just GETs with no body), and the decisions `/api/alpha/decisions` POST.
// Returns JSON matching whatever `response_format.json_schema` was asked
// for, so generateObject succeeds on the first attempt instead of needing
// generateObjectLenient's generateText fallback (irrelevant to what these
// tests assert, but keeps each test to a single captured request).
function createFetchMock(streamBody: string = SSE_HELLO) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      calls.push({ url, body });

      if (body.stream) {
        return new Response(streamBody, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      const schemaProps = body.response_format?.json_schema?.schema?.properties;
      if (schemaProps?.options) {
        return jsonResponse(
          JSON.stringify({ options: [{ text: "la", kind: "continuation" }] }),
        );
      }
      if (schemaProps?.suggestions) {
        return jsonResponse(
          JSON.stringify({ suggestions: [{ mode: "completion", text: "la" }] }),
        );
      }
      if (schemaProps?.parts) {
        return jsonResponse(
          JSON.stringify({
            parts: [
              {
                instrument: "guitar",
                name: "Verse Guitar",
                content: "e|-------|",
              },
            ],
          }),
        );
      }
      return jsonResponse("ok");
    },
  );
  return { fn, calls };
}

// Only real chat-completions requests carry a `messages` array — the
// catalog GETs (this module's own, and the decisions catalog's) don't.
function chatCompletionBodies(calls: FetchCall[]): Record<string, unknown>[] {
  return calls.map((c) => c.body).filter((b) => Array.isArray(b.messages));
}

// Consumes an async generator for its side effects (triggering the
// request) without needing a named loop variable.
async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) void _;
}

describe("OpenRouter reasoning, end to end", () => {
  it("stream lyrics suggestion: reasoning present for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await drain(streamLyricsSuggestion(cfg, "sys", "prompt"));

    const [body] = chatCompletionBodies(calls);
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("next_word: reasoning present for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await generateNextWordOptions(cfg, "sys", "prompt");

    const bodies = chatCompletionBodies(calls);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies)
      expect(body.reasoning).toEqual({ effort: "none" });
  });

  it("popup: reasoning present for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await generatePopupSuggestions(cfg, "sys", "prompt");

    const bodies = chatCompletionBodies(calls);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies)
      expect(body.reasoning).toEqual({ effort: "none" });
  });

  it("style summary: reasoning present for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await generateStyleSummary(cfg, ["a line of lyrics"]);

    const [body] = chatCompletionBodies(calls);
    expect(body.reasoning).toEqual({ effort: "none" });
  });

  it("decisions generator: reasoning present on the generator call; the ranker never gets one", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({
      model: "typesafe/jev-1.14", // known decisions model id — no catalog needed
      lyricsGeneratorModel: SEEDED_MODEL,
      lyricsCandidateCount: 2,
      lyricsReasoning: "off",
    });

    await drain(streamLyricsSuggestion(cfg, "sys", "prompt"));

    const bodies = chatCompletionBodies(calls);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.model).toBe(SEEDED_MODEL);
      expect(body.reasoning).toEqual({ effort: "none" });
    }
    // The ranker posts to /api/alpha/decisions with plain fetch — it never
    // goes through createOpenRouterFetch, so it never gets a `reasoning`
    // field even though it also targets an OpenRouter endpoint.
    const rankerCall = calls.find((c) =>
      c.url.endsWith("/api/alpha/decisions"),
    );
    expect(rankerCall).toBeTruthy();
    expect(rankerCall?.body.reasoning).toBeUndefined();
  });

  it("Tab Agent: reasoning absent even for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await chatWithTabAgent(cfg, "sys", [{ role: "user", content: "hi" }]);

    const [body] = chatCompletionBodies(calls);
    expect(body.reasoning).toBeUndefined();
    // Data collection is unrelated to lyricsReasoning and still applies.
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("tab structure: reasoning absent even for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await generateTabStructure(cfg, {
      sectionName: "Verse",
      instruments: ["guitar"],
      chords: "C G",
      bars: 1,
      timeSignature: "4/4",
      styleNote: "",
    });

    const bodies = chatCompletionBodies(calls);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.reasoning).toBeUndefined();
  });

  it("testAIConnection: reasoning absent even for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });

    await testAIConnection(cfg);

    const bodies = chatCompletionBodies(calls);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.reasoning).toBeUndefined();
  });

  it("provider-default: no reasoning sent even for a seeded 5.5 model", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "provider-default" });

    await drain(streamLyricsSuggestion(cfg, "sys", "prompt"));

    const [body] = chatCompletionBodies(calls);
    expect(body.reasoning).toBeUndefined();
  });

  it("undefined lyricsReasoning defaults to 'off'", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg(); // lyricsReasoning not set

    await drain(streamLyricsSuggestion(cfg, "sys", "prompt"));

    const [body] = chatCompletionBodies(calls);
    expect(body.reasoning).toEqual({ effort: "none" });
  });

  it("a model with no catalog/seed capability data gets no reasoning field", async () => {
    const { fn, calls } = createFetchMock();
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({
      model: "some/unknown-model-not-in-any-catalog",
      lyricsReasoning: "off",
    });

    await drain(streamLyricsSuggestion(cfg, "sys", "prompt"));

    const [body] = chatCompletionBodies(calls);
    expect(body.reasoning).toBeUndefined();
  });
});

describe("requestStreamSuggestion: empty results are not cached", () => {
  it("does not cache an empty accumulated string, so a retry can call the model again", async () => {
    const { fn, calls } = createFetchMock(SSE_EMPTY);
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });
    const cache = new LruCache<string, string>(10);

    const first = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "inline",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: () => {},
    });
    expect(first).toEqual({ status: "ok", value: "" });
    expect(cache.size).toBe(0);

    const second = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "inline",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: () => {},
    });
    expect(second).toEqual({ status: "ok", value: "" });

    // Both calls hit the model — the empty result was never cached.
    expect(chatCompletionBodies(calls).length).toBe(2);
  });

  it("caches a non-empty accumulated string", async () => {
    const { fn, calls } = createFetchMock(SSE_HELLO);
    vi.stubGlobal("fetch", fn);
    const cfg = baseCfg({ lyricsReasoning: "off" });
    const cache = new LruCache<string, string>(10);

    await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "inline",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: () => {},
    });
    expect(cache.size).toBe(1);

    const second = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "inline",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: () => {},
    });
    expect(second).toEqual({ status: "ok", value: "hi" });

    // The second call was served from cache — no second network request.
    expect(chatCompletionBodies(calls).length).toBe(1);
  });
});

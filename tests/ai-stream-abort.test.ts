// Engineer review item 1 (BLOCKER, PR #118): in ai@6.0.x, streamText does
// NOT throw on abort — the textStream just ends. These tests exercise the
// real "ai" streamText + createTracingMiddleware + wrapLanguageModel stack
// (only the provider SDK factory is mocked, so streamLyricsSuggestion and
// requestStreamSuggestion run unmodified) to prove: a mid-stream abort never
// gets cached as "ok", the overlay sees aborted vs timeout correctly, and
// the middleware records the attempt exactly once with the right status.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

const { createOpenAIMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

import { streamLyricsSuggestion } from "../src/lib/ai";
import {
  requestStreamSuggestion,
  LruCache,
} from "../src/lib/lyrics-ai-request";
import { createTraceContext, MemoryTraceStore } from "../src/lib/ai-trace";
import type { AIConfig } from "../src/types";

const cfg: AIConfig = {
  provider: "openai",
  apiKey: "test-key",
  baseUrl: "",
  model: "gpt-4.1-mini",
};

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
}

// A model that streams a handful of text-delta chunks with a delay between
// each, slow enough for a test to abort mid-stream.
function makeSlowStreamingModel(chunkDelayInMs: number) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "roses " },
          { type: "text-delta", id: "1", delta: "are " },
          { type: "text-delta", id: "1", delta: "red " },
          { type: "text-delta", id: "1", delta: "violets " },
          { type: "text-end", id: "1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: usage(),
          },
        ],
      }),
    }),
  });
}

beforeEach(() => {
  createOpenAIMock.mockReset();
});

describe("requestStreamSuggestion abort/timeout (real streamText, #118)", () => {
  it("aborted mid-stream: returns status 'aborted', caches nothing, records the attempt as cancelled", async () => {
    const mockModel = makeSlowStreamingModel(20);
    createOpenAIMock.mockReturnValue(() => mockModel);

    const controller = new AbortController();
    const cache = new LruCache<string, string>(10);
    const store = new MemoryTraceStore();
    const ctx = createTraceContext({
      feature: "lyrics",
      operation: "stream_suggestion",
      store,
    });

    const promise = requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "write a lyric",
      signal: controller.signal,
      cache,
      onToken: () => {},
      trace: ctx,
    });

    setTimeout(() => controller.abort(), 45);
    const result = await promise;

    expect(result.status).toBe("aborted");
    expect(cache.size).toBe(0);
    expect(ctx.span.status).toBe("cancelled");
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0].status).toBe("cancelled");
  });

  it("times out: returns status 'timeout', caches nothing, records the attempt as timeout", async () => {
    const mockModel = makeSlowStreamingModel(50);
    createOpenAIMock.mockReturnValue(() => mockModel);

    const cache = new LruCache<string, string>(10);
    const store = new MemoryTraceStore();
    const ctx = createTraceContext({
      feature: "lyrics",
      operation: "stream_suggestion",
      store,
    });

    const result = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "write a lyric",
      cache,
      firstTokenTimeoutMs: 15,
      onToken: () => {},
      trace: ctx,
    });

    expect(result.status).toBe("timeout");
    expect(cache.size).toBe(0);
    expect(ctx.span.status).toBe("timeout");
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0].status).toBe("timeout");
  });

  it("completes normally when not aborted: caches the result and records an 'ok' attempt", async () => {
    const mockModel = makeSlowStreamingModel(1);
    createOpenAIMock.mockReturnValue(() => mockModel);

    const cache = new LruCache<string, string>(10);
    const store = new MemoryTraceStore();
    const ctx = createTraceContext({
      feature: "lyrics",
      operation: "stream_suggestion",
      store,
    });

    const result = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "write a lyric",
      cache,
      onToken: () => {},
      trace: ctx,
    });

    expect(result).toEqual({ status: "ok", value: "roses are red violets " });
    expect(cache.size).toBe(1);
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0].status).toBe("ok");
  });

  it("streamLyricsSuggestion itself (the raw generator) does not throw on abort — it just stops yielding", async () => {
    const mockModel = makeSlowStreamingModel(20);
    createOpenAIMock.mockReturnValue(() => mockModel);
    const controller = new AbortController();

    const chunks: string[] = [];
    let threw = false;
    try {
      for await (const chunk of streamLyricsSuggestion(
        cfg,
        "sys",
        "prompt",
        controller.signal,
      )) {
        chunks.push(chunk);
        controller.abort();
      }
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });
});

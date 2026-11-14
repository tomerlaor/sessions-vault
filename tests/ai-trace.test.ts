import { describe, it, expect, vi } from "vitest";
import { APICallError, generateText, wrapLanguageModel } from "ai";
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test";
import {
  createTraceContext,
  createTracingMiddleware,
  hashPrompt,
  scrubError,
  traced,
  MemoryTraceStore,
  type TraceContext,
  type TraceStore,
} from "../src/lib/ai-trace";
import { logAI } from "../src/lib/ai";

function usage(inputTotal: number, outputTotal: number) {
  return {
    inputTokens: {
      total: inputTotal,
      noCache: inputTotal,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
  };
}

function finishReason(unified: "stop" | "error" = "stop") {
  return { unified, raw: unified };
}

describe("createTracingMiddleware", () => {
  it("records TTFT on the first stream text-delta, and usage/finish reason at finish", async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "resp_1", modelId: "mock-served" },
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "hello" },
          { type: "text-end", id: "1" },
          { type: "finish", finishReason: finishReason(), usage: usage(10, 5) },
        ]),
      }),
    });

    const ctx = createTraceContext({
      feature: "lyrics",
      operation: "stream_suggestion",
    });
    const model = wrapLanguageModel({
      model: mockModel,
      middleware: createTracingMiddleware(ctx),
    });

    const result = streamTextChunks(model);
    const chunks: string[] = [];
    for await (const chunk of result) chunks.push(chunk);

    expect(chunks.join("")).toBe("hello");
    expect(typeof ctx.span.ttftMs).toBe("number");
    expect(ctx.span.inputTokens).toBe(10);
    expect(ctx.span.outputTokens).toBe(5);
    expect(ctx.span.finishReason).toBe("stop");
    expect(ctx.span.responseModel).toBe("mock-served");
    expect(ctx.span.attempts).toBe(1);
  });

  it("classifies a call error, scrubbing secrets and long quoted text", async () => {
    const secret = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789";
    const longQuoted = "x".repeat(50);
    const mockModel = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error(
          `Request failed with Authorization: Bearer ${secret}. Body: "${longQuoted}"`,
        );
      },
    });
    const ctx = createTraceContext({
      feature: "settings",
      operation: "test_connection",
    });
    const model = wrapLanguageModel({
      model: mockModel,
      middleware: createTracingMiddleware(ctx),
    });

    await expect(
      generateText({ model, prompt: "hi", maxRetries: 0 }),
    ).rejects.toThrow();

    expect(ctx.span.status).toBe("error");
    const serialized = JSON.stringify(ctx.span);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(longQuoted);
  });

  it("classifies an aborted call as cancelled", async () => {
    const mockModel = new MockLanguageModelV3({
      doGenerate: async () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
    });
    const ctx = createTraceContext({ feature: "lyrics", operation: "popup" });
    const model = wrapLanguageModel({
      model: mockModel,
      middleware: createTracingMiddleware(ctx),
    });

    await expect(
      generateText({ model, prompt: "hi", maxRetries: 0 }),
    ).rejects.toThrow();

    expect(ctx.span.status).toBe("cancelled");
  });

  it("records one AttemptRecord per SDK retry (maxRetries: 1, fails once then succeeds)", async () => {
    let calls = 0;
    const mockModel = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) {
          throw new APICallError({
            message: "Service unavailable",
            url: "https://example.test",
            requestBodyValues: {},
            statusCode: 503,
          });
        }
        return {
          content: [{ type: "text" as const, text: "ok" }],
          finishReason: finishReason(),
          usage: usage(5, 2),
          warnings: [],
          response: { id: "resp_2", modelId: "mock-served" },
        };
      },
    });
    const store = new MemoryTraceStore();
    const ctx = createTraceContext({
      feature: "settings",
      operation: "test_connection",
      store,
    });
    const model = wrapLanguageModel({
      model: mockModel,
      middleware: createTracingMiddleware(ctx),
    });

    const result = await generateText({ model, prompt: "hi", maxRetries: 1 });

    expect(result.text).toBe("ok");
    expect(calls).toBe(2);
    expect(ctx.span.attempts).toBe(2);
    expect(store.attempts).toHaveLength(2);
    expect(store.attempts[0].status).toBe("error");
    expect(store.attempts[1].status).toBe("ok");
  });

  it("never stores prompt or system text on the span", async () => {
    const distinctiveSystem = "SYSTEM_MARKER_8f2e: respond concisely.";
    const distinctivePrompt =
      "PROMPT_MARKER_c91a: write a sad song about rain.";
    const mockModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "a reply" }],
        finishReason: finishReason(),
        usage: usage(3, 2),
        warnings: [],
        response: { id: "r1", modelId: "mock-served" },
      }),
    });
    const ctx = createTraceContext({ feature: "lyrics", operation: "popup" });
    const model = wrapLanguageModel({
      model: mockModel,
      middleware: createTracingMiddleware(ctx),
    });

    await generateText({
      model,
      system: distinctiveSystem,
      prompt: distinctivePrompt,
      maxRetries: 0,
    });

    const serialized = JSON.stringify(ctx.span);
    expect(serialized).not.toContain("SYSTEM_MARKER_8f2e");
    expect(serialized).not.toContain("PROMPT_MARKER_c91a");
  });
});

// Drains streamText's textStream for the TTFT/usage test above without
// pulling in the lyrics-ai mocked suite's helpers.
async function* streamTextChunks(
  model: Parameters<typeof wrapLanguageModel>[0]["model"],
): AsyncGenerator<string> {
  const { streamText } = await import("ai");
  const result = streamText({ model, prompt: "say hi" });
  for await (const chunk of result.textStream) yield chunk;
}

describe("scrubError", () => {
  it("redacts secrets and long quoted strings, and truncates to ~200 chars", () => {
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";
    const longQuote = "y".repeat(60);
    const err = new Error(
      `failed Bearer ${secret} body: "${longQuote}" ${"z".repeat(300)}`,
    );
    const { errorMessage } = scrubError(err);
    expect(errorMessage).not.toContain(secret);
    expect(errorMessage).not.toContain(longQuote);
    expect(errorMessage.length).toBeLessThanOrEqual(201);
  });

  it("classifies abort-named errors as errorType 'abort'", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(scrubError(err).errorType).toBe("abort");
  });

  it("classifies an http status from a statusCode field", () => {
    const err = Object.assign(new Error("failed"), { statusCode: 429 });
    expect(scrubError(err).errorType).toBe("http_429");
  });
});

describe("hashPrompt", () => {
  it("is deterministic for the same salt+system+prompt and returns 16 hex chars", async () => {
    const a = await hashPrompt("salt-1", "sys", "prompt");
    const b = await hashPrompt("salt-1", "sys", "prompt");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs when the prompt differs", async () => {
    const a = await hashPrompt("salt-1", "sys", "prompt one");
    const b = await hashPrompt("salt-1", "sys", "prompt two");
    expect(a).not.toBe(b);
  });

  it("differs when the salt differs (keyed hash)", async () => {
    const a = await hashPrompt("salt-1", "sys", "prompt");
    const b = await hashPrompt("salt-2", "sys", "prompt");
    expect(a).not.toBe(b);
  });
});

describe("MemoryTraceStore", () => {
  it("records span and attempt writes", async () => {
    const store = new MemoryTraceStore();
    const ctx = createTraceContext({ feature: "lyrics", operation: "popup" });
    store.write(ctx.span);
    store.writeAttempt({
      spanId: ctx.spanId,
      attempt: 1,
      startedAt: Date.now(),
      status: "ok",
    });
    expect(store.spans).toHaveLength(1);
    expect(store.attempts).toHaveLength(1);
    await expect(store.flush()).resolves.toBeUndefined();
  });
});

describe("traced()", () => {
  it("rethrows fn's error unchanged", async () => {
    const boom = new Error("boom");
    await expect(
      traced({ operation: "test_connection" }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("does not throw if the store's write/flush fail", async () => {
    const store: TraceStore = {
      write: () => {
        throw new Error("write failed");
      },
      writeAttempt: () => {},
      flush: () => {
        throw new Error("flush failed");
      },
    };
    const result = await traced(
      { operation: "test_connection", store },
      async () => "ok",
    );
    expect(result).toBe("ok");
  });

  it("derives status cache_hit when fn marks the span cacheHit", async () => {
    let captured: TraceContext | undefined;
    const result = await traced({ operation: "popup" }, async (ctx) => {
      captured = ctx;
      ctx.span.cacheHit = true;
      return "cached";
    });
    expect(result).toBe("cached");
    expect(captured?.span.status).toBe("cache_hit");
  });
});

describe("logAI(span) — DEV console sink of a SpanRecord", () => {
  it("prints span metadata in DEV and never the underlying prompt/system text", () => {
    const ctx = createTraceContext({
      feature: "lyrics",
      operation: "popup",
    });
    ctx.span.requestModel = "gpt-4.1-mini";
    ctx.span.durationMs = 42;
    ctx.span.status = "ok";

    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupEndSpy = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logAI(ctx.span, { DEV: true });
      expect(groupSpy).toHaveBeenCalledTimes(1);
      const printed = logSpy.mock.calls.flat().join(" ");
      expect(printed).not.toMatch(/PROMPT_MARKER|SYSTEM_MARKER/);
    } finally {
      groupSpy.mockRestore();
      groupEndSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("is a no-op in release (DEV false)", () => {
    const ctx = createTraceContext({ feature: "lyrics", operation: "popup" });
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    try {
      logAI(ctx.span, { DEV: false });
      expect(groupSpy).not.toHaveBeenCalled();
    } finally {
      groupSpy.mockRestore();
    }
  });
});

describe("createTraceContext (auto-span fallback)", () => {
  it("defaults feature to 'unknown' when a caller hasn't threaded a trace through", () => {
    const ctx = createTraceContext({ operation: "next_word" });
    expect(ctx.span.feature).toBe("unknown");
    expect(ctx.span.operation).toBe("next_word");
    expect(ctx.span.status).toBe("ok");
    expect(ctx.span.attempts).toBe(0);
    expect(ctx.span.cacheHit).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { generateObjectMock, generateTextMock, streamTextMock } = vi.hoisted(
  () => ({
    generateObjectMock: vi.fn(async () => ({
      object: { options: [], suggestions: [] },
      usage: {},
      finishReason: "stop",
      response: { modelId: "mock" },
    })),
    generateTextMock: vi.fn(async () => ({
      text: "ok",
      usage: {},
      finishReason: "stop",
      response: { modelId: "mock" },
    })),
    streamTextMock: vi.fn((opts: { onFinish?: (r: unknown) => void }) => {
      const usage = {};
      opts?.onFinish?.({
        text: "ok",
        usage,
        finishReason: "stop",
        response: { modelId: "mock" },
      });
      return {
        textStream: (async function* () {
          yield "ok";
        })(),
        usage: Promise.resolve(usage),
      };
    }),
  }),
);

vi.mock("ai", () => ({
  generateObject: generateObjectMock,
  generateText: generateTextMock,
  streamText: streamTextMock,
}));

import {
  streamLyricsSuggestion,
  generateNextWordOptions,
  generatePopupSuggestions,
  generateStyleSummary,
  shouldLogAI,
  logAI,
} from "../src/lib/ai";
import type { AIConfig } from "../src/types";

const cfg: AIConfig = {
  provider: "openai",
  apiKey: "test-key",
  baseUrl: "",
  model: "gpt-4.1-mini",
};

describe("lyrics AI call sites in ai.ts", () => {
  beforeEach(() => {
    generateObjectMock.mockClear();
    generateTextMock.mockClear();
    streamTextMock.mockClear();
  });

  it("streamLyricsSuggestion passes maxOutputTokens: 80, maxRetries: 0, and the abort signal", async () => {
    const controller = new AbortController();
    const gen = streamLyricsSuggestion(cfg, "sys", "prompt", controller.signal);
    for await (const chunk of gen) void chunk; // drain
    expect(streamTextMock).toHaveBeenCalledTimes(1);
    const opts = streamTextMock.mock.calls[0][0];
    expect(opts.maxOutputTokens).toBe(80);
    expect(opts.maxRetries).toBe(0);
    expect(opts.abortSignal).toBe(controller.signal);
  });

  it("generateNextWordOptions passes maxOutputTokens: 60, maxRetries: 0, and the abort signal", async () => {
    const controller = new AbortController();
    await generateNextWordOptions(cfg, "sys", "prompt", controller.signal);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const opts = generateObjectMock.mock.calls[0][0];
    expect(opts.maxOutputTokens).toBe(60);
    expect(opts.maxRetries).toBe(0);
    expect(opts.abortSignal).toBe(controller.signal);
  });

  it("generateNextWordOptions reports usage and timing via the optional onMetrics callback", async () => {
    const onMetrics = vi.fn();
    await generateNextWordOptions(cfg, "sys", "prompt", undefined, onMetrics);
    expect(onMetrics).toHaveBeenCalledTimes(1);
    const metrics = onMetrics.mock.calls[0][0];
    expect(metrics.usage).toEqual({});
    expect(metrics.ttftMs).toBe(metrics.totalMs);
    expect(typeof metrics.totalMs).toBe("number");
  });

  it("streamLyricsSuggestion reports usage and timing via the optional onMetrics callback", async () => {
    const onMetrics = vi.fn();
    const gen = streamLyricsSuggestion(
      cfg,
      "sys",
      "prompt",
      undefined,
      onMetrics,
    );
    for await (const chunk of gen) void chunk; // drain, triggers onFinish
    expect(onMetrics).toHaveBeenCalledTimes(1);
    const metrics = onMetrics.mock.calls[0][0];
    expect(metrics.usage).toEqual({});
    expect(typeof metrics.totalMs).toBe("number");
    expect(metrics.ttftMs === null || typeof metrics.ttftMs === "number").toBe(
      true,
    );
  });

  it("generatePopupSuggestions passes maxOutputTokens: 300, maxRetries: 1, and the abort signal", async () => {
    const controller = new AbortController();
    await generatePopupSuggestions(cfg, "sys", "prompt", controller.signal);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const opts = generateObjectMock.mock.calls[0][0];
    expect(opts.maxOutputTokens).toBe(300);
    expect(opts.maxRetries).toBe(1);
    expect(opts.abortSignal).toBe(controller.signal);
  });

  it("generateStyleSummary passes maxOutputTokens: 60, maxRetries: 1, and the abort signal", async () => {
    const controller = new AbortController();
    await generateStyleSummary(cfg, ["a line"], controller.signal);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const opts = generateTextMock.mock.calls[0][0];
    expect(opts.maxOutputTokens).toBe(60);
    expect(opts.maxRetries).toBe(1);
    expect(opts.abortSignal).toBe(controller.signal);
  });
});

describe("shouldLogAI", () => {
  it("is true only when DEV is true", () => {
    expect(shouldLogAI({ DEV: true })).toBe(true);
    expect(shouldLogAI({ DEV: false })).toBe(false);
    expect(shouldLogAI({})).toBe(false);
  });
});

describe("logAI gating", () => {
  it("is a no-op and never touches the console when DEV is false", () => {
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logAI(
      "testFn",
      { model: "gpt-4.1-mini", prompt: "secret prompt", durationMs: 1 },
      { DEV: false },
    );
    expect(groupSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    groupSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("logs to the console when DEV is true", () => {
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupEndSpy = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logAI(
      "testFn",
      { model: "gpt-4.1-mini", prompt: "hello", durationMs: 1 },
      { DEV: true },
    );
    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();
    groupSpy.mockRestore();
    groupEndSpy.mockRestore();
    logSpy.mockRestore();
  });
});

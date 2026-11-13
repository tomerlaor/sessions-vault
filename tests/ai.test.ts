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
    streamTextMock: vi.fn(() => ({
      textStream: (async function* () {
        yield "ok";
      })(),
    })),
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

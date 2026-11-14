import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  // Tracing wraps every provider model via buildProvider (T1, #89). A
  // passthrough keeps this suite's assertions about the underlying model
  // (e.g. `.modelId`) and call args unaffected by that wrapping.
  wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));

import {
  streamLyricsSuggestion,
  generateNextWordOptions,
  generatePopupSuggestions,
  generateStyleSummary,
  generateTabStructure,
  chatWithTabAgent,
  testAIConnection,
  shouldLogAI,
  logAI,
  resolveAiLogEnv,
  NEXT_WORD_MAX_OUTPUT_TOKENS,
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

  it("generateNextWordOptions passes NEXT_WORD_MAX_OUTPUT_TOKENS, maxRetries: 0, and the abort signal", async () => {
    const controller = new AbortController();
    await generateNextWordOptions(cfg, "sys", "prompt", controller.signal);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const opts = generateObjectMock.mock.calls[0][0];
    expect(opts.maxOutputTokens).toBe(NEXT_WORD_MAX_OUTPUT_TOKENS);
    expect(opts.maxRetries).toBe(0);
    expect(opts.abortSignal).toBe(controller.signal);
    expect(typeof opts.experimental_repairText).toBe("function");
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

  it("recovers next_word options from fenced JSON on a generateObject parse error, without a second call", async () => {
    const object = {
      options: [
        { text: "shadow", kind: "continuation" },
        { text: "smoke", kind: "rhyme" },
        { text: "silence", kind: "continuation" },
      ],
    };
    const fenced = "```json\n" + JSON.stringify(object) + "\n```";
    const err = Object.assign(
      new Error("No object generated: could not parse the response."),
      { text: fenced },
    );
    generateObjectMock.mockRejectedValueOnce(err);

    const result = await generateNextWordOptions(cfg, "sys", "prompt");
    expect(result).toEqual(object);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("accepts word/candidates aliases in a fenced next_word reply", async () => {
    const object = {
      candidates: [
        { word: "shadow", kind: "continuation" },
        { text: "smoke", kind: "rhyme" },
      ],
    };
    const fenced = "```json\n" + JSON.stringify(object) + "\n```";
    const err = Object.assign(
      new Error("No object generated: could not parse the response."),
      { text: fenced },
    );
    generateObjectMock.mockRejectedValueOnce(err);

    const result = await generateNextWordOptions(cfg, "sys", "prompt");
    expect(result).toEqual({
      options: [
        { text: "shadow", kind: "continuation" },
        { text: "smoke", kind: "rhyme" },
      ],
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("salvages complete next_word options from a truncated fenced reply", async () => {
    const truncated =
      '```json\n{\n  "options": [\n    {\n      "word": "turned away",\n      "kind": "continuation"\n    },\n    {\n      "word": "disappeared",\n      "kind": "continuation"\n    },\n    {';
    const err = Object.assign(
      new Error("No object generated: could not parse the response."),
      { text: truncated },
    );
    generateObjectMock.mockRejectedValueOnce(err);

    const result = await generateNextWordOptions(cfg, "sys", "prompt");
    expect(result).toEqual({
      options: [
        { text: "turned away", kind: "continuation" },
        { text: "disappeared", kind: "continuation" },
      ],
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("falls back to generateText and lenient JSON extraction when generateObject has no recoverable text", async () => {
    const object = {
      options: [
        { text: "shadow", kind: "continuation" },
        { text: "smoke", kind: "rhyme" },
        { text: "silence", kind: "continuation" },
      ],
    };
    generateObjectMock.mockRejectedValueOnce(
      new Error("No object generated: could not parse the response."),
    );
    generateTextMock.mockResolvedValueOnce({
      text: "Here is the JSON:\n```json\n" + JSON.stringify(object) + "\n```",
      usage: { inputTokens: 10, outputTokens: 20 },
      finishReason: "stop",
      response: { modelId: "mock" },
    });

    const result = await generateNextWordOptions(cfg, "sys", "prompt");
    expect(result).toEqual(object);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const opts = generateTextMock.mock.calls[0][0];
    expect(opts.maxOutputTokens).toBe(NEXT_WORD_MAX_OUTPUT_TOKENS);
    expect(opts.maxRetries).toBe(0);
    expect(opts.system).toContain("Return only a single JSON object");
  });

  it("includes the raw model text when structured output cannot be parsed", async () => {
    generateObjectMock.mockRejectedValueOnce(
      new Error("No object generated: could not parse the response."),
    );
    generateTextMock.mockResolvedValueOnce({
      text: "I am just going to talk about lyrics instead.",
      usage: {},
      finishReason: "stop",
      response: { modelId: "mock" },
    });

    const err = await generateNextWordOptions(cfg, "sys", "prompt").then(
      () => {
        throw new Error("expected generateNextWordOptions to reject");
      },
      (e: unknown) => e as Error & { text?: string },
    );
    expect(err.message).toContain("could not parse the response");
    expect(err.message).toContain(
      "I am just going to talk about lyrics instead.",
    );
    expect(err.text).toBe("I am just going to talk about lyrics instead.");
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

  it("does not throw when the env object is missing (Node CLI / import.meta.env is undefined)", () => {
    expect(() => shouldLogAI(undefined)).not.toThrow();
    // Simulate the CLI: import.meta.env itself is undefined, so DEV must be false.
    expect(resolveAiLogEnv(undefined, undefined)).toEqual({});
    expect(!!resolveAiLogEnv(undefined, undefined).DEV).toBe(false);
    // An explicit { DEV: false } wins over a DEV=true fallback (production).
    expect(resolveAiLogEnv({ DEV: false }, { DEV: true })).toEqual({
      DEV: false,
    });
  });
});

describe("logAI gating", () => {
  it("does not throw when the env object is missing", () => {
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupEndSpy = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() =>
        logAI("testFn", { model: "gpt-4.1-mini", durationMs: 1 }, undefined),
      ).not.toThrow();
    } finally {
      groupSpy.mockRestore();
      groupEndSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("is a no-op and never touches the console when DEV is false", () => {
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logAI(
        "testFn",
        { model: "gpt-4.1-mini", prompt: "secret prompt", durationMs: 1 },
        { DEV: false },
      );
      expect(groupSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      groupSpy.mockRestore();
      logSpy.mockRestore();
    }
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

// ── OpenRouter decisions: "generate, then decide" ───────────────────────────
// The generator stage goes through the same mocked `ai` package as above;
// the ranker stage calls the real fetch-based callOpenRouterDecisions, so
// global fetch is stubbed per test instead.

const orCfg: AIConfig = {
  provider: "openrouter",
  apiKey: "or-key",
  baseUrl: "",
  model: "typesafe/jev-1.14",
  lyricsGeneratorModel: "anthropic/claude-haiku-4.5",
  lyricsCandidateCount: 3,
};

function mockTextResult(text: string) {
  return {
    text,
    usage: {},
    finishReason: "stop" as const,
    response: { modelId: "mock" },
  };
}

function stubDecisionsFetch(answer: Record<string, unknown>) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "typesafe/jev-1.14-20261014",
          answers: { best: answer },
          usage: { input_tokens: 20, output_tokens: 2, cost: 0.00001 },
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OpenRouter decisions pipeline (generate, then decide)", () => {
  beforeEach(() => {
    generateObjectMock.mockClear();
    generateTextMock.mockClear();
    streamTextMock.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streamLyricsSuggestion: generates candidates, ranks them, and yields only the winner", async () => {
    generateTextMock
      .mockResolvedValueOnce(mockTextResult("cand A"))
      .mockResolvedValueOnce(mockTextResult("cand B"))
      .mockResolvedValueOnce(mockTextResult("cand C"));
    const fetchMock = stubDecisionsFetch({
      type: "choice",
      choice: "c1",
      probabilities: { c0: 0.1, c1: 0.8, c2: 0.1 },
    });

    const onMetrics = vi.fn();
    const chunks: string[] = [];
    for await (const chunk of streamLyricsSuggestion(
      orCfg,
      "sys",
      "prompt",
      undefined,
      onMetrics,
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["cand B"]);
    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onMetrics).toHaveBeenCalledTimes(1);
    const metrics = onMetrics.mock.calls[0][0];
    expect(metrics.generator?.count).toBe(3);
    expect(metrics.ranker?.model).toBe("typesafe/jev-1.14-20261014");
    expect(metrics.unrankedCandidates).toEqual(["cand A", "cand B", "cand C"]);
    expect(metrics.pickedIndex).toBe(1);
  });

  it("streamLyricsSuggestion: falls back to the unranked generator output when ranking fails (non-abort)", async () => {
    generateTextMock
      .mockResolvedValueOnce(mockTextResult("first"))
      .mockResolvedValueOnce(mockTextResult("second"))
      .mockResolvedValueOnce(mockTextResult("third"));
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    for await (const chunk of streamLyricsSuggestion(orCfg, "sys", "prompt")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["first"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streamLyricsSuggestion: propagates an abort instead of silently falling back", async () => {
    generateTextMock
      .mockResolvedValueOnce(mockTextResult("first"))
      .mockResolvedValueOnce(mockTextResult("second"))
      .mockResolvedValueOnce(mockTextResult("third"));
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(async () => {
      for await (const chunk of streamLyricsSuggestion(
        orCfg,
        "sys",
        "prompt",
        controller.signal,
      )) {
        void chunk;
      }
    }).rejects.toThrow();
  });

  it("generateNextWordOptions: generates then ranks, reordering options best-first", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        options: [
          { text: "opt1", kind: "continuation" },
          { text: "opt2", kind: "continuation" },
          { text: "opt3", kind: "rhyme" },
        ],
      },
      usage: {},
      finishReason: "stop",
      response: { modelId: "mock" },
    });
    stubDecisionsFetch({
      type: "choice",
      choice: "c2",
      probabilities: { c0: 0.1, c1: 0.1, c2: 0.8 },
    });

    const onMetrics = vi.fn();
    const result = await generateNextWordOptions(
      orCfg,
      "sys",
      "prompt",
      undefined,
      onMetrics,
    );
    expect(result.options.map((o) => o.text)).toEqual(["opt3", "opt1", "opt2"]);
    expect(generateObjectMock.mock.calls[0][0].maxOutputTokens).toBe(
      NEXT_WORD_MAX_OUTPUT_TOKENS,
    );
    expect(
      typeof generateObjectMock.mock.calls[0][0].experimental_repairText,
    ).toBe("function");
    expect(onMetrics.mock.calls[0][0].ranker).toBeDefined();
    expect(onMetrics.mock.calls[0][0].generator).toBeDefined();
    expect(onMetrics.mock.calls[0][0].unrankedCandidates).toEqual([
      "opt1",
      "opt2",
      "opt3",
    ]);
    expect(onMetrics.mock.calls[0][0].pickedIndex).toBe(2);
  });

  it("generatePopupSuggestions: ranks suggestions within the list", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        suggestions: [
          { mode: "completion", text: "s1" },
          { mode: "next_line", text: "s2" },
        ],
      },
      usage: {},
      finishReason: "stop",
      response: { modelId: "mock" },
    });
    stubDecisionsFetch({
      type: "choice",
      choice: "c1",
      probabilities: { c0: 0.2, c1: 0.8 },
    });

    const result = await generatePopupSuggestions(orCfg, "sys", "prompt");
    expect(result.suggestions.map((s) => s.text)).toEqual(["s2", "s1"]);
  });

  it("generateStyleSummary uses the generator model and never calls the decisions endpoint", async () => {
    generateTextMock.mockResolvedValueOnce(mockTextResult("a style"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateStyleSummary(orCfg, ["line one"]);

    expect(result).toBe("a style");
    expect(fetchMock).not.toHaveBeenCalled();
    const usedModel = generateTextMock.mock.calls[0][0].model;
    expect(usedModel.modelId).toBe("anthropic/claude-haiku-4.5");
  });

  it("chatWithTabAgent uses the generator model and never calls the decisions endpoint", async () => {
    generateTextMock.mockResolvedValueOnce(mockTextResult("a reply"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatWithTabAgent(orCfg, "sys", [
      { role: "user", content: "hi" },
    ]);

    expect(result).toBe("a reply");
    expect(fetchMock).not.toHaveBeenCalled();
    const usedModel = generateTextMock.mock.calls[0][0].model;
    expect(usedModel.modelId).toBe("anthropic/claude-haiku-4.5");
  });

  it("generateTabStructure uses the generator model and never calls the decisions endpoint", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { parts: [] },
      usage: {},
      finishReason: "stop",
      response: { modelId: "mock" },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await generateTabStructure(orCfg, {
      sectionName: "Verse",
      instruments: ["guitar"],
      chords: "C G",
      bars: 4,
      timeSignature: "4/4",
      styleNote: "",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const usedModel = generateObjectMock.mock.calls[0][0].model;
    expect(usedModel.modelId).toBe("anthropic/claude-haiku-4.5");
  });

  it("testAIConnection sends a decisions ping instead of a chat request", async () => {
    const fetchMock = stubDecisionsFetch({ type: "noul", noul: 0.99 });

    await testAIConnection(orCfg);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.questions.ok.type).toBe("noul");
  });

  it('lyricsDecisionsMode "off" keeps a known decisions model on the plain chat path', async () => {
    generateTextMock.mockResolvedValueOnce(mockTextResult("plain reply"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await testAIConnection({ ...orCfg, lyricsDecisionsMode: "off" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });
});

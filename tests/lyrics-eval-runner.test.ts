import { describe, it, expect, vi, beforeEach } from "vitest";

const { streamLyricsSuggestionMock, generateNextWordOptionsMock } = vi.hoisted(
  () => ({
    streamLyricsSuggestionMock: vi.fn(),
    generateNextWordOptionsMock: vi.fn(),
  }),
);

vi.mock("../src/lib/ai", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/ai")>("../src/lib/ai");
  return {
    ...actual,
    streamLyricsSuggestion: streamLyricsSuggestionMock,
    generateNextWordOptions: generateNextWordOptionsMock,
  };
});

import { runTrial, CHECK_NAMES } from "../scripts/lyrics-eval/runner";
import type { EvalFixture } from "../scripts/lyrics-eval/types";
import type { AIConfig } from "../src/types";

const cfg: AIConfig = {
  provider: "openai",
  apiKey: "test-key",
  baseUrl: "",
  model: "gpt-4.1-mini",
};

function fixture(overrides: Partial<EvalFixture> = {}): EvalFixture {
  return {
    id: "test-fixture",
    lang: "en",
    mode: "next_line",
    lyrics: "I walked down a street in the rain",
    cursor: 36,
    expect: {},
    ...overrides,
  };
}

beforeEach(() => {
  streamLyricsSuggestionMock.mockReset();
  generateNextWordOptionsMock.mockReset();
});

describe("runTrial: empty-output / length-reasoning classification", () => {
  it("errors (not a format fail) when the stream yields nothing and finishReason is length with reasoning tokens spent", async () => {
    streamLyricsSuggestionMock.mockImplementation(async function* (
      _cfg: AIConfig,
      _system: string,
      _prompt: string,
      _signal: AbortSignal | undefined,
      onMetrics?: (m: unknown) => void,
    ) {
      onMetrics?.({
        ttftMs: null,
        totalMs: 50,
        usage: {
          outputTokens: 80,
          outputTokenDetails: { reasoningTokens: 80 },
        },
        finishReason: "length",
      });
      if (false as boolean) yield "";
    });

    const trial = await runTrial(cfg, fixture());

    expect(trial.error).toMatch(/length/);
    expect(trial.rawOutput).toBe("");
    for (const name of CHECK_NAMES) {
      expect(trial.checks[name].status).toBe("skip");
    }
  });

  it("stays a format fail (not an error) when empty output has finishReason stop and no reasoning tokens", async () => {
    streamLyricsSuggestionMock.mockImplementation(async function* (
      _cfg: AIConfig,
      _system: string,
      _prompt: string,
      _signal: AbortSignal | undefined,
      onMetrics?: (m: unknown) => void,
    ) {
      onMetrics?.({
        ttftMs: 5,
        totalMs: 10,
        usage: {
          outputTokens: 0,
          outputTokenDetails: { reasoningTokens: 0 },
        },
        finishReason: "stop",
      });
      if (false as boolean) yield "";
    });

    const trial = await runTrial(cfg, fixture());

    expect(trial.error).toBeUndefined();
    expect(trial.checks.format.status).toBe("fail");
    expect(trial.checks.format.detail).toBe("empty output");
  });
});

describe("runTrial: next_word with zero options", () => {
  it("errors instead of scoring aggregateOptionChecks' format fail", async () => {
    generateNextWordOptionsMock.mockImplementation(
      async (
        _cfg: AIConfig,
        _system: string,
        _prompt: string,
        _signal: AbortSignal | undefined,
        onMetrics?: (m: unknown) => void,
      ) => {
        onMetrics?.({ ttftMs: 10, totalMs: 10, usage: {} });
        return { options: [] };
      },
    );

    const trial = await runTrial(cfg, fixture({ mode: "next_word" }));

    expect(trial.error).toBe("no options returned");
    for (const name of CHECK_NAMES) {
      expect(trial.checks[name].status).toBe("skip");
    }
  });
});

describe("runTrial: normal trials still score", () => {
  it("scores a non-empty stream trial normally", async () => {
    streamLyricsSuggestionMock.mockImplementation(async function* (
      _cfg: AIConfig,
      _system: string,
      _prompt: string,
      _signal: AbortSignal | undefined,
      onMetrics?: (m: unknown) => void,
    ) {
      onMetrics?.({
        ttftMs: 5,
        totalMs: 20,
        usage: { outputTokens: 4 },
        finishReason: "stop",
      });
      yield "down the empty road";
    });

    const trial = await runTrial(cfg, fixture());

    expect(trial.error).toBeUndefined();
    expect(trial.rawOutput).toBe("down the empty road");
    expect(trial.checks.format.status).not.toBe("skip");
  });

  it("scores a non-empty next_word trial normally", async () => {
    generateNextWordOptionsMock.mockImplementation(
      async (
        _cfg: AIConfig,
        _system: string,
        _prompt: string,
        _signal: AbortSignal | undefined,
        onMetrics?: (m: unknown) => void,
      ) => {
        onMetrics?.({ ttftMs: 10, totalMs: 10, usage: {} });
        return {
          options: [
            { text: "slowly", kind: "continuation" },
            { text: "away", kind: "rhyme" },
          ],
        };
      },
    );

    const trial = await runTrial(cfg, fixture({ mode: "next_word" }));

    expect(trial.error).toBeUndefined();
    expect(trial.checks.format.status).not.toBe("skip");
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  OPENROUTER_DECISIONS_URL,
  isDecisionsModelId,
  resolveIsDecisionsModel,
  callOpenRouterDecisions,
  rankLyricCandidates,
  pingDecisionsModel,
  OpenRouterDecisionsError,
  DecisionsRefusalError,
} from "../src/lib/openrouter-decisions";
import type { AIConfig } from "../src/types";

const cfg: AIConfig = {
  provider: "openrouter",
  apiKey: "test-key",
  baseUrl: "",
  model: "typesafe/jev-1.14",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const okAnswerBody = {
  model: "typesafe/jev-1.14-20261014",
  answers: { ok: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 1 },
};

describe("isDecisionsModelId", () => {
  it("matches the known typesafe/jev-* family", () => {
    expect(isDecisionsModelId("typesafe/jev-1.14")).toBe(true);
    expect(isDecisionsModelId("typesafe/jev-router")).toBe(true);
  });

  it("matches the ~typesafe/jev-latest alias", () => {
    expect(isDecisionsModelId("~typesafe/jev-latest")).toBe(true);
  });

  it("matches an id only present in the provided catalog set", () => {
    const known = new Set(["google/gemini-decision-1"]);
    expect(isDecisionsModelId("google/gemini-decision-1", known)).toBe(true);
  });

  it("returns false for an unrelated chat model id", () => {
    expect(isDecisionsModelId("anthropic/claude-haiku-4.5")).toBe(false);
  });

  it("returns false for an empty id", () => {
    expect(isDecisionsModelId("")).toBe(false);
  });
});

describe("resolveIsDecisionsModel", () => {
  it('forces true when mode is "on", even for an unrelated id', () => {
    expect(resolveIsDecisionsModel("anthropic/claude-haiku-4.5", "on")).toBe(
      true,
    );
  });

  it('forces false when mode is "off", even for a known decisions id', () => {
    expect(resolveIsDecisionsModel("typesafe/jev-1.14", "off")).toBe(false);
  });

  it('falls back to isDecisionsModelId when mode is "auto" or undefined', () => {
    expect(resolveIsDecisionsModel("typesafe/jev-1.14", "auto")).toBe(true);
    expect(resolveIsDecisionsModel("typesafe/jev-1.14", undefined)).toBe(true);
    expect(
      resolveIsDecisionsModel("anthropic/claude-haiku-4.5", undefined),
    ).toBe(false);
  });
});

describe("callOpenRouterDecisions", () => {
  it("posts to the decisions URL with Bearer auth, X-Title, and model/state/questions", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okAnswerBody));
    await callOpenRouterDecisions(
      cfg,
      {
        model: "typesafe/jev-1.14",
        state: { ticket: "hello" },
        questions: { ok: { type: "noul", instructions: "Is this ok?" } },
      },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OPENROUTER_DECISIONS_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "X-Title": "Sessions",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("typesafe/jev-1.14");
    expect(body.state).toEqual({ ticket: "hello" });
    expect(body.questions).toEqual({
      ok: { type: "noul", instructions: "Is this ok?" },
    });
  });

  it("injects provider.data_collection: deny by default", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okAnswerBody));
    await callOpenRouterDecisions(
      cfg,
      { model: "x", state: "s", questions: {} },
      { fetchImpl },
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("switches to allow when openRouterDenyDataCollection is false", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okAnswerBody));
    await callOpenRouterDecisions(
      { ...cfg, openRouterDenyDataCollection: false },
      { model: "x", state: "s", questions: {} },
      { fetchImpl },
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.provider).toEqual({ data_collection: "allow" });
  });

  it("passes the abort signal through to fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => jsonResponse(okAnswerBody));
    await callOpenRouterDecisions(
      cfg,
      { model: "x", state: "s", questions: {} },
      { fetchImpl, signal: controller.signal },
    );
    expect(fetchImpl.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("throws a readable error with the message from a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { code: 402, message: "Insufficient credits" } },
        402,
      ),
    );
    await expect(
      callOpenRouterDecisions(
        cfg,
        { model: "x", state: "s", questions: {} },
        { fetchImpl },
      ),
    ).rejects.toThrow("Insufficient credits");
  });

  it("throws a generic message when a non-2xx response has no error body", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    await expect(
      callOpenRouterDecisions(
        cfg,
        { model: "x", state: "s", questions: {} },
        { fetchImpl },
      ),
    ).rejects.toThrow(/500/);
  });

  it("throws when the response is missing required fields", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ answers: {} }));
    await expect(
      callOpenRouterDecisions(
        cfg,
        { model: "x", state: "s", questions: {} },
        { fetchImpl },
      ),
    ).rejects.toThrow(OpenRouterDecisionsError);
  });
});

describe("rankLyricCandidates", () => {
  const candidates = ["candidate A", "candidate B", "candidate C"];

  it("orders candidates best-first by the choice answer's probabilities", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "typesafe/jev-1.14-20261014",
        answers: {
          best: {
            type: "choice",
            choice: "c1",
            probabilities: { c0: 0.1, c1: 0.7, c2: 0.2 },
          },
        },
        usage: { input_tokens: 50, output_tokens: 5, cost: 0.0001 },
      }),
    );
    const result = await rankLyricCandidates(
      cfg,
      { system: "sys", prompt: "prompt", candidates },
      { fetchImpl },
    );
    expect(result.ranked).toEqual([
      "candidate B",
      "candidate C",
      "candidate A",
    ]);
    expect(result.topProbability).toBe(0.7);
    expect(result.servedModel).toBe("typesafe/jev-1.14-20261014");
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 5 });
    expect(result.cost).toBe(0.0001);
  });

  it("falls back to putting the chosen candidate first when probabilities are missing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "typesafe/jev-1.14-20261014",
        answers: { best: { type: "choice", choice: "c2" } },
        usage: { input_tokens: 50, output_tokens: 5 },
      }),
    );
    const result = await rankLyricCandidates(
      cfg,
      { system: "sys", prompt: "prompt", candidates },
      { fetchImpl },
    );
    expect(result.ranked[0]).toBe("candidate C");
    expect(result.ranked).toHaveLength(3);
    expect(result.topProbability).toBeUndefined();
  });

  it("throws DecisionsRefusalError on a refusal answer", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "typesafe/jev-1.14-20261014",
        answers: { best: { type: "refusal" } },
        usage: { input_tokens: 50, output_tokens: 0 },
      }),
    );
    await expect(
      rankLyricCandidates(
        cfg,
        { system: "sys", prompt: "prompt", candidates },
        { fetchImpl },
      ),
    ).rejects.toThrow(DecisionsRefusalError);
  });

  it("throws on an unexpected answer type for the ranking question", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "typesafe/jev-1.14-20261014",
        answers: { best: { type: "noul", noul: 0.5 } },
        usage: { input_tokens: 50, output_tokens: 0 },
      }),
    );
    await expect(
      rankLyricCandidates(
        cfg,
        { system: "sys", prompt: "prompt", candidates },
        { fetchImpl },
      ),
    ).rejects.toThrow(OpenRouterDecisionsError);
  });

  it("sends one choice question keyed c0..cN mapping to the candidate texts", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "m",
        answers: { best: { type: "choice", choice: "c0" } },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    await rankLyricCandidates(
      cfg,
      { system: "sys", prompt: "prompt", candidates },
      { fetchImpl },
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.questions.best.type).toBe("choice");
    expect(body.questions.best.criteria).toEqual({
      c0: "candidate A",
      c1: "candidate B",
      c2: "candidate C",
    });
  });
});

describe("pingDecisionsModel", () => {
  it("sends a single noul question for the configured model", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(okAnswerBody));
    await pingDecisionsModel(cfg, { fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe(cfg.model);
    expect(body.questions.ok.type).toBe("noul");
  });
});

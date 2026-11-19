import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  parseOpenRouterModels,
  filterOpenRouterModels,
  openRouterDataCollection,
  createOpenRouterFetch,
  resolveReasoningParam,
  fetchOpenRouterModels,
} from "../src/lib/openrouter";
import type { AIConfig } from "../src/types";

describe("parseOpenRouterModels", () => {
  it("extracts id/name, sorts by id, and skips malformed entries", () => {
    const out = parseOpenRouterModels({
      data: [{ id: "b/x", name: "X" }, { id: "a/y" }, { name: "no id" }],
    });
    expect(out).toEqual([
      { id: "a/y", name: "a/y" },
      { id: "b/x", name: "X" },
    ]);
  });

  it("returns [] for unexpected payloads", () => {
    expect(parseOpenRouterModels(null)).toEqual([]);
    expect(parseOpenRouterModels({})).toEqual([]);
  });

  it("keeps reasoning capability metadata when present", () => {
    const out = parseOpenRouterModels({
      data: [
        {
          id: "anthropic/claude-haiku-5.5",
          reasoning: {
            mandatory: false,
            supported_efforts: ["none", "low", "medium", "high"],
          },
        },
        { id: "anthropic/claude-haiku-4.5" },
        { id: "some/mandatory-model", reasoning: { mandatory: true } },
        { id: "weird/model", reasoning: "not an object" },
      ],
    });
    expect(
      out.find((m) => m.id === "anthropic/claude-haiku-5.5")?.reasoning,
    ).toEqual({
      mandatory: false,
      supported_efforts: ["none", "low", "medium", "high"],
    });
    expect(
      out.find((m) => m.id === "anthropic/claude-haiku-4.5")?.reasoning,
    ).toBeUndefined();
    expect(out.find((m) => m.id === "some/mandatory-model")?.reasoning).toEqual(
      { mandatory: true, supported_efforts: undefined },
    );
    expect(out.find((m) => m.id === "weird/model")?.reasoning).toBeUndefined();
  });
});

describe("filterOpenRouterModels", () => {
  const models = [
    { id: "anthropic/claude-sonnet-4.6", name: "Anthropic: Claude Sonnet 4.6" },
    { id: "openai/gpt-4.1-mini", name: "OpenAI: GPT-4.1 Mini" },
  ];

  it("returns everything for an empty query", () => {
    expect(filterOpenRouterModels(models, "  ")).toHaveLength(2);
  });

  it("matches all terms against id or name, case-insensitively", () => {
    expect(filterOpenRouterModels(models, "CLAUDE sonnet")).toEqual([
      models[0],
    ]);
    expect(filterOpenRouterModels(models, "gpt mini")).toEqual([models[1]]);
    expect(filterOpenRouterModels(models, "gemini")).toEqual([]);
  });
});

const baseCfg: AIConfig = {
  provider: "openrouter",
  apiKey: "test-key",
  baseUrl: "",
  model: "anthropic/claude-haiku-4.5",
};

describe("openRouterDataCollection", () => {
  it("defaults to deny when the setting is missing", () => {
    expect(openRouterDataCollection(baseCfg)).toBe("deny");
  });

  it("denies when explicitly set to true", () => {
    expect(
      openRouterDataCollection({
        ...baseCfg,
        openRouterDenyDataCollection: true,
      }),
    ).toBe("deny");
  });

  it("allows only when explicitly set to false", () => {
    expect(
      openRouterDataCollection({
        ...baseCfg,
        openRouterDenyDataCollection: false,
      }),
    ).toBe("allow");
  });
});

describe("resolveReasoningParam", () => {
  it("sends effort:none for 'off' when the capability supports it", () => {
    expect(
      resolveReasoningParam("some/model", "off", {
        mandatory: false,
        supportedEfforts: ["none", "low"],
      }),
    ).toEqual({ effort: "none" });
  });

  it("sends nothing for 'provider-default' regardless of capability", () => {
    expect(
      resolveReasoningParam("some/model", "provider-default", {
        mandatory: false,
        supportedEfforts: ["none"],
      }),
    ).toBeUndefined();
  });

  it("sends nothing when the model is mandatory, even if the effort is listed", () => {
    expect(
      resolveReasoningParam("some/mandatory-model", "off", {
        mandatory: true,
        supportedEfforts: ["none"],
      }),
    ).toBeUndefined();
  });

  it("sends nothing when there is no capability data at all", () => {
    expect(
      resolveReasoningParam(
        "openrouter/some-unknown-model-id",
        "off",
        undefined,
      ),
    ).toBeUndefined();
  });

  it("sends nothing when the requested effort isn't in supported_efforts", () => {
    expect(
      resolveReasoningParam("some/model", "off", {
        mandatory: false,
        supportedEfforts: ["low", "high"],
      }),
    ).toBeUndefined();
  });

  it("sends a named effort when the capability lists it", () => {
    expect(
      resolveReasoningParam("some/model", "low", {
        mandatory: false,
        supportedEfforts: ["low", "high"],
      }),
    ).toEqual({ effort: "low" });
  });
});

describe("createOpenRouterFetch", () => {
  it("injects provider.data_collection into a JSON request body", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const wrapped = createOpenRouterFetch(
      { dataCollection: "deny" },
      baseFetch,
    );

    await wrapped("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "anthropic/claude-haiku-4.5" }),
    });

    expect(baseFetch).toHaveBeenCalledTimes(1);
    const [, init] = baseFetch.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      model: "anthropic/claude-haiku-4.5",
      provider: { data_collection: "deny" },
    });
  });

  it("preserves an existing provider object and switches to allow", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const wrapped = createOpenRouterFetch(
      { dataCollection: "allow" },
      baseFetch,
    );

    await wrapped("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "x", provider: { order: ["foo"] } }),
    });

    const [, init] = baseFetch.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      model: "x",
      provider: { order: ["foo"], data_collection: "allow" },
    });
  });

  it("passes non-JSON bodies through unchanged", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const wrapped = createOpenRouterFetch(
      { dataCollection: "deny" },
      baseFetch,
    );

    await wrapped("https://example.com", { method: "POST", body: "not json" });

    const [, init] = baseFetch.mock.calls[0];
    expect(init.body).toBe("not json");
  });

  it("passes requests with no body through unchanged", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const wrapped = createOpenRouterFetch(
      { dataCollection: "deny" },
      baseFetch,
    );

    await wrapped("https://example.com");

    expect(baseFetch).toHaveBeenCalledWith("https://example.com", undefined);
  });

  describe("reasoning injection (per-model capability)", () => {
    // The reasoning lookup falls back to a static seed until the OpenRouter
    // catalog resolves (see getCachedOpenRouterModels) — resolve it once,
    // to an empty catalog, so every test below exercises the seed path
    // deterministically and no test makes a real network call.
    beforeAll(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ data: [] }))),
      );
      await fetchOpenRouterModels();
      vi.unstubAllGlobals();
    });

    it("injects reasoning:{effort:none} for a seeded model when the setting is 'off'", async () => {
      const baseFetch = vi.fn(async () => new Response("{}"));
      const wrapped = createOpenRouterFetch(
        { dataCollection: "deny", reasoning: "off" },
        baseFetch,
      );

      await wrapped("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "anthropic/claude-haiku-5.5" }),
      });

      const [, init] = baseFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.reasoning).toEqual({ effort: "none" });
      expect(body.provider).toEqual({ data_collection: "deny" });
    });

    it("sends nothing for a model with no catalog/seed capability data", async () => {
      const baseFetch = vi.fn(async () => new Response("{}"));
      const wrapped = createOpenRouterFetch(
        { dataCollection: "deny", reasoning: "off" },
        baseFetch,
      );

      await wrapped("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "anthropic/claude-haiku-4.5" }),
      });

      const [, init] = baseFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.reasoning).toBeUndefined();
    });

    it("never overwrites a caller-supplied reasoning field", async () => {
      const baseFetch = vi.fn(async () => new Response("{}"));
      const wrapped = createOpenRouterFetch(
        { dataCollection: "deny", reasoning: "off" },
        baseFetch,
      );

      await wrapped("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "anthropic/claude-haiku-5.5",
          reasoning: { effort: "high" },
        }),
      });

      const [, init] = baseFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.reasoning).toEqual({ effort: "high" });
    });

    it("sends nothing when lyricsReasoning is 'provider-default'", async () => {
      const baseFetch = vi.fn(async () => new Response("{}"));
      const wrapped = createOpenRouterFetch(
        { dataCollection: "deny", reasoning: "provider-default" },
        baseFetch,
      );

      await wrapped("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "anthropic/claude-haiku-5.5" }),
      });

      const [, init] = baseFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.reasoning).toBeUndefined();
    });

    it("does not touch a request to a non-chat-completions URL", async () => {
      const baseFetch = vi.fn(async () => new Response("{}"));
      const wrapped = createOpenRouterFetch(
        { dataCollection: "deny", reasoning: "off" },
        baseFetch,
      );

      const rawBody = JSON.stringify({ model: "anthropic/claude-haiku-5.5" });
      await wrapped("https://openrouter.ai/api/alpha/decisions", {
        method: "POST",
        body: rawBody,
      });

      const [, init] = baseFetch.mock.calls[0];
      expect(init.body).toBe(rawBody);
    });

    it("does nothing when options.reasoning is undefined (Tab Agent / testAIConnection)", async () => {
      const baseFetch = vi.fn(async () => new Response("{}"));
      const wrapped = createOpenRouterFetch(
        { dataCollection: "deny" },
        baseFetch,
      );

      await wrapped("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "anthropic/claude-haiku-5.5" }),
      });

      const [, init] = baseFetch.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.reasoning).toBeUndefined();
      expect(body.provider).toEqual({ data_collection: "deny" });
    });
  });
});

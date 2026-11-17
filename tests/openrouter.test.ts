import { describe, it, expect, vi } from "vitest";
import {
  parseOpenRouterModels,
  filterOpenRouterModels,
  openRouterDataCollection,
  createOpenRouterFetch,
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

describe("createOpenRouterFetch", () => {
  it("injects provider.data_collection into a JSON request body", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const wrapped = createOpenRouterFetch("deny", baseFetch);

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
    const wrapped = createOpenRouterFetch("allow", baseFetch);

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
    const wrapped = createOpenRouterFetch("deny", baseFetch);

    await wrapped("https://example.com", { method: "POST", body: "not json" });

    const [, init] = baseFetch.mock.calls[0];
    expect(init.body).toBe("not json");
  });

  it("passes requests with no body through unchanged", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const wrapped = createOpenRouterFetch("deny", baseFetch);

    await wrapped("https://example.com");

    expect(baseFetch).toHaveBeenCalledWith("https://example.com", undefined);
  });
});

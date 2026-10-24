import { describe, it, expect } from "vitest";
import {
  parseOpenRouterModels,
  filterOpenRouterModels,
} from "../src/lib/openrouter";

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

import { describe, it, expect } from "vitest";
import {
  extractJsonText,
  parseNextWordOptions,
  rawTextFromObjectError,
  repairAiJsonText,
  sliceBalancedJson,
} from "../src/lib/parse-ai-json";

const OPTIONS = {
  options: [
    { text: "shadow", kind: "continuation" },
    { text: "smoke", kind: "rhyme" },
  ],
};

describe("extractJsonText", () => {
  it("parses a bare JSON object", () => {
    const raw = JSON.stringify(OPTIONS);
    expect(extractJsonText(raw)).toBe(raw);
  });

  it("strips markdown fences around JSON", () => {
    const inner = JSON.stringify(OPTIONS);
    const fenced = "```json\n" + inner + "\n```";
    expect(extractJsonText(fenced)).toBe(inner);
  });

  it("extracts a JSON object after a prose preamble", () => {
    const inner = JSON.stringify(OPTIONS);
    const wrapped =
      "Here is the JSON you asked for:\n" + inner + "\nHope this helps.";
    expect(extractJsonText(wrapped)).toBe(inner);
  });

  it("returns null for commentary with no JSON", () => {
    expect(extractJsonText("I cannot produce an object.")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(extractJsonText('{"options":[{"text":"sha')).toBeNull();
  });
});

describe("sliceBalancedJson", () => {
  it("ignores braces inside strings", () => {
    const raw = '{"text":"a { brace }"}';
    expect(sliceBalancedJson("prefix " + raw + " trailing")).toBe(raw);
  });
});

describe("repairAiJsonText", () => {
  it("returns extracted JSON for generateObject's repair hook", async () => {
    const inner = JSON.stringify(OPTIONS);
    expect(
      await repairAiJsonText({ text: "```json\n" + inner + "\n```" }),
    ).toBe(inner);
  });
});

describe("rawTextFromObjectError", () => {
  it("reads the text field off a NoObjectGenerated-like error", () => {
    const err = Object.assign(
      new Error("No object generated: could not parse the response."),
      { text: "```json\n{}\n```" },
    );
    expect(rawTextFromObjectError(err)).toBe("```json\n{}\n```");
  });

  it("returns empty string when no text is attached", () => {
    expect(rawTextFromObjectError(new Error("boom"))).toBe("");
  });
});

describe("parseNextWordOptions", () => {
  it("maps the word and candidates aliases onto the canonical schema", () => {
    expect(
      parseNextWordOptions(
        JSON.stringify({
          candidates: [
            { word: "shadow", kind: "continuation" },
            { text: "smoke", kind: "rhyme" },
          ],
        }),
      ),
    ).toEqual({
      options: [
        { text: "shadow", kind: "continuation" },
        { text: "smoke", kind: "rhyme" },
      ],
    });
  });

  it("accepts a fenced reply that uses those aliases", () => {
    const inner = JSON.stringify({
      candidates: [
        { word: "שתיקה", kind: "rhyme" },
        { word: "חדר אפל", kind: "continuation" },
      ],
    });
    expect(parseNextWordOptions("```json\n" + inner + "\n```")).toEqual({
      options: [
        { text: "שתיקה", kind: "rhyme" },
        { text: "חדר אפל", kind: "continuation" },
      ],
    });
  });

  // Reproduces the truncated Haiku replies from the PR #87 jev eval: an
  // opening markdown fence, alias keys, and a cut-off third option.
  const truncatedEnglish = `\`\`\`json
{
  "options": [
    {
      "word": "turned away",
      "kind": "continuation"
    },
    {
      "word": "disappeared",
      "kind": "continuation"
    },
    {`;

  const truncatedHebrew = `\`\`\`json
{
  "candidates": [
    {
      "text": "של דממה",
      "kind": "continuation"
    },
    {
      "text": "שחוזרת",
      "kind": "rhyme"`;

  it("salvages complete options from a truncated fenced English reply", () => {
    expect(parseNextWordOptions(truncatedEnglish)).toEqual({
      options: [
        { text: "turned away", kind: "continuation" },
        { text: "disappeared", kind: "continuation" },
      ],
    });
  });

  it("salvages complete options from a truncated fenced Hebrew reply", () => {
    expect(parseNextWordOptions(truncatedHebrew)).toEqual({
      options: [
        { text: "של דממה", kind: "continuation" },
        { text: "שחוזרת", kind: "rhyme" },
      ],
    });
  });
});

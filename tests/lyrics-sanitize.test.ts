import { describe, it, expect } from "vitest";
import { sanitizeLyricsOutput } from "../src/lib/lyrics-sanitize";
import { smartJoinCompletion } from "../src/lib/lyrics-join";

describe("sanitizeLyricsOutput", () => {
  it("strips an EN leading label", () => {
    expect(
      sanitizeLyricsOutput("Next line: Walking into tomorrow", "next_line"),
    ).toBe("Walking into tomorrow");
    expect(
      sanitizeLyricsOutput("Suggestion: a quiet kind of leaving", "next_line"),
    ).toBe("a quiet kind of leaving");
  });

  it("strips a HE leading label", () => {
    expect(sanitizeLyricsOutput("השלמה: אני אוהב אותך", "completion")).toBe(
      "אני אוהב אותך",
    );
    expect(
      sanitizeLyricsOutput("שורה הבאה: הולך לאיבוד בלילה", "next_line"),
    ).toBe("הולך לאיבוד בלילה");
  });

  it("strips a bold-markdown label", () => {
    expect(
      sanitizeLyricsOutput("**Next line:** Walking into tomorrow", "next_line"),
    ).toBe("Walking into tomorrow");
  });

  it("strips surrounding quotes", () => {
    expect(sanitizeLyricsOutput('"Walking into tomorrow"', "next_line")).toBe(
      "Walking into tomorrow",
    );
    expect(sanitizeLyricsOutput("'Walking into tomorrow'", "alternative")).toBe(
      "Walking into tomorrow",
    );
  });

  it("keeps only the first non-empty line, skipping a leading section header", () => {
    expect(sanitizeLyricsOutput("[Chorus]\nWe rise again", "next_line")).toBe(
      "We rise again",
    );
    expect(sanitizeLyricsOutput("## Verse\nWe rise again", "next_line")).toBe(
      "We rise again",
    );
  });

  it("keeps only the first line out of several", () => {
    expect(
      sanitizeLyricsOutput(
        "Walking into tomorrow\nwith nothing but hope",
        "next_line",
      ),
    ).toBe("Walking into tomorrow");
  });

  it("combines label stripping, quotes, and first-line extraction", () => {
    expect(
      sanitizeLyricsOutput(
        '[Verse 2]\nNext line: "Walking into tomorrow"\nwith nothing but hope',
        "next_line",
      ),
    ).toBe("Walking into tomorrow");
  });

  it("preserves a leading space for completion (smartJoinCompletion's signal)", () => {
    expect(sanitizeLyricsOutput(" away", "completion")).toBe(" away");
    expect(sanitizeLyricsOutput("away", "completion")).toBe("away");
  });

  it("strips quotes while still preserving the leading-space signal", () => {
    expect(sanitizeLyricsOutput(' "away"', "completion")).toBe(" away");
  });

  it("does not preserve a leading space for next_line/alternative", () => {
    expect(sanitizeLyricsOutput(" Walking into tomorrow", "next_line")).toBe(
      "Walking into tomorrow",
    );
  });

  it("returns empty output unchanged", () => {
    expect(sanitizeLyricsOutput("", "completion")).toBe("");
    expect(sanitizeLyricsOutput("   ", "next_line")).toBe("");
  });

  it("leaves an already-clean single line untouched", () => {
    expect(sanitizeLyricsOutput("away from here", "next_line")).toBe(
      "away from here",
    );
  });

  it("stays joinable by smartJoinCompletion after sanitizing", () => {
    // A labeled/quoted completion reply still ends up correctly spaced once
    // joined to the typed prefix, exactly as an unlabeled reply would.
    const prefix = "I walk";
    const sanitized = sanitizeLyricsOutput('Completion: "away"', "completion");
    expect(sanitized).toBe("away");
    expect(smartJoinCompletion(prefix, sanitized)).toBe(" away");
  });
});

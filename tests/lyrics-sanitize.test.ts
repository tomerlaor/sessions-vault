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

  it("strips a matched wrapping pair of double quotes", () => {
    expect(sanitizeLyricsOutput('"Walking into tomorrow"', "next_line")).toBe(
      "Walking into tomorrow",
    );
    expect(sanitizeLyricsOutput("“Walking into tomorrow”", "next_line")).toBe(
      "Walking into tomorrow",
    );
  });

  it("strips Hebrew wrapping quote pairs", () => {
    expect(sanitizeLyricsOutput("„הולך לאיבוד בלילה”", "next_line")).toBe(
      "הולך לאיבוד בלילה",
    );
    expect(sanitizeLyricsOutput("״הולך לאיבוד בלילה״", "next_line")).toBe(
      "הולך לאיבוד בלילה",
    );
  });

  it("never strips a single quote/apostrophe, even when it wraps the line", () => {
    // Per the code review: apostrophes are overwhelmingly real lyrics
    // content ("'Cause...", "leavin'", "'s gone", " 'til"), not a wrapping
    // quote pair — stripping them corrupts the line.
    expect(sanitizeLyricsOutput("'Walking into tomorrow'", "alternative")).toBe(
      "'Walking into tomorrow'",
    );
    expect(sanitizeLyricsOutput("'Cause I'm leavin'", "next_line")).toBe(
      "'Cause I'm leavin'",
    );
    expect(sanitizeLyricsOutput("'s gone", "next_line")).toBe("'s gone");
    expect(sanitizeLyricsOutput(" 'til", "next_line")).toBe("'til");
  });

  it("does not strip a leading/trailing quote that isn't a matched wrapping pair", () => {
    // The leading and trailing `"` here aren't a wrapping pair around the
    // whole line — there are two more `"` inside — so stripping would
    // mangle real dialogue-style lyrics.
    const line = '"Stop," she said, "don\'t go"';
    expect(sanitizeLyricsOutput(line, "next_line")).toBe(line);
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

  it("treats a leading newline before the first lyric line as a leading space", () => {
    expect(sanitizeLyricsOutput("\n say", "completion")).toBe(" say");
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

  it("skips a code fence around the real line", () => {
    expect(
      sanitizeLyricsOutput("```\nWalking into tomorrow\n```", "next_line"),
    ).toBe("Walking into tomorrow");
    expect(
      sanitizeLyricsOutput("```text\nWalking into tomorrow\n```", "next_line"),
    ).toBe("Walking into tomorrow");
  });

  it("sanitizes to empty when the whole reply is just a fence marker", () => {
    expect(sanitizeLyricsOutput("```", "next_line")).toBe("");
    expect(sanitizeLyricsOutput("```text", "next_line")).toBe("");
  });

  it("does not treat a bare hyphen right after the label word as the separator", () => {
    // "Option-less, I run" must not be mistaken for a labeled "Option -
    // less, I run" — a dash separator needs whitespace on both sides.
    expect(sanitizeLyricsOutput("Option-less, I run", "next_line")).toBe(
      "Option-less, I run",
    );
  });

  it("strips a label separated by a dash with whitespace on both sides", () => {
    expect(
      sanitizeLyricsOutput("Suggestion - a quiet kind of leaving", "next_line"),
    ).toBe("a quiet kind of leaving");
  });

  it('strips a "Line:" label', () => {
    expect(
      sanitizeLyricsOutput("Line: Walking into tomorrow", "next_line"),
    ).toBe("Walking into tomorrow");
  });

  it("strips leading 1./1) numbering", () => {
    expect(sanitizeLyricsOutput("1. Walking into tomorrow", "next_line")).toBe(
      "Walking into tomorrow",
    );
    expect(sanitizeLyricsOutput("1) Walking into tomorrow", "next_line")).toBe(
      "Walking into tomorrow",
    );
  });

  it("strips an echoed cursor marker", () => {
    expect(
      sanitizeLyricsOutput("Walking ⟨CURSOR⟩into tomorrow", "next_line"),
    ).toBe("Walking into tomorrow");
  });
});

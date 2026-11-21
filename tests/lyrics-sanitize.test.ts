import { describe, it, expect } from "vitest";
import {
  sanitizeLyricsOutput,
  sanitizePartialLyricsOutput,
  trimRepeatedTail,
} from "../src/lib/lyrics-sanitize";
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

  it("does not treat a spaced dash after the bare word 'line' as a label separator", () => {
    // "Line" alone is too common an ordinary lyric word for the dash form
    // to be safe ("Line — by line" is real lyrics) — only a colon counts.
    expect(sanitizeLyricsOutput("Line — by line", "next_line")).toBe(
      "Line — by line",
    );
  });

  it("strips leading 1./1) numbering", () => {
    expect(sanitizeLyricsOutput("1. Walking into tomorrow", "next_line")).toBe(
      "Walking into tomorrow",
    );
    expect(sanitizeLyricsOutput("1) Walking into tomorrow", "next_line")).toBe(
      "Walking into tomorrow",
    );
  });

  it("does not treat a number embedded in the lyric as numbering", () => {
    // The old regex only required the punctuation, not whitespace after
    // it, so "7.62 caliber love" lost its "7" to "62 caliber love".
    expect(sanitizeLyricsOutput("7.62 caliber love", "next_line")).toBe(
      "7.62 caliber love",
    );
  });

  it("strips a number-only line with nothing else on it", () => {
    expect(sanitizeLyricsOutput("12)", "next_line")).toBe("");
  });

  it("strips an echoed cursor marker", () => {
    expect(
      sanitizeLyricsOutput("Walking ⟨CURSOR⟩into tomorrow", "next_line"),
    ).toBe("Walking into tomorrow");
  });
});

// ── sanitizePartialLyricsOutput (#79: streaming ghost text) ────────────────

describe("sanitizePartialLyricsOutput", () => {
  it("passes a clean partial straight through", () => {
    expect(sanitizePartialLyricsOutput("Walking into")).toBe("Walking into");
  });

  it("strips an echoed cursor marker immediately", () => {
    expect(sanitizePartialLyricsOutput("Walking ⟨CURSOR⟩into")).toBe(
      "Walking into",
    );
  });

  it("strips a leading opening quote as soon as it appears, with no close needed yet", () => {
    expect(sanitizePartialLyricsOutput('"Walking into')).toBe("Walking into");
    expect(sanitizePartialLyricsOutput("“Walking into")).toBe("Walking into");
  });

  it("never strips a leading apostrophe (not a wrapping-quote character)", () => {
    expect(sanitizePartialLyricsOutput("'Cause I'm runnin")).toBe(
      "'Cause I'm runnin",
    );
  });

  it("holds back a label until it either resolves or disproves itself", () => {
    // "Complet" could still become "Completion: ..." — hold back rather
    // than flash it.
    expect(sanitizePartialLyricsOutput("Complet")).toBe("");
    // Once the colon lands, the label is confirmed and stripped.
    expect(sanitizePartialLyricsOutput("Completion: aw")).toBe("aw");
    // "Complex" diverges from every known label word — stop holding back.
    expect(sanitizePartialLyricsOutput("Complex")).toBe("Complex");
  });

  it("holds back numbering until the separator lands", () => {
    expect(sanitizePartialLyricsOutput("1")).toBe("");
    expect(sanitizePartialLyricsOutput("1. Walking")).toBe("Walking");
  });

  it("drops a fully-streamed leading header/fence line", () => {
    expect(sanitizePartialLyricsOutput("[Verse 2]\nWalking into")).toBe(
      "Walking into",
    );
    expect(sanitizePartialLyricsOutput("```\nWalking into")).toBe(
      "Walking into",
    );
  });

  it("holds back a still-open header/fence line", () => {
    expect(sanitizePartialLyricsOutput("[Ver")).toBe("");
    expect(sanitizePartialLyricsOutput("```")).toBe("");
  });

  it("combines label and quote stripping once both resolve", () => {
    expect(sanitizePartialLyricsOutput('Completion: "away')).toBe("away");
  });

  it("holds back a label word even once it diverges mid-word, not just when it still matches exactly", () => {
    // "Lines", "Answers", "Optional" each start with a known label word
    // ("line", "answer", "option") but continue into a different, longer
    // word — a letter right after the label is never a real label.
    expect(sanitizePartialLyricsOutput("Lines of fire")).toBe("Lines of fire");
    expect(sanitizePartialLyricsOutput("Answers in the wind")).toBe(
      "Answers in the wind",
    );
    expect(sanitizePartialLyricsOutput("Optional love")).toBe("Optional love");
  });

  it("hides a trailing close quote the moment it streams in, matching the open quote it stripped", () => {
    // Once the model's closing quote has streamed in, showing it would
    // flash before sanitizeLyricsOutput removes the matched pair for
    // real once the full reply lands.
    expect(sanitizePartialLyricsOutput('"Walking into tomorrow"')).toBe(
      "Walking into tomorrow",
    );
    expect(sanitizePartialLyricsOutput("“Walking into tomorrow”")).toBe(
      "Walking into tomorrow",
    );
  });

  it("does not hide a trailing quote when no opening quote was stripped", () => {
    expect(sanitizePartialLyricsOutput('Walking into tomorrow"')).toBe(
      'Walking into tomorrow"',
    );
  });
});

// ── trimRepeatedTail (#79: don't repeat text after the cursor) ────────────

describe("trimRepeatedTail", () => {
  it("trims a trailing duplicate of the after-cursor text", () => {
    expect(
      trimRepeatedTail(" through the dark alone tonight", "alone tonight"),
    ).toBe(" through the dark");
  });

  it("is case-insensitive", () => {
    expect(trimRepeatedTail(" into the Night", "night")).toBe(" into the");
  });

  it("returns empty when the suggestion IS the after-cursor text", () => {
    expect(trimRepeatedTail(" alone tonight", "alone tonight")).toBe("");
  });

  it("leaves the suggestion untouched when there's no overlap", () => {
    expect(trimRepeatedTail("away into the dark", "tonight")).toBe(
      "away into the dark",
    );
  });

  it("leaves the suggestion untouched when there's no after-cursor text", () => {
    expect(trimRepeatedTail("away into the dark", "")).toBe(
      "away into the dark",
    );
    expect(trimRepeatedTail("away into the dark", "   ")).toBe(
      "away into the dark",
    );
  });

  it("leaves an empty suggestion untouched", () => {
    expect(trimRepeatedTail("", "alone tonight")).toBe("");
  });

  it("does not trim when the overlap splits a word in half", () => {
    // prefix "I want", after-text " me", reply " to come" — "come" and
    // "me" overlap on "me" but the split point ("co" | "me") is mid-word,
    // not a word boundary, so trimming would produce "I want to co me".
    expect(trimRepeatedTail(" to come", " me")).toBe(" to come");
  });

  it("trims when the overlap starts with a non-letter, even if the kept text ends in a letter", () => {
    // The kept text "wait" ends in a letter, but the overlap ", really"
    // starts with punctuation — that's still a real word boundary.
    expect(trimRepeatedTail("wait, really", ", really")).toBe("wait");
  });
});

import { describe, it, expect } from "vitest";
import {
  applyCopyGuard,
  isCommentaryLine,
  isCopyOfExistingLine,
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

// ── commentary/preamble lines (R6-fix: en-edge-empty / he-edge-empty /
// he-completion-long recorded raw outputs) ────────────────────────────────

describe("isCommentaryLine", () => {
  it("flags the recorded EN preambles", () => {
    expect(
      isCommentaryLine(
        "The lyrics are empty, so I'll offer one striking opening line.",
      ),
    ).toBe(true);
    expect(
      isCommentaryLine(
        "The lyrics are empty, so I'll write a striking opening line.",
      ),
    ).toBe(true);
  });

  it("flags the recorded HE preambles", () => {
    expect(
      isCommentaryLine(
        "שיר פתיחה על התחלה חדשה, ואין עדיין אף שורה. אז הנה שורת פתיחה:",
      ),
    ).toBe(true);
    expect(
      isCommentaryLine('רגע, נחשוב: זה "אותו" + סיום, כדי להשלים לשורה שלמה. '),
    ).toBe(true);
    expect(
      isCommentaryLine(
        'המילה "לאותו" נשארת לפני הסמן, אז ההשלמה צריכה להיות המשך ',
      ),
    ).toBe(true);
  });

  it("flags other common EN meta/preamble openers", () => {
    expect(isCommentaryLine("As an AI, I can't have feelings")).toBe(true);
    expect(isCommentaryLine("Note: this is just a suggestion")).toBe(true);
    expect(isCommentaryLine("Explanation: it rhymes with night")).toBe(true);
    expect(isCommentaryLine("This line sets up the chorus nicely")).toBe(true);
    expect(isCommentaryLine("Here's a line: walking into tomorrow")).toBe(true);
    expect(isCommentaryLine("Sure, here's a suggestion:")).toBe(true);
    expect(isCommentaryLine("Okay, here's the next line:")).toBe(true);
    expect(isCommentaryLine("Wait, that's not a rhyme with mark.")).toBe(true);
    expect(isCommentaryLine("Let me offer a line for you")).toBe(true);
    expect(isCommentaryLine("I think this suggestion rhymes better")).toBe(
      true,
    );
    expect(isCommentaryLine("I'll offer a quick suggestion:")).toBe(true);
  });

  it("flags other common HE meta/preamble openers", () => {
    expect(isCommentaryLine("הנה שורה: הולך לאיבוד בלילה")).toBe(true);
    expect(isCommentaryLine("בטח, הנה הצעה לשורה הבאה")).toBe(true);
    expect(isCommentaryLine("אוקיי, הנה ההשלמה:")).toBe(true);
    expect(isCommentaryLine("אני מציע שורה חדשה כאן")).toBe(true);
  });

  it("does NOT flag a table of real lyric lines that merely start with the same words", () => {
    const realLyrics = [
      // EN — each starts with an opener word that's ambiguous on its own,
      // but has no second signal (mention of line/lyric/suggestion/etc, or
      // a trailing colon), so it must read as ordinary lyrics.
      "Here comes the sun",
      "Wait for me",
      "Sure as the rain",
      "I think of you every night",
      "I'll write your name in the sand",
      "Let me love you",
      "Hmm hmm hmm",
      "Okay, I'm leaving",
      "Certainly not the way I planned it",
      "I'll carry you home tonight",
      // HE — same idea, Hebrew openers with no second signal.
      "הנה אני",
      "בטח שאני אוהב",
      "רגע לפני שהשמש שוקעת",
      "אוקיי אני הולך",
      "אני מציע לך את הלב שלי",
    ];
    for (const line of realLyrics) {
      expect(isCommentaryLine(line)).toBe(false);
    }
  });

  it("does not flag an ordinary line with no opener at all", () => {
    expect(isCommentaryLine("a brand new line of lyrics")).toBe(false);
    expect(isCommentaryLine("")).toBe(false);
    expect(isCommentaryLine("   ")).toBe(false);
  });
});

describe("sanitizeLyricsOutput (commentary preamble, R6-fix)", () => {
  it("skips the recorded EN preamble and keeps the real opening line", () => {
    expect(
      sanitizeLyricsOutput(
        "The lyrics are empty, so I'll offer one striking opening line.\n\nEvery morning I wake up counting the ways the light gets in",
        "next_line",
      ),
    ).toBe("Every morning I wake up counting the ways the light gets in");
    expect(
      sanitizeLyricsOutput(
        "The lyrics are empty, so I'll write a striking opening line.\n\nEvery morning the coffee cools before I've tasted it",
        "next_line",
      ),
    ).toBe("Every morning the coffee cools before I've tasted it");
  });

  it("skips the recorded HE preamble and keeps the real opening line", () => {
    expect(
      sanitizeLyricsOutput(
        "שיר פתיחה על התחלה חדשה, ואין עדיין אף שורה. אז הנה שורת פתיחה:\n\nהבוקר פותח דלת שלא ידענו שקיימת",
        "next_line",
      ),
    ).toBe("הבוקר פותח דלת שלא ידענו שקיימת");
  });

  it("returns empty (does not fabricate) when every line is commentary", () => {
    // Recorded he-completion-long t4: both lines are self-talk about the
    // task itself ("wait, let's think... to complete the whole line" /
    // "the word 'to-that' remains before the cursor..."), never actually
    // writing a completion. sanitizeLyricsOutput must not fall back to
    // returning that commentary text as if it were the suggestion — the
    // app already treats "" as "no suggestion" (idle, no ghost text, no
    // insertion — see LyricsAiOverlay.tsx), so "" is the safe choice here,
    // and checkFormat (scripts/lyrics-eval/checks.ts) then fails the trial
    // honestly as "empty output".
    expect(
      sanitizeLyricsOutput(
        'רגע, נחשוב: זה "אותו" + סיום, כדי להשלים לשורה שלמה. \n\nהמילה "לאותו" נשארת לפני הסמן, אז ההשלמה צריכה להיות המשך ',
        "completion",
      ),
    ).toBe("");
  });

  it("does not drop a real lyric line that happens to start with an ambiguous word", () => {
    expect(sanitizeLyricsOutput("Wait for me", "next_line")).toBe(
      "Wait for me",
    );
    expect(sanitizeLyricsOutput("הנה אני", "next_line")).toBe("הנה אני");
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

  it("stays on the first lyric line once it's done streaming, dropping a self-correction that follows (R6 review §7.3)", () => {
    const raw =
      "night I told you I'd leave, and didn't\n\n" +
      'Wait, that\'s not a rhyme with "mark." Corrected:\n\n' +
      "dark";
    for (let i = 1; i <= raw.length; i++) {
      const partial = sanitizePartialLyricsOutput(raw.slice(0, i));
      expect(partial).not.toContain("Wait");
      expect(partial).not.toContain("Corrected");
      // Once the first line's own newline has streamed in, the preview is
      // exactly that line — nothing from later in the reply leaks through.
      if (raw.slice(0, i).includes("\n")) {
        expect(partial).toBe("night I told you I'd leave, and didn't");
      }
    }
  });

  // ── commentary/preamble lines while streaming (R6-fix) ──────────────────

  it("drops a fully-streamed leading commentary line, moving on to the real line", () => {
    expect(
      sanitizePartialLyricsOutput(
        "The lyrics are empty, so I'll offer one striking opening line.\nEvery morning",
      ),
    ).toBe("Every morning");
    expect(
      sanitizePartialLyricsOutput(
        "שיר פתיחה על התחלה חדשה, ואין עדיין אף שורה. אז הנה שורת פתיחה:\nהבוקר פותח",
      ),
    ).toBe("הבוקר פותח");
  });

  it("holds back a still-streaming commentary line rather than flashing it", () => {
    // Resolves as soon as the defining substring streams in — "As an AI"
    // is never a real lyric opener, so holding back from the start is
    // safe.
    expect(sanitizePartialLyricsOutput("As an AI, I don't")).toBe("");
    // The ambiguous opener "The lyrics are" only resolves into commentary
    // once its second signal (the ", so" clause) has also streamed in.
    expect(sanitizePartialLyricsOutput("The lyrics are empty, so")).toBe("");
  });

  it("never permanently holds back a real lyric line that starts with an ambiguous opener", () => {
    // These never satisfy isCommentaryLine (no second signal ever
    // appears), so once the full line has streamed in it must be shown in
    // full — unlike a genuine label/numbering prefix (a pre-existing,
    // separate holdback — see looksLikeUnresolvedPrefix), nothing about
    // isCommentaryLine keeps these held back once all their text is in.
    for (const line of [
      "Wait for me",
      "Sure as the rain",
      "Okay, I'm leaving",
      "I'll write your name in the sand",
      "הנה אני",
      "בטח שאני אוהב",
    ]) {
      expect(sanitizePartialLyricsOutput(line)).toBe(line);
    }
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

// ── Client-side noCopy guard (R6 review §7.1) ───────────────────────────────

describe("isCopyOfExistingLine", () => {
  const lyrics = "[Chorus]\nWe rise again when the morning comes\n";

  it("flags a verbatim copy", () => {
    expect(
      isCopyOfExistingLine("We rise again when the morning comes", lyrics, {
        mode: "next_line",
      }),
    ).toBe(true);
  });

  it("flags a copy that only differs by niqqud", () => {
    const heLyrics = "אנחנו קמים כשהבוקר מגיע\n";
    // Every base letter followed by a patach (U+05B7) — same word, pointed.
    const pointed = "אַנַחַנַוַ קַמַיַםַ כַשַהַבַוַקַרַ מַגַיַעַ";
    expect(isCopyOfExistingLine(pointed, heLyrics, { mode: "next_line" })).toBe(
      true,
    );
  });

  it("flags a copy that only differs by punctuation and case", () => {
    expect(
      isCopyOfExistingLine("WE RISE AGAIN, WHEN THE MORNING COMES!", lyrics, {
        mode: "next_line",
      }),
    ).toBe(true);
  });

  it("passes a genuinely new line", () => {
    expect(
      isCopyOfExistingLine("A brand new thought I've never sung", lyrics, {
        mode: "next_line",
      }),
    ).toBe(false);
  });

  it("completion: compares the WHOLE resulting line, not the suffix alone", () => {
    const completionLyrics = "I walk alone through the empty street\n";
    // The suffix alone isn't itself an existing line, but prefix + suffix
    // together reconstructs one.
    expect(
      isCopyOfExistingLine("through the empty street", completionLyrics, {
        mode: "completion",
        linePrefix: "I walk alone ",
      }),
    ).toBe(true);
    // A suffix that doesn't reconstruct an existing line isn't a copy.
    expect(
      isCopyOfExistingLine("through the quiet night", completionLyrics, {
        mode: "completion",
        linePrefix: "I walk alone ",
      }),
    ).toBe(false);
  });

  it("the chorus-mirror allow exemption lets the explicitly-mirrored line through", () => {
    const mirrorLyrics =
      "[Chorus]\nWe rise again\nWhen the night is long\n[Chorus]\nWe rise again\n";
    expect(
      isCopyOfExistingLine("When the night is long", mirrorLyrics, {
        mode: "next_line",
        allow: "When the night is long",
      }),
    ).toBe(false);
    // Without the exemption, the same line is a copy.
    expect(
      isCopyOfExistingLine("When the night is long", mirrorLyrics, {
        mode: "next_line",
      }),
    ).toBe(true);
  });
});

describe("applyCopyGuard", () => {
  const lyrics = "[Chorus]\nWe rise again when the morning comes\n";

  it("returns the sanitized suggestion when it isn't a copy", () => {
    expect(
      applyCopyGuard("A brand new thought I've never sung", "next_line", {
        lyrics,
      }),
    ).toBe("A brand new thought I've never sung");
  });

  it("drops a verbatim copy when there's nothing left in the raw reply to rescue from", () => {
    expect(
      applyCopyGuard("We rise again when the morning comes", "next_line", {
        lyrics,
      }),
    ).toBe("");
  });

  it("rescues from the next line in the raw reply when the first line is a copy", () => {
    const raw =
      "We rise again when the morning comes\nWe rise and we carry the fire";
    expect(applyCopyGuard(raw, "next_line", { lyrics })).toBe(
      "We rise and we carry the fire",
    );
  });

  it("drops when the rescued line is also a copy", () => {
    const raw =
      "We rise again when the morning comes\nWe rise again when the morning comes";
    expect(applyCopyGuard(raw, "next_line", { lyrics })).toBe("");
  });

  it("the chorus-mirror allow exemption passes the mirrored line through without a rescue", () => {
    expect(
      applyCopyGuard("We rise again when the morning comes", "next_line", {
        lyrics,
        allow: "We rise again when the morning comes",
      }),
    ).toBe("We rise again when the morning comes");
  });

  it("completion: rescue re-sanitizes the remainder and re-checks the whole joined line", () => {
    const completionLyrics = "I walk alone through the empty street\n";
    const raw = "through the empty street\nthrough the quiet night";
    expect(
      applyCopyGuard(raw, "completion", {
        lyrics: completionLyrics,
        linePrefix: "I walk alone ",
      }),
    ).toBe("through the quiet night");
  });
});

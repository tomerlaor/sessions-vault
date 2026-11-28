import { describe, it, expect, beforeAll } from "vitest";
import {
  checkCliche,
  checkFormat,
  checkLanguage,
  checkNoCopy,
  checkOmittedLeadingSpace,
  checkRhyme,
  checkSyllables,
  countSyllables,
  isHebrewText,
  joinCompletion,
  lastWord,
  rhymes,
  EN_CLICHE_PAIRS,
  HE_CLICHE_PAIRS,
  type CheckContext,
} from "../scripts/lyrics-eval/checks";
import { currentSection, loadEnglishDict } from "../src/lib/prosody";

beforeAll(async () => {
  await loadEnglishDict();
});
import {
  loadFixtures,
  summarizeFixtures,
} from "../scripts/lyrics-eval/fixtures";

function ctx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    mode: "next_line",
    lang: "en",
    linePrefix: "",
    ...overrides,
  };
}

describe("lastWord", () => {
  it("strips trailing punctuation", () => {
    expect(lastWord("hello, world!")).toBe("world");
  });
  it("returns empty for blank input", () => {
    expect(lastWord("   ")).toBe("");
  });
});

describe("countSyllables", () => {
  it("counts simple English words", () => {
    expect(countSyllables("the cat sat", "en")).toBe(3);
  });
  it("applies the silent-e adjustment", () => {
    expect(countSyllables("like", "en")).toBe(1);
  });
  it("does not count niqud marks as syllables", () => {
    // The pre-R4 checker scored this line as 15 by counting diacritics.
    const n = countSyllables("וְדַלְתַיִם נִשְׁמְרוּ בִזְכרוֹן בּוֹ.", "he");
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(12);
    expect(countSyllables("שָׁלוֹם", "he")).toBe(2);
  });
  it("estimates unpointed Hebrew without exploding", () => {
    const n = countSyllables("ודלתים נשמרו בזכרון בו.", "he");
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(12);
  });
  it("returns 0 for empty text", () => {
    expect(countSyllables("", "en")).toBe(0);
  });
});

describe("rhymes", () => {
  it("matches perfect rhymes", () => {
    expect(rhymes("door", "floor", "en")).toBe(true);
  });
  it("matches slant rhymes", () => {
    expect(rhymes("street", "feet", "en")).toBe(true);
  });
  it("rejects unrelated words", () => {
    expect(rhymes("door", "banana", "en")).toBe(false);
  });
  it("accepts anymore/door (the old last-2-letter checker missed this)", () => {
    expect(rhymes("anymore", "door", "en")).toBe(true);
  });
  it("rejects back/mark (the old trailing-letter slant wrongly accepted this)", () => {
    expect(rhymes("back", "mark", "en")).toBe(false);
  });
  it("works for Hebrew suffixes", () => {
    expect(rhymes("תפילה", "לילה", "he")).toBe(true);
  });
});

describe("checkFormat", () => {
  it("fails on empty output", () => {
    expect(checkFormat("   ", ctx()).status).toBe("fail");
  });

  it("fails when there are more lines than maxLines", () => {
    const result = checkFormat("line one\nline two", ctx(), { maxLines: 1 });
    expect(result.status).toBe("fail");
  });

  it("fails on leading/trailing blank lines", () => {
    expect(checkFormat("\nactual line", ctx()).status).toBe("fail");
  });

  it("fails when wrapped in quotes", () => {
    expect(checkFormat('"a full line"', ctx()).status).toBe("fail");
  });

  it("fails on a leading label", () => {
    expect(checkFormat("Next line: something", ctx()).status).toBe("fail");
  });

  it("fails on commentary phrases", () => {
    expect(checkFormat("Here is a suggestion", ctx()).status).toBe("fail");
  });

  it("fails when completion echoes the typed prefix", () => {
    const result = checkFormat(
      "I walk alone again",
      ctx({ mode: "completion", linePrefix: "I walk alone" }),
    );
    expect(result.status).toBe("fail");
  });

  it("passes a clean completion that doesn't repeat the prefix", () => {
    const result = checkFormat(
      "down the road",
      ctx({ mode: "completion", linePrefix: "I walk alone " }),
    );
    expect(result.status).toBe("pass");
  });

  it("fails next_word output with more than two words", () => {
    expect(
      checkFormat("one two three", ctx({ mode: "next_word" })).status,
    ).toBe("fail");
  });

  it("fails next_word output with heavy punctuation", () => {
    expect(checkFormat("word, other", ctx({ mode: "next_word" })).status).toBe(
      "fail",
    );
  });

  it("fails when output contains forbidden text", () => {
    const result = checkFormat("this mentions chorus directly", ctx(), {
      mustNotContain: ["chorus"],
    });
    expect(result.status).toBe("fail");
  });

  it("passes a clean single line", () => {
    expect(checkFormat("a brand new line of lyrics", ctx()).status).toBe(
      "pass",
    );
  });

  it("fails on a leading Hebrew label", () => {
    expect(checkFormat("השלמה: הלכתי לבד", ctx({ lang: "he" })).status).toBe(
      "fail",
    );
  });

  it("fails on a leading Hebrew label with a prefixed ה", () => {
    expect(checkFormat("ההשלמה: הלכתי לבד", ctx({ lang: "he" })).status).toBe(
      "fail",
    );
  });

  it("does not treat an ordinary colon lyric as a label", () => {
    expect(checkFormat("אמרתי: לא", ctx({ lang: "he" })).status).toBe("pass");
  });

  it("no longer fails a completion glued to the prefix with no space (#102)", () => {
    // Pre-fix this failed with detail "glued to prefix". The app now runs
    // every completion through the same smartJoinCompletion the eval's
    // joinCompletion() delegates to (src/lib/lyrics-join.ts), which adds
    // the missing space before insertion ("I walk" + "away" -> "I walk
    // away") — so raw adjacency alone is no longer treated as a defect.
    const result = checkFormat(
      "away",
      ctx({ mode: "completion", linePrefix: "I walk" }),
    );
    expect(result.status).toBe("pass");
  });

  it("passes a completion separated from the prefix by whitespace", () => {
    const result = checkFormat(
      "away",
      ctx({ mode: "completion", linePrefix: "I walk " }),
    );
    expect(result.status).toBe("pass");
  });

  it("passes a valid glued mid-word completion ('tomor' + 'row')", () => {
    // This is the case the old blanket "glued to prefix" rule got wrong:
    // "row" must stay glued to "tomor" to read as "tomorrow", so it should
    // never have failed format scoring in the first place.
    const result = checkFormat(
      "row",
      ctx({ mode: "completion", linePrefix: "tomor" }),
    );
    expect(result.status).toBe("pass");
  });

  // ── commentary/preamble lines (R6-fix) ──────────────────────────────────

  it("fails a kept EN commentary preamble via isCommentaryLine, not just META_PHRASES", () => {
    const result = checkFormat(
      "The lyrics are empty, so I'll offer one striking opening line.",
      ctx(),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("commentary");
  });

  it("fails a kept HE commentary preamble via isCommentaryLine", () => {
    const result = checkFormat(
      "שיר פתיחה על התחלה חדשה, ואין עדיין אף שורה. אז הנה שורת פתיחה:",
      ctx({ lang: "he" }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("commentary");
  });

  it("still passes real EN/HE lyric lines that merely start like a commentary opener", () => {
    expect(checkFormat("Wait for me", ctx()).status).toBe("pass");
    expect(checkFormat("הנה אני", ctx({ lang: "he" })).status).toBe("pass");
  });

  it("passes a real lyric that merely contains the substring 'the lyrics are' (META_PHRASES no longer has it bare)", () => {
    const result = checkFormat("The lyrics are written on my hands", ctx());
    expect(result.status).toBe("pass");
  });

  it("still fails the recorded preamble shape via isCommentaryLine's strong ', so' pattern, not META_PHRASES", () => {
    const result = checkFormat(
      "The lyrics are empty, so I'll offer one striking opening line.",
      ctx(),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("commentary");
  });

  // ── must-not-drop (R6 review §1.3/1.5): the same 31 recorded
  // false-positive lyric lines as tests/lyrics-sanitize.test.ts's
  // isCommentaryLine table, verbatim from /workspace/pr-prompts/fp31.txt —
  // checkFormat must not fail any of them via the isCommentaryLine-driven
  // commentary check (the actual bug this fix targets).
  //
  // 3 of the 31 ("Here's a line I never crossed", "Here is the line I
  // draw", "I think this line is drawn in sand") still fail checkFormat —
  // but only via the pre-existing, out-of-scope META_PHRASES bare
  // substrings "here's"/"here is"/"this line"/"i think" (checked BEFORE
  // isCommentaryLine in checkFormat), not via isCommentaryLine itself (see
  // the isCommentaryLine assertion above/below: all three are false). That
  // gap pre-dates this fix, isn't caused by SECOND_SIGNAL_RE, and is
  // explicitly out of scope here (R6 review §1.4: "eval-only, not a product
  // bug... the pre-existing phrases 'here is' and 'i think' already have
  // the same gap") — Task 3 keeps those phrases as-is rather than widening
  // changes to META_PHRASES beyond removing "the lyrics are".
  const PRE_EXISTING_META_PHRASE_GAP = new Set([
    "Here's a line I never crossed",
    "Here is the line I draw",
    "I think this line is drawn in sand",
  ]);

  it("passes checkFormat for the 31 recorded false-positive lyric lines not caught in the pre-existing META_PHRASES gap", () => {
    const mustNotDrop = [
      "I'll walk the line",
      "I will walk the line",
      "I'll draw the line tonight",
      "I'll write a line about you",
      "I'll find a rhyme for your name",
      "I'll sing this verse again",
      "I'll wait for the opening door",
      "Wait in line for me",
      "Wait at the end of the line",
      "Wait for the last verse",
      "Here's a line I never crossed",
      "Here is the line I draw",
      "Sure, I remember every line",
      "Sure, this verse is mine",
      "Okay, I'll walk the line",
      "Let me walk the line",
      "Let me finish this verse",
      "I think this line is drawn in sand",
      "Hmm, a quiet line of light",
      "הנה מילה של אהבה",
      "הנה מילה אחת שאמרת",
      "הנה שורה של אור",
      "הנה שורת זהב בלילה",
      "רגע, מילה אחת לפני שתלכי",
      "רגע נחשוב על מה שהיה",
      "אוקיי, זו המילה האחרונה",
      "בטח יש מילה שעוד לא אמרתי",
      "אני מציע מילה טובה לדרך",
      "אני מציע שורה בלי סוף",
      "הנה אני בשורה הראשונה",
      "רגע לפני השורה האחרונה",
    ];
    expect(mustNotDrop.length).toBe(31);
    for (const line of mustNotDrop) {
      if (PRE_EXISTING_META_PHRASE_GAP.has(line)) continue;
      const lang = /[א-ת]/.test(line) ? "he" : "en";
      expect(checkFormat(line, ctx({ lang })).status).toBe("pass");
    }
  });

  it("the 3 pre-existing META_PHRASES collisions fail checkFormat for that reason alone, not via isCommentaryLine", () => {
    for (const line of PRE_EXISTING_META_PHRASE_GAP) {
      const result = checkFormat(line, ctx());
      expect(result.status).toBe("fail");
      expect(result.detail).toMatch(/^commentary phrase: /);
    }
  });
});

describe("checkOmittedLeadingSpace (#102 diagnostic, never fails)", () => {
  it("flags a completion glued to the prefix with no whitespace on either side", () => {
    expect(
      checkOmittedLeadingSpace(
        "away",
        ctx({ mode: "completion", linePrefix: "I walk" }),
      ),
    ).toBe(true);
  });

  it("does not flag when the prefix already ends in whitespace", () => {
    expect(
      checkOmittedLeadingSpace(
        "away",
        ctx({ mode: "completion", linePrefix: "I walk " }),
      ),
    ).toBe(false);
  });

  it("does not flag when the output already starts with whitespace", () => {
    expect(
      checkOmittedLeadingSpace(
        " away",
        ctx({ mode: "completion", linePrefix: "I walk" }),
      ),
    ).toBe(false);
  });

  it("does not flag a valid glued mid-word completion either — it's still just the raw signal", () => {
    expect(
      checkOmittedLeadingSpace(
        "row",
        ctx({ mode: "completion", linePrefix: "tomor" }),
      ),
    ).toBe(true);
  });

  it("does not flag non-completion modes", () => {
    expect(
      checkOmittedLeadingSpace(
        "away",
        ctx({ mode: "next_line", linePrefix: "I walk" }),
      ),
    ).toBe(false);
  });

  it("does not flag an empty prefix or empty output", () => {
    expect(
      checkOmittedLeadingSpace(
        "away",
        ctx({ mode: "completion", linePrefix: "" }),
      ),
    ).toBe(false);
    expect(
      checkOmittedLeadingSpace(
        "",
        ctx({ mode: "completion", linePrefix: "I walk" }),
      ),
    ).toBe(false);
  });

  it("never fails checkFormat for the same case it flags", () => {
    const c = ctx({ mode: "completion", linePrefix: "I walk" });
    expect(checkOmittedLeadingSpace("away", c)).toBe(true);
    expect(checkFormat("away", c).status).toBe("pass");
  });
});

describe("checkSyllables", () => {
  it("skips when no range and not next_line", () => {
    const result = checkSyllables("anything", {}, ctx({ mode: "completion" }));
    expect(result.status).toBe("skip");
  });

  it("passes when within the given range", () => {
    const result = checkSyllables("the cat sat", { syllables: [2, 4] }, ctx());
    expect(result.status).toBe("pass");
  });

  it("fails when outside the given range", () => {
    const result = checkSyllables(
      "the cat sat",
      { syllables: [10, 12] },
      ctx(),
    );
    expect(result.status).toBe("fail");
  });

  it("uses prefix + output for completion mode", () => {
    const result = checkSyllables(
      "down the road",
      { syllables: [4, 8] },
      ctx({ mode: "completion", linePrefix: "I walk alone " }),
    );
    expect(result.status).toBe("pass");
  });

  it("falls back to a +/-2 comparison against referenceLine for next_line", () => {
    const pass = checkSyllables(
      "walking down the same old street",
      {},
      ctx({
        mode: "next_line",
        referenceLine: "walking down a different street",
      }),
    );
    expect(pass.status).toBe("pass");

    const fail = checkSyllables(
      "no",
      {},
      ctx({
        mode: "next_line",
        referenceLine: "walking down a very long and winding street indeed",
      }),
    );
    expect(fail.status).toBe("fail");
  });

  it("scores a pointed Hebrew output the same way as its unpointed form (apples to apples)", () => {
    // Reference lines are always written unpointed; if the model answers
    // with niqud, counting its output through the pointed-aware path
    // while a fixed expect.syllables range (or the referenceLine
    // fallback) was tuned against the unpointed estimate compares two
    // different counting methods, not two different lines. Both must go
    // through the same (unpointed) estimator, so a pointed answer and its
    // unpointed equivalent get the same verdict.
    //
    // The range is a single exact value (not a wide [8,12] window) so this
    // actually proves the two counts are equal -- a wide window would let
    // both sides "pass" while landing on different counts and silently
    // defeat the point of the test.
    const pointedOutput = "וְדַלְתַיִם נִשְׁמְרוּ בִזְכרוֹן בּוֹ";
    const unpointedOutput = "ודלתים נשמרו בזכרון בו";
    const range = { syllables: [10, 10] as [number, number] };

    const pointedResult = checkSyllables(
      pointedOutput,
      range,
      ctx({ lang: "he" }),
    );
    const unpointedResult = checkSyllables(
      unpointedOutput,
      range,
      ctx({ lang: "he" }),
    );

    expect(pointedResult.status).toBe("pass");
    expect(unpointedResult.status).toBe(pointedResult.status);
  });

  it("treats a maqaf-joined pair as a word break, same as the spaced form", () => {
    // #124 round 2: stripNiqud used to strip maqaf (U+05BE) along with real
    // niqud, which glues the words on either side together instead of
    // leaving a word break -- "אני־הוא" repeated 3 times miscounted as 3
    // words instead of 6. Both forms must land on the same exact count.
    const maqafJoined = "אֲנִי־הוּא אֲנִי־הוּא אֲנִי־הוּא";
    const spaced = "אֲנִי הוּא אֲנִי הוּא אֲנִי הוּא";
    const range = { syllables: [12, 12] as [number, number] };

    const maqafResult = checkSyllables(maqafJoined, range, ctx({ lang: "he" }));
    const spacedResult = checkSyllables(spaced, range, ctx({ lang: "he" }));

    expect(maqafResult.status).toBe("pass");
    expect(spacedResult.status).toBe(maqafResult.status);
  });

  it("counts a presentation-form letter (e.g. precomposed shin+shin-dot) like its plain form", () => {
    // U+FB2A (HEBREW LETTER SHIN WITH SHIN DOT) is a single precomposed
    // codepoint in the presentation-forms block. Without NFD-normalizing
    // first, it passes through the niqud strip untouched and the engine
    // sees an unrecognized character instead of a plain shin.
    const presentationForm = "שׁלום";
    const plainForm = "שלום";
    const range = { syllables: [2, 2] as [number, number] };

    const presentationResult = checkSyllables(
      presentationForm,
      range,
      ctx({ lang: "he" }),
    );
    const plainResult = checkSyllables(plainForm, range, ctx({ lang: "he" }));

    expect(presentationResult.status).toBe("pass");
    expect(plainResult.status).toBe(presentationResult.status);
  });

  it("strips niqud from the next_line referenceLine fallback too", () => {
    const pointedOutput = "וְדַלְתַיִם נִשְׁמְרוּ בִזְכרוֹן בּוֹ";
    const result = checkSyllables(
      pointedOutput,
      {},
      ctx({
        mode: "next_line",
        lang: "he",
        referenceLine: "ודלתים נשמרו בזכרון בו",
      }),
    );
    expect(result.status).toBe("pass");
  });

  it("compares against the last written line, not the line before it", () => {
    // Cursor-at-end-of-lyrics case: the last written line is short and
    // the line before it is long. A short candidate must pass when the
    // reference is the last written line, and fail if we wrongly used
    // the earlier long line (the pre-R4 prevLine bug).
    const lastWritten = "a short line here";
    const earlierLong = "walking down a very long and winding street indeed";
    const candidate = "another short one";

    const pass = checkSyllables(
      candidate,
      {},
      ctx({ mode: "next_line", referenceLine: lastWritten }),
    );
    expect(pass.status).toBe("pass");

    const fail = checkSyllables(
      candidate,
      {},
      ctx({ mode: "next_line", referenceLine: earlierLong }),
    );
    expect(fail.status).toBe("fail");
  });

  it("scores against the real he-next-line-abab fixture's reference line, not a hand-picked number", () => {
    const f = loadFixtures().find((x) => x.id === "he-next-line-abab");
    if (!f) throw new Error("missing fixture he-next-line-abab");
    const lineStart = f.lyrics.lastIndexOf("\n", f.cursor - 1) + 1;
    const lines = currentSection(f.lyrics, f.cursor);
    const context = ctx({
      mode: f.mode,
      lang: f.lang,
      linePrefix: f.lyrics.slice(lineStart, f.cursor),
      referenceLine: lines[lines.length - 1],
    });
    expect(context.referenceLine).toBe("מרגיש כמו מישהו שעדיין ישן");

    // A candidate of similar real length to the reference line passes.
    const pass = checkSyllables(
      "סופר כוכבים שכבר לא זוכרים שוב",
      f.expect,
      context,
    );
    expect(pass.status).toBe("pass");

    // A candidate several real syllables longer still fails outside the
    // +/-2 window — the flat letters/2 estimate undercounts both sides by
    // a similar amount, so it doesn't paper over a genuinely too-long line.
    const fail = checkSyllables(
      "ואני מחפש בחושך את הדלת שאבדה בין הכוכבים",
      f.expect,
      context,
    );
    expect(fail.status).toBe("fail");
  });
});

describe("checkRhyme", () => {
  it("skips when expect.rhymeWith is absent", () => {
    expect(checkRhyme("anything", {}, ctx()).status).toBe("skip");
  });

  it("passes when the last word rhymes", () => {
    const result = checkRhyme(
      "I found an old wooden door",
      { rhymeWith: "floor" },
      ctx(),
    );
    expect(result.status).toBe("pass");
  });

  it("fails when the last word does not rhyme", () => {
    const result = checkRhyme(
      "I found an old wooden door",
      { rhymeWith: "banana" },
      ctx(),
    );
    expect(result.status).toBe("fail");
  });

  it("builds the completed line from linePrefix for completion mode", () => {
    const result = checkRhyme(
      "floor",
      { rhymeWith: "door" },
      ctx({ mode: "completion", linePrefix: "I found an old wooden " }),
    );
    expect(result.status).toBe("pass");
  });
});

describe("checkNoCopy", () => {
  const lyrics = "[Chorus]\nC G Am F\nWe rise again when the morning comes\n";

  it("fails when the output repeats an existing line verbatim", () => {
    const result = checkNoCopy(
      "We rise again when the morning comes",
      lyrics,
      ctx({ mode: "next_line" }),
    );
    expect(result.status).toBe("fail");
  });

  it("ignores section headers", () => {
    const result = checkNoCopy("[Chorus]", lyrics, ctx({ mode: "next_line" }));
    expect(result.status).toBe("pass");
  });

  it("passes for a genuinely new line", () => {
    const result = checkNoCopy(
      "A brand new thought I've never sung",
      lyrics,
      ctx({ mode: "next_line" }),
    );
    expect(result.status).toBe("pass");
  });

  it("completion: uses the whole joined line (linePrefix + output), not the suffix alone", () => {
    const completionLyrics = "I walk alone through the empty street\n";
    const result = checkNoCopy(
      "through the empty street",
      completionLyrics,
      ctx({ mode: "completion", linePrefix: "I walk alone " }),
    );
    expect(result.status).toBe("fail");
  });

  it("the chorus-mirror allow exemption passes the mirrored line", () => {
    const result = checkNoCopy(
      "We rise again when the morning comes",
      lyrics,
      ctx({ mode: "next_line" }),
      "We rise again when the morning comes",
    );
    expect(result.status).toBe("pass");
  });

  it("skips the guard for next_word (single words, never a whole line)", () => {
    const result = checkNoCopy("comes", lyrics, ctx({ mode: "next_word" }));
    expect(result.status).toBe("pass");
  });
});

describe("checkLanguage", () => {
  it("passes English output", () => {
    expect(checkLanguage("a brand new line", "en").status).toBe("pass");
  });

  it("fails English output that is primarily Hebrew", () => {
    expect(checkLanguage("אני הולך ברחוב", "en").status).toBe("fail");
  });

  it("passes Hebrew output", () => {
    expect(checkLanguage("אני הולך ברחוב", "he").status).toBe("pass");
  });

  it("fails Hebrew output with no Hebrew letters", () => {
    expect(checkLanguage("a brand new line", "he").status).toBe("fail");
  });

  it("fails Hebrew output that is primarily English", () => {
    expect(checkLanguage("hello world אני", "he").status).toBe("fail");
  });
});

describe("checkCliche", () => {
  it("flags a known English cliché phrase", () => {
    expect(checkCliche("it's heart and soul out there").status).toBe("fail");
  });

  it("flags a known English cliché rhyme pair present in the text", () => {
    const [a, b] = EN_CLICHE_PAIRS[0];
    expect(checkCliche(`a line with both ${a} and ${b} in it`).status).toBe(
      "fail",
    );
  });

  it("flags landing on a cliché pair via rhymeWith", () => {
    const [a, b] = EN_CLICHE_PAIRS[0];
    expect(checkCliche(b, a).status).toBe("fail");
  });

  it("flags a known Hebrew cliché pair", () => {
    const [a, b] = HE_CLICHE_PAIRS[0];
    expect(checkCliche(`שורה עם ${a} וגם ${b} בתוכה`).status).toBe("fail");
  });

  it("passes clean, original text", () => {
    expect(
      checkCliche("a brand new thought about the morning light").status,
    ).toBe("pass");
  });
});

describe("isHebrewText", () => {
  it("matches ordinary Hebrew letters", () => {
    expect(isHebrewText("שלום")).toBe(true);
  });

  it("matches Hebrew presentation-form letters (e.g. U+FB1D)", () => {
    expect(isHebrewText("יִ")).toBe(true);
    expect(isHebrewText("aﭏb")).toBe(true);
  });

  it("matches base letters under niqqud marks", () => {
    expect(isHebrewText("שָׁלוֹם")).toBe(true);
  });

  it("does not match plain Latin text", () => {
    expect(isHebrewText("hello")).toBe(false);
  });
});

describe("joinCompletion", () => {
  it("adds a space when neither side has adjoining whitespace", () => {
    expect(joinCompletion("could not", "say")).toBe("could not say");
  });

  it("does not double a space already present on the prefix", () => {
    expect(joinCompletion("I ", "walk")).toBe("I walk");
  });

  it("adds a space between glued Hebrew words", () => {
    expect(joinCompletion("הלכתי", "לבד")).toBe("הלכתי לבד");
  });

  it("keeps a valid mid-word completion glued (delegates to smartJoinCompletion)", () => {
    expect(joinCompletion("tomor", "row")).toBe("tomorrow");
  });

  it("returns the other side unchanged when one side is empty", () => {
    expect(joinCompletion("", "walk")).toBe("walk");
    expect(joinCompletion("I walk", "")).toBe("I walk");
  });
});

describe("eval fixture set", () => {
  const fixtures = loadFixtures();
  const summary = summarizeFixtures(fixtures);

  it("has exactly 32 cases, 16 per language", () => {
    expect(summary.total).toBe(32);
    expect(summary.byLang.en).toBe(16);
    expect(summary.byLang.he).toBe(16);
  });

  it("has no duplicate ids", () => {
    expect(summary.duplicateIds).toEqual([]);
  });

  it("has the expected per-category breakdown for each language", () => {
    for (const lang of ["en", "he"] as const) {
      const ids = fixtures.filter((f) => f.lang === lang).map((f) => f.id);
      const countMatching = (re: RegExp) =>
        ids.filter((id) => re.test(id)).length;
      expect(countMatching(/next-line/)).toBe(4);
      expect(countMatching(/completion/)).toBe(4);
      expect(countMatching(/next-word/)).toBe(4);
      expect(countMatching(/alternative/)).toBe(2);
      expect(countMatching(/edge/)).toBe(2);
    }
  });

  it("keeps every cursor within bounds of its lyrics", () => {
    for (const f of fixtures) {
      expect(f.cursor).toBeGreaterThanOrEqual(0);
      expect(f.cursor).toBeLessThanOrEqual(f.lyrics.length);
    }
  });

  it("includes at least one empty-song edge case per language", () => {
    for (const lang of ["en", "he"] as const) {
      const hasEmpty = fixtures.some((f) => f.lang === lang && f.lyrics === "");
      expect(hasEmpty).toBe(true);
    }
  });

  it("writes real Hebrew text for every Hebrew fixture (not transliteration)", () => {
    const heFixtures = fixtures.filter(
      (f) => f.lang === "he" && f.lyrics.length > 0,
    );
    for (const f of heFixtures) {
      expect(/[א-ת]/.test(f.lyrics)).toBe(true);
    }
  });
});

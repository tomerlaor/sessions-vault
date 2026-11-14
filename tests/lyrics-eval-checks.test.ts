import { describe, it, expect, beforeAll } from "vitest";
import {
  checkCliche,
  checkFormat,
  checkLanguage,
  checkNoCopy,
  checkRhyme,
  checkSyllables,
  countSyllables,
  lastWord,
  rhymes,
  EN_CLICHE_PAIRS,
  HE_CLICHE_PAIRS,
  type CheckContext,
} from "../scripts/lyrics-eval/checks";
import { loadEnglishDict } from "../src/lib/prosody";

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
      ctx({ mode: "completion", linePrefix: "I walk alone" }),
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
    const result = checkNoCopy("We rise again when the morning comes", lyrics);
    expect(result.status).toBe("fail");
  });

  it("ignores section headers and chord-only lines", () => {
    const result = checkNoCopy("[Chorus]", lyrics);
    expect(result.status).toBe("pass");
  });

  it("passes for a genuinely new line", () => {
    const result = checkNoCopy("A brand new thought I've never sung", lyrics);
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

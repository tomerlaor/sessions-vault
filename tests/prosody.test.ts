import { describe, it, expect, beforeAll } from "vitest";
import {
  countSyllables,
  rhymeKey,
  rhymes,
  cleanLine,
  currentSection,
  detectScheme,
  nextLineTargets,
  loadEnglishDict,
} from "../src/lib/prosody";
import { loadFixtures } from "../scripts/lyrics-eval/fixtures";
import type { EvalFixture } from "../scripts/lyrics-eval/types";

beforeAll(async () => {
  await loadEnglishDict();
});

const fixtures = loadFixtures();
function fixture(id: string): EvalFixture {
  const f = fixtures.find((x) => x.id === id);
  if (!f) throw new Error(`missing fixture ${id}`);
  return f;
}

describe("countSyllables (en)", () => {
  it("does not inflate words with silent endings", () => {
    expect(countSyllables("smelled", "en")).toBe(1);
    expect(countSyllables("someone's", "en")).toBe(2);
    expect(countSyllables("days", "en")).toBe(1);
  });

  it("gets common lyric words right (dict-backed)", () => {
    expect(countSyllables("fire", "en")).toBe(1);
    expect(countSyllables("desire", "en")).toBe(2);
    expect(countSyllables("everything", "en")).toBe(3);
    expect(countSyllables("family", "en")).toBe(3);
    expect(countSyllables("beautiful", "en")).toBe(3);
    expect(countSyllables("comfortable", "en")).toBe(4);
  });

  it("sums across a whole line", () => {
    expect(countSyllables("the cat sat", "en")).toBe(3);
  });

  it("returns 0 for empty text", () => {
    expect(countSyllables("", "en")).toBe(0);
  });

  it("falls back to a heuristic for out-of-dictionary words", () => {
    expect(countSyllables("zxqvplanator", "en")).toBeGreaterThan(0);
  });
});

describe("countSyllables (he)", () => {
  it("does not count niqud dots as syllables (the live-eval bug)", () => {
    // Old buggy behaviour counted every diacritic, scoring this line as 15.
    const n = countSyllables("וְדַלְתַיִם נִשְׁמְרוּ בִזְכרוֹן בּוֹ.", "he");
    expect(n).toBeLessThan(15);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(12);
  });

  it("estimates the unpointed form near the pointed count, not 15", () => {
    const n = countSyllables("ודלתים נשמרו בזכרון בו.", "he");
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(12);
  });

  it("counts a short pointed word around 2, not 3-4 from counting dots", () => {
    expect(countSyllables("שָׁלוֹם", "he")).toBe(2);
  });

  it("returns 0 for empty text", () => {
    expect(countSyllables("", "he")).toBe(0);
  });
});

describe("rhymeKey (en)", () => {
  it("is equal for words that perfectly rhyme", () => {
    expect(rhymeKey("door", "en")).toBe(rhymeKey("floor", "en"));
  });

  it("differs for words that don't rhyme", () => {
    expect(rhymeKey("back", "en")).not.toBe(rhymeKey("mark", "en"));
  });
});

describe("rhymes (en)", () => {
  it("fixes the false negative: anymore/door, floor/door", () => {
    expect(rhymes("anymore", "door", "en")).toBe("perfect");
    expect(rhymes("floor", "door", "en")).toBe("perfect");
  });

  it("accepts street/feet as perfect or slant", () => {
    expect(["perfect", "slant"]).toContain(rhymes("street", "feet", "en"));
  });

  it("fixes the false positive: back/mark is not a rhyme", () => {
    expect(rhymes("back", "mark", "en")).toBe("none");
  });

  it("treats the same word as a perfect rhyme", () => {
    expect(rhymes("door", "door", "en")).toBe("perfect");
  });

  it("rejects unrelated words", () => {
    expect(rhymes("door", "banana", "en")).toBe("none");
  });
});

describe("rhymes (he)", () => {
  it("rhymes words sharing a meaningful ending", () => {
    expect(rhymes("תפילה", "לילה", "he")).toBe("perfect");
  });

  it("rejects unrelated words", () => {
    expect(rhymes("שלום", "מכונית", "he")).toBe("none");
  });
});

describe("cleanLine", () => {
  it("strips a bare [Section] header to empty", () => {
    expect(cleanLine("[Verse]")).toBe("");
    expect(cleanLine("[בית 1]")).toBe("");
  });

  it("strips a bare chord-grid line to empty", () => {
    expect(cleanLine("C G Am F")).toBe("");
    expect(cleanLine("Dm7 G7 Cmaj7")).toBe("");
  });

  it("strips inline chord tokens but keeps the lyric text", () => {
    expect(cleanLine("I [C]walked down the [G]street")).toBe(
      "I walked down the street",
    );
  });

  it("drops parenthetical remarks", () => {
    expect(cleanLine("I walked (softly) down the street")).toBe(
      "I walked down the street",
    );
  });

  it("passes a plain lyric line through unchanged (trimmed)", () => {
    expect(cleanLine("  a real lyric line  ")).toBe("a real lyric line");
  });
});

describe("currentSection", () => {
  it("stays within the chorus and ignores the earlier repeated chorus", () => {
    const f = fixture("en-edge-chords-chorus");
    const lines = currentSection(f.lyrics, f.cursor);
    expect(lines).toEqual([
      "We rise again when the morning comes",
      "We rise again when the morning comes",
    ]);
  });

  it("ignores chords and headers for a Hebrew section", () => {
    const f = fixture("he-edge-chords-chorus");
    const lines = currentSection(f.lyrics, f.cursor);
    expect(lines).toEqual([
      "אנחנו קמים כשהבוקר מגיע",
      "אנחנו קמים כשהבוקר מגיע",
    ]);
  });

  it("returns an empty array for empty lyrics", () => {
    expect(currentSection("", 0)).toEqual([]);
  });
});

describe("detectScheme", () => {
  it("detects AABB from a couplet", () => {
    expect(
      detectScheme([
        "I walked down a street in the rain",
        "Trying to shake off the pain",
        "I found an old coat by the door",
      ]),
    ).toBe("AABB");
  });

  it("detects ABAB from alternating end rhymes", () => {
    expect(
      detectScheme([
        "Every evening I walk this road",
        "Counting stars that used to shine",
        "Thinking back to what you told",
      ]),
    ).toBe("ABAB");
  });

  it("is free when lines don't rhyme", () => {
    expect(
      detectScheme([
        "She keeps the porch light on for no one",
        "Waiting on a car that won't return",
        "The radio hums some old forgotten tune",
      ]),
    ).toBe("free");
  });

  it("does not invent a scheme from a single line, or from non-rhyming lines", () => {
    expect(detectScheme(["one line"])).toBe("free");
    expect(detectScheme([])).toBe("free");
    expect(detectScheme(["door", "banana"])).toBe("free");
  });

  it("treats two rhyming lines as the start of an AABB couplet", () => {
    expect(detectScheme(["door", "floor"])).toBe("AABB");
  });

  it("detects AABB and ABAB in Hebrew", () => {
    expect(
      detectScheme([
        "אני הולך ברחוב בלילה",
        "מחפש תשובה שקטה כמו תפילה",
        "מצאתי מעיל ישן ומפתח ישן",
      ]),
    ).toBe("AABB");
    expect(
      detectScheme([
        "כל ערב אני חוזר לבית הישן",
        "סופר כוכבים שכבר לא זוכרים",
        "מרגיש כמו מישהו שעדיין ישן",
      ]),
    ).toBe("ABAB");
  });
});

describe("nextLineTargets", () => {
  it("targets the AABB rhyme word (en)", () => {
    const f = fixture("en-next-line-aabb");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    expect(targets.scheme).toBe("AABB");
    expect(targets.rhymeWith).toBe("door");
  });

  it("targets the ABAB rhyme word, two lines back (en)", () => {
    const f = fixture("en-next-line-abab");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    expect(targets.scheme).toBe("ABAB");
    expect(targets.rhymeWith).toBe("shine");
  });

  it("targets the AABB rhyme word (he)", () => {
    const f = fixture("he-next-line-aabb");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    expect(targets.scheme).toBe("AABB");
    expect(targets.rhymeWith).toBe("ישן");
  });

  it("targets the ABAB rhyme word, two lines back (he)", () => {
    const f = fixture("he-next-line-abab");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    expect(targets.scheme).toBe("ABAB");
    expect(targets.rhymeWith).toBe("זוכרים");
  });

  it("finds the genuine ABAB slant (return/burns share the stressed vowel)", () => {
    const f = fixture("en-next-line-midverse");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    expect(targets.scheme).toBe("ABAB");
    expect(targets.rhymeWith).toBe("tune");
  });

  it("stays inside the current section, ignoring the verse above", () => {
    const f = fixture("en-next-line-chorus");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    // Only the two chorus lines are in-section; they don't rhyme with each
    // other ("out" vs "fall"), so this must not pick up the verse's rhyme.
    expect(targets.scheme).toBe("free");
  });

  it("does not jump the section boundary on a repeated chorus (en)", () => {
    const f = fixture("en-edge-chords-chorus");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    // Only the 2 lines of the *current* chorus repeat are in-section (not
    // the earlier repeat before the second [Chorus] header). They're
    // identical, so they trivially rhyme (AABB) — but critically, the
    // target must be "comes" (the lyric), never a header/chord word.
    expect(targets.scheme).toBe("AABB");
    expect(targets.rhymeWith).toBe("comes");
  });

  it("omits rhymeWith and syllables for empty lyrics", () => {
    const f = fixture("en-edge-empty");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    expect(targets.scheme).toBe("free");
    expect(targets.rhymeWith).toBeUndefined();
    expect(targets.syllables).toBeUndefined();
  });

  it("gives a +/-2 syllable range around the reference line", () => {
    const f = fixture("en-next-line-aabb");
    const targets = nextLineTargets(f.lyrics, f.cursor);
    const refCount = countSyllables("I found an old coat by the door", "en");
    expect(targets.syllables).toEqual([refCount - 2, refCount + 2]);
  });

  it("excludes the in-progress line when the caller passes a truncated draft", () => {
    // Simulates next_word's wiring: without truncation, the unfinished
    // line being typed gets treated as a finished AABB reference and the
    // target becomes its own last (partial) word — useless. The caller
    // must pass a draft cut back to just before that line instead.
    const priorLines =
      "I walked down a street in the rain\n" +
      "Trying to shake off the pain\n" +
      "I found an old coat by the door";
    const untruncated = priorLines + "\nNow I am ringing the ";

    const broken = nextLineTargets(untruncated, untruncated.length);
    expect(broken.rhymeWith).toBe("the");

    const fixed = nextLineTargets(priorLines, priorLines.length);
    expect(fixed.rhymeWith).toBe("door");
  });
});

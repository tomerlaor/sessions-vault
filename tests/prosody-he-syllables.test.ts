// Calibration table for the unpointed Hebrew syllable estimate
// (src/lib/prosody/he.ts). Hand-counted against ordinary pronunciation —
// real counts are inherently fuzzy without niqud (see he.ts), so this
// asserts the estimate is within +/-1 on most lines/words and that it's
// a clear improvement over the old flat round(letterCount / 2), not that
// every single entry is exact.
import { describe, it, expect } from "vitest";
import { countSyllables } from "../src/lib/prosody/he";

function oldLetterHalfEstimate(word: string): number {
  const letters = word.match(/[א-ת]/g) ?? [];
  if (letters.length === 0) return 0;
  return Math.max(1, Math.round(letters.length / 2));
}

function oldLineEstimate(line: string): number {
  return line
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, w) => sum + oldLetterHalfEstimate(w), 0);
}

// [word, hand-counted syllables]
const WORDS: [string, number][] = [
  ["של", 1],
  ["אני", 2],
  ["הולך", 2],
  ["ברחוב", 3],
  ["בלילה", 3],
  ["מחפש", 3],
  ["תשובה", 3],
  ["שקטה", 2],
  ["כמו", 2],
  ["תפילה", 3],
  ["בחדר", 3],
  ["שלא", 2],
  ["נגעו", 2],
  ["בו", 1],
  ["ידיים", 3],
  ["אמרתי", 3],
  ["שלום", 2],
  ["תודה", 2],
  ["אהבה", 3],
  ["ילד", 2],
  ["ילדים", 3],
  ["בית", 2],
  ["בתים", 2],
  ["חוזר", 2],
  ["יותר", 2],
  ["רחוק", 2],
  ["קרוב", 2],
  ["לעולם", 3],
  ["דלתות", 2],
  ["עיניים", 3],
  ["עין", 2],
  ["אנחנו", 3],
  ["כוכבים", 3],
  ["זוכרים", 3],
];

// [line, hand-counted syllables] — a mix of fixture reference lines
// (tests/fixtures/lyrics-eval/he.json) and model outputs quoted in
// analysis-4.5.md Cluster F.
const LINES: [string, number][] = [
  ["אני הולך ברחוב בלילה", 10],
  ["מחפש תשובה שקטה כמו תפילה", 13],
  ["מצאתי מעיל ישן ומפתח ישן", 14],
  ["כל ערב אני חוזר לבית הישן", 13],
  ["סופר כוכבים שכבר לא זוכרים", 11],
  ["מרגיש כמו מישהו שעדיין ישן", 13],
  ["היא משאירה אור קטן דלוק במסדרון", 13],
  ["מחכה למישהו שלא חוזר יותר", 13],
  ["הרדיו ממלמל שיר ישן מהעבר", 13],
  ["והקפה עדיין חם אבל כבר לא עוזר", 16],
  // analysis-4.5.md Cluster F: output counted 10 vs a reference of 13 by
  // the old heuristic; the likely false fail this fix targets.
  ["בחדר שלא נגעו בו ידיים", 11],
  ["היא יושבת על הכיסא שלו ומחכה לחזרה", 18],
  ["ובידיים פתוחות אנחנו מתעוררים לשמיע", 18],
  ["אנחנו קמים כשהבוקר מגיע", 13],
  ["אנחנו האש שלא נכבית לעולם", 12],
  ["אנחנו ההד שממשיך אחרי הנפילה", 14],
];

function withinOne(count: number, hand: number): boolean {
  return Math.abs(count - hand) <= 1;
}

describe("countSyllables (he, unpointed) — calibration", () => {
  it("is within +/-1 of a hand count for most common lyric words", () => {
    const hits = WORDS.filter(([word, hand]) =>
      withinOne(countSyllables(word), hand),
    ).length;
    expect(hits).toBeGreaterThanOrEqual(Math.ceil(WORDS.length * 0.9));
  });

  it("is within +/-1 of a hand count for most sample lyric lines", () => {
    const hits = LINES.filter(([line, hand]) =>
      withinOne(countSyllables(line), hand),
    ).length;
    expect(hits).toBeGreaterThanOrEqual(Math.ceil(LINES.length * 0.65));
  });

  it("is a clear improvement over the old flat letters/2 estimate on words", () => {
    const newMae =
      WORDS.reduce(
        (sum, [w, hand]) => sum + Math.abs(countSyllables(w) - hand),
        0,
      ) / WORDS.length;
    const oldMae =
      WORDS.reduce(
        (sum, [w, hand]) => sum + Math.abs(oldLetterHalfEstimate(w) - hand),
        0,
      ) / WORDS.length;
    expect(newMae).toBeLessThan(oldMae);
  });

  it("does not regress mean error on lines, and matches more lines within +/-1", () => {
    const newMae =
      LINES.reduce(
        (sum, [l, hand]) => sum + Math.abs(countSyllables(l) - hand),
        0,
      ) / LINES.length;
    const oldMae =
      LINES.reduce(
        (sum, [l, hand]) => sum + Math.abs(oldLineEstimate(l) - hand),
        0,
      ) / LINES.length;
    const newWithin1 = LINES.filter(([l, hand]) =>
      withinOne(countSyllables(l), hand),
    ).length;
    const oldWithin1 = LINES.filter(([l, hand]) =>
      withinOne(oldLineEstimate(l), hand),
    ).length;
    expect(newMae).toBeLessThanOrEqual(oldMae);
    expect(newWithin1).toBeGreaterThan(oldWithin1);
  });

  it("fixes the motivating false-fail case: a short line within 1 of its 11-syllable hand count", () => {
    // analysis-4.5.md: he-next-line-abab t1 output, scored 10 by the old
    // letters/2 heuristic. A careful hand count of this line (ba-che-der
    // sh'lo nig'u bo ya-da-yim = 3+2+2+1+3) is 11, not the 13 this test
    // previously asserted against — the improved estimate should land
    // close to that correct count.
    const count = countSyllables("בחדר שלא נגעו בו ידיים");
    expect(Math.abs(count - 11)).toBeLessThanOrEqual(1);
  });

  it("treats a maqaf (־) as a word break", () => {
    // תל־אביב (Tel Aviv) is written with a maqaf joining the two words;
    // it should count the same as if they were space-separated (tel-a-viv).
    expect(countSyllables("תל־אביב")).toBe(3);
    expect(countSyllables("תל־אביב")).toBe(countSyllables("תל אביב"));
  });

  it("doesn't double-count the stem's last consonant for the יים dual ending", () => {
    // The old ["יים", 2] rule stripped all 3 letters of the dual ending and
    // added a flat 2, double-counting the stem's final consonant (which is
    // the same letter the dual ending's leading mater fuses with in
    // writing, e.g. חי + ים -> חיים). Falling through to the ordinary
    // ["ים", 1] rule leaves that letter as part of the stem instead.
    expect(countSyllables("חיים")).toBe(2); // kha-YIM
    expect(countSyllables("עיניים")).toBe(3); // ei-NA-yim
    expect(countSyllables("רגליים")).toBe(3); // rag-LA-yim
    expect(countSyllables("אזניים")).toBe(3); // oz-NA-yim
    expect(countSyllables("שמיים")).toBe(3); // sha-MA-yim
    // פעמיים is truly pa-a-MA-yim = 4 (the guttural ע after a bare
    // consonant takes its own vowel, same as in נעליים/פעמיים-type nouns)
    // but nothing in this letter-counting heuristic models that guttural
    // vowel-insertion rule, so the general fix lands on 3 here, one short
    // of the true count. Documented as a known miss rather than
    // special-cased away.
    expect(countSyllables("פעמיים")).toBe(3);
  });
});

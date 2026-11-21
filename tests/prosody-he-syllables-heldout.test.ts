// Held-out calibration check for the unpointed Hebrew syllable estimate
// (src/lib/prosody/he.ts). Every word below is hand-counted in standard
// modern Israeli pronunciation and is deliberately NOT in he.ts's tuning
// tables (ONE_SYLLABLE_WORDS/SYLLABLE_SUFFIXES) or in the calibration
// fixtures in prosody-he-syllables.test.ts — the point is to measure the
// estimator on words it was never fitted against, not to re-check words
// the tables already know about. Do not add any of these words to the
// tuning tables to make this pass; if the general rules can't beat the
// old estimate honestly, that should show up here.
import { describe, it, expect } from "vitest";
import { countSyllables } from "../src/lib/prosody/he";

function oldLetterHalfEstimate(word: string): number {
  const letters = word.match(/[א-ת]/g) ?? [];
  if (letters.length === 0) return 0;
  return Math.max(1, Math.round(letters.length / 2));
}

// [word, hand-counted syllables, pronunciation]
const HELD_OUT_WORDS: [string, number, string][] = [
  // nouns
  ["לב", 1, "lev"],
  ["יד", 1, "yad"],
  ["שמש", 2, "she-mesh"],
  ["ירח", 3, "ya-re-ach"],
  ["דרך", 2, "de-rech"],
  ["עולם", 2, "o-lam"],
  ["מילה", 2, "mi-la"],
  ["שיר", 1, "shir"],
  ["קול", 1, "kol"],
  ["חלום", 2, "cha-lom"],
  ["אור", 1, "or"],
  ["רוח", 2, "ru-ach"],
  ["גשם", 2, "ge-shem"],
  ["שלג", 2, "she-leg"],
  ["כוכב", 2, "ko-chav"],
  ["ספר", 2, "se-fer"],
  ["בגד", 2, "be-ged"],
  ["שנה", 2, "sha-na"],
  // plurals (ים/ות)
  ["ילדות", 3, "ye-la-dot"],
  ["מילים", 2, "mi-lim"],
  ["שירים", 2, "shi-rim"],
  ["קולות", 2, "ko-lot"],
  ["חלומות", 3, "cha-lo-mot"],
  ["עצים", 2, "e-tzim"],
  ["ימים", 2, "ya-mim"],
  ["שנים", 2, "sha-nim"],
  ["בגדים", 3, "be-ga-dim"],
  // דual (יים) nouns — a few, distinct from the he.ts fix's own verify
  // list (חיים/עיניים/רגליים/אזניים/שמיים/פעמיים)
  ["ברכיים", 3, "bir-ka-yim"],
  ["מכנסיים", 4, "mich-na-sa-yim"],
  ["נעליים", 4, "na-a-la-yim"],
  // adjectives
  ["יפה", 2, "ya-fe"],
  ["גדול", 2, "ga-dol"],
  ["קטן", 2, "ka-tan"],
  ["חדש", 2, "cha-dash"],
  ["חזק", 2, "cha-zak"],
  ["עצוב", 2, "a-tzuv"],
  // verbs, conjugated
  ["הולכת", 3, "ho-le-chet"],
  ["אוהב", 2, "o-hev"],
  ["אוהבת", 3, "o-he-vet"],
  ["רוצה", 2, "ro-tze"],
  ["יודע", 3, "yo-de-a"],
  ["בוכה", 2, "bo-che"],
  ["שרה", 2, "sha-ra"],
  ["חושב", 2, "cho-shev"],
  ["נשאר", 2, "nish-ar"],
  // prefixed forms (ו/ה/ב/ל/מ/ש/כ)
  ["והלב", 3, "ve-ha-lev"],
  ["השיר", 2, "ha-shir"],
  ["בבית", 3, "ba-ba-yit"],
  ["לבית", 3, "la-ba-yit"],
  ["משירים", 3, "mi-shi-rim"],
  ["שרוצה", 3, "she-ro-tze"],
  ["כזה", 2, "ka-ze"],
  ["ובלב", 3, "u-va-lev"],
];

describe("countSyllables (he, unpointed) — held-out words", () => {
  it("beats the old flat letters/2 estimate on mean absolute error", () => {
    const newErrors = HELD_OUT_WORDS.map(([w, hand]) =>
      Math.abs(countSyllables(w) - hand),
    );
    const oldErrors = HELD_OUT_WORDS.map(([w, hand]) =>
      Math.abs(oldLetterHalfEstimate(w) - hand),
    );
    const n = HELD_OUT_WORDS.length;
    const newMae = newErrors.reduce((a, b) => a + b, 0) / n;
    const oldMae = oldErrors.reduce((a, b) => a + b, 0) / n;
    const newExact = newErrors.filter((e) => e === 0).length;
    const oldExact = oldErrors.filter((e) => e === 0).length;

    console.log(
      `held-out set (N=${n}): new mean error=${newMae.toFixed(3)} exact=${newExact}/${n}` +
        ` vs old mean error=${oldMae.toFixed(3)} exact=${oldExact}/${n}`,
    );

    expect(newMae).toBeLessThanOrEqual(oldMae);
  });
});

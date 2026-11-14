// Local English + Hebrew rhyme and syllable engine (R4).
//
// The English dictionary (see ./data/NOTICE.md) is loaded lazily via
// dynamic import — nothing here, in ./scheme.ts, or in ./en.ts statically
// imports the data file, so it never lands in the startup bundle. Call
// loadEnglishDict() once (src/lib/lyrics-ai.ts does this as a side effect
// on first use) before relying on dictionary-backed accuracy; every
// function below works before that too, via a heuristic fallback.
import {
  countSyllables as enCountSyllables,
  rhymeKey as enRhymeKey,
  rhymes as enRhymes,
} from "./en";
import {
  countSyllables as heCountSyllables,
  rhymeKey as heRhymeKey,
  rhymes as heRhymes,
} from "./he";

export { loadEnglishDict } from "./en";
export {
  cleanLine,
  currentSection,
  detectScheme,
  nextLineTargets,
  type NextLineTargets,
} from "./scheme";

export type ProsodyLang = "en" | "he";
export type RhymeResult = "perfect" | "slant" | "none";

export function countSyllables(wordOrLine: string, lang: ProsodyLang): number {
  return lang === "he"
    ? heCountSyllables(wordOrLine)
    : enCountSyllables(wordOrLine);
}

export function rhymeKey(word: string, lang: ProsodyLang): string {
  return lang === "he" ? heRhymeKey(word) : enRhymeKey(word);
}

export function rhymes(a: string, b: string, lang: ProsodyLang): RhymeResult {
  return lang === "he" ? heRhymes(a, b) : enRhymes(a, b);
}

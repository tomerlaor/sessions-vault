// Pure, deterministic, offline checkers for the lyrics-AI eval harness.
//
// Every check takes a single model output string and returns a CheckResult —
// no network, no I/O, no randomness — so they can run in `npx vitest run`
// without API keys and be re-scored later from saved JSON.
//
// Syllable counting and rhyme detection are delegated to the local prosody
// engine (src/lib/prosody) — see that module for the CMUdict-backed English
// syllables/rhymes and the heuristic Hebrew niqud-aware syllable count.
// English scoring is only dictionary-backed once loadEnglishDict() resolves
// (the runner awaits it before scoring); callers that can't await it get the
// engine's heuristic fallback instead.
import {
  countSyllables as engineCountSyllables,
  rhymes as engineRhymeDetail,
} from "../../src/lib/prosody";

export type EvalLang = "en" | "he";
export type EvalMode = "next_line" | "completion" | "next_word" | "alternative";

export interface EvalExpect {
  rhymeWith?: string;
  syllables?: [number, number];
  maxLines?: number;
  mustNotContain?: string[];
}

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  status: CheckStatus;
  detail?: string;
}

// Shared context every checker that needs more than the raw output and the
// expectation can read from. Built by the runner from a fixture + cursor.
export interface CheckContext {
  mode: EvalMode;
  lang: EvalLang;
  // Text already typed on the current line, up to the cursor. Used to build
  // the "completed line" for completion mode (prefix + output) and to catch
  // the model echoing back what the writer already typed.
  linePrefix: string;
  // The lyric line a next_line candidate should match in length: the last
  // *written* lyric line (cleaned, skipping headers/chords/remarks). Used
  // only as a fallback syllable check when no explicit expect.syllables
  // range is given. Not simply "the line before the cursor's line" (see
  // buildReferenceLine() in runner.ts) -- that's one line too early
  // whenever the cursor sits at the end of the last written line, which is
  // the common case for next_line fixtures.
  referenceLine?: string;
}

// ── shared helpers ──────────────────────────────────────────────

// Hebrew letters (U+05D0-U+05EA) plus the Hebrew presentation forms block
// (U+FB1D-U+FB4F, e.g. ligatures and niqqud-bearing letter variants). ASCII
// \u escapes so this can't be mangled by source-encoding normalization the
// way a literal Hebrew character range in the source could be.
const HEBREW_RE = /[\u05D0-\u05EA\uFB1D-\uFB4F]/;
const HEBREW_LETTER_G = /[\u05D0-\u05EA\uFB1D-\uFB4F]/g;
const LATIN_LETTER_G = /[A-Za-z]/g;

export function isHebrewText(text: string): boolean {
  return HEBREW_RE.test(text);
}

// Extracts the last "word" of a line/output, trimming trailing whitespace
// and punctuation first.
export function lastWord(text: string): string {
  const trimmed = text.trim().replace(/[.,!?;:"'“”‘’)\]]+$/u, "");
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? "";
}

// Joins a completion's typed prefix with the model's output for scoring
// (syllables/rhyme). Adds a separating space only when neither side already
// has adjoining whitespace, so a genuinely glued reply like "walk"+"away"
// still gets a word boundary, but "I "+"walk" doesn't end up "I  walk".
export function joinCompletion(prefix: string, output: string): string {
  if (prefix.length === 0 || output.length === 0) return prefix + output;
  if (/\s$/.test(prefix) || /^\s/.test(output)) return prefix + output;
  return `${prefix} ${output}`;
}

// Counts syllables across a whole string (line or output), word by word.
// Dictionary-backed for English once loadEnglishDict() resolves (the
// runner awaits it before scoring); falls back to the engine's heuristic
// otherwise. See src/lib/prosody/en.ts and he.ts.
export function countSyllables(text: string, lang: EvalLang): number {
  return engineCountSyllables(text, lang);
}

// Boolean rhyme check for the eval harness: true iff the engine calls it
// "perfect" or "slant" (false for "none"). Use rhymeDetail() for the full
// three-way result.
export function rhymes(a: string, b: string, lang: EvalLang): boolean {
  return engineRhymeDetail(a, b, lang) !== "none";
}

// The engine's ternary rhyme result, re-exported under a distinct name so
// callers that want "perfect" vs "slant" (rather than the boolean above)
// don't need to import src/lib/prosody directly.
export const rhymeDetail = engineRhymeDetail;

// A line made up only of chord tokens (e.g. "C G Am F", "Dm7 G7 Cmaj7") or a
// bare [Section] header — not a real lyric line, so no-copy shouldn't flag it.
function isChordOrHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^\[.*]$/.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/);
  return tokens.every((t) =>
    /^[A-G](#|b)?(maj|min|dim|aug|sus\d?|add\d?|m)?\d*(\/[A-G](#|b)?)?$/.test(
      t,
    ),
  );
}

// ── checks ────────────────────────────────────────────────────────────────

const LABEL_RE =
  /^(suggestion|next line|next word|completion|option|alternative|answer|ה?(?:הצעה|השלמה|שורה הבאה|מילה הבאה|אפשרות|חלופה|תשובה))\s*:/i;
const META_PHRASES = [
  "here is",
  "here's",
  "this line",
  "this suggestion",
  "i think",
  "i suggest",
  "note:",
  "explanation:",
  "as an ai",
];

export function checkFormat(
  output: string,
  ctx: CheckContext,
  expect: EvalExpect = {},
): CheckResult {
  const maxLines = expect.maxLines ?? 1;
  if (output.trim().length === 0) {
    return { status: "fail", detail: "empty output" };
  }

  const rawLines = output.split("\n");
  const hasEdgeBlankLine =
    rawLines.length > 1 &&
    (rawLines[0].trim() === "" || rawLines[rawLines.length - 1].trim() === "");
  if (hasEdgeBlankLine) {
    return { status: "fail", detail: "leading/trailing blank line" };
  }

  const trimmed = output.trim();
  const lines = trimmed.split("\n").filter((l) => l.length > 0);
  if (lines.length > maxLines) {
    return {
      status: "fail",
      detail: `${lines.length} lines, expected at most ${maxLines}`,
    };
  }

  if (/^["'“”‘’].*["'“”‘’]$/.test(trimmed)) {
    return { status: "fail", detail: "wrapped in quotes" };
  }

  if (LABEL_RE.test(trimmed)) {
    return { status: "fail", detail: "starts with a label" };
  }

  const lower = trimmed.toLowerCase();
  const metaHit = META_PHRASES.find((p) => lower.includes(p));
  if (metaHit) {
    return { status: "fail", detail: `commentary phrase: "${metaHit}"` };
  }

  if (ctx.mode === "completion" && ctx.linePrefix.trim().length > 0) {
    const prefix = ctx.linePrefix.trim().toLowerCase();
    if (lower.startsWith(prefix)) {
      return { status: "fail", detail: "repeats the already-typed prefix" };
    }
  }

  if (
    ctx.mode === "completion" &&
    ctx.linePrefix.length > 0 &&
    output.length > 0 &&
    !/\s$/.test(ctx.linePrefix) &&
    !/^\s/.test(output)
  ) {
    return { status: "fail", detail: "glued to prefix" };
  }

  if (ctx.mode === "next_word") {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length > 2) {
      return {
        status: "fail",
        detail: `${words.length} words, expected at most 2`,
      };
    }
    if (/[,:;]/.test(trimmed)) {
      return { status: "fail", detail: "punctuation-heavy commentary" };
    }
  }

  const forbidden = expect.mustNotContain?.find((s) =>
    lower.includes(s.toLowerCase()),
  );
  if (forbidden) {
    return {
      status: "fail",
      detail: `contains forbidden text: "${forbidden}"`,
    };
  }

  return { status: "pass" };
}

export function checkSyllables(
  output: string,
  expect: EvalExpect,
  ctx: CheckContext,
): CheckResult {
  const target =
    ctx.mode === "completion" ? joinCompletion(ctx.linePrefix, output) : output;

  if (expect.syllables) {
    const [min, max] = expect.syllables;
    const count = countSyllables(target, ctx.lang);
    if (count < min || count > max) {
      return {
        status: "fail",
        detail: `${count} syllables, expected ${min}-${max}`,
      };
    }
    return { status: "pass" };
  }

  if (
    ctx.mode === "next_line" &&
    ctx.referenceLine &&
    ctx.referenceLine.trim().length > 0
  ) {
    const count = countSyllables(target, ctx.lang);
    const refCount = countSyllables(ctx.referenceLine, ctx.lang);
    if (Math.abs(count - refCount) > 2) {
      return {
        status: "fail",
        detail: `${count} syllables vs ${refCount} in the reference line`,
      };
    }
    return { status: "pass" };
  }

  return { status: "skip" };
}

export function checkRhyme(
  output: string,
  expect: EvalExpect,
  ctx: CheckContext,
): CheckResult {
  if (!expect.rhymeWith) return { status: "skip" };

  const target =
    ctx.mode === "completion" ? joinCompletion(ctx.linePrefix, output) : output;
  const word = lastWord(target);
  if (!word) return { status: "fail", detail: "no word to check" };

  if (!rhymes(word, expect.rhymeWith, ctx.lang)) {
    return {
      status: "fail",
      detail: `"${word}" does not rhyme with "${expect.rhymeWith}"`,
    };
  }
  return { status: "pass" };
}

export function checkNoCopy(output: string, lyrics: string): CheckResult {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  const existingLines = new Set(
    lyrics
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isChordOrHeaderLine(l))
      .map(normalize),
  );

  const outputLines = output
    .split("\n")
    .map(normalize)
    .filter((l) => l.length > 0);

  for (const line of outputLines) {
    if (existingLines.has(line)) {
      return {
        status: "fail",
        detail: `repeats an existing line verbatim: "${line}"`,
      };
    }
  }
  return { status: "pass" };
}

export function checkLanguage(output: string, lang: EvalLang): CheckResult {
  const trimmed = output.trim();
  const hebrewCount = (trimmed.match(HEBREW_LETTER_G) ?? []).length;
  const latinCount = (trimmed.match(LATIN_LETTER_G) ?? []).length;

  if (lang === "en") {
    if (hebrewCount > 0 && hebrewCount >= latinCount) {
      return { status: "fail", detail: "output is primarily Hebrew" };
    }
    return { status: "pass" };
  }

  // he
  if (hebrewCount === 0) {
    return { status: "fail", detail: "no Hebrew letters" };
  }
  if (latinCount > hebrewCount) {
    return { status: "fail", detail: "output is primarily English" };
  }
  return { status: "pass" };
}

// Exported so tests (and the eval report) can target/display the exact
// blocklist being enforced.
export const EN_CLICHE_PAIRS: [string, string][] = [
  ["fire", "desire"],
  ["heart", "apart"],
  ["love", "above"],
  ["pain", "rain"],
  ["night", "light"],
  ["soul", "whole"],
];

export const EN_CLICHE_PHRASES = [
  "heart and soul",
  "burning desire",
  "tears like rain",
];

export const HE_CLICHE_PAIRS: [string, string][] = [
  ["לב", "אהב"],
  ["לילה", "תפילה"],
  ["אושר", "כושר"],
];

export const HE_CLICHE_PHRASES = ["לב שלם", "אהבה נצחית"];

export function checkCliche(output: string, rhymeWith?: string): CheckResult {
  const lower = output.toLowerCase();

  const phraseHit = [...EN_CLICHE_PHRASES, ...HE_CLICHE_PHRASES].find((p) =>
    lower.includes(p.toLowerCase()),
  );
  if (phraseHit) {
    return { status: "fail", detail: `cliché phrase: "${phraseHit}"` };
  }

  const word = lastWord(output).toLowerCase();
  const pairs = [...EN_CLICHE_PAIRS, ...HE_CLICHE_PAIRS];
  for (const [a, b] of pairs) {
    const bothPresent = lower.includes(a) && lower.includes(b);
    const landsOnPair =
      !!rhymeWith &&
      ((word === a && rhymeWith.toLowerCase().includes(b)) ||
        (word === b && rhymeWith.toLowerCase().includes(a)));
    if (bothPresent || landsOnPair) {
      return { status: "fail", detail: `cliché rhyme pairing: "${a}/${b}"` };
    }
  }

  return { status: "pass" };
}

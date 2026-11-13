// Pure, deterministic, offline checkers for the lyrics-AI eval harness (R3).
//
// Every check takes a single model output string and returns a CheckResult —
// no network, no I/O, no randomness — so they can run in `npx vitest run`
// without API keys and be re-scored later from saved JSON.
//
// R4 TODO: swap the syllable/rhyme heuristics below for a real engine
// (CMUdict-backed for English, a proper Hebrew phonetic model). Keep the
// function signatures the same so the runner and tests don't need to change.

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
  // Previous non-empty lyric line, used only as a fallback syllable check
  // for next_line when no explicit expect.syllables range is given.
  prevLine?: string;
}

// ── shared helpers ────────────────────────────────────────────────────────

// eslint-disable-next-line no-misleading-character-class -- Hebrew presentation forms are intentional
const HEBREW_RE = /[א-תיִ-פֿ]/;
const HEBREW_LETTER_G = /[א-ת]/g;
const LATIN_LETTER_G = /[A-Za-z]/g;
// Hebrew niqud (vowel points) — used to strip diacritics and, when present,
// as a rough proxy for syllable nuclei.
const NIQUD_G = /[ְ-ׇּׁׂ]/g;

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

function stripToLetters(word: string, lang: EvalLang): string {
  if (lang === "he") {
    return word.replace(NIQUD_G, "").replace(/[^א-ת]/g, "");
  }
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

function countSyllablesEnglishWord(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 0;
  // Silent trailing "e" (e.g. "name", "like") doesn't add its own syllable,
  // unless the whole word is just that vowel group (e.g. "the").
  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  return Math.max(1, count);
}

function countSyllablesHebrewWord(word: string): number {
  const niqud = word.match(NIQUD_G);
  if (niqud && niqud.length > 0) return niqud.length;
  // No niqud: fall back to counting matres lectionis (א ה ו י), at least one
  // syllable per word. This is a coarse heuristic — see R4 TODO above.
  const vowelLetters = word.match(/[אהוי]/g);
  return Math.max(1, vowelLetters ? vowelLetters.length : 1);
}

// Counts syllables across a whole string (line or output), word by word.
export function countSyllables(text: string, lang: EvalLang): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const counter =
    lang === "he" ? countSyllablesHebrewWord : countSyllablesEnglishWord;
  return words.reduce((sum, w) => sum + counter(w), 0);
}

// Heuristic rhyme match (R3): perfect or slant suffix comparison on the
// cleaned (letters-only) word. R4 TODO: replace with phoneme-based rhyme.
export function rhymes(a: string, b: string, lang: EvalLang): boolean {
  const ca = stripToLetters(a, lang);
  const cb = stripToLetters(b, lang);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.length >= 2 && cb.length >= 2 && ca.slice(-2) === cb.slice(-2)) {
    return true; // perfect-ish: same last two letters
  }
  // Slant: same trailing letter plus close length, catches e.g. "street"/"feet".
  return ca.slice(-1) === cb.slice(-1) && Math.abs(ca.length - cb.length) <= 2;
}

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
  /^(suggestion|next line|next word|completion|option|alternative|answer)\s*:/i;
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
  const target = ctx.mode === "completion" ? ctx.linePrefix + output : output;

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
    ctx.prevLine &&
    ctx.prevLine.trim().length > 0
  ) {
    const count = countSyllables(target, ctx.lang);
    const prevCount = countSyllables(ctx.prevLine, ctx.lang);
    if (Math.abs(count - prevCount) > 2) {
      return {
        status: "fail",
        detail: `${count} syllables vs ${prevCount} in previous line`,
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

  const target = ctx.mode === "completion" ? ctx.linePrefix + output : output;
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

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
import { smartJoinCompletion } from "../../src/lib/lyrics-join";
import {
  isCommentaryLine,
  isCopyOfExistingLine,
} from "../../src/lib/lyrics-sanitize";

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
// Maqaf, paseq, sof pasuq and nun hafukha (U+05BE, U+05C0, U+05C3, U+05C6)
// sit inside the U+0591-U+05C7 niqud block but aren't vowel points, they're
// punctuation/word-break marks. Stripping them outright (as a plain niqud
// strip would) glues the words on either side together, e.g. a maqaf-joined
// pair becomes one word and the eval's word-by-word syllable count desyncs
// from the app's. Map them to a space instead so word boundaries survive.
const WORD_BREAK_PUNCTUATION_G = /[\u05BE\u05C0\u05C3\u05C6]/g;
// Niqud (vowel points, dagesh, sheva, cantillation): U+0591-U+05C7, minus
// the word-break punctuation above (handled separately).
const HEBREW_NIQUD_G = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;

// Strips niqud so a Hebrew syllable comparison never scores one side
// (reference lines, always written unpointed) against the pointed-aware
// count and the other side (model output, which may come back with
// niqud) against the unpointed estimate. See checkSyllables.
//
// NFD-normalizes first so Hebrew presentation forms (U+FB1D-FB4F, e.g. a
// shin precomposed with its shin dot) decompose into a base letter plus
// combining marks before stripping -- otherwise the precomposed form
// passes through untouched and the base letter is never counted on its
// own.
function stripNiqud(text: string): string {
  return text
    .normalize("NFD")
    .replace(WORD_BREAK_PUNCTUATION_G, " ")
    .replace(HEBREW_NIQUD_G, "");
}

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
// (syllables/rhyme) exactly the way the app joins them for insertion — both
// delegate to smartJoinCompletion (src/lib/lyrics-join.ts), the #102 fix so
// the eval and the app can never disagree about where a space belongs. A
// genuinely glued reply like "I walk"+"away" still gets a word boundary,
// "I "+"walk" doesn't end up "I  walk", and a valid mid-word completion
// like "tomor"+"row" stays glued as "tomorrow".
export function joinCompletion(prefix: string, output: string): string {
  return prefix + smartJoinCompletion(prefix, output);
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

// ── checks ────────────────────────────────────────────────────────────────

const LABEL_RE =
  /^(suggestion|next line|next word|completion|option|alternative|answer|ה?(?:הצעה|השלמה|שורה הבאה|מילה הבאה|אפשרות|חלופה|תשובה))\s*:/i;
// Plain substring phrases, checked regardless of position in the line.
// Deliberately NOT a comprehensive list of every meta phrase mentioned in
// the R6-fix bug report ("i'll offer", "i'll write", "so i'll", "sure,",
// ...): those openers are also plausible real-lyric openers ("I'll write
// your name in the sand", "So I'll wait for you", "Sure, I remember
// everything"), so a blind substring match on them would drop real lyrics.
// They're instead covered below via isCommentaryLine, which only flags
// them when a second signal (a mention of the line/suggestion itself, or a
// trailing colon) is also present — see that function's doc comment in
// src/lib/lyrics-sanitize.ts for the full tradeoff. "the lyrics are" is
// kept here as a plain substring because it's safe unconditionally: no
// real lyric is self-referential about "the lyrics" this way.
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
  "the lyrics are",
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

  // Catches the EN/HE preamble/self-talk shapes isCommentaryLine knows
  // about (src/lib/lyrics-sanitize.ts) that aren't a blind META_PHRASES
  // substring — e.g. "The lyrics are empty, so I'll offer one striking
  // opening line." (kept whole here because formatRaw scores the raw,
  // unsanitized output, which can still be exactly this single line) or a
  // Hebrew preamble like "שיר פתיחה על התחלה חדשה... אז הנה שורת פתיחה:".
  const commentaryLine = lines.find((l) => isCommentaryLine(l));
  if (commentaryLine) {
    return { status: "fail", detail: `commentary line: "${commentaryLine}"` };
  }

  if (ctx.mode === "completion" && ctx.linePrefix.trim().length > 0) {
    const prefix = ctx.linePrefix.trim().toLowerCase();
    if (lower.startsWith(prefix)) {
      return { status: "fail", detail: "repeats the already-typed prefix" };
    }
  }

  // #102: this used to fail ANY completion whose raw output sat directly
  // against linePrefix with no whitespace on either side — including a
  // valid mid-word continuation like "tomor" + "row", which must stay
  // glued to read as "tomorrow". The app never inserts a completion's raw
  // text verbatim any more: every completion goes through the same
  // smartJoinCompletion() this check now delegates to (via joinCompletion,
  // src/lib/lyrics-join.ts), which decides per-case whether a leading
  // space belongs there before insertion. So judge the output the way the
  // app actually renders it — glued only when that's genuinely correct
  // (a dictionary word, or a punctuation rule) — rather than failing on
  // raw adjacency alone. A genuinely glued-wrong reply like "I walk" +
  // "away" is simply repaired to "I walk away" by joinCompletion, so it no
  // longer fails this check; it's not a new acceptance of garbled output.
  // The raw-adjacency signal itself isn't thrown away though — see
  // checkOmittedLeadingSpace() below, which reports it as a non-failing
  // diagnostic instead.

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

// Diagnostic only — returns a plain boolean, never a CheckResult, so it can
// never fail a trial or move the pass rate. This is the #102 root-cause
// signal checkFormat used to fail on directly (see the comment above): a
// completion-mode trial where the typed prefix ends with no whitespace and
// the model's raw output starts with no whitespace either, i.e. the model
// omitted the leading space a human would have typed. #102 established that
// raw adjacency alone isn't a defect in the *inserted* text — joinCompletion
// repairs it correctly before insertion in the common case — but it's still
// useful to know how often the model is relying on that repair rather than
// producing a naturally-joinable reply. Reported as "model omitted leading
// space" in the eval summary/report, as a rate alongside (not inside) the
// pass/fail checks.
export function checkOmittedLeadingSpace(
  output: string,
  ctx: CheckContext,
): boolean {
  return (
    ctx.mode === "completion" &&
    ctx.linePrefix.length > 0 &&
    output.length > 0 &&
    !/\s$/.test(ctx.linePrefix) &&
    !/^\s/.test(output)
  );
}

export function checkSyllables(
  output: string,
  expect: EvalExpect,
  ctx: CheckContext,
): CheckResult {
  const joined =
    ctx.mode === "completion" ? joinCompletion(ctx.linePrefix, output) : output;
  // Reference lines and expect.syllables ranges are always tuned against
  // unpointed text. If the model answers with niqud, scoring its output
  // through the pointed-aware path while the other side of the comparison
  // is unpointed compares two different counting methods, not two
  // different lines — strip niqud from both sides first so they always go
  // through the same (unpointed) estimator.
  const target = ctx.lang === "he" ? stripNiqud(joined) : joined;

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
    const referenceLine =
      ctx.lang === "he" ? stripNiqud(ctx.referenceLine) : ctx.referenceLine;
    const count = countSyllables(target, ctx.lang);
    const refCount = countSyllables(referenceLine, ctx.lang);
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

// Delegates to the same isCopyOfExistingLine the app's client-side copy
// guard uses (src/lib/lyrics-sanitize.ts), so the eval and the app agree on
// what counts as a copy: niqqud, chords/headers and punctuation differences
// are normalized away, and completion is judged by the whole resulting line
// (ctx.linePrefix + the joined candidate), not the suffix alone. `allow` is
// the chorus-mirror exemption (lyrics-ai.ts's chorusMirrorLine) — a line the
// model was explicitly told to mirror is not a copy. next_word candidates
// are single words/short phrases, never a whole line, so the guard doesn't
// apply to them.
export function checkNoCopy(
  output: string,
  lyrics: string,
  ctx: Pick<CheckContext, "mode" | "linePrefix">,
  allow?: string,
): CheckResult {
  if (ctx.mode === "next_word") return { status: "pass" };
  if (
    isCopyOfExistingLine(output, lyrics, {
      mode: ctx.mode,
      linePrefix: ctx.linePrefix,
      allow,
    })
  ) {
    return {
      status: "fail",
      detail: `repeats an existing line verbatim: "${output.trim()}"`,
    };
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

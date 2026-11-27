// Minimal output sanitizing for the model's raw lyric reply, shared by the
// app (LyricsAiOverlay) and the eval runner (scripts/lyrics-eval/runner.ts)
// so both display/score the same text — a safety net for cosmetic
// formatting artifacts (a label, wrapping quotes, a stray section header
// before the real line), not a substitute for the prompt asking for a
// single bare line (src/lib/lyrics-ai.ts's LINE_ONLY rules).
import { smartJoinCompletion } from "./lyrics-join";

export type SanitizeMode = "completion" | "next_line" | "alternative";

// The marker buildCursorMarkedLyrics (lyrics-ai.ts) inserts at the cursor —
// exported so that module can import it from here (this module is the
// shared low-level one) instead of the reverse. A model reply can echo it
// back (R6 fix), which must never reach the writer.
export const CURSOR_MARKER = "⟨CURSOR⟩";

// EN + HE labels the model sometimes prefixes the line with, optionally
// bold-markdown-wrapped (e.g. "**Next line:**"). The separator after the
// label must be a colon (optionally spaced) or a dash with whitespace on
// BOTH sides — a bare hyphen right against the label would otherwise treat
// ordinary hyphenated lyrics ("Option-less, I run") as a label. "line" on
// its own is too common an ordinary lyric word to risk the dash form at
// all ("Line — by line" is real lyrics, not a label) — it requires a colon.
const LABEL_WORDS_DASH_OK =
  "next\\s*line|next\\s*word|completion|suggestion|option|alternative|answer|הצעה|השלמה|שורה\\s*הבאה|מילה\\s*הבאה|אפשרות|חלופה|תשובה";
const LABEL_WORD_COLON_ONLY = "line";
const LEADING_LABEL_RE = new RegExp(
  `^\\*{0,2}\\s*(?:(?:${LABEL_WORDS_DASH_OK})\\*{0,2}(?:\\s*:\\s*|\\s+[-–—]\\s+)|${LABEL_WORD_COLON_ONLY}\\*{0,2}\\s*:\\s*)\\*{0,2}\\s*`,
  "i",
);

// A leading "1." or "1)" numbering the model sometimes adds before the
// line — either followed by whitespace, or alone on its own line, but
// never glued straight into digits that are actually part of the lyric
// ("7.62 caliber love" must not lose its "7" to this).
const LEADING_NUMBERING_RE = /^\s*\d+[.)](?:\s+|$)/;

// A bracketed [Section] header or a markdown "## Heading" line.
const HEADER_LINE_RE = /^\s*(?:\[[^\]]*]|#{1,6}\s+\S.*)\s*$/;

// A markdown code-fence delimiter, with or without a language tag
// (e.g. "```" or "```text").
const FENCE_LINE_RE = /^\s*```/;

// Wrapping quote pairs worth stripping: straight/curly double quotes and the
// two Hebrew double-quote conventions (low-high „…” and gershayim ״…״).
// Deliberately excludes ' and ' — those are overwhelmingly apostrophes in
// real lyrics ("'Cause I'm leavin'", "'s gone", " 'til"), not wrapping
// quotes, and stripping them corrupts the line.
const QUOTE_PAIRS: readonly [string, string][] = [
  ['"', '"'],
  ["“", "”"], // “ ”
  ["„", "”"], // „ ”
  ["״", "״"], // ״ ... ״
];

function stripWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  for (const [open, close] of QUOTE_PAIRS) {
    if (first !== open || last !== close) continue;
    const inner = s.slice(1, -1);
    // An unpaired quote char still inside the inner text (e.g. `"Stop," she
    // said, "don't go"`) means the leading/trailing quote isn't actually a
    // matched wrapping pair — leave the line alone rather than mangling it.
    if (inner.length === 0 || inner.includes(open) || inner.includes(close)) {
      continue;
    }
    return inner;
  }
  return s;
}

// Keeps the first non-empty line that isn't a bare section header or a code
// fence delimiter — used when the model answers with commentary/headers/code
// blocks before the actual line.
function firstLyricLine(s: string): string {
  for (const raw of s.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADER_LINE_RE.test(line)) continue;
    if (FENCE_LINE_RE.test(line)) continue;
    return line;
  }
  return "";
}

export function sanitizeLyricsOutput(raw: string, mode: SanitizeMode): string {
  if (!raw) return raw;

  // Completion's leading space (or lack of it) is a signal smartJoinCompletion
  // (lyrics-join.ts) relies on to decide word-boundary spacing — preserve it
  // across the rest of this cleanup rather than losing it to .trim(). Any
  // leading whitespace counts, including a leading newline before the real
  // line (e.g. "\n say") — it's still the model separating itself from the
  // typed prefix, just with the wrong whitespace character.
  const hadLeadingSpace = mode === "completion" && /^\s/.test(raw);

  let text = raw.trim();
  if (!text) return text;

  // An echoed cursor marker (see src/lib/lyrics-ai.ts's buildCursorMarkedLyrics)
  // must never reach the writer.
  text = text.split(CURSOR_MARKER).join("").trim();
  if (!text) return text;

  // Pick the single line to work with FIRST (skipping headers/blanks/code
  // fences), then strip numbering/a label/quotes from that line — a label
  // can follow a leading section header, e.g. "[Verse 2]\nNext line: ...".
  text = firstLyricLine(text);
  if (!text) return text;

  text = text.replace(LEADING_NUMBERING_RE, "");
  text = text.replace(LEADING_LABEL_RE, "").trim();
  if (!text) return text;

  text = stripWrappingQuotes(text).trim();

  if (hadLeadingSpace && text) text = ` ${text}`;
  return text;
}

// ─── Streaming (partial) sanitizer ─────────────────────────────────────────
// A lighter version of sanitizeLyricsOutput for LyricsAiOverlay's streaming
// ghost text (onToken) — it only ever trims from the start of the reply,
// and holds back (returns "") rather than show a prefix that could still
// turn into noise once more of the stream arrives (e.g. "Line" before the
// ":" that would make it a label, or "1" before the "." that would make it
// numbering). This avoids the ghost text visibly flashing a label/quote/
// fence/header and then jumping to the clean text once the full reply —
// still cleaned by sanitizeLyricsOutput — lands.
const LABEL_WORD_LIST = [
  "next line",
  "next word",
  "completion",
  "suggestion",
  "option",
  "alternative",
  "answer",
  "line",
  "הצעה",
  "השלמה",
  "שורה הבאה",
  "מילה הבאה",
  "אפשרות",
  "חלופה",
  "תשובה",
];

function isCompleteNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    HEADER_LINE_RE.test(trimmed) ||
    FENCE_LINE_RE.test(trimmed)
  );
}

// True while `s` (the streamed-so-far first line) could still turn into a
// label ("Line" -> "Line: ...") or numbering ("1" -> "1. ...") once more
// tokens arrive — holding back avoids ever flashing it.
function looksLikeUnresolvedPrefix(s: string): boolean {
  if (/^\s*\d+$/.test(s)) return true;
  const bare = s.replace(/^\*{0,2}/, "");
  if (bare === "") return s.length > 0; // only stars/whitespace so far
  const lower = bare.toLowerCase();
  return LABEL_WORD_LIST.some((word) => {
    const target = word.toLowerCase();
    if (lower.length <= target.length) return target.startsWith(lower);
    if (!lower.startsWith(target)) return false;
    // Streamed past the label word itself ("Lines of fire", "Answers in
    // the wind", "Optional love") — a letter right after it means this is
    // a different, longer word, not the label, so stop holding it back.
    // Only a non-letter (space, colon, dash, …) still leaves it ambiguous.
    return !/^\p{L}/u.test(lower[target.length]);
  });
}

export function sanitizePartialLyricsOutput(raw: string): string {
  if (!raw) return raw;
  let text = raw.split(CURSOR_MARKER).join("");

  // Drop fully-streamed leading blank/header/fence lines.
  for (;;) {
    const nl = text.indexOf("\n");
    if (nl === -1 || !isCompleteNoiseLine(text.slice(0, nl))) break;
    text = text.slice(nl + 1);
  }

  const firstLineEnd = text.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const rest = firstLineEnd === -1 ? "" : text.slice(firstLineEnd);

  // A still-open header/fence line ("[Ver", "##", "`"): hold back — the
  // loop above will drop it once it closes, or more text will prove it
  // was never really one.
  if (firstLineEnd === -1 && /^\s*(\[|#{1,6}(\s|$)|`)/.test(firstLine)) {
    return "";
  }

  let cleanedFirst = firstLine.replace(LEADING_NUMBERING_RE, "");
  cleanedFirst = cleanedFirst.replace(LEADING_LABEL_RE, "");

  if (
    cleanedFirst === firstLine &&
    firstLineEnd === -1 &&
    looksLikeUnresolvedPrefix(firstLine)
  ) {
    return "";
  }

  let strippedOpenQuote: string | undefined;
  if (cleanedFirst.length > 0) {
    for (const [open] of QUOTE_PAIRS) {
      if (cleanedFirst[0] === open) {
        cleanedFirst = cleanedFirst.slice(1);
        strippedOpenQuote = open;
        break;
      }
    }
  }

  // The matching close quote has just streamed in as the very last
  // character so far — hide it rather than flash it, the same way the
  // open quote was hidden the moment it appeared. sanitizeLyricsOutput
  // will remove the matched pair for real once the full reply lands; if
  // more text follows this char later, it naturally stops being the last
  // character and this no longer applies.
  if (strippedOpenQuote && rest === "" && cleanedFirst.length > 0) {
    const close = QUOTE_PAIRS.find(([o]) => o === strippedOpenQuote)?.[1];
    if (close && cleanedFirst.endsWith(close)) {
      cleanedFirst = cleanedFirst.slice(0, -close.length);
    }
  }

  // All four inline modes are a single line — once the first line has
  // content and a newline has arrived (so it's done streaming), drop
  // whatever the model writes after it. Without this, a self-correction
  // reply ("...\n\nWait, that's not a rhyme. Corrected:\n\ndark") flashes
  // its own chatter in the ghost text before the final sanitize/accept
  // path (which only ever keeps the first line anyway) replaces it.
  if (firstLineEnd !== -1 && cleanedFirst.length > 0) {
    return cleanedFirst;
  }

  return cleanedFirst + rest;
}

// ─── After-cursor overlap trim (#79) ───────────────────────────────────────
// A completion that duplicates text already sitting after the cursor (mid-
// line editing) — trims that overlap off the end. Leading whitespace is
// left untouched (smartJoinCompletion/sanitizeLyricsOutput's leading-space
// signal still matters); only a trailing match against `afterCursor` is
// removed.
export function trimRepeatedTail(
  suggestion: string,
  afterCursor: string,
): string {
  const after = afterCursor.trim();
  if (!after || !suggestion.trim()) return suggestion;

  if (suggestion.trim().toLowerCase() === after.toLowerCase()) return "";

  const suggestionTrimmedEnd = suggestion.replace(/\s+$/, "");
  if (!suggestionTrimmedEnd.toLowerCase().endsWith(after.toLowerCase())) {
    return suggestion;
  }

  const kept = suggestionTrimmedEnd.slice(
    0,
    suggestionTrimmedEnd.length - after.length,
  );
  // Only trim at a genuine word boundary: the overlap must sit between
  // words, not split one in half (e.g. prefix "I want", after-text " me",
  // reply " to come" would otherwise trim to " to co" -> "I want to co me").
  // A boundary exists when nothing is kept, the kept text already ends in
  // whitespace, or the overlap itself starts with a non-letter (so even a
  // letter right before it, like "wait" before ", really", isn't a split).
  const atWordBoundary =
    kept === "" || /\s$/.test(kept) || !/^\p{L}/u.test(after);
  if (!atWordBoundary) return suggestion;

  return kept.replace(/\s+$/, "");
}

// ─── Client-side noCopy guard (R6 review §7.1) ─────────────────────────────
// A safety net for when the prompt's own no-repeat rule loses to a stronger
// instruction (e.g. a repeated-chorus note) and the model just echoes a
// line that's already in the draft. Normalizes harder than
// sanitizeLyricsOutput — niqqud, chords/headers and punctuation can all
// differ between two lines that are really the same line — so the eval
// (checkNoCopy) and the app agree on what counts as a copy.
// Maqaf, paseq, sof pasuq, nun hafukha (U+05BE, U+05C0, U+05C3, U+05C6) are
// word-break marks, not niqqud — mapped to a space so the words on either
// side don't glue together. ASCII \u escapes, like lyrics-join.ts's
// HEBREW_RE, so this can't be mangled by source-encoding normalization.
const WORD_BREAK_PUNCTUATION_RE = /[\u05BE\u05C0\u05C3\u05C6]/g;
// Niqqud / cantillation (vowel points, dagesh, sheva, etc): U+0591-U+05C7.
const NIQQUD_RE = /[\u0591-\u05C7]/g;

function normLine(l: string): string {
  return l
    .normalize("NFKC")
    .replace(/\[[^\]]*]/g, " ") // chords / [Section headers]
    .replace(WORD_BREAK_PUNCTUATION_RE, " ")
    .replace(NIQQUD_RE, "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "") // punctuation, quotes, dashes
    .replace(/\s+/g, " ")
    .trim();
}

export type CopyGuardMode = SanitizeMode | "next_word";

export interface CopyGuardOptions {
  mode: CopyGuardMode;
  // completion: the text already typed on the current line, up to the
  // cursor — needed to build the whole resulting line the writer would
  // actually see (linePrefix + smartJoinCompletion(linePrefix, candidate)).
  linePrefix?: string;
  // A line that's allowed to match verbatim despite being "already in the
  // draft" — the chorus-mirror exemption (lyrics-ai.ts's chorusMirrorLine):
  // when the model is explicitly told to mirror the earlier chorus's line
  // at this position, that's the one copy that's actually correct.
  allow?: string;
}

// The line the writer would actually end up with for `candidate`, the same
// way the app and the eval both render/insert it — completion's candidate
// is only ever a suffix, so comparing it alone against existing lines would
// miss a prefix+candidate combination that duplicates one.
function wholeLineFor(candidate: string, opts: CopyGuardOptions): string {
  if (opts.mode !== "completion") return candidate;
  const prefix = opts.linePrefix ?? "";
  return prefix + smartJoinCompletion(prefix, candidate);
}

export function isCopyOfExistingLine(
  candidate: string,
  lyrics: string,
  opts: CopyGuardOptions,
): boolean {
  if (!candidate.trim()) return false;
  const wholeNorm = normLine(wholeLineFor(candidate, opts));
  if (!wholeNorm) return false;
  if (opts.allow !== undefined && normLine(opts.allow) === wholeNorm) {
    return false;
  }
  return lyrics
    .split("\n")
    .map(normLine)
    .filter((l) => l.length > 0)
    .includes(wholeNorm);
}

export interface ApplyCopyGuardOptions {
  lyrics: string;
  linePrefix?: string;
  allow?: string;
}

// sanitizeLyricsOutput + the copy guard, with a rescue: if the kept line is
// a copy, look for it in the raw reply and re-sanitize whatever the model
// wrote after it (the model's own "no, that's not right — actually:" self-
// correction, or a second attempt further down the reply) before giving up
// entirely. Shared by the overlay's final path, sanitizePopupSuggestions
// (lyrics-ai.ts) and the eval runner, so all three drop/rescue the same way.
export function applyCopyGuard(
  raw: string,
  mode: SanitizeMode,
  opts: ApplyCopyGuardOptions,
): string {
  const sug = sanitizeLyricsOutput(raw, mode);
  if (!sug) return sug;
  const guardOpts: CopyGuardOptions = {
    mode,
    linePrefix: opts.linePrefix,
    allow: opts.allow,
  };
  if (!isCopyOfExistingLine(sug, opts.lyrics, guardOpts)) return sug;

  const sugNorm = normLine(sug);
  const rawLines = raw.split("\n");
  const matchIndex = rawLines.findIndex((l) => normLine(l) === sugNorm);
  if (matchIndex === -1) return "";

  const retry = sanitizeLyricsOutput(
    rawLines.slice(matchIndex + 1).join("\n"),
    mode,
  );
  if (!retry || isCopyOfExistingLine(retry, opts.lyrics, guardOpts)) {
    return "";
  }
  return retry;
}

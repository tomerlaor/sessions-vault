// Minimal output sanitizing for the model's raw lyric reply, shared by the
// app (LyricsAiOverlay) and the eval runner (scripts/lyrics-eval/runner.ts)
// so both display/score the same text — a safety net for cosmetic
// formatting artifacts (a label, wrapping quotes, a stray section header
// before the real line), not a substitute for the prompt asking for a
// single bare line (src/lib/lyrics-ai.ts's LINE_ONLY rules).
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
// ordinary hyphenated lyrics ("Option-less, I run") as a label.
const LABEL_WORDS =
  "next\\s*line|next\\s*word|completion|suggestion|option|alternative|answer|line|הצעה|השלמה|שורה\\s*הבאה|מילה\\s*הבאה|אפשרות|חלופה|תשובה";
const LEADING_LABEL_RE = new RegExp(
  `^\\*{0,2}\\s*(?:${LABEL_WORDS})\\*{0,2}(?:\\s*:\\s*|\\s+[-–—]\\s+)\\*{0,2}\\s*`,
  "i",
);

// A leading "1." or "1)" numbering the model sometimes adds before the line.
const LEADING_NUMBERING_RE = /^\s*\d+[.)]\s*/;

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
    return lower.length <= target.length
      ? target.startsWith(lower)
      : lower.startsWith(target);
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

  if (cleanedFirst.length > 0) {
    for (const [open] of QUOTE_PAIRS) {
      if (cleanedFirst[0] === open) {
        cleanedFirst = cleanedFirst.slice(1);
        break;
      }
    }
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
  if (suggestionTrimmedEnd.toLowerCase().endsWith(after.toLowerCase())) {
    const kept = suggestionTrimmedEnd.slice(
      0,
      suggestionTrimmedEnd.length - after.length,
    );
    return kept.replace(/\s+$/, "");
  }
  return suggestion;
}

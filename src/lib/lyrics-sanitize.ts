// Minimal output sanitizing for the model's raw lyric reply, shared by the
// app (LyricsAiOverlay) and the eval runner (scripts/lyrics-eval/runner.ts)
// so both display/score the same text — a safety net for cosmetic
// formatting artifacts (a label, wrapping quotes, a stray section header
// before the real line), not a substitute for the prompt asking for a
// single bare line (src/lib/lyrics-ai.ts's LINE_ONLY rules).
export type SanitizeMode = "completion" | "next_line" | "alternative";

// EN + HE labels the model sometimes prefixes the line with, optionally
// bold-markdown-wrapped (e.g. "**Next line:**").
const LEADING_LABEL_RE =
  /^\*{0,2}\s*(?:next\s*line|next\s*word|completion|suggestion|option|alternative|answer|הצעה|השלמה|שורה\s*הבאה|מילה\s*הבאה|אפשרות|חלופה|תשובה)\s*\*{0,2}\s*[:\-–]\s*\*{0,2}\s*/i;

// A bracketed [Section] header or a markdown "## Heading" line.
const HEADER_LINE_RE = /^\s*(?:\[[^\]]*]|#{1,6}\s+\S.*)\s*$/;

function stripWrappingQuotes(s: string): string {
  const m = /^["'“”‘’]([\s\S]*)["'“”‘’]$/.exec(s);
  return m && m[1].length > 0 ? m[1] : s;
}

// Keeps the first non-empty line that isn't a bare section header — used
// when the model answers with commentary/headers before the actual line.
function firstLyricLine(s: string): string {
  for (const raw of s.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADER_LINE_RE.test(line)) continue;
    return line;
  }
  return "";
}

export function sanitizeLyricsOutput(raw: string, mode: SanitizeMode): string {
  if (!raw) return raw;

  // Completion's leading space (or lack of it) is a signal smartJoinCompletion
  // (lyrics-join.ts) relies on to decide word-boundary spacing — preserve it
  // across the rest of this cleanup rather than losing it to .trim().
  const hadLeadingSpace = mode === "completion" && /^[ \t]/.test(raw);

  let text = raw.trim();
  if (!text) return text;

  // Pick the single line to work with FIRST (skipping headers/blanks), then
  // strip a label/quotes from that line — a label can follow a leading
  // section header, e.g. "[Verse 2]\nNext line: ...".
  if (text.includes("\n")) {
    text = firstLyricLine(text);
  }
  if (!text) return text;

  text = text.replace(LEADING_LABEL_RE, "").trim();
  if (!text) return text;

  text = stripWrappingQuotes(text).trim();

  if (hadLeadingSpace && text) text = ` ${text}`;
  return text;
}

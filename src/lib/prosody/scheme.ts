// Section-aware line cleaning, rhyme-scheme detection, and next-line target
// computation. Pure string/array logic — no dictionary access beyond the
// per-language countSyllables/rhymes functions, so this module is cheap to
// import statically (see index.ts).
import { countSyllables as enCountSyllables, rhymes as enRhymes } from "./en";
import { countSyllables as heCountSyllables, rhymes as heRhymes } from "./he";

type Lang = "en" | "he";
type Scheme = "AABB" | "ABAB" | "free";

export interface NextLineTargets {
  rhymeWith?: string;
  syllables?: [number, number];
  scheme: Scheme;
}

const HEBREW_RE = /[֐-׿]/;

function detectLang(text: string): Lang {
  return HEBREW_RE.test(text) ? "he" : "en";
}

function rhymesFor(lang: Lang) {
  return lang === "he" ? heRhymes : enRhymes;
}

function countSyllablesFor(lang: Lang) {
  return lang === "he" ? heCountSyllables : enCountSyllables;
}

// A bracketed token: a [Section] header like [Verse]/[Chorus]/[בית]/[פזמון],
// or an inline chord annotation like [C]/[Am]/[F#m7]. Both are written the
// same way, so stripping every [...] span handles both at once — a
// header-only line collapses to "" (filtered out by currentSection), while
// an inline chord leaves the surrounding lyric text intact.
const BRACKET_TOKEN_RE = /\[[^\]]*]/g;
const REMARK_RE = /\([^)]*\)/g;
const CHORD_TOKEN_RE =
  /^[A-G](?:#|b)?(?:maj|min|dim|aug|sus\d?|add\d?|m)?\d*(?:\/[A-G](?:#|b)?)?$/;

function isBareChordLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => CHORD_TOKEN_RE.test(t));
}

export function cleanLine(line: string): string {
  const stripped = line
    .replace(BRACKET_TOKEN_RE, " ")
    .replace(REMARK_RE, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!stripped) return "";
  if (isBareChordLine(stripped)) return "";
  return stripped;
}

function isHeaderLine(line: string): boolean {
  return /^\s*\[[^\]]*]\s*$/.test(line);
}

interface CursorLocation {
  rawLines: string[];
  lineIndex: number;
  posInLine: number;
  lineLen: number;
}

function locateCursor(draft: string, cursor: number): CursorLocation {
  const rawLines = draft.split("\n");
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const lineLen = rawLines[i].length;
    if (cursor <= offset + lineLen) {
      return { rawLines, lineIndex: i, posInLine: cursor - offset, lineLen };
    }
    offset += lineLen + 1;
  }
  const lastIndex = Math.max(0, rawLines.length - 1);
  return {
    rawLines,
    lineIndex: lastIndex,
    posInLine: rawLines[lastIndex]?.length ?? 0,
    lineLen: rawLines[lastIndex]?.length ?? 0,
  };
}

// Section boundaries are [Section] headers; a section runs from just after
// the nearest preceding header (or the top of the draft) to just before the
// next one (or the end of the draft).
function sectionBounds(
  rawLines: string[],
  lineIndex: number,
): { start: number; end: number } {
  let start = 0;
  for (let i = lineIndex; i >= 0; i--) {
    if (isHeaderLine(rawLines[i])) {
      start = i + 1;
      break;
    }
  }
  let end = rawLines.length;
  for (let i = lineIndex + 1; i < rawLines.length; i++) {
    if (isHeaderLine(rawLines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function currentSection(draft: string, cursor: number): string[] {
  const { rawLines, lineIndex } = locateCursor(draft, cursor);
  const { start, end } = sectionBounds(rawLines, lineIndex);
  return rawLines
    .slice(start, end)
    .map(cleanLine)
    .filter((l) => l.length > 0);
}

const TRAILING_PUNCT_RE = /[.,!?;:"'""''‘’)\]]+$/u;

function lastWordOf(line: string): string {
  const trimmed = line.trim().replace(TRAILING_PUNCT_RE, "");
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words[words.length - 1] ?? "";
}

// A single line is never enough to invent a scheme from. Two lines that
// actually rhyme are treated as the start of an AABB couplet (the simplest,
// most common case); telling AABB apart from ABAB (alternating) at all
// needs a third line to show the alternation.
export function detectScheme(sectionLines: string[]): Scheme {
  const lines = sectionLines.filter((l) => l.trim().length > 0);
  if (lines.length < 2) return "free";

  const lang = detectLang(lines.join(" "));
  const rhymeFn = rhymesFor(lang);
  const ends = lines.map(lastWordOf);
  const doRhyme = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    const r = rhymeFn(a, b);
    return r === "perfect" || r === "slant";
  };

  for (let i = 0; i + 1 < ends.length; i++) {
    if (doRhyme(ends[i], ends[i + 1])) return "AABB";
  }
  for (let i = 0; i + 2 < ends.length; i++) {
    if (doRhyme(ends[i], ends[i + 2])) return "ABAB";
  }
  return "free";
}

// Builds the list of complete lyric lines, in section order, that the next
// (or currently-being-finished) line should be judged against. The line at
// the cursor counts only when it's already a finished, non-blank lyric
// line (cursor sitting right at its end) — e.g. a typical next_line
// fixture. Callers that are still composing the cursor's line (next_word,
// completion) should pass a draft truncated to just before that line so it
// never gets treated as a finished reference.
function referenceLines(draft: string, cursor: number): string[] {
  const { rawLines, lineIndex, posInLine, lineLen } = locateCursor(
    draft,
    cursor,
  );
  const { start, end } = sectionBounds(rawLines, lineIndex);
  const sectionRaw = rawLines.slice(start, end);
  const cursorRelIndex = Math.max(0, lineIndex - start);

  const atLineEnd = posInLine === lineLen;
  const cursorLineCleaned = cleanLine(rawLines[lineIndex] ?? "");
  const includeCursorLine = atLineEnd && cursorLineCleaned.length > 0;

  const before = sectionRaw
    .slice(0, cursorRelIndex)
    .map(cleanLine)
    .filter((l) => l.length > 0);

  return includeCursorLine ? [...before, cursorLineCleaned] : before;
}

export function nextLineTargets(
  draft: string,
  cursor: number,
): NextLineTargets {
  const lines = referenceLines(draft, cursor);
  const scheme = detectScheme(lines);
  const lang = detectLang(lines.join(" ") || draft);

  let rhymeWith: string | undefined;
  if (scheme === "AABB" && lines.length >= 1) {
    rhymeWith = lastWordOf(lines[lines.length - 1]) || undefined;
  } else if (scheme === "ABAB" && lines.length >= 2) {
    rhymeWith = lastWordOf(lines[lines.length - 2]) || undefined;
  }

  let syllables: [number, number] | undefined;
  if (lines.length >= 1) {
    const count = countSyllablesFor(lang)(lines[lines.length - 1]);
    if (count > 0) syllables = [Math.max(1, count - 2), count + 2];
  }

  return { rhymeWith, syllables, scheme };
}

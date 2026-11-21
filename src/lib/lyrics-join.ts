// Smart join for inserting an AI-generated lyric completion right after the
// text the writer already typed (#102: "could not" + "say" was inserted
// verbatim as "could notsay to you"). smartJoinCompletion() is the single
// place that decides whether a space belongs between the typed prefix and
// the model's suggestion before either one is shown (ghost text) or
// committed to the draft (Tab / accept) — see LyricsAiOverlay.tsx and
// scripts/lyrics-eval/checks.ts's joinCompletion(), both of which delegate
// here so the preview a writer sees always matches what gets inserted.
//
// Rules, applied in order (first match wins):
//  1. Empty suggestion -> no-op (return it unchanged, nothing to insert).
//  2. Empty prefix (start of line/doc) -> never add a leading space.
//  3. The prefix already ends in whitespace, or the suggestion already
//     starts with whitespace -> don't add another one. We only ever ADD a
//     missing space; we never strip whitespace the user or model typed, so
//     this never produces a double space.
//  4. The suggestion starts with closing punctuation (. , ! ? ; : ) ] } ' "
//     ” ’ … or a hyphen) -> no space ("love" + ", baby" stays "love, baby").
//  5. The prefix ends in opening punctuation ( [ { " ' or a hyphen/maqaf
//     (־) -> no space (a hyphenated compound or an opening bracket/quote is
//     always tight against what follows it).
//  6. The prefix ends in sentence punctuation . , ! ? ; : -> add a space
//     before the next word.
//  7. Latin mid-word completion: completion mode is only picked when the
//     cursor follows a letter (pickInlineMode in lyrics-ai.ts), so the
//     model may be continuing a partial word ("to" + "morrow") or starting
//     a new one after a finished word ("could not" + "say"). We tell these
//     apart with the local English dictionary (src/lib/prosody/en.ts):
//     join the prefix's trailing letter-run with the suggestion's leading
//     letter-run ("to" + "morrow" -> "tomorrow") and check
//     isKnownEnglishWord() on the result. A known word means the model was
//     finishing that word -> glue, no space. Otherwise -> add a space.
//     Until loadEnglishDict() resolves, isKnownEnglishWord() always
//     returns false, so this conservatively adds a space for every such
//     boundary rather than risk re-gluing two real words — the dictionary
//     lookup is what lets "to"+"morrow" stay glued; without it we fall
//     back to the safer (if occasionally over-eager) default.
//     Known limitation: a prefix fragment + suggestion token that
//     *happens* to spell a different real word (e.g. "a" + "part" ->
//     "apart") will be glued even though the model likely meant two
//     separate words. This is a heuristic, not a parser.
//  8. Hebrew: Hebrew has no dictionary here, and mid-word completions are
//     rare in practice, so two adjacent Hebrew letters/niqqud always get a
//     space ("חושב על כל הדברים שלא" + "נאמרו" -> a space). A prefix ending
//     in a final-form letter (ך ם ן ף ץ) unambiguously means the word is
//     already complete, which is consistent with — not an exception to —
//     this default.
//  9. Anything else (mixed Hebrew/Latin scripts, digits, emoji, ...) ->
//     add a space, the same conservative default as the dictionary-miss
//     case above.
import { isKnownEnglishWord } from "./prosody/en";

const OPENING_PUNCT_RE = /[([{"'“‘\-־]$/;
const SENTENCE_PUNCT_RE = /[.,!?;:]$/;
const CLOSING_PUNCT_RE = /^[)\]}.,!?;:'"”’…-]/;

const LATIN_LETTER_END_RE = /[A-Za-z]$/;
const LATIN_LETTER_START_RE = /^[A-Za-z]/;
const LATIN_FRAGMENT_END_RE = /[A-Za-z']+$/;
const LATIN_TOKEN_START_RE = /^[A-Za-z']+/;

// Hebrew letters (U+05D0-U+05EA) plus niqqud/cantillation combining marks
// (U+0591-U+05BD, U+05BF, U+05C1, U+05C2, U+05C4-U+05C5, U+05C7), so a
// prefix/suggestion boundary sitting right after a vowel point is still
// recognized as Hebrew. ASCII \u escapes, like checks.ts's HEBREW_RE, so
// this can't be mangled by source-encoding normalization.
const HEBREW_RE =
  // eslint-disable-next-line no-misleading-character-class -- niqqud combine with letters; this range covers both on purpose
  /[\u05D0-\u05EA\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C5\u05C7]/;

function trailingLatinFragment(prefix: string): string {
  return LATIN_FRAGMENT_END_RE.exec(prefix)?.[0] ?? "";
}

function leadingLatinToken(suggestion: string): string {
  return LATIN_TOKEN_START_RE.exec(suggestion)?.[0] ?? "";
}

export function smartJoinCompletion(
  prefix: string,
  suggestion: string,
): string {
  if (!suggestion) return suggestion;
  if (!prefix) return suggestion;

  if (/\s$/.test(prefix) || /^\s/.test(suggestion)) return suggestion;
  if (CLOSING_PUNCT_RE.test(suggestion)) return suggestion;
  if (OPENING_PUNCT_RE.test(prefix)) return suggestion;
  if (SENTENCE_PUNCT_RE.test(prefix)) return ` ${suggestion}`;

  if (
    LATIN_LETTER_END_RE.test(prefix) &&
    LATIN_LETTER_START_RE.test(suggestion)
  ) {
    const combined = (
      trailingLatinFragment(prefix) + leadingLatinToken(suggestion)
    ).toLowerCase();
    return isKnownEnglishWord(combined) ? suggestion : ` ${suggestion}`;
  }

  if (
    HEBREW_RE.test(prefix.slice(-1)) &&
    HEBREW_RE.test(suggestion.slice(0, 1))
  ) {
    // Rule 8: no dictionary for Hebrew, so two adjacent Hebrew letters
    // always get a space, final-form or not.
    return ` ${suggestion}`;
  }

  // Rule 9: mixed scripts, or anything else none of the above caught —
  // the same conservative default.
  return ` ${suggestion}`;
}

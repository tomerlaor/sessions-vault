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
//  3. The prefix already ends in whitespace -> the separation already
//     exists, so strip any leading spaces/tabs (not newlines — a lyric
//     line break is meaningful and never collapsed) the model put on the
//     suggestion, so "not " + " say" doesn't become "not  say". Otherwise,
//     if the suggestion itself already starts with whitespace -> leave it
//     untouched; it already supplies the separation. Either way we only
//     ever ADD or trim a space at this boundary, never touch whitespace
//     that isn't adjacent to it.
//  4. Quotes/apostrophes (straight or curly: ' " ‘ ’ “ ”): the prefix
//     ending in one of these is ambiguous on its own, so we look at what's
//     immediately before it. Preceded by whitespace or start-of-string ->
//     it's an opening quote -> glue, no space ("said '" + "hello'" ->
//     "said 'hello'"). Preceded by a letter -> it's closing punctuation or
//     a possessive/contraction apostrophe. For ' and ’ specifically, a
//     contraction suffix right after (t, s, ll, re, ve, d, m, with nothing
//     else letter-like trailing it) means the model is finishing a
//     contraction -> glue ("don'" + "t" -> "don't"). Anything else in this
//     position -> space, which is right for both a closing double quote
//     ("said "hello"" + "Then" -> space) and a possessive apostrophe
//     ("boys'" + "toys" -> "boys' toys").
//  5. The suggestion starts with closing punctuation (. , ! ? ; : ) ] } '
//     " ” ’ … or a dash) -> no space ("love" + ", baby" stays "love, baby",
//     "love" + "—forever" stays "love—forever"). This is about what the
//     *suggestion* opens with, so it's independent of rule 4 above (which
//     only looks at the prefix).
//  6. Dashes (- – — and the Hebrew maqaf ־): a dash directly after a letter
//     with no space is a compound ("love-" + "forever" -> "love-forever",
//     "love—" + "forever" -> "love—forever", "תל־" + "אביב" ->
//     "תל־אביב"); the same dash with a space before it is being used as a
//     separator, so it gets a space after too ("love —" + "forever" ->
//     "love — forever").
//  7. The prefix ends in an opening bracket ( [ { -> no space (always tight
//     against what follows it).
//  8. The prefix ends in sentence punctuation . , ! ? ; : -> add a space
//     before the next word.
//  9. Hebrew. Checked before rule 10 because Hebrew letters also satisfy
//     \p{L} and would otherwise fall into the dictionary-based rule below,
//     which has no Hebrew entries and would always default to a space.
//     There's no dictionary here, so this is a set of heuristics, in order:
//       a. The prefix's trailing run of Hebrew letters (niqqud allowed) is
//          exactly one letter, and it's one of the inseparable
//          prefixes/conjunctions ו ב כ ל מ ש ה, and it's preceded by
//          whitespace or start-of-string -> it's a prefix glued onto the
//          next word by definition -> glue ("ו" + "אהבה" -> "ואהבה", "אני
//          ו" + "את" -> "אני ואת").
//       b. The suggestion's leading Hebrew letter is a final form (ך ם ן ף
//          ץ) -> a final form can only end a word, so the suggestion must
//          be completing the one the prefix started -> glue ("שָׁלוֹ" + "ם"
//          -> "שלום").
//       c. The prefix's trailing Hebrew run is 2+ letters and its last
//          letter is a non-final form of a letter that has a final form
//          (כ מ נ פ צ) -> Hebrew words can't end on those non-final forms,
//          so the word must still be unfinished -> glue.
//       d. Otherwise -> space. This is deliberately the common case: most
//          Hebrew-Hebrew boundaries are between two finished words, and a
//          wrong guess here is visible and cheap to reject in the ghost
//          preview before it's committed.
//     Limits: this is letter-shape heuristics, not a dictionary, so a
//     prefix ending in a letter that doesn't have a final form (e.g. ר, ל)
//     always falls through to (d) regardless of whether the word is
//     actually finished — there's no way to tell without a wordlist.
// 10. Latin (or any other non-Hebrew script) mid-word completion: this
//     branch is reached whenever the prefix ends in a Unicode letter/mark
//     (\p{L}/\p{M} — not just ASCII, so "café" + "s" is recognized as a
//     letter-letter boundary too) and the suggestion starts with one.
//     pickInlineMode in lyrics-ai.ts picks completion mode whenever
//     next_word is disabled, or whenever the cursor doesn't follow
//     whitespace — not "only when the cursor follows a letter": the
//     character right behind the cursor can just as easily be punctuation,
//     a digit, or anything else non-blank. So this branch covers both a
//     partial word ("tomor" + "row") and a finished one followed by a new
//     one ("could not" + "say", "so" + "me"). We tell
//     these apart with the local English dictionary (src/lib/prosody/en.ts),
//     checking the prefix's trailing letter-run (the "fragment") FIRST: if
//     the fragment is ITSELF a known word (isKnownEnglishWord(fragment))
//     the writer already finished typing it, so the suggestion starts a
//     new word -> add a space ("so" + "me" -> "so me", "in" + "to" -> "in
//     to", "for" + "ever" -> "for ever", "be" + "cause" -> "be cause", "no"
//     + "thing" -> "no thing", "a" + "live" -> "a live"). This is the
//     common case — by far most of what a writer types right before a
//     suggestion lands is a complete word — and the ghost-text preview
//     always shows the result before it's committed, so a wrong guess here
//     is visible and cheap to reject with a keystroke. Only when the
//     fragment is NOT a known word do we fall through to the old check:
//     join the fragment with the suggestion's leading letter-run ("tomor" +
//     "row" -> "tomorrow") and check isKnownEnglishWord() on THAT. A known
//     word there means the model was finishing a word the fragment only
//     started -> glue, no space. Otherwise -> add a space. Single-letter
//     fragments like "a" or "I" are themselves known words, so they get a
//     space too ("a" + "part" -> "a part"), which is almost always what's
//     meant since a lone "a"/"I" is essentially never a word-in-progress.
//     The dictionary itself only knows English, and isKnownEnglishWord's
//     normalizeWord *deletes* non-ASCII letters rather than transliterating
//     them, so an accented fragment only glues when the accent is a purely
//     decorative extra letter the real spelling doesn't need — "understané"
//     + "ding" normalizes (dropping the "é") to "understanding", a real
//     word, so it glues. When the accent stands in for a needed plain
//     letter, deleting it breaks the reconstruction instead of fixing it:
//     "café" + "s" normalizes to "cafs", not "cafes", so neither the
//     fragment nor the combined form is a known word and this falls
//     through to the space default. Accepted trade-off: a
//     genuine mid-word continuation of a string that also happens to be a
//     complete word on its own still gets a space ("to" + "morrow" -> "to
//     morrow", "I wan" + "na" -> "I wan na") — rarer than the common case
//     above, and still visible/correctable in the ghost preview before
//     it's committed. Until loadEnglishDict() resolves, isKnownEnglishWord()
//     always returns false for both checks, so this conservatively adds a
//     space for every such boundary rather than risk gluing two real words
//     together. A proper fix needs a prompt-side rule where the model
//     restates the partial word it's completing and the app replaces that
//     restated fragment rather than appending after it — tracked as a
//     follow-up issue, since it needs prompt changes, not just this join
//     heuristic.
// 11. Anything else (mixed Hebrew/Latin scripts, digits, emoji, ...) -> add
//     a space, the same conservative default as the dictionary-miss case
//     above.
import { isKnownEnglishWord } from "./prosody/en";

const OPENING_BRACKET_RE = /[([{]$/;
const SENTENCE_PUNCT_RE = /[.,!?;:]$/;
const CLOSING_PUNCT_RE = /^[)\]}.,!?;:'"”’…\-–—]/;

const WORD_LETTER_END_RE = /[\p{L}\p{M}]$/u;
const WORD_LETTER_START_RE = /^[\p{L}\p{M}]/u;
const WORD_FRAGMENT_END_RE = /[\p{L}\p{M}']+$/u;
const WORD_TOKEN_START_RE = /^[\p{L}\p{M}']+/u;

const QUOTE_CHAR_RE = /['"‘’“”]$/;
const APOSTROPHE_CHARS = new Set(["'", "’"]);
const CONTRACTION_SUFFIX_RE = /^(?:t|s|ll|re|ve|d|m)(?![a-zA-Z])/i;

const DASH_CHAR_RE = /[-–—־]$/;

// Hebrew letters (U+05D0-U+05EA) plus niqqud/cantillation combining marks
// (U+0591-U+05BD, U+05BF, U+05C1, U+05C2, U+05C4-U+05C5, U+05C7), so a
// prefix/suggestion boundary sitting right after a vowel point is still
// recognized as Hebrew. ASCII \u escapes, like checks.ts's HEBREW_RE, so
// this can't be mangled by source-encoding normalization.
const HEBREW_RE =
  // eslint-disable-next-line no-misleading-character-class -- niqqud combine with letters; this range covers both on purpose
  /[\u05D0-\u05EA\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C5\u05C7]/;
const HEBREW_TRAILING_RUN_RE =
  // eslint-disable-next-line no-misleading-character-class -- see HEBREW_RE
  /[\u05D0-\u05EA\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C5\u05C7]+$/;
const HEBREW_LEADING_RUN_RE =
  // eslint-disable-next-line no-misleading-character-class -- see HEBREW_RE
  /^[\u05D0-\u05EA\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C5\u05C7]+/;
const HEBREW_NIQQUD_GLOBAL_RE =
  /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C5\u05C7]/g;

// ו ב כ ל מ ש ה — the inseparable prefixes/conjunctions (and, in, as/like,
// to/for, from, that, the).
const HEBREW_PREFIX_CONJUNCTIONS = new Set(["ו", "ב", "כ", "ל", "מ", "ש", "ה"]);
// ך ם ן ף ץ — final forms, which can only end a word.
const HEBREW_FINAL_FORMS = new Set(["ך", "ם", "ן", "ף", "ץ"]);
// כ מ נ פ צ — the non-final forms of the letters above; Hebrew words never
// end on one of these, so seeing one at the end of a run means more letters
// are still coming.
const HEBREW_NON_FINAL_WITH_FINAL_FORM = new Set(["כ", "מ", "נ", "פ", "צ"]);

function trailingWordFragment(prefix: string): string {
  return WORD_FRAGMENT_END_RE.exec(prefix)?.[0] ?? "";
}

function leadingWordToken(suggestion: string): string {
  return WORD_TOKEN_START_RE.exec(suggestion)?.[0] ?? "";
}

function stripLeadingSpacesAndTabs(suggestion: string): string {
  return suggestion.replace(/^[ \t]+/, "");
}

// Rule 4: decide whether a quote/apostrophe at the end of the prefix opens
// something (glue) or closes/possesses something (space, unless it reads as
// a contraction in progress).
function joinAtQuote(prefix: string, suggestion: string): string {
  const before = prefix.slice(0, -1);
  const isOpening = before.length === 0 || /\s$/.test(before);
  if (isOpening) return suggestion;

  const quoteChar = prefix.slice(-1);
  if (
    APOSTROPHE_CHARS.has(quoteChar) &&
    CONTRACTION_SUFFIX_RE.test(suggestion)
  ) {
    return suggestion;
  }
  return ` ${suggestion}`;
}

// Rule 6: a dash directly after a letter is a compound (glue); the same
// dash after a space is a separator (space after too).
function joinAtDash(prefix: string, suggestion: string): string {
  const before = prefix.slice(0, -1);
  const isCompound = before.length > 0 && !/\s$/.test(before);
  return isCompound ? suggestion : ` ${suggestion}`;
}

// Rule 9: Hebrew. See the header comment for the heuristics and their
// documented limits.
function joinHebrew(prefix: string, suggestion: string): string {
  const run = HEBREW_TRAILING_RUN_RE.exec(prefix)?.[0] ?? "";
  const baseLetters = run.replace(HEBREW_NIQQUD_GLOBAL_RE, "");
  const runStart = prefix.length - run.length;
  const precededByWhitespaceOrStart =
    runStart === 0 || /\s/.test(prefix[runStart - 1]);

  if (
    baseLetters.length === 1 &&
    HEBREW_PREFIX_CONJUNCTIONS.has(baseLetters) &&
    precededByWhitespaceOrStart
  ) {
    return suggestion;
  }

  const suggestionRun = HEBREW_LEADING_RUN_RE.exec(suggestion)?.[0] ?? "";
  const suggestionBaseLetters = suggestionRun.replace(
    HEBREW_NIQQUD_GLOBAL_RE,
    "",
  );
  if (
    suggestionBaseLetters.length > 0 &&
    HEBREW_FINAL_FORMS.has(suggestionBaseLetters[0])
  ) {
    return suggestion;
  }

  if (
    baseLetters.length >= 2 &&
    HEBREW_NON_FINAL_WITH_FINAL_FORM.has(baseLetters[baseLetters.length - 1])
  ) {
    return suggestion;
  }

  return ` ${suggestion}`;
}

export function smartJoinCompletion(
  prefix: string,
  suggestion: string,
): string {
  if (!suggestion) return suggestion;
  if (!prefix) return suggestion;

  if (/\s$/.test(prefix)) return stripLeadingSpacesAndTabs(suggestion);
  if (/^\s/.test(suggestion)) return suggestion;

  if (QUOTE_CHAR_RE.test(prefix)) return joinAtQuote(prefix, suggestion);
  if (CLOSING_PUNCT_RE.test(suggestion)) return suggestion;
  if (DASH_CHAR_RE.test(prefix)) return joinAtDash(prefix, suggestion);
  if (OPENING_BRACKET_RE.test(prefix)) return suggestion;
  if (SENTENCE_PUNCT_RE.test(prefix)) return ` ${suggestion}`;

  const prefixEndsHebrew = HEBREW_RE.test(prefix.slice(-1));
  const suggestionStartsHebrew = HEBREW_RE.test(suggestion.slice(0, 1));
  if (prefixEndsHebrew && suggestionStartsHebrew) {
    return joinHebrew(prefix, suggestion);
  }

  // Guard against a Hebrew-script boundary falling into the dictionary
  // branch below: isKnownEnglishWord() strips non-ASCII letters before
  // looking a word up, so e.g. "שלום" + "world" would otherwise combine to
  // "שלוםworld", strip down to the real word "world", and wrongly glue.
  if (
    !prefixEndsHebrew &&
    !suggestionStartsHebrew &&
    WORD_LETTER_END_RE.test(prefix) &&
    WORD_LETTER_START_RE.test(suggestion)
  ) {
    const fragment = trailingWordFragment(prefix).toLowerCase();
    if (isKnownEnglishWord(fragment)) return ` ${suggestion}`;

    const combined = fragment + leadingWordToken(suggestion).toLowerCase();
    return isKnownEnglishWord(combined) ? suggestion : ` ${suggestion}`;
  }

  // Rule 11: mixed scripts, or anything else none of the above caught —
  // the same conservative default.
  return ` ${suggestion}`;
}

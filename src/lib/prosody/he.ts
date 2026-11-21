// Hebrew syllable counting and rhyme detection — heuristic, not a real
// grammar. There is no Hebrew equivalent of CMUdict freely available, so
// this module works from the written letters (and niqud, when present)
// using standard rules of thumb rather than true phonemic analysis.
//
// Syllables (pointed text): each niqud vowel point is a syllable nucleus,
// except:
//   - dagesh/mapiq, rafe, shin/sin dots, and meteg are never nuclei (they
//     mark gemination/consonant-quality/cantillation, not vowels).
//   - sheva (ְ) is ambiguous between "na" (voiced, a nucleus) and
//     "nach" (silent). We use the standard rule of thumb: a word-initial
//     sheva is always na; of two consecutive shevas the first is nach and
//     the second is na; any other sheva is treated as nach. This is a
//     simplification — real sheva-na/nach depends on syllable structure we
//     don't model — but it matches common cases (e.g. וְ־ prefixes).
//   - a vav carrying only a dagesh (no other vowel point) is read as shuruk
//     (the vowel "u"), not a doubled consonant.
// Syllables (unpointed text): there's no reliable algorithm without niqud.
// We approximate with round(letterCount / 2), which tracks typical CV
// Hebrew syllable shape closely enough for line-length comparison. Real
// counts can still differ, especially for loanwords and very short words.
//
// Rhyme: rhymeKey strips niqud and prefixes/suffixes down to the final
// letters, with a small table of common Hebrew endings (plural ים/ות,
// possessive/verb endings תי/נו, the ה/ך suffixes, etc.) so that two words
// sharing a meaningful ending rhyme even when their roots don't share any
// sound (e.g. תפילה / לילה). This is intentionally generous — it will call
// many unrelated ה-final words "slant" rhymes — and it never consults
// niqud for the vowel quality (a documented limitation: a future Hebrew
// G2P/niqud-aware model would do better here; see HOOK below).
//
// HOOK for a future, real Hebrew G2P / niqud model: swap the body of
// countSyllables/rhymeKey/rhymes for calls into that model. Keep the
// signatures the same so src/lib/prosody/index.ts doesn't need to change.

const HEBREW_LETTER_RE = /[א-ת]/;
const HEBREW_LETTER_G = /[א-ת]/g;
const CANTILLATION_RE = /[֑-֯]/;
const VAV = "ו";
const SHEVA = "ְ";
const DAGESH = "ּ";
const VOWEL_MARKS = new Set([
  "ֱ", // hataf segol
  "ֲ", // hataf patah
  "ֳ", // hataf qamats
  "ִ", // hiriq
  "ֵ", // tsere
  "ֶ", // segol
  "ַ", // patah
  "ָ", // qamats
  "ֹ", // holam
  "ֺ", // holam haser for vav
  "ֻ", // qubuts
  "ׇ", // qamats qatan
]);

function hasNiqud(word: string): boolean {
  for (const ch of word) {
    if (VOWEL_MARKS.has(ch) || ch === SHEVA) return true;
  }
  return false;
}

interface LetterGroup {
  letter: string;
  marks: string[];
}

// Groups each base Hebrew letter with the combining marks that follow it,
// dropping cantillation marks entirely (they carry no syllable information
// here).
function groupLetters(word: string): LetterGroup[] {
  const groups: LetterGroup[] = [];
  for (const ch of word) {
    if (CANTILLATION_RE.test(ch)) continue;
    if (HEBREW_LETTER_RE.test(ch)) {
      groups.push({ letter: ch, marks: [] });
    } else if (groups.length > 0) {
      groups[groups.length - 1].marks.push(ch);
    }
  }
  return groups;
}

function countPointedSyllables(word: string): number {
  const groups = groupLetters(word);
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    const { letter, marks } = groups[i];
    if (marks.some((m) => VOWEL_MARKS.has(m))) {
      count++;
      continue;
    }
    if (marks.includes(SHEVA)) {
      const isWordInitial = i === 0;
      const prev = groups[i - 1];
      const prevIsBareSheva =
        !!prev &&
        prev.marks.includes(SHEVA) &&
        !prev.marks.some((m) => VOWEL_MARKS.has(m));
      if (isWordInitial || prevIsBareSheva) count++; // sheva na
      continue; // else sheva nach — silent
    }
    if (letter === VAV && marks.includes(DAGESH)) {
      count++; // shuruk: vav + dagesh, no other vowel point
    }
  }
  return Math.max(1, count);
}

// Unpointed text: without niqud there is no reliable nucleus count, but a
// flat letters/2 estimate is worse than it needs to be — it ignores matres
// lectionis (ו/י marking a vowel rather than a consonant) entirely, so
// words written with vowel letters (ktiv male) and words written without
// them (ktiv chaser) get the same per-letter rate even though the first
// kind needs fewer syllables per letter than the second. We approximate
// instead by:
//   1. a lookup table of common one-syllable function words/prefixes,
//      which are short and frequent enough that a general rule tends to
//      miscount them (e.g. "של" is one syllable, not the two a flat
//      per-letter count would give it);
//   2. stripping a recognized final suffix (plural ים/ות, the dual/pair
//      ending יים, or a possessive/verb ending like תי/נו/כם) and scoring
//      it at its own fixed syllable count, then estimating the stem
//      separately — this is the single biggest source of improvement,
//      since these endings are extremely common in sung Hebrew and have a
//      predictable syllable count regardless of the root;
//   3. for what's left, treating every letter as a syllable nucleus
//      except the ones that are almost always silent vowel markers
//      (a mater ו/י that isn't word-initial, a doubled וו/יי pair that
//      counts once, or a final א/ה) — and only then, when the stem has no
//      such marker at all (fully consonantal, "ktiv chaser" spelling),
//      folding the last letter in as the coda of the preceding syllable
//      rather than a nucleus of its own, since an all-consonant stem is
//      exactly the case the old flat estimate undercounted.
// Real counts can still differ — a mater letter is sometimes a genuine
// glide consonant rather than a silent vowel marker (e.g. the "י" in
// "עין" starts its own syllable, "a-yin") — see he-syllables.test.ts for
// where this still misses by one; pointed text still uses niqud.
const ONE_SYLLABLE_WORDS = new Set([
  "של",
  "על",
  "אל",
  "עם",
  "גם",
  "רק",
  "כל",
  "לא",
  "מה",
  "זה",
  "זו",
  "הוא",
  "היא",
  "את",
  "עד",
  "אם",
  "או",
  "כי",
  "פה",
  "שם",
  "אז",
  "לו",
  "בו",
  "בה",
  "לה",
  "בי",
  "לי",
  "כן",
  "פן",
  "יש",
  "אין",
  "עוד",
  "כך",
  "פה",
]);

// Longest-match-first; each entry is [suffix letters, syllables it adds].
// The dual/pair ending (עיניים, ידיים, רגליים) is two syllables; the
// ordinary plural/possessive endings are one.
const SYLLABLE_SUFFIXES: [string, number][] = [
  ["יים", 2],
  ["ים", 1],
  ["ות", 1],
  ["תי", 1],
  ["נו", 1],
  ["כם", 1],
  ["כן", 1],
  ["הם", 1],
  ["הן", 1],
  ["תם", 1],
  ["תן", 1],
  ["ני", 1],
  ["נה", 1],
];

function isLoneMater(letters: string[], i: number): boolean {
  const ch = letters[i];
  return (ch === VAV || ch === "י") && i > 0 && letters[i - 1] !== ch;
}

function isDoubledMaterPair(letters: string[], i: number): boolean {
  const ch = letters[i];
  return (ch === VAV || ch === "י") && i > 0 && letters[i - 1] === ch;
}

// Estimates a stem (a word, or a word with a recognized suffix already
// stripped off) that carries no niqud.
function estimateStemSyllables(letters: string[]): number {
  const n = letters.length;
  if (n === 0) return 0;
  if (n === 1) return 1;

  let materDiscount = 0;
  for (let i = 0; i < n; i++) {
    if (isDoubledMaterPair(letters, i)) {
      materDiscount++; // the pair (וו/יי) is one nucleus, not two
    } else if (isLoneMater(letters, i)) {
      materDiscount++;
    } else if (i === n - 1 && (letters[i] === "א" || letters[i] === "ה")) {
      materDiscount++; // trailing silent aleph/heh
    }
  }

  let nuclei = n - materDiscount;
  // One of the remaining letters is almost always a closing coda rather
  // than its own nucleus — e.g. "בחדר" ("ba-che-der", 3 syllables from 4
  // consonant letters) or "חוזר" ("cho-zer", 2 syllables from 3 letters
  // left after its one mater). That correction only holds once there are
  // enough letters left to have a coda in the first place: a stem with no
  // mater needs at least two letters left (so a single CV word like "יד"
  // isn't folded down to zero), and a stem that already spent exactly one
  // letter on a mater needs at least three (so "עין" — one mater, two
  // letters left, both still real nuclei, "a-yin" — isn't over-folded).
  // Two or more matres already account for enough of the word's vowels
  // that a further coda correction tends to overcorrect (see
  // he-syllables.test.ts).
  if (materDiscount === 0 && nuclei >= 2) {
    nuclei -= 1;
  } else if (materDiscount === 1 && nuclei >= 3) {
    nuclei -= 1;
  }
  return Math.max(1, nuclei);
}

function countUnpointedSyllables(word: string): number {
  const letters = word.match(HEBREW_LETTER_G) ?? [];
  const bare = letters.join("");
  if (letters.length === 0) return 0;
  if (ONE_SYLLABLE_WORDS.has(bare)) return 1;

  for (const [suffix, syllables] of SYLLABLE_SUFFIXES) {
    if (bare.length > suffix.length && bare.endsWith(suffix)) {
      const stem = bare.slice(0, -suffix.length).split("");
      return estimateStemSyllables(stem) + syllables;
    }
  }

  return estimateStemSyllables(letters);
}

function countSyllablesWord(word: string): number {
  const bare = word.match(HEBREW_LETTER_G);
  if (!bare) return 0;
  return hasNiqud(word)
    ? countPointedSyllables(word)
    : countUnpointedSyllables(word);
}

export function countSyllables(wordOrLine: string): number {
  const words = wordOrLine.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return words.reduce((sum, w) => sum + countSyllablesWord(w), 0);
}

function bareLetters(word: string): string {
  return (word.match(HEBREW_LETTER_G) ?? []).join("");
}

// Longest-match-first table of common Hebrew endings — plural/possessive
// suffixes mostly. A word ending in one of these rhymes with any other word
// sharing the same ending, regardless of its root.
const SUFFIXES = [
  "ים",
  "ות",
  "תי",
  "נו",
  "כם",
  "כן",
  "הם",
  "הן",
  "תם",
  "תן",
  "ני",
  "נה",
].sort((a, b) => b.length - a.length);

const WEAK_SINGLE_SUFFIXES = new Set(["ה", "ך", "ם", "ן"]); // ה ך ם ן

export function rhymeKey(word: string): string {
  const bare = bareLetters(word);
  if (!bare) return "";
  for (const suffix of SUFFIXES) {
    if (bare.endsWith(suffix)) return suffix;
  }
  return bare.length >= 2 ? bare.slice(-2) : bare;
}

export function rhymes(a: string, b: string): "perfect" | "slant" | "none" {
  const bareA = bareLetters(a);
  const bareB = bareLetters(b);
  if (!bareA || !bareB) return "none";
  if (bareA === bareB) return "perfect";

  const keyA = rhymeKey(a);
  const keyB = rhymeKey(b);
  if (keyA === keyB) return "perfect";

  const lastA = bareA.slice(-1);
  const lastB = bareB.slice(-1);
  if (lastA === lastB && WEAK_SINGLE_SUFFIXES.has(lastA)) return "slant";
  if (lastA === lastB) return "slant";
  return "none";
}

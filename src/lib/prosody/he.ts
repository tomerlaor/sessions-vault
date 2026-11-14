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

// Unpointed text: without niqud there is no reliable nucleus count.
// Counting every letter (or every mater) overcounts badly (the same
// four-word line the pointed path scores at ~10 became 15). A simple
// letters/2 estimate tracks typical CV Hebrew syllable shape closely
// enough for line-length comparison; pointed text still uses niqud.
function countUnpointedSyllables(word: string): number {
  const letters = word.match(HEBREW_LETTER_G) ?? [];
  if (letters.length === 0) return 0;
  return Math.max(1, Math.round(letters.length / 2));
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

// English syllable counting and rhyme detection.
//
// Dictionary-backed via a compact subset of the CMU Pronouncing Dictionary
// (public domain, Carnegie Mellon University) — see ./data/NOTICE.md for
// provenance and ./data/en-dict.txt for the encoded format. The dictionary
// is loaded lazily (dynamic `?raw` import) so it never lands in the app's
// startup bundle. Before it's loaded, or for a word that isn't in it, every
// function below falls back to an orthographic heuristic.

interface DictEntry {
  syllables: number;
  // ARPAbet phonemes from the last primary-stressed vowel onward (or the
  // last vowel if none carries primary stress) — the "rhyme key".
  tail: string[];
}

const RESERVED_CODE_CHARS = new Set(["|", "\\", '"', "'"]);

function buildCodeAlphabet(count: number): string[] {
  const chars: string[] = [];
  for (let c = 33; chars.length < count; c++) {
    const ch = String.fromCharCode(c);
    if (RESERVED_CODE_CHARS.has(ch)) continue;
    chars.push(ch);
  }
  return chars;
}

function parseDict(raw: string): Map<string, DictEntry> {
  const newlineIdx = raw.indexOf("\n");
  const phonemes = raw.slice(0, newlineIdx).split(",");
  const codeChars = buildCodeAlphabet(phonemes.length);
  const phonemeOfCode = new Map<string, string>();
  codeChars.forEach((ch, i) => phonemeOfCode.set(ch, phonemes[i]));

  const map = new Map<string, DictEntry>();
  const lines = raw.slice(newlineIdx + 1).split("\n");
  for (const line of lines) {
    if (!line) continue;
    const sep1 = line.indexOf("|");
    const sep2 = line.indexOf("|", sep1 + 1);
    const word = line.slice(0, sep1);
    const syllables = Number(line.slice(sep1 + 1, sep2));
    const code = line.slice(sep2 + 1);
    const tail: string[] = [];
    for (const ch of code) {
      const ph = phonemeOfCode.get(ch);
      if (ph) tail.push(ph);
    }
    map.set(word, { syllables, tail });
  }
  return map;
}

let dict: Map<string, DictEntry> | null = null;
let loadPromise: Promise<void> | null = null;

async function loadDictRaw(): Promise<string> {
  // Vite and Vitest understand the `?raw` suffix and code-split this into
  // its own async chunk. The eval CLI (plain `tsx`) does not, so fall back
  // to a filesystem read. `import.meta.env` is defined in Vite/Vitest and
  // missing under tsx (same pattern as the #86 lyrics-privacy fix).
  if (typeof import.meta.env !== "undefined") {
    const mod = (await import("./data/en-dict.txt?raw")) as { default: string };
    return mod.default;
  }
  // String-variable import() so `tsc` (no @types/node in this package)
  // doesn't try to resolve the Node builtins. Vite never takes this
  // branch (`import.meta.env` is defined there) and the @vite-ignore
  // comments keep the client bundle from pulling `node:` modules in.
  const fsSpec = "node:fs/promises";
  const urlSpec = "node:url";
  const pathSpec = "node:path";
  const { readFile } = (await import(/* @vite-ignore */ fsSpec)) as {
    readFile: (path: string, enc: "utf8") => Promise<string>;
  };
  const { fileURLToPath } = (await import(/* @vite-ignore */ urlSpec)) as {
    fileURLToPath: (url: string | URL) => string;
  };
  const { dirname, join } = (await import(/* @vite-ignore */ pathSpec)) as {
    dirname: (path: string) => string;
    join: (...parts: string[]) => string;
  };
  const dir = dirname(fileURLToPath(import.meta.url));
  return readFile(join(dir, "data/en-dict.txt"), "utf8");
}

// Dynamic import so bundlers code-split the dictionary into its own async
// chunk — never statically import this module's data from elsewhere.
export function loadEnglishDict(): Promise<void> {
  if (dict) return Promise.resolve();
  loadPromise ??= loadDictRaw().then((raw) => {
    dict = parseDict(raw);
  });
  return loadPromise;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']+/g, "");
}

// Heuristic fallback syllable count for a single out-of-dictionary word:
// vowel-letter groups, with silent trailing "e" and "'s"/"-ed"/-es" endings
// that shouldn't add their own syllable.
function heuristicSyllablesWord(word: string): number {
  const w = normalizeWord(word).replace(/'/g, "");
  if (!w) return 0;

  // Possessive/plural "'s" was already stripped by the apostrophe removal
  // above; an "s" left over from "...'s" doesn't add a syllable on its own,
  // so nothing extra to do there. Handle silent "-e", "-es", "-ed" below.
  const groups = w.match(/[aeiouy]+/g) ?? [];
  let count = groups.length;

  if (count > 1) {
    if (/[^aeiouy]ed$/.test(w) && !/[td]ed$/.test(w)) {
      count--; // "smelled", "walked" — not "wanted", "landed"
    } else if (
      /[^aeiouy]es$/.test(w) &&
      !/[sxz]es$/.test(w) &&
      !/ches$|shes$/.test(w)
    ) {
      count--; // "days" isn't -es, but e.g. "makes" → "mak" + silent e + s
    } else if (w.endsWith("e") && !w.endsWith("le")) {
      count--; // silent trailing "e" ("name", "like"), but keep "-le" ("little")
    }
  }

  return Math.max(1, count);
}

// Rough rhyme key fallback for an out-of-dictionary word: trailing vowel run
// plus whatever consonants follow it, from the letters only.
// Returns "<vowel-run> <trailing-consonants>" (two space-separated tokens,
// matching the dict's "<nucleus> <coda...>" shape) so nucleusBase()/coda()
// below can compare dict-backed and fallback keys the same way.
function heuristicRhymeKey(word: string): string {
  const w = normalizeWord(word).replace(/'/g, "");
  if (!w) return "";
  const match = /([aeiouy]+)([^aeiouy]*)$/.exec(w);
  if (!match) return w;
  const [, vowel, consonants] = match;
  return consonants ? `${vowel} ${consonants}` : vowel;
}

function lookupEntry(word: string): DictEntry | null {
  if (!dict) return null;
  const key = normalizeWord(word);
  return dict.get(key) ?? null;
}

export function countSyllables(wordOrLine: string): number {
  const words = wordOrLine.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  return words.reduce((sum, w) => {
    const entry = lookupEntry(w);
    return sum + (entry ? entry.syllables : heuristicSyllablesWord(w));
  }, 0);
}

export function rhymeKey(word: string): string {
  const entry = lookupEntry(word);
  if (entry) return entry.tail.join(" ");
  return heuristicRhymeKey(word);
}

const VOWEL_BASE_RE = /^[A-Z]+/;

function nucleusBase(key: string): string {
  const first = key.split(" ")[0] ?? "";
  return VOWEL_BASE_RE.exec(first)?.[0] ?? first;
}

function coda(key: string): string {
  const parts = key.split(" ");
  return parts.slice(1).join(" ");
}

// Dictionary rhyme keys are ARPAbet (e.g. "AO1 R"); the heuristic fallback
// produces plain letters (e.g. "oor"). Both compare the same way: first
// token is the nucleus, the rest is the coda.
//
// A coda-only match ("consonance", e.g. worm/swarm) only counts toward
// "slant" when the shared coda is an actual cluster (2+ phonemes) — a
// match on a single trailing consonant like "N" or "T" is far too common
// to mean anything (e.g. "one"/"return" both just end in N) and would
// otherwise flood scheme detection with false positives.
export function rhymes(a: string, b: string): "perfect" | "slant" | "none" {
  const entryA = lookupEntry(a);
  const entryB = lookupEntry(b);
  const keyA = entryA ? entryA.tail.join(" ") : heuristicRhymeKey(a);
  const keyB = entryB ? entryB.tail.join(" ") : heuristicRhymeKey(b);

  if (!keyA || !keyB) return "none";
  if (keyA === keyB) return "perfect";

  const codaA = coda(keyA);
  const sameNucleus = nucleusBase(keyA) === nucleusBase(keyB);
  const sameCoda = codaA === coda(keyB) && codaA.split(" ").length >= 2;

  if (sameNucleus && sameCoda) return "perfect";
  if (sameNucleus || sameCoda) return "slant";
  return "none";
}

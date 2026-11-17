// One-off generator for src/lib/prosody/data/en-dict.txt — NOT run as part of
// any build or test step. Re-run manually only if the derived dictionary
// needs to be regenerated:
//
//   npm install --no-save cmu-pronouncing-dictionary
//   node scripts/gen-prosody-dict.mjs
//
// Source data: the CMU Pronouncing Dictionary (cmudict), a public-domain
// pronunciation dictionary created by Carnegie Mellon University. Fetched
// here via the `cmu-pronouncing-dictionary` npm package (ISC License,
// Zeke Sikelianos), which crawls https://github.com/cmusphinx/cmudict — that
// package is a build-time tool only and is never added as a runtime
// dependency; only this derived, compacted subset ships in the app.
//
// Output format (text, one entry per line after a header line):
//   line 1:  comma-separated phoneme alphabet, index == its single-char code
//   line N:  `${word}|${syllableCount}|${encodedTailPhonemes}`
// `encodedTailPhonemes` is the ARPAbet pronunciation from the last
// primary-stressed vowel onward (or the last vowel if none is marked
// primary), each phoneme replaced by its single-char code from the header —
// this is exactly what src/lib/prosody/en.ts calls the word's "rhyme key".
import { dictionary } from "cmu-pronouncing-dictionary";
import { writeFileSync } from "node:fs";

const VOWELS = new Set([
  "AA",
  "AE",
  "AH",
  "AO",
  "AW",
  "AY",
  "EH",
  "ER",
  "EY",
  "IH",
  "IY",
  "OW",
  "OY",
  "UH",
  "UW",
]);

function isVowel(ph) {
  return VOWELS.has(ph.replace(/[012]$/, ""));
}
function stressOf(ph) {
  const m = ph.match(/([012])$/);
  return m ? m[1] : null;
}

// Mirrors the syllable-counting + rhyme-key rules documented in en.ts:
// - syllable count = number of vowel phonemes, except an unstressed ER
//   immediately after another vowel merges into that vowel's syllable
//   (handles fire/desire-style rhotic diphthongs; known false positive on
//   agentive -er words like "higher", documented as a limitation).
// - rhyme key = phonemes from the last stress-1 vowel onward, falling back
//   to the last vowel in the word when none carries primary stress.
function analyze(phonemes) {
  let stressedIdx = -1;
  for (let i = 0; i < phonemes.length; i++) {
    if (isVowel(phonemes[i]) && stressOf(phonemes[i]) === "1") stressedIdx = i;
  }
  let idx = stressedIdx;
  if (idx === -1) {
    for (let i = phonemes.length - 1; i >= 0; i--) {
      if (isVowel(phonemes[i])) {
        idx = i;
        break;
      }
    }
  }
  if (idx === -1) idx = 0;

  let syllables = 0;
  for (let i = 0; i < phonemes.length; i++) {
    if (!isVowel(phonemes[i])) continue;
    const base = phonemes[i].replace(/[012]$/, "");
    const mergesIntoPrev =
      base === "ER" &&
      stressOf(phonemes[i]) === "0" &&
      i > 0 &&
      isVowel(phonemes[i - 1]);
    if (mergesIntoPrev) continue;
    syllables++;
  }

  return { tail: phonemes.slice(idx), syllables: Math.max(1, syllables) };
}

const alphabetSet = new Set();
const records = [];
for (const [key, value] of Object.entries(dictionary)) {
  if (/\(\d+\)$/.test(key)) continue; // alternate-pronunciation variant
  if (!/^'?[a-z]+(?:'[a-z]+)*$/.test(key)) continue; // skip abbrevs/numerals
  const clean = value.replace(/\s*#.*$/, "").trim();
  const phonemes = clean.split(/\s+/);
  const { tail, syllables } = analyze(phonemes);
  tail.forEach((p) => alphabetSet.add(p));
  records.push({ key, syllables, tail });
}

const alphabet = [...alphabetSet].sort();
const chars = [];
for (let c = 33; chars.length < alphabet.length; c++) {
  const ch = String.fromCharCode(c);
  if ("|\\\"'".includes(ch)) continue; // keep the delimiter set unambiguous
  chars.push(ch);
}
const codeOf = new Map(alphabet.map((p, i) => [p, chars[i]]));

const lines = [alphabet.join(",")];
for (const r of records) {
  const code = r.tail.map((p) => codeOf.get(p)).join("");
  lines.push(`${r.key}|${r.syllables}|${code}`);
}

const outPath = new URL("../src/lib/prosody/data/en-dict.txt", import.meta.url);
writeFileSync(outPath, lines.join("\n"));
console.log(`wrote ${records.length} entries to ${outPath.pathname}`);

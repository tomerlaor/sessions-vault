# Data provenance

`en-dict.txt` is derived from the **CMU Pronouncing Dictionary** (cmudict), a
pronunciation dictionary created by Carnegie Mellon University and released
into the public domain:

> The Carnegie Mellon Pronouncing Dictionary, in its current and previous
> versions, is Copyright (C) 1993-2015 by Carnegie Mellon University. Use of
> this dictionary for any research or commercial purpose is completely
> unrestricted.

Source: https://github.com/cmusphinx/cmudict

The dictionary was fetched and filtered using the
[`cmu-pronouncing-dictionary`](https://github.com/words/cmu-pronouncing-dictionary)
npm package (ISC License, © Zeke Sikelianos) — see
`scripts/gen-prosody-dict.mjs` for the exact derivation. That package is a
build-time tool only; it is not a runtime dependency of this app and nothing
from it ships beyond this derived file.

`en-dict.txt` keeps only plain words and simple possessive/contraction forms
(drops numbered alternate pronunciations, abbreviations, and inline
cmudict comments), and keeps only the syllable count and the pronunciation
from the last primary-stressed vowel onward (the "rhyme key") — not each
word's full pronunciation — to minimize the size of this lazily-loaded chunk.
See `en.ts` for the decode format and the derivation rules.

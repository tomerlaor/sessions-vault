# Changelog

## [Unreleased]

## [0.3.0](https://github.com/tomerlaor/sessions-vault/compare/v0.2.0...v0.3.0) (2026-11-28)

### Features

* Add an OpenRouter provider so the lyrics helper and Tab Agent can use OpenRouter models, including decisions models such as typesafe/jev-1.14 (#18, #87).
* Add song-context and next-word mode for the lyrics helper (#20).
* Organize attached mix, master, and export files by project stage (#19).
* Reveal and open project files on Windows and Linux as well as macOS (#24).
* Reduce macOS keychain prompts by storing secrets in a single vault item (#26).
* Write a SHA-256 backup manifest of stage files, and verify and restore those backups (US-008, #70, #71).
* Switch the project page to Project, Lyrics, and Tabs views (#72, #73).
* Show a privacy disclosure and a local/cloud badge for AI features, and require per-feature consent before sending text to a cloud provider (#75, #84, #111).
* Add a local rhyme and syllable engine for the lyrics helper (#77, #98).
* Rewrite the lyrics AI prompts with cursor/section context and explicit rhyme and syllable targets; the shared sanitizer now strips matched quote pairs only, survives the cursor marker in ad-libs/chords, sanitizes popup suggestions, and infers rhyme targets from AABB/ABAB/free-verse (R6, #79, #125).
* Add a local AI activity log and instrument all LLM call sites (tracing T1/T2, #89, #90, #99, #118).
* Add an offline eval harness for the lyrics helper (#76, #85).

### Bug Fixes

* Existing users will be asked for AI cloud consent once more, because consent is now tied to the current provider (lyrics helper and Tab Agent).
* Fix the AABB rhyme target's last-line bias to respect couplet parity, add a position-based soft rhyme target for next_word when the scheme is still ambiguous, and add a `formatRaw` diagnostic plus a prompt-version bump (R6, #79 review follow-up).
* Smooth streaming ghost text by live-sanitizing a leading label/numbering/quote/fence/header so it stops flashing raw formatting before the full reply lands.
* Finish more of #79: the completion prompt is punctuation-aware, completions no longer repeat text already after the cursor, and a headerless draft infers its line position from blank-line-separated stanzas.
* Fix a monorhyme (AAA) regression from the AABB couplet-parity fix so 3+ actually-rhyming lines keep their rhyme target.
* Fix a mid-word trim in the after-cursor overlap filter, make the line-position count only count the cursor's own line as finished in next_line mode, fix a headerless blank-line stanza miscount, require a word boundary before holding back a streamed label, tighten leading-numbering/dash-label detection, hide a flashing trailing close quote while streaming, name the right rhyme-target line (one vs. two lines up) for next_word, and stop a cursor inside a chord/remark from leaking bracket fragments (R6 review round 2).
* Do not treat a repeated chorus line as a closed AABB couplet; add a noCopy guard that drops suggestions matching an existing line (unless a chorus mirror was requested); ask the model to finish in one or two words when few syllables remain; and show only the first streamed line so self-correction text cannot flash (R6, #125).
* Insert lyrics completions with a smart space join so prefixes are not glued onto the next word (#102, #119).
* Treat Hebrew maqaf, paseq, sof-pasuq, and nun-hafukha as word breaks when stripping niqud in the syllable checker (#124).
* Cancel in-flight lyrics requests, enforce timeouts, and dedupe and cap tokens (#74, #83).
* Turn lyrics reasoning off on OpenRouter so suggestions stay stable (#101, #107).
* Recover next-word JSON on the OpenRouter decisions path and score every eval candidate (#86, #97).
* Count empty or over-length eval outputs as errors and fix Hebrew checker edge cases (#100, #106).
* Checkpoint the SQLite WAL on startup and window close so the database cannot grow without bound (#17).

## [0.2.0](https://github.com/tomerlaor/sessions-vault/compare/v0.1.0...v0.2.0) (2026-05-30)


### Features

* add AboutWindow component — Bold & Branded design
* register Help → About menu item, emit show-about event
* wire About window into app shell via show-about event
* replace scaffold with real sessions app, add SessionsVault branding and About window
* replace titlebar placeholder with Sessions Vault brand mark
* star projects from the row + fix chord regex and lyrics chord palette
* include lyrics, tabs, and todos as text files in project backups
* add lyric style memory DB tables and types
* add lyrics AI DB query layer
* add lyrics prompt builder with tests
* add streamLyricsSuggestion, generatePopupSuggestions, generateStyleSummary
* add LyricsAiSettings component and wire into SettingsModal
* add LyricsAiOverlay component
* integrate LyricsAiOverlay into LyricsTab
* add free-form chat input to Tab Agent Modal
* add TabGrid and CellValue types
* add tab-grid utility — constants, defaultGrid, gridToText
* add parseTabToGrid to tab-grid utilities
* add useTabGrid hook
* add AnnotationToolbar component
* add TabGridEditor component
* add TabExpandedModal component
* wire tab grid editor into TabTab — replace textarea with visual grid


### Bug Fixes

* add dialog ARIA roles and promise error handling to AboutWindow
* replace unwrap with error logging on menu emit
* resolve TS and Rust compile errors for clean build verification
* rename crate/package from -tmp, add window label, use default menu as base
* case-sensitive rename check and preserve spaces in chord annotations
* use SQL count in countAcceptedEvents instead of table scan
* use explicit null checks in buildSongContext
* guard empty recentAccepted in generateStyleSummary and clarify streamText non-await
* address code review issues in LyricsAI implementation
* detect file renames by hash and sync lyrics AI config live
* prompt-free keychain on macOS and improve LyricsAI error UX
* implement three dots dropdown menu in project list rows
* change Tab Agent initial screen to confirm flow
* prevent duplicate initial message in Tab Agent Modal
* deduplicate lyrics sections, fix bracket parsing, improve Tab Agent prompt, add AI debug logging
* stabilize callbacks, reset grid on instrument change, remove dead CSS
* remount editor on instrument change by including instrument in key

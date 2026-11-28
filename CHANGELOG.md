# Changelog

## [Unreleased]

### Features

* rename the app from SessionsVault to SeshKi (display name only; package/crate names, bundle identifier, and keychain service names are unchanged)

### Bug Fixes

* Existing users will be asked for AI cloud consent once more, because consent is now tied to the current provider (lyrics helper and Tab Agent).
* Rewrite the lyrics AI prompts with cursor/section context and explicit rhyme/syllable targets (R6, #79); the shared sanitizer now strips matched quote pairs only, survives the cursor marker in ad-libs/chords, sanitizes popup suggestions, and infers rhyme targets from AABB/ABAB/free-verse.
* Fix the AABB rhyme target's last-line bias to respect couplet parity, add a position-based soft rhyme target for next_word when the scheme is still ambiguous, and add a `formatRaw` diagnostic plus a prompt-version bump (R6, #79 review follow-up).
* Smooth streaming ghost text by live-sanitizing a leading label/numbering/quote/fence/header so it stops flashing raw formatting before the full reply lands.
* Finish more of #79: the completion prompt is punctuation-aware, completions no longer repeat text already after the cursor, and a headerless draft infers its line position from blank-line-separated stanzas.
* Fix a monorhyme (AAA) regression from the AABB couplet-parity fix so 3+ actually-rhyming lines keep their rhyme target.
* Fix a mid-word trim in the after-cursor overlap filter, make the line-position count only count the cursor's own line as finished in next_line mode, fix a headerless blank-line stanza miscount, require a word boundary before holding back a streamed label, tighten leading-numbering/dash-label detection, hide a flashing trailing close quote while streaming, name the right rhyme-target line (one vs. two lines up) for next_word, and stop a cursor inside a chord/remark from leaking bracket fragments (R6 review round 2).

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

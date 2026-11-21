# Changelog

## [Unreleased]

### Bug Fixes

* Existing users will be asked for AI cloud consent once more, because consent is now tied to the current provider (lyrics helper and Tab Agent).
* rewrite the lyrics AI prompts with cursor/section context and explicit rhyme/syllable targets (R6, #79), and fix the shared output sanitizer: wrapping-quote stripping now only removes a genuinely matched quote pair (never an apostrophe), the cursor marker survives ad-libs/chords and strips an echoed marker, popup suggestions are sanitized like ghost text, and the implied rhyme target respects AABB/ABAB/free-verse instead of always targeting the previous line.
* fix the AABB rhyme target's last-line bias (it now respects couplet parity instead of always targeting the previous line, in both the implied-target fallback and `nextLineTargets`), replace the no-scheme-yet fallback with a position-based soft target that hedges between two candidate lines for next_word when genuinely ambiguous, and add a non-failing `formatRaw` diagnostic plus a prompt-version bump (R6, #79 review follow-up).
* smooth the inline ghost text while it's streaming — a light live sanitize now strips a leading label/numbering/quote/fence/header from the partial reply so it no longer flashes raw formatting and then jumps once the full reply lands.
* finish more of #79: the completion prompt is now punctuation-aware (continues mid-clause after a comma, starts fresh after `. ! ?`), a prompt rule plus a post-filter stop completions from repeating text already after the cursor, and a headerless draft now infers its line position from blank-line-separated stanzas instead of saying nothing.

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

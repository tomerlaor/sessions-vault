# Changelog

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

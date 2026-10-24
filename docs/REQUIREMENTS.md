# Requirements

This file captures user stories for the project.
Stories are added via the `feature-to-user-story` skill.

---

### US-001: Edit Project Key (Root Note)

**User Story:**
As a music creator, I want to select the musical key (root note) of a project from a picklist so that I can accurately tag and later search/filter my projects by key.

**Acceptance Criteria:**

- [ ] The project detail view includes a "Key" field with a dropdown picklist
- [ ] The picklist contains exactly 12 options: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- [ ] The selected key is saved to the project record in the local database
- [ ] The field displays the current key when reopening a project
- [ ] The field can be left empty (key unknown / not set)

**Priority:** Medium
**Status:** Draft

---

### US-002: Interactive Tab Editor with Fret Placement and Annotation Library

**User Story:**
As a music creator, I want to place fret numbers and musical annotations directly onto fixed-width string lines in a visual tab editor so that I can compose tablature intuitively without manually editing raw text.

**Acceptance Criteria:**

- [ ] Tab strings are rendered as a fixed-width grid of cells; the grid width never changes as fret numbers are placed
- [ ] Clicking a cell on a string line opens a small input to enter a fret number (0–24), which is placed at that column position
- [ ] Fret numbers placed in the same column across multiple strings are vertically aligned, representing a chord
- [ ] An annotation palette is always visible alongside the editor, listing all supported symbols (e.g. h, p, /, b, ~, x, etc.)
- [ ] Clicking an annotation in the palette and then a cell places that annotation symbol at that position
- [ ] The underlying tab content (stored as text) is kept in sync with every placement/removal action
- [ ] Existing text-based tab content is parsed and rendered correctly in the grid on load

**Priority:** High
**Status:** Draft

---

### US-003: Add Custom String Lines and 4-Bar Default Grid

**User Story:**
As a music creator, I want to add extra string lines to the tab editor and have a 4-bar grid by default so that I can notate non-standard instruments and have enough space for a standard musical phrase without immediately needing to extend.

**Acceptance Criteria:**

- [ ] A new "Add Line" button appears in the tab grid footer alongside the existing "Extend" button
- [ ] Clicking "Add Line" shows an inline label input; confirming appends a new string row to the grid
- [ ] The new string row behaves identically to existing rows (clickable cells, fret/annotation placement)
- [ ] A new tab part starts with 4 bars (64 columns) by default instead of 2 bars

**Priority:** Medium
**Status:** Draft

---

### US-004: OpenRouter as an AI Provider

**User Story:**
As a music creator, I want to connect my OpenRouter API key and pick any model it offers so that I can use one account to access many AI models (for lyrics suggestions and the tab agent) without managing a separate key per vendor.

**Acceptance Criteria:**

- [ ] "OpenRouter" appears in the AI provider list in Settings alongside OpenAI, Anthropic, Ollama and LM Studio
- [ ] The OpenRouter API key is stored in the OS keychain, never in the SQLite DB or plain-text settings
- [ ] The model picker lists the full OpenRouter catalog (300+ models, fetched from OpenRouter) with a search box that filters by name or ID, and I can also type a model ID manually (e.g. `anthropic/claude-sonnet-4.6`)
- [ ] I can choose a different model for Lyrics AI and for the Tab Agent; each falls back to the default model if not set
- [ ] "Test connection" succeeds with a valid key and shows a clear error for an invalid key or unknown model
- [ ] Lyrics AI suggestions and the Tab Agent work with OpenRouter, including streaming
- [ ] If the model list cannot be fetched (offline), the app still works with a manually typed model ID

**Priority:** Medium
**Status:** Draft

---

### US-005: Next-Word Suggestion Mode in the Lyrics Helper

**User Story:**
As a songwriter, I want the lyrics helper to suggest just the next word (or two) while I'm mid-line so that I can keep my own phrasing and get a nudge without the AI writing the whole line.

**Acceptance Criteria:**

- [ ] "Next word" appears as a mode in the Lyrics AI settings alongside Line completion, Next line and Alternative phrasing
- [ ] With it enabled, I get at least three options for the next word (each one word, two at most), and at least one of them rhymes with the end of the line above
- [ ] The AI sees the entire song, my song context and the songwriting craft guidance when suggesting words
- [ ] I can accept the first option with Tab or click any option in the list
- [ ] The suggestion is spaced correctly when accepted (a space is added if my cursor follows a letter)
- [ ] If both Line completion and Next word are on, Next word is used right after I finish a word (cursor after a space) and Line completion otherwise
- [ ] Works for Hebrew and English, in both inline and popup display modes

**Priority:** Medium
**Status:** Draft

---

### US-006: Song Context for the Lyrics Helper

**User Story:**
As a songwriter, I want to describe my song in a few short sentences (what it's about, its mood and meaning) so that the lyrics helper's suggestions, especially the next line, fit what I'm trying to say.

**Acceptance Criteria:**

- [ ] The lyrics editor has a "Song context" input where I can write a few short sentences about the song's meaning, mood and subject
- [ ] The context is saved per song and is still there when I reopen the project
- [ ] The context is sent to the AI with every suggestion (next line, next word, line completion, alternative phrasing and popup)
- [ ] The next-line suggestion reflects the stated mood and subject
- [ ] Leaving the input empty changes nothing about how suggestions work
- [ ] Works for Hebrew and English context text

**Priority:** Medium
**Status:** Draft

---

### US-007: Project Files by Stage (Record/Mix, Mastering, Final Exports)

**User Story:**
As a music producer, I want a single song project to hold several files with a defined stage (record & mix DAW project, mastering DAW project, and one or more exported WAV versions) so that I can follow a song from the first recording to the final delivered master in one place.

**Acceptance Criteria:**

- [x] A project can contain multiple files, each tagged with a type: "Record/Mix project", "Mastering project", or "Export"
- [x] Exports have a subtype: mix bounce, master, stem set, instrumental, or alternate
- [x] I can add a DAW project file (e.g. an Ableton .als) as the mix project and another DAW project file as the mastering project, and they may come from different people or folders
- [x] I can attach more than one WAV export; every file has a version label (e.g. "v1", "v2") and a date, and the app suggests the next label
- [x] I can mark one export as "Final". This is a marker on the version, not part of its name, and the final version is shown prominently on the project
- [x] Each WAV export shows sample rate, bit depth, duration, and peak level, and warns if it is lossy (e.g. MP3-derived) or clipping
- [x] Each file shows its type, name, size, date, and whether it still exists on disk
- [x] DAW project files flag missing media and samples stored outside the project folder
- [x] The original files are never modified or moved by the app

**Priority:** Medium
**Status:** Implemented (PR #19)

---

### US-008: Back Up All Files of a Project by Stage

**User Story:**
As a music producer, I want backups to include the mix project, mastering project, and all exported versions of a song so that I can restore the whole production history, not just one DAW file.

**Acceptance Criteria:**

- [ ] A project backup (local and Google Drive) includes every file listed in the project's Files tab, grouped by stage
- [ ] I can choose which stages to include (e.g. skip large stem sets)
- [ ] Each backed-up file has its own checksum recorded in the backup record
- [ ] Files that are missing on disk are reported in the backup result instead of failing the whole backup
- [ ] Restoring a backup brings back files with their stage, version label, and Final marker
- [ ] Original files are never modified

**Priority:** Medium
**Status:** Draft
**Depends on:** US-007

---

### US-009: Auto-Detect Mastering Project During Scan

**User Story:**
As a music producer, I want the app to suggest which scanned project is the mastering session for a song so that I don't have to link them by hand.

**Acceptance Criteria:**

- [ ] After a scan, the app suggests matches between projects based on similar names (e.g. "Song" and "Song - Master") or sibling folders
- [ ] Suggestions are shown for review and are never linked automatically without my confirmation
- [ ] Accepting a suggestion adds the project to the song as a "Mastering project" file
- [ ] I can dismiss a suggestion and it does not reappear
- [ ] A project already linked as mastering is no longer listed as a separate song if I choose to hide it

**Priority:** Low
**Status:** Draft
**Depends on:** US-007

---

### US-010: AIFF and FLAC Audio Metadata

**User Story:**
As a music producer, I want sample rate, bit depth, duration, and peak level shown for AIFF and FLAC exports, not just WAV, so that I can check any delivered version at a glance.

**Acceptance Criteria:**

- [ ] AIFF and FLAC exports show sample rate, bit depth, channels, duration, and peak level
- [ ] Clipping is flagged the same way as for WAV
- [ ] Corrupt or truncated files show a clear error instead of crashing the app
- [ ] Lossy formats (MP3, M4A, OGG) are flagged as lossy

**Priority:** Low
**Status:** Draft
**Depends on:** US-007

---

### US-011: Group Stems into a Stem Set

**User Story:**
As a music producer, I want to group the stems of a song into one stem set so that I can manage and send them as a single deliverable.

**Acceptance Criteria:**

- [ ] I can create a stem set under a project and add multiple audio files to it
- [ ] The stem set shows as one row with its file count and total size, and can be expanded
- [ ] The stem set has its own version label and date
- [ ] I can mark whether the stems are from the mix or the master
- [ ] The stem set can be revealed in Finder as a folder
- [ ] The app warns if stems differ in sample rate, bit depth, or length

**Priority:** Low
**Status:** Draft
**Depends on:** US-007

---

### US-012: Loudness Measurement (LUFS) for Exports

**User Story:**
As a mastering engineer, I want integrated loudness (LUFS) and true peak shown for each export so that I can compare versions and check them against streaming targets.

**Acceptance Criteria:**

- [ ] Each WAV export shows integrated loudness in LUFS and true peak in dBTP
- [ ] Measurement follows ITU-R BS.1770 / EBU R128
- [ ] I can compare two versions side by side and see the loudness difference
- [ ] The app can show whether a version is above or below a chosen streaming target
- [ ] Measurement runs in the background and does not block the UI

**Priority:** Low
**Status:** Draft
**Depends on:** US-007

---

### US-013: Missing-Media Checks for Non-Ableton DAWs

**User Story:**
As a music producer who uses more than one DAW, I want missing and external samples flagged for Logic, FL Studio, Reaper, and other projects, not only Ableton, so that I can trust the check on every project.

**Acceptance Criteria:**

- [ ] Reaper projects report missing and outside-folder media
- [ ] Logic, FL Studio, and other supported DAWs report media where the format allows it
- [ ] If a DAW format cannot be parsed, the flag is hidden instead of showing wrong numbers
- [ ] Parsing failures fall back to file-level metadata without errors
- [ ] The Files tab shows the same "missing / outside folder" summary for every supported DAW

**Priority:** Low
**Status:** Draft
**Depends on:** US-007

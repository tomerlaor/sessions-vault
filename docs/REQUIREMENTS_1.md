# DAW File Manager — Requirements

**Version:** 0.1 (draft)
**Status:** Pre-development
**Last updated:** April 21, 2026

---

## 1. Overview

### 1.1 Product vision

A desktop application that gives music creators a single home for every DAW project on their machine. Instead of hunting through folders named `song_idea_v7_FINAL_actual_final`, creators get a searchable, tagged library with project metadata (key, BPM, mood), attached lyrics and tab files, and automated cloud backups.

### 1.2 Target user

Bedroom producers, songwriters, and hobbyist-to-prosumer musicians who:

- Accumulate dozens to hundreds of DAW projects over time
- Use primarily Ableton Live, but may dabble in other DAWs
- Lose projects to drive failures, misplaced folders, or forgotten names
- Want to search "that G minor dub idea from last summer" and actually find it

### 1.3 Non-goals (v1)

- Not a DAW itself — no audio editing, no playback beyond preview
- Not a collaboration platform — single-user local-first app
- Not a DRM/licensing tool
- Not a stem/sample library manager (projects only, though samples referenced by projects may be tracked)

---

## 2. Platform & tech stack

### 2.1 Platform

Cross-platform desktop app. **Tauri preferred** over Electron for smaller bundle size and better native filesystem performance, which matters when scanning thousands of project files. Rust backend handles filesystem + cloud sync; webview frontend handles UI.

Target OS: macOS (primary — most Ableton users), Windows (secondary), Linux (best-effort).

### 2.2 Suggested stack

- **Shell:** Tauri 2.x
- **Frontend:** React + TypeScript + Tailwind
- **Local DB:** SQLite (via `rusqlite` or `sqlx`) — stores metadata, not the project files themselves
- **Cloud SDKs:** Dropbox API, Google Drive API, AWS S3 SDK — behind an abstracted `CloudProvider` trait
- **DAW file parsing:** `.als` files are gzipped XML; parse with `flate2` + `quick-xml` in Rust

---

## 3. Core features (v1)

### 3.1 Project discovery & import

- **Folder scanning:** user points the app at one or more root folders; it recursively scans for recognized DAW project files
- **Supported formats (v1 priority order):**
  - Ableton Live: `.als`, `.alp` (primary, full metadata extraction)
  - Logic Pro: `.logicx` (basic — name, modified date, size)
  - FL Studio: `.flp` (basic)
  - Pro Tools: `.ptx` (basic)
  - Cubase: `.cpr` (basic)
  - Reaper: `.rpp` (basic — RPP is plain text, easy to parse)
- **Full metadata extraction for Ableton:** tempo, key/scale (if set in Live 11+), time signature, track count, plugin list, sample dependencies
- **Incremental re-scan:** watch folders for changes; update library without full rescan
- **Duplicate detection:** flag projects with identical hashes or near-identical names

### 3.2 Metadata & annotations

Each project entry stores:

**Auto-extracted (where possible):**

- Project name, file path, size, created/modified dates
- DAW + version
- BPM, key, time signature, length
- Track count, plugin list, sample dependencies

**User-editable:**

- Title (separate from filename)
- Description / notes
- Tags (genre, mood, status — e.g. `draft`, `mixed`, `released`)
- Key and BPM overrides (when auto-detection fails)
- Collaborators / credits
- Release status and associated release info
- Star rating or similar priority marker

### 3.3 Attachments

Each project can have attached files stored alongside or referenced by path:

- **Lyrics:** `.txt`, `.md`, `.rtf` — editable in-app with a basic text editor
- **Tabs / chord charts:** `.gp`, `.gpx`, `.gp5`, `.pdf`, image files — viewable in-app (no editing required)
- **Reference audio:** mixdowns, bounces, demos — playable with a simple audio preview
- **Images:** cover art, whiteboard photos
- **Generic files:** any other supporting document

Attachments live in a per-project sidecar folder (e.g. `<project>.dawmgr/`) so they travel with the project when copied.

### 3.4 Backup & cloud sync

- **Cloud providers (v1):** Dropbox, Google Drive, S3-compatible (includes Backblaze B2, Cloudflare R2)
- **Backup scope:** user picks per-project or "everything tagged X"
- **Backup strategy:**
  - Full project folder including sidecar attachments
  - Configurable: entire project, or project file only (no samples/renders)
  - Versioned snapshots with retention policy (keep last N, or last N days)
  - Incremental — only changed files re-uploaded
- **Triggers:**
  - Manual ("Back up now")
  - Scheduled (daily, weekly)
  - On-change (watch filesystem; debounce by N minutes to avoid mid-session uploads)
- **Restore:** browse backup history, restore a version to original location or new location
- **Integrity:** checksum verification after upload; alert on mismatch
- **Status UI:** per-project backup status indicator (synced / pending / failed / never backed up)

### 3.5 Library views & search

- **Grid and list views** with sortable columns (modified, BPM, key, size, status)
- **Filters:** DAW, tags, key, BPM range, date range, backup status
- **Search:** full-text across titles, descriptions, lyrics, tags, filenames
- **Smart collections:** saved filter queries (e.g. "unreleased dub tracks at 70-80 BPM")
- **Quick actions:** reveal in Finder/Explorer, open in DAW, back up, duplicate, archive

---

## 4. Nice-to-haves (v2+)

- Waveform preview of bounced audio attachments
- Tempo/key detection from rendered audio when DAW metadata is missing
- Automatic setlist builder (drag projects into ordered lists with key/BPM transition warnings)
- Collaborator sharing (invite-only access to specific projects)
- Mobile companion app (read-only library browsing)
- Plugin inventory view — "which projects use Serum?"
- Missing sample detection and repair suggestions
- Integration with streaming platforms to mark "released" status automatically
- Export project as self-contained archive for sharing

---

## 5. User experience principles

- **Local-first:** the app works fully offline; cloud is a sync layer, not a dependency
- **Non-destructive:** the app never modifies original DAW project files; metadata lives in its own DB + sidecar folders
- **Fast:** scanning thousands of projects should complete in seconds, not minutes; search is instant
- **Keyboard-friendly:** power-user shortcuts for everything (tag, star, search, open)
- **Graceful degradation:** if Ableton-specific parsing fails, still show the project with filesystem-level metadata

---

## 6. Data model (preliminary)

```
Project
  id, name, title, description
  daw_type, daw_version
  file_path, file_hash, size_bytes
  created_at, modified_at, last_opened_at
  bpm, key, scale, time_signature, length_seconds
  rating, status
  (relations: tags, attachments, backup_history, plugins, samples)

Tag
  id, name, color

Attachment
  id, project_id, type (lyrics|tab|audio|image|other)
  file_path, original_filename, size_bytes, created_at

BackupRecord
  id, project_id, provider, remote_path
  snapshot_timestamp, status, size_bytes, checksum

Plugin
  id, name, manufacturer, format (VST3|AU|AAX)

Sample
  id, name, file_path_at_scan, exists, size_bytes
```

---

## 7. Security & privacy

- Cloud provider credentials stored in OS keychain (macOS Keychain, Windows Credential Manager, libsecret on Linux) — never in plain config files
- All cloud transfers use HTTPS/TLS
- Optional client-side encryption for S3 backups (user-held key)
- No telemetry by default; opt-in anonymous usage analytics only
- Local DB is unencrypted by default; optional passphrase-encrypted DB for shared machines

---

## 8. Performance targets

- Initial scan: <30 seconds for 1,000 projects
- Search / filter: results rendered in <100ms for libraries up to 10,000 projects
- Backup throughput: limited only by cloud provider and network
- App cold start: <2 seconds to interactive UI
- Memory footprint: <300MB idle with 5,000-project library

---

## 9. Open questions

1. **Ableton version coverage:** minimum Live version to support for `.als` parsing? Live 10+ is a reasonable floor.
2. **Sample management:** just track sample references, or offer to consolidate/collect missing samples?
3. **Monetization:** free and open source, freemium (free local / paid cloud), or one-time paid?
4. **Sync vs. backup semantics:** if the same project exists on two machines, is this a backup tool (one-way) or a sync tool (two-way with conflict resolution)? v1 should probably be backup-only; sync is a much harder problem.
5. **DAW launch integration:** double-click opens the DAW — do we need to handle projects that reference missing plugins gracefully, or just let the DAW do its thing?
6. **Lyrics editor scope:** plain text only, or basic formatting (chords above lyrics, section markers)?

---

## 10. Success criteria

The v1 release is successful if a typical user can:

1. Point the app at their Music folder and see every DAW project indexed within a minute
2. Search "that G minor thing at 75 BPM" and find it
3. Attach a lyrics file to a project and have it survive a move to another drive
4. Configure Dropbox backup once and never worry about losing a project to a drive failure
5. Open any project in its native DAW with one click

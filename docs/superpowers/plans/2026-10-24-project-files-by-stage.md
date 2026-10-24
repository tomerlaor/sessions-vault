# Project Files by Stage (US-007) — Implementation Plan

**Goal:** One song holds several files, each with a stage (record/mix project, mastering project, export), a version label and a date. WAV exports show audio metadata, and DAW project files flag missing media.

## Decisions

1. **New `project_files` table, not `attachments`.** The attachments spec (2026-04-22) was never built (no table or Files tab in code), and attachments copy files into the sidecar. DAW projects and WAVs are large, so `project_files` **references files in place** and never copies, moves or modifies them (non-destructive principle).
2. **A "song" is the existing `projects` row** (the mix `.als`). The mastering `.als` is added as a `project_files` row via file picker. If the scanner also indexes it as its own project, the file row stores `linkedProjectId` so it can be opened as a project. No change to the scanner.
3. **Audio metadata is computed in Rust** (new command), with no new dependency. A RIFF/WAVE header parser plus a streaming peak scan is about 150 lines.
4. **"Lossy" detection is by extension and format tag only** (mp3/m4a/ogg, or WAV with a non-PCM format tag). A WAV transcoded from an MP3 cannot be detected reliably, so the app does not claim it can.
5. **"Final" is a flag** (`is_final`), at most one per project, enforced in the query layer. It is never part of a file name.

## Data model

```ts
// src/db/schema.ts
projectFiles = sqliteTable("project_files", {
  id, projectId (FK cascade),
  kind: "mix_project" | "master_project" | "export",
  exportType: "mix" | "master" | "stems" | "instrumental" | "alternate" | null,
  filePath (not unique across projects), fileName, sizeBytes,
  versionLabel, fileDate (file mtime, editable),
  isFinal (0/1), linkedProjectId (nullable),
  sampleRate, bitDepth, channels, durationSecs, peakDb, clipped (0/1), lossy (0/1),
  mediaMissingCount, mediaExternalCount,   // DAW project files only
  note, createdAt
})
```

Migration in `src/db/client.ts` as `CREATE TABLE IF NOT EXISTS project_files`, matching the existing pattern. Add an index on `project_id`.

## Tasks

### 1. Types, schema, migration, queries
- `Project`-adjacent `ProjectFile` type in `src/types/index.ts`.
- `src/db/queries/project-files.ts`: `listFiles(projectId)`, `addFile`, `updateFile`, `removeFile`, `setFinal(projectId, fileId)` (clears other flags, in one transaction), `nextVersionLabel(projectId, kind)`.
- `nextVersionLabel` is pure and lives in `src/lib/project-files.ts` so it is unit-testable.
- **Tests (`tests/project-files.test.ts`, written first):** next label is v1 on empty, then v2, v3, and ignores non-numeric labels. `setFinal` leaves exactly one final.

### 2. Rust: audio inspection
- `src-tauri/src/audio.rs` with `inspect_audio(path) -> AudioInfo { sampleRate, bitDepth, channels, durationSecs, peakDb, clipped, lossy }`.
- Parse RIFF chunks (`fmt `, `data`, WAVE_FORMAT_EXTENSIBLE). Stream samples for 16/24/32-bit int and 32-bit float. Peak is dBFS. `clipped` means three or more consecutive full-scale samples.
- Non-WAV extensions return `lossy: true` with size only. AIFF and FLAC are out of scope (follow-up).
- Register in `commands.rs` and `lib.rs`.
- **Tests (`#[cfg(test)]`, using the existing `tempfile`):** synthesized WAVs at 16/24-bit and float, a -6 dB sine peak, a clipped square wave, a truncated header returning an error rather than panicking.

### 3. Rust: DAW project media check
- Extend `parser/ableton.rs` to collect sample `FileRef` paths from the `.als` (`<SampleRef><FileRef><Path|RelativePath>`). Resolve against the project folder.
- New command `inspect_project_media(path) -> { total, missing, external }`. "External" means the sample resolves outside the project folder.
- Only Ableton is supported. Other DAWs return nulls and the UI hides the flags (graceful degradation).
- **Tests:** a gzipped fixture `.als` with one internal, one external and one missing sample.

### 4. Frontend: "Files" tab
- `src/components/detail/tabs/FilesTab.tsx`, added to `TABS` in `DetailPanel.tsx`. Three sections: Record/Mix, Mastering, Exports (newest first).
- Add via the dialog plugin (already a dependency). Kind is chosen by section. The version label is prefilled from `nextVersionLabel` and is editable.
- Each row shows name, version, date, size and an exists badge. WAV rows show `48 kHz · 24-bit · 3:42 · peak -3.1 dBFS`, with warning chips for clipping or lossy. DAW rows show "N missing / M outside folder".
- Row actions: reveal in Finder (existing `reveal_in_finder`), open (existing `open_in_daw` for projects), mark Final, edit label, remove (removes the reference only, with a confirm that the file on disk is untouched).
- The final export is pinned in a header strip at the top of the tab and in `OverviewTab`.
- Exists badges are refreshed when the tab opens through a single `file_exists_many` Rust command, rather than one call per file.

### 5. Wire-up and docs
- Mark US-007 criteria and status in `docs/REQUIREMENTS.md`.
- Update the CLAUDE.md data model section (add `ProjectFile`).

## Out of scope (follow-ups)
- Including project files in backups (`backup_local`/`backup_gdrive` snapshot only the `.als` today). Worth a separate story.
- Auto-detecting a mastering project from the scan by name or folder.
- AIFF/FLAC metadata, stem-set grouping, loudness (LUFS).
- Non-Ableton media checks.

## Risks
- Peak scan on large WAVs. Mitigation: stream in 64 KB chunks and run on a blocking thread, with the result cached in the row so it runs once at add time.
- Moved or renamed files. Mitigation: the exists badge, plus a "Locate…" action to repoint `filePath`.

## Suggested order
1 → 2 → 4 (exports only, usable end to end) → 3 → 4 (media flags) → 5. Each step is a separate commit on a new branch off `dev`, opened as a PR (per the git workflow rule).

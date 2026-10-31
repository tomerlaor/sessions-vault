# Stage-File Backup with Manifest + Checksums (PR 1 of US-008)

**Date:** 2026-10-31
**Issue:** #34 (US-008), UX context from #68 (restore UI explicitly out of scope here)

## Scope

This is **PR 1 only**: the backup side. It adds a `manifest.json` to every backup
archive, a per-file SHA-256 for each stage file (plus the `.als`, sidecar and text
files already backed up), a stage picker that remembers the user's last choice, and
missing-file reporting that turns a failed backup into a `partial` one instead.

Explicitly **not** in this PR: verify-only, one-click restore, zip-slip rejection on
read, `project_files` re-insertion. Those are PR 2. The DB migration below includes
the `backup_files` and `backup_restores` tables from the issue's full data model up
front (so PR 2 doesn't need another migration), but PR 1 only writes to
`backups.manifest_json` / `.stages` / `.missing_count`; `backup_files` and
`backup_restores` are created empty and unused until PR 2.

## Context (verified in code, 2026-10-31)

- `backup::zip_project()` (`src-tauri/src/backup/mod.rs`) zips the `.als`, its
  `<stem>.dawmgr/` sidecar, and optional `lyrics.txt`/`tabs.txt`/`todos.txt` at the
  zip root into a temp file. `backup_to_local` / `gdrive::upload` copy or upload that
  zip. One checksum (SHA-256 of the whole zip, via `checksum_file`) is stored on the
  `backups` row.
- Stage files (US-007) live in `project_files` (columns: `kind`, `export_type`,
  `file_path`, `file_name`, `size_bytes`, `version_label`, `is_final`, …) and are
  **not** included in backups today — confirmed by reading `zip_project` and
  `FilesTab.tsx`; nothing wires `project_files` into the backup commands.
- `backup_configs` (`id TEXT PRIMARY KEY, config_json TEXT`) already exists and is
  used as a generic key/value store (`local`, `gdrive`, `gdrive-folder`, plus unrelated
  AI config rows). The stage selection reuses this table under a new id rather than
  adding a dedicated table.
- `zip` crate is 2.6.1 (verified in `~/.cargo/registry/src/.../zip-2.6.1`):
  `FileOptions::large_file(bool)` exists at `write.rs:483`, `ZipFile::enclosed_name()`
  exists at `read.rs:1571`. (`enclosed_name` is read-side and belongs to PR 2's
  restore path, not this PR, but worth confirming now since the issue flagged it.)

## Design

### 1. Manifest-based archive (Rust)

`zip_project` is extended (same function, new params) to take the project id and the
list of selected stage files, and to always write `manifest.json` at the archive
root — there is no pre-manifest archive format to stay compatible with (no restore
exists yet, nothing reads an old zip back).

Archive layout:

```
manifest.json
project/<als file name>
project/<stem>.dawmgr/...         (if the sidecar exists)
text/lyrics.txt, text/tabs.txt, text/todos.txt   (only non-empty ones)
stages/<kind>/<file name>          (one per selected project_files row)
```

`<kind>` is the raw `project_files.kind` value (`mix_project` | `master_project` |
`export`). Within one `stages/<kind>/` directory, a repeated file name gets a
`_2`, `_3`, ... suffix before the extension so two different files never collide.

### 2. Manifest contents

```jsonc
{
  "schema": 1,
  "project": { "id": "...", "title": "...", "alsPath": "..." },
  "createdAt": 1735500000,
  "appVersion": "0.2.0",
  "files": [
    {
      "archivePath": "stages/export/Song_final.wav",
      "originalPath": "/Users/.../Song_final.wav",
      "stage": "export",
      "exportType": "mix",
      "versionLabel": "v3",
      "isFinal": true,
      "sizeBytes": 48213990,
      "sha256": "…",
      "mtime": 1735400000
    }
  ],
  "missing": [
    { "originalPath": "/Users/.../stems/kick.wav", "stage": "export", "reason": "not found on disk" }
  ]
}
```

`files` covers **every** file written into the archive, not just stage files — the
`.als`, sidecar files and text files get an entry too (`stage`/`exportType`/
`versionLabel` are `null`, `isFinal` is `false`). This costs nothing extra: the
hashing happens while streaming each file into the zip regardless of its kind, and it
means the whole archive is checksummed at the file level, not only the stage subset.
`missing` only applies to `project_files` rows (the `.als` itself still hard-fails the
backup if unreadable, same as before — that failure mode doesn't change in this PR).

### 3. Checksums without a second read

A `HashingReader<R: Read>` wraps the source file's `Read` and feeds every chunk
through a running `Sha256` as `std::io::copy` streams it into the zip. One read, one
write, one digest — no file is read twice and nothing is buffered in memory beyond
the 8 KB copy buffer `std::io::copy` already uses.

### 4. Compression and large files

- Audio extensions (`wav`, `aif`, `aiff`, `mp3`, `flac`, `m4a`, `ogg`) use
  `CompressionMethod::Stored` — they're already compressed or don't compress well,
  and `Stored` avoids burning CPU for no size benefit.
  (`.als` continues to use `Deflated`: although also gzip internally, it's small and
  deflating it again costs nothing. No change from today's behavior.)
- Any file at or above 4 GiB gets `.large_file(true)` on its `SimpleFileOptions` (Zip64),
  checked via `std::fs::metadata` before `zip.start_file`.

### 5. Missing files → `partial`, not `failed`

For each selected `project_files` row, the file is opened before it's added to the
zip. If `File::open` fails (deleted, renamed, permissions, unmounted volume), the
row goes into `manifest.missing` with a human-readable reason and the loop moves to
the next file — the whole backup does not abort. If `missing` is non-empty when the
archive finishes, the returned status is `"partial"`; otherwise `"ok"`. (A failure to
read the `.als` or its sidecar is unrelated to this feature and keeps today's
behavior of returning `Err`, which the existing frontend catch block turns into a
`"failed"` backup row.)

### 6. Stage selection (frontend)

"Stage" for the picker is a finer key than `project_files.kind`, so a user can skip
just the large stem set without skipping all exports:

- `kind === "mix_project"` → stage key `"mix_project"`
- `kind === "master_project"` → stage key `"master_project"`
- `kind === "export"` → stage key `` `export:${exportType}` `` (one key per
  `mix` / `master` / `stems` / `instrumental` / `alternate`)

`groupFilesByStage(files)` (new, `src/lib/backup-stages.ts`, pure/unit-tested) turns
a `ProjectFile[]` into `{ key, label, count, totalBytes }[]`.
`defaultStageSelection(groups)` selects every key except ones whose `totalBytes`
exceeds 1 GiB (the issue's "skip large stem sets" example, generalized to any heavy
stage, not just ones literally named "stems").

The last selection is remembered globally (not per-project — the existing
`backup_configs` rows are already global singletons, and the issue doesn't ask for
per-project memory) as `backup_configs` row id `"stage-selection"`,
`config_json: '{"keys": ["mix_project", "export:mix", ...]}'`. On the next backup,
stored keys are intersected with the stages actually present on that project (a
remembered key for a stage this project doesn't have is simply absent from the
checklist; a remembered key that's missing from storage falls back to
`defaultStageSelection`).

If a project has zero `project_files` rows, the stage checklist is skipped entirely
and the backup proceeds exactly as before (`.als` + sidecar + text only, `files: []`
passed to the command) — no dialog for the common case of a project that hasn't
adopted the Files tab yet.

### 7. Command surface (Rust)

`backup_local` and `backup_gdrive` both gain two params: `project_id: String` and
`files: Vec<StageFileInput>` (camelCase over IPC: `filePath`, `fileName`, `kind`,
`exportType`, `versionLabel`, `isFinal`). `BackupResult` gains `status: String`
(`"ok" | "partial"`), `missingCount: u32`, `manifestJson: String`. The existing
`checksum` field is kept as-is (whole-archive digest, useful for an eventual
verify-only step in PR 2); `destination` / `sizeBytes` / `provider` are unchanged.

No new Tauri commands are registered — both commands already exist in
`lib.rs`'s `generate_handler!`, only their signatures change.

### 8. Data model

```sql
ALTER TABLE backups ADD COLUMN manifest_json TEXT;
ALTER TABLE backups ADD COLUMN stages TEXT;             -- JSON array of included stage keys
ALTER TABLE backups ADD COLUMN missing_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS backup_files (   -- unused until PR 2 (restore/verify)
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  project_file_id TEXT,
  archive_path TEXT NOT NULL,
  original_path TEXT NOT NULL,
  stage TEXT, version_label TEXT, is_final INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_restores ( -- unused until PR 2
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  restored_to TEXT NOT NULL, restored_at INTEGER NOT NULL,
  ok_count INTEGER NOT NULL, mismatch_count INTEGER NOT NULL, error_msg TEXT
);
```

`backups.status` already has no `CHECK` constraint (plain `TEXT`), so no migration
is needed to allow the new `"partial"` value — only the TypeScript union type widens.

### 9. Result rendering (frontend)

`HistoryTab`'s backup history rows already branch on `b.status`. They gain a third
branch for `"partial"`: an amber dot (reusing the existing ok/failed dot pattern) and
an expandable "N files missing" line that parses `b.manifestJson` and lists each
`missing[].originalPath` with its `reason`. No new DB round-trip needed — the
manifest already carries everything required to render this.

## Invariants

- Original files are opened read-only; never modified, moved, renamed or deleted.
- A missing/unreadable stage file is recorded, never silently dropped and never
  fatal to the backup.
- Both local and Drive paths go through the same `zip_project`/`backup_to_local`
  code — no divergence between providers.
- The stage checklist is skipped (not shown empty) when a project has no
  `project_files` rows.

## Files to change

| File | Change |
| --- | --- |
| `src-tauri/src/backup/manifest.rs` (new) | `Manifest`, `ManifestFile`, `ManifestMissing`, `ManifestProject` types + serde |
| `src-tauri/src/backup/mod.rs` | `HashingReader`, `StageFileInput`, `zip_project` rewrite, `BackupResult` new fields |
| `src-tauri/src/backup/local.rs` | `backup_to_local` takes `project_id` + `files`, passes through |
| `src-tauri/src/commands.rs` | `backup_local` / `backup_gdrive` gain `project_id`, `files` |
| `src/db/client.ts` | migration: `backups` columns, `backup_files`, `backup_restores` tables |
| `src/db/schema.ts` | drizzle defs for the above |
| `src/types/index.ts` | `BackupRecord.status` gains `"partial"`, new `manifestJson`/`stages`/`missingCount` fields, `BackupFile`/`BackupRestore` types, `StageGroup` type |
| `src/lib/backup-stages.ts` (new) | `groupFilesByStage`, `defaultStageSelection`, `formatBackupResult` — pure, unit-tested |
| `src/db/queries/backups.ts` | `getStageSelection` / `setStageSelection` helpers over `backup_configs` |
| `src/components/detail/tabs/HistoryTab.tsx` | stage checklist before backup, partial-status + missing-files rendering |
| `tests/backup-stages.test.ts` (new) | Vitest coverage for the pure lib |
| `src-tauri/src/backup/manifest.rs`, `mod.rs` `#[cfg(test)]` | Rust unit tests (tempfile, no separate fixtures dir — follows the existing `audio.rs`/`ableton.rs` convention of synthesizing fixtures inline) |

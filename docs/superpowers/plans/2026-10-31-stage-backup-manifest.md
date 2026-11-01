# Stage-File Backup with Manifest + Checksums (PR 1) — Implementation Plan

Design: `docs/superpowers/specs/2026-10-31-stage-backup-manifest-design.md`

## 1. Rust: manifest + hashing + archive (backend core)

- `src-tauri/src/backup/manifest.rs`: `Manifest`, `ManifestProject`, `ManifestFile`,
  `ManifestMissing` (serde, camelCase). Unit test: build one, serialize, parse back,
  assert equality (round trip).
- `src-tauri/src/backup/mod.rs`:
  - `HashingReader<R: Read>` wrapping a `Read` + running `Sha256`; `finish(self) -> String`.
    Test: hash a known byte buffer via `HashingReader` + `io::copy` into a `Vec<u8>`
    sink and compare against `Sha256::digest` directly.
  - `StageFileInput { file_path, file_name, kind, export_type, version_label, is_final }`
    (serde Deserialize, camelCase).
  - `compression_for(path) -> CompressionMethod` (Stored for audio extensions, Deflated
    otherwise). Test both branches.
  - `dedup_name(used: &mut HashMap<String, u32>, name: &str) -> String` — pure helper,
    tested directly: first use returns the name unchanged, second returns `_2` before
    the extension, etc.
  - Rewrite `zip_project(als_path, title, project_id, lyrics, tabs, todos, stage_files)
-> Result<(PathBuf, Manifest), String>`: writes `project/`, `text/`, `stages/<kind>/`
    entries as in the design, hashes each via `HashingReader`, skips (and records into
    `manifest.missing`) any stage file that fails to open, writes `manifest.json` last,
    returns the zip path and the `Manifest`.
  - `BackupResult` gains `status`, `missing_count`, `manifest_json` (camelCase serde).

## 2. Rust: wire through local + Drive + commands

- `src-tauri/src/backup/local.rs`: `backup_to_local` takes `project_id: &str`,
  `stage_files: &[StageFileInput]`; builds status/missing_count/manifest_json onto
  `BackupResult` from what `zip_project` returns.
- `src-tauri/src/commands.rs`: `backup_local` and `backup_gdrive` gain `project_id:
String`, `files: Vec<StageFileInput>` params; thread them to `zip_project` /
  `backup_to_local`. No change to `lib.rs` registration (signatures only).

## 3. Rust tests (cargo test, tempfile, inline fixtures — matches `audio.rs` style)

In `src-tauri/src/backup/mod.rs` `#[cfg(test)] mod tests`:

- Manifest round-trip (also covered in `manifest.rs`, keep one copy there).
- `HashingReader` digest equals `Sha256::digest`/`checksum_file` on the same bytes.
- Stage filter: given 2 stage files, the archive's `files` manifest entries have
  exactly the expected `archivePath`s under `stages/<kind>/`.
- A missing stage file (path that doesn't exist) → `manifest.missing` has one entry,
  `files` doesn't, overall returned status would be `"partial"` once `backup_to_local`
  wraps it (test that at the `backup::local` level with a tempdir).
- Two stage files with the same `file_name` in the same kind → the second gets a
  `_2` suffix in its `archivePath`.
- `compression_for("x.wav")` → `Stored`; `compression_for("x.als")` → `Deflated`.

## 4. DB migration + schema + types

- `src/db/client.ts`: add to `runMigrations` — `ALTER TABLE backups ADD COLUMN
manifest_json TEXT` / `stages TEXT` / `missing_count INTEGER DEFAULT 0` (each in its
  own try/catch like the existing `projects` column additions, since `ALTER TABLE ADD
COLUMN` has no `IF NOT EXISTS` in SQLite); `CREATE TABLE IF NOT EXISTS backup_files`;
  `CREATE TABLE IF NOT EXISTS backup_restores`.
- `src/db/schema.ts`: add `manifestJson`, `stages`, `missingCount` to the `backups`
  table def; add `backupFiles`, `backupRestores` table defs.
- `src/types/index.ts`: widen `BackupRecord.status` to include `"partial"`; add
  `manifestJson: string | null`, `stages: string | null`, `missingCount: number | null`
  to `BackupRecord`; add a `ManifestFile`/`Manifest` shape for parsing `manifestJson`
  in the UI; add a `StageGroup` type for the picker.

## 5. Frontend: stage selection lib (pure, tested first)

`src/lib/backup-stages.ts`:

- `stageKey(file: ProjectFile): string`
- `groupFilesByStage(files: ProjectFile[]): StageGroup[]` (sorted mix_project →
  master_project → export subtypes; count + totalBytes per group)
- `defaultStageSelection(groups: StageGroup[]): string[]` (all keys, minus any group
  over 1 GiB)
- `resolveStageSelection(groups, remembered: string[] | null): string[]` (remembered ∩
  present groups' keys, or `defaultStageSelection` if `remembered` is null/empty-after-
  intersection)
- `parseMissing(manifestJson: string | null): { originalPath: string; reason: string
}[]` for rendering the partial-backup detail line.

## 6. Frontend: wire into `backups.ts` queries + `HistoryTab.tsx`

- `src/db/queries/backups.ts`: `getStageSelection()` / `setStageSelection(keys:
string[])` over `backup_configs` id `"stage-selection"`, same pattern as
  `getLocalConfig`/`setLocalConfig`.
- `HistoryTab.tsx`:
  - Load `listFiles(p.id)` alongside existing reload; compute `groupFilesByStage`.
  - If there are no project files, backup proceeds immediately with `files: []` as
    today (no dialog).
  - If there are, show a small inline checklist (checkbox per stage group with label +
    count + formatted size) before either backup button fires; pre-check via
    `resolveStageSelection` using the remembered selection. On confirm: persist the
    selection via `setStageSelection`, map selected `ProjectFile[]` to
    `StageFileInput[]`, pass `projectId: p.id, files` into `invoke("backup_local"/
"backup_gdrive", ...)`.
  - `insertBackup(...)` gains `status: result.status`, `manifestJson:
result.manifestJson`, `stages: JSON.stringify(selectedKeys)`, `missingCount:
result.missingCount`.
  - Render: status dot gets a third amber state for `"partial"`; under the existing
    destination block, if `missingCount > 0`, show "`N` files missing" with the list
    from `parseMissing(b.manifestJson)` (collapsed by default, expandable).

## 7. Vitest tests

`tests/backup-stages.test.ts`:

- `groupFilesByStage`: mix_project/master_project collapse to one group each; export
  rows split by `exportType`; totals sum `sizeBytes` correctly.
- `defaultStageSelection`: excludes a group over 1 GiB, includes everything else.
- `resolveStageSelection`: remembered keys that still exist win; a remembered key for
  a stage no longer present is dropped; null/empty remembered falls back to default.
- `parseMissing`: null manifest → `[]`; a manifest with two missing entries → both
  returned with path + reason; malformed JSON → `[]` (doesn't throw).

## 8. Verification gate

Run and fix until green, in this order:

1. `cd src-tauri && cargo fmt && cargo clippy -- -D warnings && cargo test`
2. `npx tsc --noEmit`
3. `npx eslint .`
4. `npm test` (vitest run)

If `cargo build`/`clippy` fails on missing `webkit`/`gtk` system libs (apt still
installing in this environment), wait a few minutes and retry rather than skipping
the Rust gate.

## 9. Commit plan

1. `docs: spec + plan for stage-file backup manifest (US-008 PR1)` — this spec + plan.
2. `feat(backup): manifest-based archive with per-file SHA-256 and missing-file reporting` — all of `src-tauri/src/backup/*`, `commands.rs`.
3. `feat(db): add manifest/stage columns and backup_files/backup_restores tables` — `client.ts`, `schema.ts`, `types/index.ts`.
4. `feat(ui): stage picker and partial-backup reporting in History tab` — `backup-stages.ts`, `queries/backups.ts`, `HistoryTab.tsx`, `tests/backup-stages.test.ts`.

(Commits may be combined if a clean split turns out awkward once the diff exists —
the goal is logical grouping, not a fixed count.)

## Out of scope (PR 2)

- `verify_backup`, `restore_backup` commands and `backup/restore.rs`.
- Zip-slip rejection on read (`enclosed_name` usage) — confirmed available in `zip`
  2.6.1 for when PR 2 needs it.
- `project_files` re-insertion after restore.
- Restore wizard UI (per #68, explicitly out of scope for this work).

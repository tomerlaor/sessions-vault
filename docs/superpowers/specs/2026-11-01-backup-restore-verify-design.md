# Backup Verify + Restore (PR 2 of US-008) — Design

**Date:** 2026-11-01
**Issue:** #34 (US-008), UX context from #68 (restore wizard)

## Scope

This is **PR 2**: verify-only and one-click restore for the manifest-based backup
archives written by PR 1 (`docs/superpowers/specs/2026-10-31-stage-backup-manifest-design.md`).

In scope:
- `verify_backup`: re-hash every file inside a backup archive against `manifest.json`,
  report per-file `ok` / `missing` / `corrupt` plus a summary.
- `restore_backup`: extract an archive into a new destination folder with zip-slip and
  symlink rejection, `create_new` semantics (no silent overwrite), re-hash every
  restored file, emit progress events, return an outcome the frontend records as a
  `backup_restores` row.
- A restore wizard (pick backup → verify → choose target → confirm → progress →
  result) per #68.
- Tests: Rust unit tests for the zip-slip guard, corrupt-file detection and
  no-overwrite behavior; Vitest tests for the wizard's pure helper logic.

Out of scope (unchanged from the PR 1 doc, still not asked for here):
- `project_files` re-insertion after restore (the issue's "restore brings back files
  with their stage/version/Final marker" criterion is about re-populating the Files
  tab; it is not part of this task's instructions and is left for a follow-up).
- `backup_files` population. The manifest embedded in `backups.manifest_json` already
  carries every file's path/stage/checksum; nothing currently reads `backup_files`,
  and this PR doesn't add a reader for it either. Left empty, as before.

## Context (verified in code, 2026-11-01)

- `backup::zip_project()` writes `manifest.json` at the archive root with a `files[]`
  list (`archivePath`, `originalPath`, `stage`, `exportType`, `versionLabel`,
  `isFinal`, `sizeBytes`, `sha256`, `mtime`) and a `missing[]` list. `BackupRecord` in
  SQLite stores a copy as `manifest_json`.
- `backups.destination` is a local filesystem path for `provider = "local"` **and**
  for `provider = "gdrive"` backups made through a locally-mounted Drive folder (the
  existing `HistoryTab.tsx` "gdrive-folder" path reuses `backup_local` under the
  hood). It is a bare Google Drive file ID (no path separators) only for `provider =
  "gdrive"` backups made through the Drive API. `HistoryTab.tsx`'s `destinationLabel()`
  already distinguishes these two cases by checking for `/`/`\\` in `destination` —
  the restore wizard reuses the same check to decide whether a download step is
  needed before a local zip path exists.
- `zip` 2.6.1 (`~/.cargo/registry/.../zip-2.6.1/src/read.rs`): `ZipFile::enclosed_name()`
  (line 1571) rejects NUL bytes, absolute paths, and traversal that escapes the root;
  `ZipFile::is_symlink()` (line 1727) checks the stored Unix mode's `S_IFLNK` bit. Both
  confirmed present and usable, but this PR writes its own `safe_extract_path` (below)
  instead of depending solely on `enclosed_name`, so the traversal/absolute/drive-prefix
  rules are unit-testable without constructing a real zip file.
- `backup_configs`/`backups` DB writes happen in the **frontend** (`src/db/queries/backups.ts`
  via drizzle), not in Rust — Rust commands return plain result structs over IPC. Verify
  and restore follow the same split: Rust does the file I/O and hashing, the frontend
  persists the `backup_restores` row.
- No download-from-Drive exists yet (`backup/gdrive.rs` only has `upload`). This PR adds
  a minimal `gdrive::download` (GET `.../files/{id}?alt=media` with a bearer token,
  written to a temp file) so the restore wizard works for both destination shapes
  above, per the issue's "works for local and Google Drive backups" criterion.

## Design

### 1. Zip-slip + symlink guard (`src-tauri/src/backup/restore.rs`)

```rust
pub fn safe_extract_path(base: &Path, entry_name: &str) -> Result<PathBuf, String>
```

Pure, no zip/filesystem access — takes the entry name string straight from
`ZipFile::name()` so it's unit-testable with plain strings:

1. Reject a NUL byte anywhere in the name.
2. Reject an empty/whitespace-only name.
3. Reject an absolute path: leading `/` or `\`, **or** a Windows drive prefix
   (`^[A-Za-z]:`) — checked textually rather than via `Path::is_absolute()`, which
   only recognizes drive prefixes when compiled for Windows; the archive may have been
   made on a different OS than the one restoring it.
4. Walk the name split on both `/` and `\`, tracking a depth counter: `..` decrements
   depth and pops the last pushed component; any other non-empty, non-`.` component
   increments depth and gets pushed. If depth would go negative, the entry escapes the
   restore root — reject.
5. Join whatever normalized, non-escaping relative path survives onto `base`.

Symlink rejection is a separate per-entry check at extraction time
(`ZipFile::is_symlink()`), since it depends on the zip entry's stored Unix mode, not
on its name.

### 2. Verify (`verify_archive`)

```rust
pub fn verify_archive(zip_path: &Path) -> Result<VerifyReport, String>
```

1. Open the zip, read and parse `manifest.json` (`read_manifest`, shared with restore).
2. For every `ManifestFile` entry, look up the same `archivePath` inside the zip:
   - Not found → `VerifyFileResult.status = "missing"` (the archive itself is missing
     the entry the manifest promises — distinct from PR 1's `manifest.missing`, which
     is about files missing from the *original project* at backup time).
   - Found → stream it through a SHA-256 (not loaded into memory), compare to
     `manifest.sha256`. Match → `"ok"`; mismatch → `"corrupt"` (also set on a zip
     decompression/CRC error reading the entry, since a truncated/tampered archive
     member can't be read instead of just hashing wrong).
3. `VerifyReport` carries the full per-file list plus `okCount`/`missingCount`/
   `corruptCount` for the summary line.

### 3. Restore (`restore_archive`)

```rust
pub fn restore_archive(
    zip_path: &Path,
    dest_dir: &Path,
    on_progress: impl FnMut(usize, usize, &str),
) -> Result<RestoreOutcome, String>
```

1. Read the manifest (same `read_manifest` as verify).
2. `std::fs::create_dir_all(dest_dir)` — the destination folder may be new (the
   default) or an existing folder the user picked; either way nothing inside it is
   touched except the specific paths this restore writes.
3. For each manifest file entry, in order:
   - `safe_extract_path(dest_dir, &entry.archive_path)` — on error, record
     `status: "rejected"` with the reason, skip (never `?`-propagate: one bad entry
     shouldn't abort the whole restore, mirroring PR 1's missing-file handling).
   - Locate the entry in the zip by name; not found → `status: "missing_in_archive"`.
   - `entry.is_symlink()` → `status: "rejected"`, reason `"symlink entries are not supported"`.
   - `create_dir_all` the parent, then open the target with
     `OpenOptions::new().write(true).create_new(true)` — `AlreadyExists` → `status:
     "conflict"` (never overwrite); any other I/O error → `status: "error"`.
   - Stream the zip entry into the file through a hashing reader (reusing the same
     `HashingReader` pattern from PR 1's `zip_project`), compare the digest to
     `entry.sha256` → `"ok"` or `"mismatch"` (written either way; a mismatch is
     reported, not rolled back — the user can inspect or delete the restored copy).
   - Call `on_progress(done, total, &entry.archive_path)` after each entry so the
     Tauri command can emit a progress event.
4. `RestoreOutcome` aggregates `okCount`/`mismatchCount`/`conflictCount`/`rejectedCount`
   plus the per-file list, and `restoredTo` echoes `dest_dir`.

Invariant check against the acceptance criteria: nothing here ever opens an original
project file for writing, renames it, or deletes it — only the archive (read-only) and
the new destination tree are touched.

### 4. Commands (`src-tauri/src/commands.rs`)

- `verify_backup(zip_path: String) -> VerifyReport`
- `restore_backup(zip_path: String, dest_dir: String, app: AppHandle) -> RestoreOutcome`
  — emits `"restore:progress"` (`{ done, total, file }`) after each file via the
  `on_progress` callback.
- `gdrive_download_backup(file_id: String, access_token: String) -> String` (returns
  the downloaded temp zip path) — only needed when `backups.destination` is a bare
  Drive file ID; the wizard skips this call when `destination` already looks like a
  local path.

All three run inside `spawn_blocking`, matching `backup_local`/`backup_gdrive`.

### 5. Data flow / DB

No schema change — `backup_restores` already exists from PR 1's migration. The
frontend inserts a row after `restore_backup` resolves, same pattern as `insertBackup`
after `backup_local`/`backup_gdrive`:

```ts
insertBackupRestore({
  backupId, restoredTo: outcome.restoredTo, restoredAt: now,
  okCount: outcome.okCount, mismatchCount: outcome.mismatchCount, errorMsg,
})
```

`mismatchCount` in the DB row folds together the Rust side's `mismatchCount` +
`conflictCount` + `rejectedCount` (everything that isn't a clean `"ok"`) — the schema
only has the two counters from the original issue; the full per-status breakdown is
still visible in the wizard's result screen (not persisted, since there's no reader
for it yet, matching the `backup_files`-stays-empty decision above).

### 6. Restore wizard (`src/components/detail/tabs/RestoreWizard.tsx`, per #68)

Opened from a new "Restore…" button next to each `ok`/`partial` row in
`HistoryTab.tsx`'s backup history list (`failed` backups have no usable archive).
Steps, matching #68's wireframe-level flow:

1. **Review** — shows the picked backup's timestamp/provider/size; "Verify" button.
2. **Verify** — calls `verify_backup` (downloading from Drive first if `destination`
   is a bare file ID); shows the ok/missing/corrupt summary and, if any file isn't
   `ok`, the list with reasons. User can proceed anyway (a corrupt file blocks
   nothing — the user may only want the other 99 files) or cancel.
3. **Target** — folder picker (`@tauri-apps/plugin-dialog`, same as the existing
   backup-destination picker), pre-filled with
   `defaultRestoreTarget(project.filePath, project.title, now)` =
   `<project dir>/<Title> restored <date> <time>/`, never the project directory
   itself or any existing project path.
4. **Confirm** — file count + total size + target path.
5. **Progress** — listens for `"restore:progress"`, shows a `done/total` bar with the
   current file name; Cancel is not wired to abort the Rust side (same limitation as
   the existing backup flows, which also don't support cancel) but closes the wizard
   once the in-flight call resolves.
6. **Result** — ok/mismatch/conflict/rejected counts, expandable lists per non-`ok`
   status (mirrors the existing missing-files expansion already in `HistoryTab`),
   writes the `backup_restores` row.

### 7. Pure helpers (`src/lib/restore.ts`, unit-tested — matches `backup-stages.ts`'s
convention; there's no DOM test environment in this repo, so component rendering isn't
tested, only the logic the component calls)

- `defaultRestoreTarget(originalPath, title, nowSecs): string`
- `isLocalDestination(destination: string): boolean` (same slash check as
  `destinationLabel` in `HistoryTab.tsx`, extracted so both files share it instead of
  duplicating the heuristic)
- `summarizeVerify(report: VerifyReport): string`
- `summarizeRestore(outcome: RestoreOutcome): string`
- `groupRestoreFilesByStatus(files: RestoredFile[]): Record<string, RestoredFile[]>`

`src/lib/gdrive.ts` gets the `ensureFreshGDriveToken` helper lifted out of
`HistoryTab.tsx` (pure refactor, no behavior change) so `RestoreWizard.tsx` can reuse
it for the Drive-file-ID restore path without duplicating the refresh logic.

## Data model

No migration needed — `backup_restores` was created empty in PR 1 and is now written
to for the first time.

## Test plan

**Rust (`src-tauri/src/backup/restore.rs`, `#[cfg(test)]`)**:
- `safe_extract_path`: rejects `../evil`, `/etc/passwd`, `C:\evil`, `a/../../evil`
  (escapes root), accepts `a/../b` (stays inside), accepts a plain relative path.
- `verify_archive`: a byte flipped in an archive member after writing it → that file
  reports `"corrupt"`; an entry absent from the zip but present in the manifest →
  `"missing"`; an unmodified archive → all `"ok"`.
- `restore_archive`: extracts into a temp dir with correct bytes/hashes; a second
  restore into the same dir reports `"conflict"` for every file (nothing overwritten,
  verified by re-reading the first restore's bytes unchanged); a manifest entry whose
  `archivePath` is `../../evil.txt` (crafted directly, bypassing `zip_project`) is
  rejected and nothing is written outside the destination dir.

**Vitest (`tests/restore.test.ts`)**:
- `defaultRestoreTarget`: builds `<dir>/<title> restored <date> <time>` for posix and
  Windows-style original paths.
- `isLocalDestination`: true for paths with `/` or `\`, false for a bare Drive file ID.
- `summarizeVerify` / `summarizeRestore`: formats each count combination (all ok, some
  missing, some corrupt / mismatch / conflict / rejected).
- `groupRestoreFilesByStatus`: buckets a mixed list correctly, omits empty buckets.

**Manual** (not run in this environment — see note below): restore a real local
backup into a new folder, confirm an unrelated file in the same parent dir is
untouched, open a restored `.wav` in a player.

## Environment note

This sandbox has no GTK/WebKit dev packages, so `cargo build`/`clippy`/`test` for the
full crate (which pulls in `tauri`, and transitively `glib-sys`) cannot link, same
constraint flagged for PR 1. `cargo fmt` (parse-only) still runs. CI (`dtolnay/rust-toolchain`
+ apt-installed GTK/WebKit on the runner) is the actual gate for `cargo test`/`clippy`.

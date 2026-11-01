# Backup Verify + Restore (PR 2) — Implementation Plan

Design: `docs/superpowers/specs/2026-11-01-backup-restore-verify-design.md`

## 1. Rust: `backup/restore.rs` (new module)

- `safe_extract_path(base: &Path, entry_name: &str) -> Result<PathBuf, String>` — pure,
  string-based zip-slip guard (absolute paths, drive prefixes, escaping `..`). Tests
  for each rejection case plus the "stays inside" accept case.
- `read_manifest(zip: &mut ZipArchive<File>) -> Result<Manifest, String>` shared by
  verify and restore.
- `VerifyFileResult`, `VerifyReport` (serde, camelCase) + `verify_archive(zip_path)`.
- `RestoredFile`, `RestoreOutcome` (serde, camelCase) + `restore_archive(zip_path,
  dest_dir, on_progress)`, using `OpenOptions::create_new` and the `HashingReader`
  pattern from `backup/mod.rs` (export it or duplicate the ~15-line struct — check
  which reads cleaner once both call sites exist).
- `pub mod restore;` in `backup/mod.rs`.

## 2. Rust: Google Drive download

- `backup/gdrive.rs`: `pub async fn download(file_id: &str, access_token: &str) ->
Result<PathBuf, String>` — GET `https://www.googleapis.com/drive/v3/files/{id}?alt=media`
  with `bearer_auth`, stream the response body to a temp file (same temp-dir naming
  convention as `zip_project`), return the path.

## 3. Rust: commands + registration

- `commands.rs`: `verify_backup(zip_path: String) -> Result<VerifyReport, String>`,
  `restore_backup(zip_path: String, dest_dir: String, app: AppHandle) ->
Result<RestoreOutcome, String>` (emits `"restore:progress"` per file), `gdrive_download_backup(file_id: String, access_token: String) -> Result<String, String>`.
  All three `spawn_blocking` (restore/verify) or `async` (download, matching
  `backup::gdrive::upload`'s existing async style).
- `lib.rs`: add the three to `generate_handler!`.

## 4. Rust tests

In `backup/restore.rs` `#[cfg(test)] mod tests` (tempfile, inline fixtures, no
separate fixtures dir — matches `backup/mod.rs`'s existing style):

- `safe_extract_path` rejection/acceptance table (see design doc §Test plan).
- Build a tiny manifest + zip by hand (reuse `zip_project` from `super::super` for a
  realistic archive, or write directly with `ZipWriter` for full control over a
  corrupted/missing entry) covering:
  - all-`ok` verify
  - one flipped byte → `"corrupt"`
  - one manifest entry with no matching zip member → `"missing"`
- Restore into a fresh tempdir → files match manifest hashes, `okCount` correct.
- Restore twice into the same tempdir → second run reports `"conflict"` for every
  file; read the files back and assert the bytes are still the first run's bytes
  (proves no overwrite happened, not just that the status says so).
- A hand-crafted manifest entry with `archivePath: "../../evil.txt"` → restore skips
  it (`"rejected"`), and the parent-of-parent directory has no `evil.txt` after the
  call.

## 5. Frontend: types + queries

- `src/types/index.ts`: `VerifyFileResult`, `VerifyReport`, `RestoredFile`,
  `RestoreOutcome`, `BackupRestore` (DB row shape, mirrors `backupRestores` schema).
- `src/db/queries/backups.ts`: `insertBackupRestore(record: Omit<BackupRestore, "id">)`,
  `getBackupRestores(backupId: string): Promise<BackupRestore[]>` (for the result step
  to show prior restores of the same backup, if any — small, same pattern as
  `getBackups`).

## 6. Frontend: pure helpers (write + test before the component)

- `src/lib/restore.ts`: `defaultRestoreTarget`, `isLocalDestination`,
  `summarizeVerify`, `summarizeRestore`, `groupRestoreFilesByStatus`.
- `src/lib/gdrive.ts` (new): move `ensureFreshToken` out of `HistoryTab.tsx` verbatim
  as `ensureFreshGDriveToken`; update `HistoryTab.tsx`'s import, no behavior change.
- `tests/restore.test.ts`: unit tests per the design doc's Vitest section.

## 7. Frontend: `RestoreWizard.tsx` + `HistoryTab.tsx` wiring

- New `src/components/detail/tabs/RestoreWizard.tsx`: step state machine (review →
  verify → target → confirm → progress → result), inline styles matching
  `HistoryTab.tsx`/`SettingsModal.tsx` conventions (fixed overlay + centered box, `tb-btn`
  buttons, `field-label` section headers) — no new CSS classes needed.
  - Uses `isLocalDestination(backup.destination)` to decide whether to call
    `gdrive_download_backup` (after `ensureFreshGDriveToken`) before `verify_backup`/
    `restore_backup`.
  - Listens for `"restore:progress"` via `@tauri-apps/api/event`'s `listen`, same
    pattern as `App.tsx`'s `"show-about"` listener.
  - On result, calls `insertBackupRestore`.
- `HistoryTab.tsx`: add a "Restore…" button on `ok`/`partial` rows, opening
  `RestoreWizard` with that `BackupRecord`; import `ensureFreshGDriveToken` from the
  new `lib/gdrive.ts` instead of the local definition.

## 8. Verification gate

1. `cd src-tauri && cargo fmt` (parse-only, should work regardless of system libs)
2. `cd src-tauri && cargo test` — attempt; this sandbox lacks GTK/WebKit dev packages
   so the full crate (via `tauri`) may fail to link (`glib-sys` / `pkg-config`), same
   constraint noted in PR 1's plan. Report the actual failure point rather than
   skipping silently.
3. `cd src-tauri && cargo clippy -- -D warnings` — same caveat as above.
4. `npx tsc --noEmit`
5. `npx eslint .`
6. `npm test`

## 9. Commit plan

1. `docs: spec + plan for backup verify/restore (US-008 PR2)`
2. `feat(backup): verify and restore archives with zip-slip protection`
   (`backup/restore.rs`, `backup/mod.rs` wiring, Rust tests)
3. `feat(backup): google drive download for restore` (`backup/gdrive.rs`)
4. `feat(backup): verify_backup/restore_backup/gdrive_download_backup commands`
   (`commands.rs`, `lib.rs`)
5. `feat(ui): restore wizard with verify, zip-slip-safe extraction, and progress`
   (`types/index.ts`, `queries/backups.ts`, `lib/restore.ts`, `lib/gdrive.ts`,
   `RestoreWizard.tsx`, `HistoryTab.tsx`, `tests/restore.test.ts`)

(Commits may be combined if a clean split turns out awkward once the diff exists.)

## Out of scope (unchanged)

- `project_files` re-insertion after restore.
- `backup_files` population / any reader for it.
- Cancelling an in-flight restore/verify/download.

# Backup Text Files (Lyrics, Tabs, Todos)

**Date:** 2026-04-28

## Problem

When backing up a project, the zip only contains the `.als` file and the `.dawmgr` sidecar folder. Lyrics, tabs, and todos — stored as text columns in the local SQLite DB — are not included. If the DB is lost, this content is gone.

## Goal

Include lyrics, tabs, and todos as plain `.txt` files inside every backup zip, so they survive independently of the database.

## Chosen Approach

**Option A: Pass content strings through the command layer.**

The frontend reads lyrics/tabs/todos from the project already in memory and passes them as optional strings to the Tauri backup commands. The Rust `zip_project` function writes whichever are non-empty directly into the zip using in-memory bytes — no temp files, no extra I/O.

## Design

### Rust — `backup/mod.rs`

`zip_project` gains three new parameters:

```rust
pub fn zip_project(
    als_path: &Path,
    title: &str,
    lyrics: Option<&str>,
    tabs: Option<&str>,
    todos: Option<&str>,
) -> Result<PathBuf, String>
```

After the existing `.als` + `.dawmgr` logic, for each field:
- If the value is `Some(s)` and `s` is non-empty after trimming → write as a zip entry (`lyrics.txt`, `tabs.txt`, `todos.txt`)
- Otherwise → skip (no empty files in the zip)

### Rust — `commands.rs`

Both `backup_local` and `backup_gdrive` gain matching params:

```rust
pub async fn backup_local(
    file_path: String,
    title: String,
    destination_dir: String,
    lyrics: Option<String>,
    tabs: Option<String>,
    todos: Option<String>,
) -> Result<BackupResult, String>

pub async fn backup_gdrive(
    file_path: String,
    title: String,
    access_token: String,
    lyrics: Option<String>,
    tabs: Option<String>,
    todos: Option<String>,
) -> Result<BackupResult, String>
```

These forward the values directly to `zip_project`. `backup::local::backup_to_local` also gains the three params.

### Frontend

At each call site for `backup_local` / `backup_gdrive`, pass the current project's `lyrics`, `tabs`, and `todos` fields. These are already loaded in the detail panel — no extra DB queries needed. Pass `null` (maps to `None`) for any field that is an empty string or missing.

## Invariants

- Empty or whitespace-only fields produce no file in the zip.
- File names inside the zip are always `lyrics.txt`, `tabs.txt`, `todos.txt`.
- Existing backup behavior (`.als` + `.dawmgr`) is unchanged.
- Both local and GDrive backup paths get the same treatment.

## Files to Change

| File | Change |
|---|---|
| `src-tauri/src/backup/mod.rs` | Add three `Option<&str>` params to `zip_project`; write text entries |
| `src-tauri/src/backup/local.rs` | Pass params through to `zip_project` |
| `src-tauri/src/commands.rs` | Add `Option<String>` params to `backup_local` and `backup_gdrive` |
| Frontend backup call sites | Pass `lyrics`, `tabs`, `todos` from project state |

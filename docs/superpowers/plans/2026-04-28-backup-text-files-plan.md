# Implementation Plan: Backup Lyrics, Tabs, Todos as Text Files

Based on: `docs/superpowers/specs/2026-04-28-backup-text-files-design.md`

## Tasks

### Task 1 — Update `zip_project` in `backup/mod.rs`

File: `src-tauri/src/backup/mod.rs`

Add three new params to `zip_project`:

```rust
pub fn zip_project(
    als_path: &Path,
    title: &str,
    lyrics: Option<&str>,
    tabs: Option<&str>,
    todos: Option<&str>,
) -> Result<PathBuf, String>
```

After the existing `.dawmgr` sidecar loop, for each of the three fields:

- If `Some(s)` and `s.trim()` is non-empty → call `zip.start_file("lyrics.txt", opts)` (or `tabs.txt` / `todos.txt`) and write the bytes.
- Otherwise → skip.

Verification: `cargo build` passes.

---

### Task 2 — Update `backup_to_local` in `backup/local.rs`

File: `src-tauri/src/backup/local.rs`

Add three `Option<&str>` params to `backup_to_local`, pass them to `zip_project`.

Verification: `cargo build` passes.

---

### Task 3 — Update Tauri commands in `commands.rs`

File: `src-tauri/src/commands.rs`

- `backup_local`: add `lyrics: Option<String>`, `tabs: Option<String>`, `todos: Option<String>`; convert with `.as_deref()` and pass to `backup_to_local`.
- `backup_gdrive`: same three params; pass `.as_deref()` to `zip_project`.

Verification: `cargo build` passes.

---

### Task 4 — Update frontend call sites in `HistoryTab.tsx`

File: `src/components/detail/tabs/HistoryTab.tsx`

Three `invoke` call sites (lines ~86, ~149, ~155). For each, add:

```ts
lyrics: p.lyrics || null,
tabs: p.tabs || null,
todos: p.todos || null,
```

Verification: TypeScript compiles (`pnpm tsc --noEmit` or equivalent).

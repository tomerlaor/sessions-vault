# Attachments (Files Tab) — Design Spec

**Date:** 2026-04-22
**Status:** Approved

---

## Overview

Add a "Files" tab to the project detail panel. Users can attach any file to a project; it gets copied into a per-project sidecar folder. Clicking a file opens it in the system default app. Files can also be removed.

---

## Storage

### Sidecar folder

Path: `<project_parent>/<project_stem>.dawmgr/`

Example: if the project file is `/music/fire outside/Untitled Project/Untitled.als`, the sidecar is `/music/fire outside/Untitled Project/Untitled.dawmgr/`.

Created on first attachment if it doesn't exist.

### DB schema

New `attachments` table added as a migration in `client.ts`:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)
```

**Type** is inferred from extension at attach time:
- `lyrics`: `.txt`, `.md`, `.rtf`
- `tab`: `.gp`, `.gpx`, `.gp5`, `.pdf`
- `audio`: `.mp3`, `.wav`, `.aiff`, `.m4a`, `.flac`
- `image`: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`
- `other`: anything else

### Drizzle schema

New table definition added to `src/db/schema.ts`.

### TypeScript type

```ts
export interface Attachment {
  id: string
  projectId: string
  type: 'lyrics' | 'tab' | 'audio' | 'image' | 'other'
  filePath: string
  originalFilename: string
  sizeBytes: number
  createdAt: number
}
```

Added to `src/types/index.ts`.

---

## Backend

### New Rust command: `copy_to_sidecar`

**Location:** `src-tauri/src/commands.rs`

```rust
#[tauri::command]
pub fn copy_to_sidecar(project_path: String, source_path: String) -> Result<String, String> {
    let project = std::path::Path::new(&project_path);
    let parent = project.parent().ok_or("no parent")?;
    let stem = project.file_stem().and_then(|s| s.to_str()).ok_or("no stem")?;
    let sidecar_dir = parent.join(format!("{}.dawmgr", stem));
    std::fs::create_dir_all(&sidecar_dir).map_err(|e| e.to_string())?;
    let filename = std::path::Path::new(&source_path)
        .file_name().ok_or("no filename")?;
    let dest = sidecar_dir.join(filename);
    std::fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}
```

Registered in `lib.rs` invoke handler.

### Opening files

Reuse the existing `open_in_daw` command — it calls `open <path>` on macOS which uses the system default app. No new command needed.

### Deleting sidecar files

Done from the frontend via a new `delete_file` Rust command:

```rust
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}
```

Both `copy_to_sidecar` and `delete_file` must be added to the `invoke_handler!` list in `src-tauri/src/lib.rs`.

---

## Frontend

### `src/db/queries/attachments.ts`

```ts
getAttachments(projectId: string): Promise<Attachment[]>
addAttachment(attachment: Attachment): Promise<void>   // caller supplies nanoid() for id
removeAttachment(id: string): Promise<void>
```

### `FilesTab` component

**Location:** `src/components/detail/tabs/FilesTab.tsx`

**Props:**
```ts
interface Props {
  project: Project
}
```

**State:** fetches attachments on mount and after add/remove via local `reload()`.

**Layout:**
- Header row: "Files" label + "Attach file" button (right-aligned)
- Clicking "Attach file":
  1. Opens `@tauri-apps/plugin-dialog` file picker (no filter — any file)
  2. Invokes `copy_to_sidecar(project.filePath, selectedPath)`
  3. Infers type from extension
  4. Calls `addAttachment(...)` to save to DB
  5. Reloads attachment list
- List of attached files, each row:
  - Type icon (emoji or Icon component: 🎵 audio, 🖼 image, 📄 lyrics/tab/other)
  - Filename
  - Size (formatted as KB or MB)
  - **Open** button → `invoke('open_in_daw', { path: attachment.filePath })`
  - **Remove** button → `invoke('delete_file', { path: attachment.filePath })` then `removeAttachment(id)` then reload
- Empty state: "No files attached yet. Click 'Attach file' to add lyrics, tabs, audio, or images."

### `DetailPanel` wiring

- Add `{ id: 'files', label: 'Files', icon: 'folder' }` to the `TABS` array
- Add `{tab === 'files' && <FilesTab project={p} />}` to the tab body

---

## Out of scope

- In-app preview of images or audio
- Editing lyrics files in-app (that's the existing Lyrics tab's job)
- Duplicate filename handling (if same filename attached twice, overwrite silently)
- Drag-and-drop attachment

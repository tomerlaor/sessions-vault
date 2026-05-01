# DAW File Manager — Design Spec

**Date:** 2026-04-21
**Status:** Approved
**Version:** 1.0

---

## 1. Product Summary

A local-first, free and open-source desktop app for music creators to organise, search, and back up DAW projects. The single most critical v1 capability is **project discovery and metadata extraction** — scan folders, parse Ableton `.als` files deeply, and present a searchable library.

### Target user

Bedroom producers and hobbyist-to-prosumer musicians who accumulate dozens to hundreds of DAW projects and lose them to drive failures or forgotten folder names. Primary DAW: Ableton Live.

### v1 Non-goals

- No audio playback, no DAW functionality
- No collaboration or multi-user features
- No cloud backup (v2)
- No attachments/lyrics editor (v2)

---

## 2. Platform & Tech Stack

| Layer         | Choice                                    | Reason                                                  |
| ------------- | ----------------------------------------- | ------------------------------------------------------- |
| Desktop shell | Tauri 2.x                                 | Small binary (<15MB), native perf, <2s cold start       |
| Frontend      | React + TypeScript + Tailwind             | Fast iteration, large contributor pool                  |
| ORM / DB      | Drizzle ORM + `tauri-plugin-sql` → SQLite | Type-safe, schema-as-code, lives in TypeScript          |
| Rust backend  | Tauri commands                            | Scan, parse `.als`, watch folders — I/O heavy work only |
| File watching | `notify` crate                            | OS-native FSEvents/inotify/ReadDirectoryChangesW        |
| Search        | Drizzle queries + SQLite FTS5             | Sub-100ms on 10k projects                               |
| Monetisation  | Free and open source                      | Maximise adoption, community DAW parser contributions   |

### Why Rust for the backend

- `.als` parsing (gzip + XML) at scan time is CPU + I/O heavy — no GC pauses
- `notify` crate hooks into OS-native file watch APIs with minimal battery drain
- Tauri requires Rust — the question is scope, not whether
- Rust surface is intentionally tiny so contributors don't need deep Rust knowledge

---

## 3. Architecture

### 3.1 Approach: Thin Rust shell, fat React frontend

Rust owns: filesystem scan, `.als` parsing, file watching, emitting Tauri events.
TypeScript owns: all business logic, DB schema (Drizzle), queries, filtering, search, UI state.
React owns: display only — calls hooks, renders data.

```
User adds folder
      ↓
[Rust] recursive_scan(path)
  → parse .als (flate2 + quick-xml) → ProjectMetadata
  → emit Tauri event: "project:discovered"
      ↓
[TS] event handler → Drizzle upsert → SQLite
      ↓
[React] useProjects() → render library grid

File change detected
      ↓
[Rust] notify watcher → debounce 2s → re-parse
  → emit "project:updated"
      ↓
[TS] event handler → Drizzle upsert → re-render
```

**Boundary rule:** Rust returns raw parsed data only — no IDs, no user fields, no tags. TypeScript/Drizzle owns the full project record and merges metadata in.

---

## 4. Data Model (Drizzle Schema)

```typescript
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), // nanoid
  filePath: text("file_path").notNull().unique(),
  fileHash: text("file_hash"),
  title: text("title").notNull(), // user-editable display name
  daw: text("daw").notNull(), // 'ableton' | 'logic' | 'flstudio' ...
  dawVersion: text("daw_version"),
  bpm: real("bpm"), // null if not extractable
  key: text("key"), // e.g. 'G minor'
  timeSignature: text("time_signature"), // e.g. '4/4'
  trackCount: integer("track_count"),
  sizeBytes: integer("size_bytes"),
  status: text("status").default("draft"), // draft | mixed | released | archived
  rating: integer("rating"), // 1–5, nullable
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }),
  modifiedAt: integer("modified_at", { mode: "timestamp" }),
  lastScannedAt: integer("last_scanned_at", { mode: "timestamp" }),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull(),
});

export const projectTags = sqliteTable(
  "project_tags",
  {
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    tagId: text("tag_id").references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.projectId, t.tagId] }) }),
);

export const watchedFolders = sqliteTable("watched_folders", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  addedAt: integer("added_at", { mode: "timestamp" }),
});
```

Plugins, samples, attachments, and backup records are deferred to v2 — kept out of v1 schema intentionally.

---

## 5. Rust Command Surface

```rust
// Filesystem commands
#[tauri::command] scan_folder(path: String) -> Result<Vec<ProjectMetadata>>
#[tauri::command] remove_watched_folder(path: String) -> Result<()>
#[tauri::command] reveal_in_finder(path: String) -> Result<()>
#[tauri::command] open_in_daw(path: String) -> Result<()>

// Watcher lifecycle (starts on app launch)
#[tauri::command] start_watcher(paths: Vec<String>) -> Result<()>
#[tauri::command] add_watch_path(path: String) -> Result<()>
#[tauri::command] remove_watch_path(path: String) -> Result<()>

// Events emitted by Rust → consumed by TypeScript
"project:discovered"  { metadata: ProjectMetadata }
"project:updated"     { metadata: ProjectMetadata }
"project:deleted"     { file_path: String }
"scan:progress"       { scanned: u32, total: u32 }
"scan:complete"       { folder: String, count: u32 }
```

```rust
pub struct ProjectMetadata {
    pub file_path:      String,
    pub file_hash:      String,
    pub daw:            String,            // detected from extension
    pub daw_version:    Option<String>,
    pub bpm:            Option<f64>,       // Ableton only
    pub key:            Option<String>,    // Ableton Live 11+ only
    pub time_signature: Option<String>,    // Ableton only
    pub track_count:    Option<u32>,       // Ableton only
    pub size_bytes:     u64,
    pub created_at:     i64,               // unix timestamp
    pub modified_at:    i64,
}
```

### DAW detection & parsing strategy

- `.als` → full metadata extraction (Ableton, primary)
- `.alp` → basic (Ableton Live Pack — no XML access)
- `.logicx`, `.flp`, `.ptx`, `.cpr` → filesystem metadata only (name, size, dates)
- `.rpp` → plain text, basic key/value extraction possible (v2 candidate)

Minimum Ableton version floor: **Live 10** (key/scale metadata requires Live 11 but is optional).

---

## 6. React Component Structure

```
src/
├── App.tsx                      # Tauri event listeners, router root
├── db/
│   ├── schema.ts                # Drizzle schema
│   ├── client.ts                # Drizzle + tauri-plugin-sql init
│   └── queries/
│       ├── projects.ts          # getProjects, upsertProject, deleteProject
│       ├── tags.ts              # getTags, createTag, assignTag
│       └── folders.ts          # getWatchedFolders, addFolder
├── lib/
│   ├── scanner.ts               # wraps scan_folder + handles scan:* events
│   ├── watcher.ts               # wraps start_watcher, listens to project:* events
│   └── metadata.ts              # merges Rust ProjectMetadata → Drizzle project row
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx          # watched folders, smart collections, tag filters
│   │   └── Topbar.tsx           # search input, view toggle, add folder button
│   ├── library/
│   │   ├── ProjectGrid.tsx      # grid view
│   │   ├── ProjectList.tsx      # list view with sortable columns
│   │   ├── ProjectCard.tsx      # single project tile (grid)
│   │   └── ProjectRow.tsx       # single project row (list)
│   ├── project/
│   │   ├── ProjectDetail.tsx    # slide-over panel: metadata, tags, notes
│   │   └── MetadataBadges.tsx   # BPM, key, DAW, status chips
│   └── onboarding/
│       └── AddFolderPrompt.tsx  # shown when no folders watched yet
└── hooks/
    ├── useProjects.ts           # query + live-update subscription
    ├── useScanner.ts            # trigger scan, track progress
    └── useWatcher.ts            # subscribe to Rust file events
```

**Layer rule:** `db/queries/` are plain async functions — no React, no state. Hooks call queries and own reactivity. Components call hooks only.

---

## 7. DAW Support Matrix (v1)

| DAW          | Extension | BPM | Key           | Plugins | Tracks | Notes                     |
| ------------ | --------- | --- | ------------- | ------- | ------ | ------------------------- |
| Ableton Live | `.als`    | ✅  | ✅ (Live 11+) | ✅      | ✅     | Primary, full extraction  |
| Logic Pro    | `.logicx` | —   | —             | —       | —      | Name + date + size only   |
| FL Studio    | `.flp`    | —   | —             | —       | —      | Name + date + size only   |
| Pro Tools    | `.ptx`    | —   | —             | —       | —      | Name + date + size only   |
| Cubase       | `.cpr`    | —   | —             | —       | —      | Name + date + size only   |
| Reaper       | `.rpp`    | —   | —             | —       | —      | Plain text — v2 candidate |

---

## 8. Performance Targets

| Metric                            | Target                 |
| --------------------------------- | ---------------------- |
| Initial scan — 1,000 projects     | < 30s                  |
| Search / filter — 10,000 projects | < 100ms                |
| App cold start                    | < 2s to interactive UI |
| Idle memory — 5,000 projects      | < 300MB                |

---

## 9. Key UX Decisions

- **Local-first:** works fully offline; no cloud dependency in v1
- **Non-destructive:** app never writes to DAW project files; metadata lives in its own SQLite DB
- **Live folder watching:** background `notify` watcher with 2s debounce; no manual rescan required
- **Graceful degradation:** if `.als` parsing fails, show project with filesystem metadata only — never hide the project
- **Onboarding:** `AddFolderPrompt` shown on first launch; no empty state without a clear CTA

---

## 10. Open Questions (deferred)

1. Sample management — track references only, or offer consolidation/repair?
2. Sync vs backup semantics — v1 is backup-only; two-way sync is v3+
3. Lyrics editor scope — plain text only or basic chord formatting?
4. Plugin inventory view — "which projects use Serum?"

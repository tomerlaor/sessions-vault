# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-development. `REQUIREMENTS_1.md` is the authoritative spec. No code exists yet.

## What we're building

**DAW File Manager** — a local-first desktop app for music creators to organize, search, tag, and back up DAW projects (Ableton Live primary, plus Logic, FL Studio, Pro Tools, Cubase, Reaper).

## Planned tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2.x |
| Frontend | React + TypeScript + Tailwind |
| Backend (Rust) | Tauri commands, filesystem, cloud sync |
| Local DB | SQLite via `rusqlite` or `sqlx` |
| `.als` parsing | `flate2` (gzip) + `quick-xml` (Ableton files are gzipped XML) |
| Cloud | Dropbox API, Google Drive API, AWS S3 SDK — behind a `CloudProvider` trait |
| OS credentials | OS keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux) |

## Architecture principles from the spec

- **Non-destructive:** never modify original DAW project files; all metadata lives in the app's own SQLite DB plus per-project sidecar folders (`<project>.dawmgr/`)
- **Local-first:** app works fully offline; cloud is sync layer only
- **Graceful degradation:** if deep parsing fails, fall back to filesystem-level metadata
- **`CloudProvider` trait:** abstracts Dropbox / Google Drive / S3-compatible backends so they're interchangeable

## Core data model

```
Project        — id, name, title, description, daw_type, daw_version, file_path,
                 file_hash, size_bytes, bpm, key, scale, time_signature, rating, status
Tag            — id, name, color
Attachment     — id, project_id, type (lyrics|tab|audio|image|other), file_path
BackupRecord   — id, project_id, provider, remote_path, snapshot_timestamp, status, checksum
Plugin         — id, name, manufacturer, format (VST3|AU|AAX)
Sample         — id, name, file_path_at_scan, exists, size_bytes
```

## Performance targets to keep in mind

- Initial scan of 1,000 projects: <30 s
- Search / filter on 10,000-project library: <100 ms
- App cold start: <2 s to interactive UI
- Idle memory with 5,000-project library: <300 MB

## Ableton `.als` parsing notes

`.als` files are gzip-compressed XML. Decompress with `flate2`, then parse with `quick-xml`. Target Live 10+ as the minimum version floor. Fields of interest: `<Tempo>`, `<KeyScale>` (Live 11+), `<TimeSignature>`, track elements, plugin references, and sample file references.

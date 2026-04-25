# SessionsVault

> Your DAW projects, organized.

![CI](https://github.com/tomerlaor/sessions-vault/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)
![Status](https://img.shields.io/badge/status-pre--development-orange.svg)

SessionsVault is a local-first desktop app for music creators to organize, search, tag, and back up DAW projects. Instead of hunting through folders named `song_idea_v7_FINAL_actual_final`, you get a searchable, tagged library with project metadata (key, BPM, mood), attached lyrics and tab files, and automated cloud backups.

---

## Screenshot

> _App is in pre-development — screenshot coming soon._

---

## Features (v1)

- **Scan & index** — point the app at your Music folder, get every project indexed with BPM, key, and track count extracted automatically from Ableton `.als` files
- **Search** — full-text search across titles, descriptions, lyrics, tags, and filenames
- **Tags & metadata** — genre, mood, status (`draft`, `mixed`, `released`), star rating
- **Attachments** — attach lyrics, tabs, reference audio, and cover art per project
- **Cloud backup** — Dropbox, Google Drive, and S3-compatible providers with versioned snapshots
- **Non-destructive** — never touches your original project files

Full requirements: [REQUIREMENTS_1.md](./REQUIREMENTS_1.md)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2.x](https://tauri.app) |
| Frontend | React + TypeScript + Tailwind |
| Backend | Rust |
| Local database | SQLite (`rusqlite` / `sqlx`) |
| `.als` parsing | `flate2` + `quick-xml` |
| Cloud sync | Dropbox API, Google Drive API, AWS S3 SDK |

---

## Building Locally

> _Build instructions will be added once the project is scaffolded._

Requirements (coming soon):
- Rust 1.75+
- Node.js 20+
- Tauri CLI

---

## Roadmap (v1)

- [ ] Project discovery & Ableton `.als` metadata extraction
- [ ] Library views (grid + list), search, filters
- [ ] Tags, ratings, and user annotations
- [ ] Attachment support (lyrics, tabs, audio, images)
- [ ] Cloud backup — Dropbox, Google Drive, S3
- [ ] macOS, Windows, Linux builds

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.

## License

Apache 2.0 © 2026 Tomer Laor — see [LICENSE](./LICENSE).

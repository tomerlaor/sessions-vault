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

## Install

Download the latest `.dmg` from the [Releases page](https://github.com/tomerlaor/sessions-vault/releases).

1. Open the `.dmg` and drag **SessionsVault** to your Applications folder
2. On first launch, macOS may show *"SessionsVault can't be opened because it is from an unidentified developer"*
3. To bypass: right-click the app icon → **Open** → **Open** again in the dialog
4. You only need to do this once — subsequent launches work normally

> SessionsVault is open source (Apache 2.0). The app is not yet notarized with Apple. [View the source](https://github.com/tomerlaor/sessions-vault) if you'd like to verify it yourself or build from source.

---


## Features (v1)

- **Scan & index** — point the app at your Music folder, get every project indexed with BPM, key, and track count extracted automatically from Ableton `.als` files
- **Search** — full-text search across titles, descriptions, lyrics, tags, and filenames
- **Tags & metadata** — genre, mood, status (`draft`, `mixed`, `released`), star rating
- **Attachments** — attach lyrics, tabs, reference audio, and cover art per project
- **Cloud backup** — Dropbox, Google Drive, and S3-compatible providers with versioned snapshots
- **Non-destructive** — never touches your original project files

Full requirements: [REQUIREMENTS_1.md](./docs/REQUIREMENTS_1.md)

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

**Requirements:**
- [Rust](https://rustup.rs) 1.75+
- [Node.js](https://nodejs.org) 20+

```bash
git clone https://github.com/tomerlaor/sessions-vault.git
cd sessions-vault
npm install
npm run tauri dev
```

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

Contributions are welcome. Please read [CONTRIBUTING.md](./docs/CONTRIBUTING.md) before opening a PR.

## License

Apache 2.0 © 2026 Tomer Laor — see [LICENSE](./LICENSE).

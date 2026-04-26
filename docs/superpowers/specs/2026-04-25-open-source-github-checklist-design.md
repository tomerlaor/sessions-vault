# Open Source GitHub Launch — Design Spec

**Date:** 2026-04-25  
**Status:** Approved  
**Project:** SessionsVault (formerly DAW File Manager)  
**Scope:** Option B — Community-ready open source on a personal GitHub account

---

## Context

The project is pre-development with a complete requirements document. This is the right moment to establish open-source infrastructure before any code lands. The repo will live on a personal GitHub account and be maintained initially solo with a small number of known collaborators.

**App name:** SessionsVault  
**License:** Apache 2.0 (standard for Rust ecosystem; includes patent protection; allows future monetization)  
**CI/CD:** Basic only — lint and format checks on PRs, no cross-platform builds yet  
**Analytics:** None in v1 — removed from scope; open source audience values privacy, can revisit later  
**Logo:** Arrangement-view bars mark (Ableton-inspired horizontal track grid), `#ff5a00` orange accent, horizontal lockup — asset saved at `docs/brand/logo.svg`

---

## Section 1: Repository Foundation

- [ ] Create repo on GitHub (public, no auto-generated README)
- [ ] Add `.gitignore` — Rust + Node + macOS/Windows/Linux build artifacts
- [ ] Add `LICENSE` — Apache 2.0 with name and year
- [ ] Initial commit: `REQUIREMENTS_1.md`, `CLAUDE.md`, `LICENSE`, `.gitignore`
- [ ] Create `main` as default branch; create `dev` branch for active development
- [ ] Enable branch protection on `main` — require PR before merge; set required approvals to 1 once a collaborator joins (0 while solo, to avoid blocking yourself)

---

## Section 2: Documentation Files

- [ ] Write `README.md` covering:
  - Project name + one-line description
  - Status badge ("pre-development / in progress")
  - Screenshot placeholder
  - What it does (pulled from requirements)
  - Planned tech stack (Tauri, Rust, React, SQLite)
  - How to build locally (placeholder, fill in when code exists)
  - Link to `REQUIREMENTS_1.md` as the living spec
  - Roadmap section (v1 goals from requirements)
  - License + contributing links
- [ ] Write `CONTRIBUTING.md` covering:
  - How to open an issue before starting work
  - Branch naming convention (`feature/`, `fix/`, `chore/`)
  - PR checklist (tests pass, lint passes, description filled)
  - Code style: `rustfmt` for Rust, Prettier for TypeScript
  - How to reach the maintainer (GitHub Discussions or email)
- [ ] Add `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1

---

## Section 3: GitHub Platform Configuration

- [ ] Create `.github/` folder with:
  - `ISSUE_TEMPLATE/bug_report.md` — steps to reproduce, OS, DAW version
  - `ISSUE_TEMPLATE/feature_request.md` — structured feature idea form
  - `pull_request_template.md` — description, type of change, testing notes
- [ ] Set up GitHub Labels:
  - Standard: `bug`, `enhancement`, `good first issue`, `help wanted`, `wontfix`
  - DAW-specific: `ableton`, `logic`, `fl-studio`
  - Area: `rust/backend`, `frontend`, `cloud-sync`, `parser`
- [ ] Pin repo to GitHub profile
- [ ] Enable GitHub Discussions
- [ ] Add repo topics: `tauri`, `rust`, `ableton`, `daw`, `music-production`, `desktop-app`

---

## Section 4: Basic CI/CD

- [ ] Create `.github/workflows/ci.yml`:
  - Rust: `cargo fmt --check` + `cargo clippy` (no warnings)
  - TypeScript: `prettier --check` + `eslint`
  - Triggers: push to `main`/`dev`, all PRs
- [ ] Add CI status badge to `README.md`
- [ ] Document in `CONTRIBUTING.md` that PRs must pass CI before review

---

## Section 5: App Name & Branding

- [ ] Use **SessionsVault** as the official app name throughout all files (README, CONTRIBUTING, LICENSE header, `tauri.conf.json` when scaffolded)
- [ ] GitHub repo name: `sessions-vault` (kebab-case convention)
- [ ] Tagline: *"Your DAW projects, organized."*

### Brand Assets (`docs/brand/`)

- [ ] `logo.svg` — horizontal lockup (mark + wordmark) ✅ done
- [ ] `icon.svg` — mark only, inside dark `#1a1a1a` rounded square, for use as app icon source
- [ ] Export `icon.svg` → PNG at required Tauri sizes:
  - `32x32.png`, `128x128.png`, `256x256.png` (128x128@2x), `512x512.png`
  - `icon.icns` — macOS dock + Finder (generated from PNGs via `iconutil`)
  - `icon.ico` — Windows taskbar + Explorer (generated from PNGs)
  - All exported files go into `src-tauri/icons/` when the Tauri project is scaffolded
- [ ] Wire icon into `tauri.conf.json` → `tauri.bundle.icon` array

---

## Section 6: UI Legal & Informational Requirements

### About Window (triggered from menu bar: Help → About SessionsVault)

A standard desktop modal containing:

- Horizontal logo lockup (`logo.svg`) at the top
- App name: **SessionsVault**
- Version number (dynamic, pulled from `tauri.conf.json`)
- Tagline: *"Your DAW projects, organized."*
- Copyright: `© 2026 Tomer Laor. All rights reserved.`
- License: `Apache 2.0` — with a clickable link to the full license text (opens in browser)
- GitHub repo link
- Built-with credits: Tauri, React, Rust

### App Icon & Taskbar

- macOS dock + Finder: `icon.icns` (mark-only, dark rounded square background)
- Windows taskbar + Explorer: `icon.ico`
- Linux desktop: `512x512.png`
- Window title bar: 32×32 PNG shown next to "SessionsVault" in the OS window chrome
- All sizes sourced from `icon.svg` in `docs/brand/`

### Notes

- No telemetry, no analytics, no opt-in prompt — removed from v1 scope entirely
- No EULA or first-run legal screen required (Apache 2.0 is permissive, no user agreement needed)
- Copyright line also appears in the `LICENSE` file in the repo root

---

## Section 7: Launch

- [ ] Final review pass — placeholder text, correct name in LICENSE, no secrets or local paths
- [ ] Make repo public on GitHub
- [ ] Create `v0.1.0-pre` release tag ("requirements complete, development starting")
- [ ] Share in relevant communities:
  - Reddit: r/ableton, r/WeAreTheMusicMakers, r/rust, r/tauri
  - Personal social/dev channels if relevant

---

## Section 8: Versioning Strategy

- **Scheme:** Semver — `vMAJOR.MINOR.PATCH`
- **Source of truth:** version in `tauri.conf.json` — Tauri syncs to `Cargo.toml` and `package.json` at build time
- **Automation:** `release-please` GitHub Action watches `main` for conventional commits, opens a Release PR with bumped version + auto-generated `CHANGELOG.md`
- **Version bump rules:**
  - `feat:` → minor bump (e.g. `v0.2.0`)
  - `fix:` → patch bump (e.g. `v0.1.1`)
  - `feat!:` or `BREAKING CHANGE:` → major bump (e.g. `v1.0.0`)
  - `chore:`, `docs:`, `ci:` → no bump
- **Release flow:** merge Release PR → tag created → build workflow fires → `.dmg` attached to GitHub Release

### Files

- [ ] Create `.github/workflows/release-please.yml` — runs on push to `main`, manages Release PRs
- [ ] Create `release-please-config.json` — configures release-please for a Tauri monorepo layout
- [ ] `CHANGELOG.md` — auto-generated and maintained by release-please

---

## Section 9: Release Build Workflow (macOS)

- **Trigger:** push of tags matching `v*.*.*`
- **Runner:** `macos-latest`
- **Build tool:** `tauri-apps/tauri-action`
- **Signing:** ad-hoc (`codesign --deep --force --sign -`) — removes "damaged" error on Apple Silicon; Gatekeeper warning still appears, right-click → Open workaround documented in README
- **Output:** `SessionsVault_x.x.x_universal.dmg` (universal binary — Intel + Apple Silicon)
- **Distribution:** binary attached to GitHub Release automatically

### Files

- [ ] Create `.github/workflows/release-build.yml` — triggered by version tags, builds and signs `.dmg`, attaches to release

---

## Section 10: Installation Instructions

Add **Install** section to `README.md` (above "Building Locally"):

```markdown
## Install

Download the latest `.dmg` from the [Releases page](https://github.com/tomerlaor/sessions-vault/releases).

1. Open the `.dmg` and drag **SessionsVault** to your Applications folder
2. On first launch, macOS may show *"SessionsVault can't be opened because it is from an unidentified developer"*
3. To bypass: right-click the app icon → **Open** → **Open** again in the dialog
4. You only need to do this once — subsequent launches work normally

> SessionsVault is open source (Apache 2.0). The app is not yet notarized with Apple. [View the source](https://github.com/tomerlaor/sessions-vault) if you'd like to verify it yourself or build from source.
```

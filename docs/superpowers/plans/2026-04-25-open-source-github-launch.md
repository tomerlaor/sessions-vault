# SessionsVault Open Source GitHub Launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish SessionsVault as a community-ready open source project on GitHub with full documentation, GitHub configuration, brand assets, and basic CI.

**Architecture:** All work is file creation and GitHub configuration — no application code yet. The project is pre-development; the Tauri app will be scaffolded in a later plan. The About window and `tauri.conf.json` icon wiring are noted as deferred tasks at the end.

**Tech Stack:** GitHub CLI (`gh`), `librsvg` (`rsvg-convert`) for icon export, `iconutil` (macOS built-in) for `.icns`, ImageMagick for `.ico`.

---

## Deferred (requires Tauri scaffold — do in next plan)

- About window React component
- Wiring icons into `tauri.conf.json`
- Window title bar icon

---

## File Map

| File                                        | Purpose                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `.gitignore`                                | Excludes Rust/Node/Tauri/macOS/Windows build artifacts |
| `LICENSE`                                   | Apache 2.0, © 2026 Tomer Laor                          |
| `README.md`                                 | Project homepage, badges, tech stack, roadmap          |
| `CONTRIBUTING.md`                           | Contributor guide, branch naming, code style, CI gate  |
| `CODE_OF_CONDUCT.md`                        | Contributor Covenant v2.1                              |
| `.github/ISSUE_TEMPLATE/bug_report.md`      | Structured bug report form                             |
| `.github/ISSUE_TEMPLATE/feature_request.md` | Structured feature request form                        |
| `.github/pull_request_template.md`          | PR checklist                                           |
| `.github/workflows/ci.yml`                  | Lint + format check on push/PR                         |
| `docs/brand/icon.svg`                       | App icon source — mark only, 512×512 ✅ exists         |
| `docs/brand/logo.svg`                       | Horizontal lockup — mark + wordmark ✅ exists          |
| `docs/brand/icons/`                         | Exported PNGs + .icns + .ico                           |

---

## Task 1: Create GitHub Repository

**Files:** GitHub remote (no local files)

- [ ] **Step 1: Create public repo via gh CLI**

```bash
gh repo create sessions-vault \
  --public \
  --description "Your DAW projects, organized." \
  --no-readme
```

Expected output: `✓ Created repository <yourname>/sessions-vault on GitHub`

- [ ] **Step 2: Add remote to local project**

```bash
git init
git remote add origin https://github.com/<yourname>/sessions-vault.git
```

- [ ] **Step 3: Verify remote**

```bash
git remote -v
```

Expected:

```
origin  https://github.com/<yourname>/sessions-vault.git (fetch)
origin  https://github.com/<yourname>/sessions-vault.git (push)
```

---

## Task 2: .gitignore and LICENSE

**Files:**

- Create: `.gitignore`
- Create: `LICENSE`

- [ ] **Step 1: Write .gitignore**

Create `.gitignore` at project root with this content:

```gitignore
# Rust
target/
**/*.rs.bk
Cargo.lock

# Tauri
src-tauri/target/

# Node / frontend
node_modules/
dist/
.env
.env.local

# macOS
.DS_Store
.AppleDouble
.LSOverride

# Windows
Thumbs.db
Desktop.ini

# IDE
.idea/
.vscode/
*.swp
*.swo

# Superpowers brainstorm sessions
.superpowers/
```

- [ ] **Step 2: Write LICENSE**

Create `LICENSE` at project root with the full Apache 2.0 text:

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship made available under
      the License, as indicated by a copyright notice that is included in
      or attached to the work.

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship.

      "Contribution" shall mean, as submitted to the Licensor for inclusion
      in the Work by the copyright owner or by an individual or Legal Entity
      authorized to submit on behalf of the copyright owner.

      "Contributor" shall mean Licensor and any Legal Entity on behalf of
      whom a Contribution has been received by the Licensor and included
      within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      patent license to make, have made, use, offer to sell, sell,
      import, and otherwise transfer the Work.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative
          Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work; and

      (d) If the Work includes a "NOTICE" text file, you may reproduce
          and distribute a copy of the NOTICE file.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor.

   7. Disclaimer of Warranty. Unless required by applicable law or agreed
      to in writing, Licensor provides the Work on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      shall any Contributor be liable to You for damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may offer, and charge a
      fee for, acceptance of support, warranty, indemnity, or other
      liability obligations and rights consistent with this License.

   END OF TERMS AND CONDITIONS

   Copyright 2026 Tomer Laor

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

- [ ] **Step 3: Initial commit**

```bash
git add .gitignore LICENSE REQUIREMENTS_1.md CLAUDE.md docs/brand/
git commit -m "chore: initial repo setup — license, gitignore, brand assets"
```

- [ ] **Step 4: Push to main**

```bash
git branch -M main
git push -u origin main
```

---

## Task 3: README.md

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write README.md**

Create `README.md` at project root:

```markdown
# SessionsVault

> Your DAW projects, organized.

![CI](https://github.com/<yourname>/sessions-vault/actions/workflows/ci.yml/badge.svg)
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

| Layer          | Technology                                |
| -------------- | ----------------------------------------- |
| Desktop shell  | [Tauri 2.x](https://tauri.app)            |
| Frontend       | React + TypeScript + Tailwind             |
| Backend        | Rust                                      |
| Local database | SQLite (`rusqlite` / `sqlx`)              |
| `.als` parsing | `flate2` + `quick-xml`                    |
| Cloud sync     | Dropbox API, Google Drive API, AWS S3 SDK |

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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with project overview, tech stack, and roadmap"
```

---

## Task 4: CONTRIBUTING.md

**Files:**

- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Write CONTRIBUTING.md**

Create `CONTRIBUTING.md` at project root:

````markdown
# Contributing to SessionsVault

Thanks for your interest in contributing. Here's everything you need to know.

## Before You Start

**Open an issue first.** Before writing any code, open an issue describing what you want to build or fix. This prevents duplicate work and makes sure the change aligns with the project's direction.

## Branch Naming

| Type           | Pattern                | Example                     |
| -------------- | ---------------------- | --------------------------- |
| Feature        | `feature/<short-name>` | `feature/ableton-parser`    |
| Bug fix        | `fix/<short-name>`     | `fix/scan-crash-on-symlink` |
| Chore / config | `chore/<short-name>`   | `chore/update-dependencies` |

Always branch off `dev`, not `main`.

## Pull Requests

- Fill in the PR template completely
- Keep PRs focused — one feature or fix per PR
- PRs must pass CI before review (see below)
- Link the related issue in your PR description

## Code Style

**Rust:** Format with `rustfmt` before committing.

```bash
cargo fmt
cargo clippy -- -D warnings
```
````

**TypeScript / React:** Format with Prettier, lint with ESLint.

```bash
npx prettier --write .
npx eslint .
```

## CI Gate

Every PR runs `cargo fmt --check`, `cargo clippy`, `prettier --check`, and `eslint`. If CI fails, the PR won't be reviewed until it passes.

## Getting Help

Open a thread in [GitHub Discussions](https://github.com/<yourname>/sessions-vault/discussions) or reach out via the issue tracker.

````

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add CONTRIBUTING guide with branch naming, code style, and CI gate"
````

---

## Task 5: CODE_OF_CONDUCT.md

**Files:**

- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1: Write CODE_OF_CONDUCT.md**

Create `CODE_OF_CONDUCT.md` at project root (Contributor Covenant v2.1):

```markdown
# Contributor Covenant Code of Conduct

## Our Pledge

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, caste, color, religion, or sexual identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming, diverse, inclusive, and healthy community.

## Our Standards

Examples of behavior that contributes to a positive environment:

- Demonstrating empathy and kindness toward other people
- Being respectful of differing opinions, viewpoints, and experiences
- Giving and gracefully accepting constructive feedback
- Accepting responsibility and apologizing to those affected by our mistakes
- Focusing on what is best not just for us as individuals, but for the overall community

Examples of unacceptable behavior:

- The use of sexualized language or imagery, and sexual attention or advances of any kind
- Trolling, insulting or derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information without their explicit permission
- Other conduct which could reasonably be considered inappropriate in a professional setting

## Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.

## Scope

This Code of Conduct applies within all community spaces, and also applies when an individual is officially representing the community in public spaces.

## Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the community leaders responsible for enforcement at tomerlaor@gmail.com. All complaints will be reviewed and investigated promptly and fairly.

## Attribution

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 2.1.
```

- [ ] **Step 2: Commit**

```bash
git add CODE_OF_CONDUCT.md
git commit -m "docs: add Contributor Covenant v2.1 code of conduct"
```

---

## Task 6: GitHub Issue & PR Templates

**Files:**

- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Create bug report template**

Create `.github/ISSUE_TEMPLATE/bug_report.md`:

```markdown
---
name: Bug report
about: Something isn't working correctly
labels: bug
---

## What happened?

<!-- A clear description of the bug -->

## Steps to reproduce

1.
2.
3.

## Expected behavior

<!-- What should have happened -->

## Environment

- OS: <!-- e.g. macOS 14.4, Windows 11 -->
- SessionsVault version: <!-- e.g. v0.2.0 -->
- DAW (if relevant): <!-- e.g. Ableton Live 11.3 -->

## Logs / screenshots

<!-- Paste any relevant logs or attach a screenshot -->
```

- [ ] **Step 2: Create feature request template**

Create `.github/ISSUE_TEMPLATE/feature_request.md`:

```markdown
---
name: Feature request
about: Suggest an improvement or new feature
labels: enhancement
---

## What problem does this solve?

<!-- Describe the pain point or use case -->

## Proposed solution

<!-- How would you like it to work? -->

## Alternatives considered

<!-- Any other approaches you thought about? -->

## Additional context

<!-- Screenshots, mockups, links — anything helpful -->
```

- [ ] **Step 3: Create PR template**

Create `.github/pull_request_template.md`:

```markdown
## What does this PR do?

<!-- One sentence summary -->

## Related issue

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Documentation

## Testing

- [ ] I tested this manually on my machine
- [ ] Existing tests pass (`cargo test` / `npm test`)
- [ ] I added tests for new behavior

## Checklist

- [ ] `cargo fmt` and `cargo clippy` pass
- [ ] `prettier` and `eslint` pass
- [ ] PR title is descriptive
- [ ] I linked the related issue above
```

- [ ] **Step 4: Commit**

```bash
git add .github/
git commit -m "chore: add GitHub issue templates and PR template"
```

---

## Task 7: CI Workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write ci.yml**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:

jobs:
  rust:
    name: Rust — fmt & clippy
    runs-on: ubuntu-latest
    # Only runs when Rust source files exist
    steps:
      - uses: actions/checkout@v4

      - name: Check if Cargo.toml exists
        id: cargo_check
        run: |
          if [ -f "src-tauri/Cargo.toml" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Install Rust toolchain
        if: steps.cargo_check.outputs.exists == 'true'
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy

      - name: cargo fmt --check
        if: steps.cargo_check.outputs.exists == 'true'
        run: cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

      - name: cargo clippy
        if: steps.cargo_check.outputs.exists == 'true'
        run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

  frontend:
    name: Frontend — prettier & eslint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check if package.json exists
        id: pkg_check
        run: |
          if [ -f "package.json" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

      - name: Setup Node.js
        if: steps.pkg_check.outputs.exists == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        if: steps.pkg_check.outputs.exists == 'true'
        run: npm ci

      - name: Prettier check
        if: steps.pkg_check.outputs.exists == 'true'
        run: npx prettier --check .

      - name: ESLint
        if: steps.pkg_check.outputs.exists == 'true'
        run: npx eslint .
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for Rust fmt/clippy and TS prettier/eslint"
```

- [ ] **Step 3: Push dev branch**

```bash
git checkout -b dev
git push -u origin dev
git checkout main
```

---

## Task 8: Export Brand Icons

**Files:**

- Create: `docs/brand/icons/` — 32x32, 128x128, 256x256, 512x512 PNGs, icon.icns, icon.ico

- [ ] **Step 1: Install rsvg-convert**

```bash
brew install librsvg imagemagick
```

Expected: both packages install without error.

- [ ] **Step 2: Create icons output directory**

```bash
mkdir -p docs/brand/icons
```

- [ ] **Step 3: Export PNGs from icon.svg**

```bash
for size in 32 128 256 512; do
  rsvg-convert -w $size -h $size docs/brand/icon.svg -o docs/brand/icons/${size}x${size}.png
done
```

Verify:

```bash
ls -lh docs/brand/icons/
```

Expected: four PNG files, roughly 1–50KB each.

- [ ] **Step 4: Generate icon.icns (macOS)**

```bash
mkdir -p docs/brand/icons/SessionsVault.iconset
cp docs/brand/icons/32x32.png   docs/brand/icons/SessionsVault.iconset/icon_32x32.png
cp docs/brand/icons/128x128.png docs/brand/icons/SessionsVault.iconset/icon_128x128.png
cp docs/brand/icons/256x256.png docs/brand/icons/SessionsVault.iconset/icon_128x128@2x.png
cp docs/brand/icons/512x512.png docs/brand/icons/SessionsVault.iconset/icon_256x256@2x.png
iconutil -c icns docs/brand/icons/SessionsVault.iconset -o docs/brand/icons/icon.icns
```

Verify:

```bash
ls -lh docs/brand/icons/icon.icns
```

Expected: file exists, ~50–200KB.

- [ ] **Step 5: Generate icon.ico (Windows)**

```bash
convert docs/brand/icons/32x32.png \
        docs/brand/icons/128x128.png \
        docs/brand/icons/256x256.png \
        docs/brand/icons/icon.ico
```

Verify:

```bash
ls -lh docs/brand/icons/icon.ico
```

Expected: file exists.

- [ ] **Step 6: Commit brand icons**

```bash
git add docs/brand/icons/
git commit -m "chore: export brand icons — PNG sizes, icns, ico from icon.svg"
```

---

## Task 9: Configure GitHub via CLI

**Note:** These steps require `gh auth login` to be complete. Run `gh auth status` first.

- [ ] **Step 1: Verify gh is authenticated**

```bash
gh auth status
```

Expected: `✓ Logged in to github.com as <yourname>`

- [ ] **Step 2: Set repo topics**

```bash
gh repo edit sessions-vault \
  --add-topic tauri \
  --add-topic rust \
  --add-topic ableton \
  --add-topic daw \
  --add-topic music-production \
  --add-topic desktop-app
```

- [ ] **Step 3: Enable GitHub Discussions**

```bash
gh repo edit sessions-vault --enable-discussions
```

- [ ] **Step 4: Create labels — standard**

```bash
gh label create "good first issue" --color "7057ff" --description "Good for newcomers" --repo <yourname>/sessions-vault
gh label create "help wanted"      --color "008672" --description "Extra attention needed" --repo <yourname>/sessions-vault
gh label create "wontfix"          --color "ffffff" --description "Won't be addressed" --repo <yourname>/sessions-vault
```

Note: `bug` and `enhancement` are created by GitHub by default — no need to recreate.

- [ ] **Step 5: Create labels — DAW-specific**

```bash
gh label create "ableton"    --color "ff5a00" --description "Ableton Live specific" --repo <yourname>/sessions-vault
gh label create "logic"      --color "d4a017" --description "Logic Pro specific"    --repo <yourname>/sessions-vault
gh label create "fl-studio"  --color "e91e63" --description "FL Studio specific"    --repo <yourname>/sessions-vault
```

- [ ] **Step 6: Create labels — area**

```bash
gh label create "rust/backend" --color "b7410e" --description "Rust backend code"     --repo <yourname>/sessions-vault
gh label create "frontend"     --color "61dafb" --description "React/TS frontend"     --repo <yourname>/sessions-vault
gh label create "cloud-sync"   --color "4285f4" --description "Cloud backup/sync"     --repo <yourname>/sessions-vault
gh label create "parser"       --color "6f42c1" --description "DAW file parsing"      --repo <yourname>/sessions-vault
```

- [ ] **Step 7: Enable branch protection on main (via GitHub UI)**

GitHub CLI branch protection requires complex JSON. Do this in the UI instead:

1. Go to `github.com/<yourname>/sessions-vault/settings/branches`
2. Click **Add branch protection rule**
3. Branch name pattern: `main`
4. Check: **Require a pull request before merging**
5. Set required approvals to **0** (solo for now — change to 1 when a collaborator joins)
6. Check: **Do not allow bypassing the above settings**
7. Click **Save changes**

- [ ] **Step 8: Add CI badge to README.md**

Open `README.md` and confirm the badge line uses your actual GitHub username:

```markdown
![CI](https://github.com/<yourname>/sessions-vault/actions/workflows/ci.yml/badge.svg)
```

Replace `<yourname>` with your real GitHub username. Commit if changed:

```bash
git add README.md
git commit -m "docs: fix CI badge URL with correct GitHub username"
```

---

## Task 10: Launch

- [ ] **Step 1: Final review pass**

Check every file for:

- `<yourname>` placeholder — replace with real GitHub username
- Any local paths (e.g. `/Users/...`) that shouldn't be committed
- Correct name in LICENSE (`Tomer Laor`) and CODE_OF_CONDUCT (`tomerlaor@gmail.com`)

```bash
grep -r "<yourname>" .
grep -r "/Users/" . --include="*.md"
```

Both should return no results.

- [ ] **Step 2: Push everything**

```bash
git push origin main
```

- [ ] **Step 3: Pin repo to GitHub profile**

1. Go to `github.com/<yourname>`
2. Click **Customize your pins**
3. Add `sessions-vault`
4. Save

- [ ] **Step 4: Create v0.1.0-pre release tag**

```bash
git tag -a v0.1.0-pre -m "Requirements complete — development starting"
git push origin v0.1.0-pre
```

Then create a GitHub release:

```bash
gh release create v0.1.0-pre \
  --title "v0.1.0-pre — Requirements Complete" \
  --notes "Pre-development milestone. Requirements spec is complete. Application development starting. No runnable code yet." \
  --prerelease
```

- [ ] **Step 5: Share**

Post to:

- [r/ableton](https://reddit.com/r/ableton)
- [r/WeAreTheMusicMakers](https://reddit.com/r/WeAreTheMusicMakers)
- [r/rust](https://reddit.com/r/rust)
- [r/tauri](https://reddit.com/r/tauri)

Suggested post title: _"Building SessionsVault — open source DAW project organizer (Tauri + Rust + React). Looking for early feedback and contributors."_

---

---

## Task 11: Versioning & Release-Please Setup

**Files:**

- Create: `.github/workflows/release-please.yml`
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`

- [ ] **Step 1: Write release-please-config.json**

Create `release-please-config.json` at project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "simple",
  "packages": {
    ".": {
      "release-type": "simple",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "chore", "section": "Miscellaneous", "hidden": true },
        { "type": "docs", "section": "Documentation", "hidden": true },
        { "type": "ci", "section": "CI", "hidden": true }
      ]
    }
  }
}
```

- [ ] **Step 2: Write .release-please-manifest.json**

Create `.release-please-manifest.json` at project root:

```json
{
  ".": "0.1.0"
}
```

- [ ] **Step 3: Write release-please.yml**

Create `.github/workflows/release-please.yml`:

```yaml
name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 4: Commit**

```bash
git add release-please-config.json .release-please-manifest.json .github/workflows/release-please.yml
git commit -m "ci: add release-please for automated versioning and changelog"
git push
```

- [ ] **Step 5: Verify workflow appears in GitHub**

```bash
gh workflow list --repo tomerlaor/sessions-vault
```

Expected: `Release Please` appears in the list.

---

## Task 12: Release Build Workflow (macOS .dmg)

**Files:**

- Create: `.github/workflows/release-build.yml`

- [ ] **Step 1: Write release-build.yml**

Create `.github/workflows/release-build.yml`:

```yaml
name: Release Build

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  build-macos:
    name: Build macOS
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install frontend dependencies
        run: npm ci

      - name: Build Tauri app (universal)
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: ${{ github.ref_name }}
          releaseBody: "See [CHANGELOG.md](https://github.com/tomerlaor/sessions-vault/blob/main/CHANGELOG.md) for details."
          releaseDraft: false
          prerelease: false
          args: --target universal-apple-darwin

      - name: Ad-hoc sign the DMG
        run: |
          DMG=$(find . -name "*.dmg" | head -1)
          if [ -n "$DMG" ]; then
            codesign --deep --force --sign - "$DMG"
            echo "Signed: $DMG"
          fi
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release-build.yml
git commit -m "ci: add macOS release build workflow with ad-hoc signing"
git push
```

- [ ] **Step 3: Verify workflow appears in GitHub**

```bash
gh workflow list --repo tomerlaor/sessions-vault
```

Expected: `Release Build` appears in the list.

---

## Task 13: Install Instructions in README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add Install section to README.md**

Open `README.md` and insert the following section between the `## Screenshot` section and the `## Features (v1)` section:

```markdown
## Install

Download the latest `.dmg` from the [Releases page](https://github.com/tomerlaor/sessions-vault/releases).

1. Open the `.dmg` and drag **SessionsVault** to your Applications folder
2. On first launch, macOS may show _"SessionsVault can't be opened because it is from an unidentified developer"_
3. To bypass: right-click the app icon → **Open** → **Open** again in the dialog
4. You only need to do this once — subsequent launches work normally

> SessionsVault is open source (Apache 2.0). The app is not yet notarized with Apple. [View the source](https://github.com/tomerlaor/sessions-vault) if you'd like to verify it yourself or build from source.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Install section with macOS Gatekeeper workaround"
git push
```

---

## Deferred Tasks (next plan — after Tauri scaffold)

These require a scaffolded Tauri project and are out of scope for this plan:

- [ ] About window React component (`src/components/AboutWindow.tsx`) — show logo, version, copyright, license link, GitHub link, built-with credits
- [ ] Wire icons into `tauri.conf.json` `tauri.bundle.icon` array — copy `docs/brand/icons/` to `src-tauri/icons/`
- [ ] Window title bar icon — 32×32 PNG in `src-tauri/icons/`
- [ ] Update `tauri.conf.json` version to match release-please manifest on first scaffold

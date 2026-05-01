# SessionsVault — Tauri Scaffold & About Window Design Spec

**Date:** 2026-04-25
**Status:** Approved
**Scope:** Scaffold the Tauri 2.x project, wire brand assets, and implement the About window component

---

## Context

The open source repo is live at https://github.com/tomerlaor/sessions-vault. No application code exists yet. This spec covers scaffolding the full Tauri 2.x project with React + TypeScript + Tailwind, wiring in the existing brand icons, and building the About window as the first UI component.

**Scaffold method:** `npm create tauri-app@latest` (official CLI, `react-ts` template)
**Bundle ID:** `com.tomerlaor.sessionsvault` (permanent)
**App name:** SessionsVault
**Version:** 0.1.0 (managed by release-please going forward)

---

## Section 1: Project Scaffold Structure

Run `npm create tauri-app@latest` with:

- Project name: `sessions-vault`
- Frontend language: TypeScript + React
- Package manager: npm
- Template: `react-ts`

Generated structure:

```
sessions-vault/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   └── assets/
├── src-tauri/
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── icons/
│   └── tauri.conf.json
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**Post-scaffold steps:**

- Copy `docs/brand/icons/` → `src-tauri/icons/` with one rename: `256x256.png` → `128x128@2x.png` (Tauri's required name for that size)
- Final `src-tauri/icons/` contents: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`
- Install Tailwind CSS v3 + PostCSS + Autoprefixer
- `App.tsx` is a minimal placeholder — app shell only, no feature UI yet

---

## Section 2: Tauri Configuration (`src-tauri/tauri.conf.json`)

```json
{
  "productName": "SessionsVault",
  "version": "0.1.0",
  "identifier": "com.tomerlaor.sessionsvault",
  "bundle": {
    "active": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "windows": [
    {
      "title": "SessionsVault",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600
    }
  ]
}
```

Notes:

- `identifier` is `com.tomerlaor.sessionsvault` — do not change after first release
- `version` is kept in sync with `.release-please-manifest.json`
- Window min size of 800×600 prevents unusably small layouts

---

## Section 3: About Window Component

### Trigger

`Help → About SessionsVault` in the native OS menu bar. Registered in `src-tauri/src/main.rs` as a Tauri menu item that emits a frontend event `show-about`.

### Files

- `src/components/AboutWindow.tsx` — modal component
- `src/components/AboutWindow.css` — track motif background styles
- `src-tauri/src/main.rs` — registers Help menu, emits `show-about` event

### Design: Bold & Branded

- Small centered modal: **400×320px**, overlaid on the main window
- Dismiss: click outside or press `Escape`
- Dark background `#111111` with faint arrangement-bar track motif (opacity ~4%)
- App icon mark (SVG inline, from `docs/brand/icon.svg`) centered at top
- Wordmark: `Sessions` in white `#ffffff`, `Vault` in `#ff5a00`, font-weight 900
- Version + license line: `v0.1.0 · Apache 2.0` in `#555555`
- Two links side by side:
  - `License ↗` → opens `https://www.apache.org/licenses/LICENSE-2.0` in browser
  - `GitHub ↗` → opens `https://github.com/tomerlaor/sessions-vault` in browser
- Built-with line: `Built with Tauri · React · Rust` in `#444444`, small
- Copyright: `© 2026 Tomer Laor. All rights reserved.` in `#333333`, smallest

### Link behaviour

All external links use Tauri's `open` plugin (`@tauri-apps/plugin-shell`) to open URLs in the default browser — not `window.open`.

### Version source

Version string is read at runtime using `getVersion()` from `@tauri-apps/api/app` — it reads from `tauri.conf.json` which is the single source of truth managed by release-please.

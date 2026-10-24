# Full-Screen Project View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecting a project opens a full-screen view with an always-visible info rail and Lyrics and Tab editors side by side, split by a draggable divider.

**Architecture:** `DetailPanel` (a side column inside `<main>`) is replaced by `ProjectView`, which fills `<main>`. The list stays mounted but hidden while a project is open, so search, filters, sort and scroll position survive. The four info tabs become collapsible sections in a left `InfoRail`. Decision logic (neighbour lookup, divider clamping, Esc rule, flush rule) lives in one pure module so it can be unit-tested; components are verified by running the app.

**Tech Stack:** Tauri 2, React 19, TypeScript, plain CSS in `src/styles/app.css`, Vitest (node environment, no DOM — only pure logic is unit-tested).

**Spec:** `docs/superpowers/specs/2026-10-24-fullscreen-project-view-design.md` (story US-014 in `docs/REQUIREMENTS.md`)

## Global Constraints

- Minimum width of each of the Lyrics and Tab panes: 320 px.
- Divider: default 50/50, double-click resets to 50/50, position remembered between sessions.
- Rail: fixed width about 280 px, not resizable, each section collapsible.
- Below 1100 px window width the rail becomes an icon strip; below 900 px Lyrics and Tab stack vertically with a horizontal divider.
- Esc goes back only when focus is not in a text input, textarea, select, editable cell, rename field, or the Lyrics AI overlay.
- Pending edits must be saved before leaving a project (Back, Esc, previous/next); leaving must never lose an edit.
- Never modify DAW project files; no data-model or schema change; saving works exactly as today.
- Do not push to `dev` directly; work on branch `docs/fullscreen-project-view` (rename to `feat/fullscreen-project-view` before opening the PR) and open a PR into `dev`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The open project disappears from the loaded list (watcher reload, archive under an "active" filter, search narrows it out): the view must fall back to the list, and previous/next must not crash. → Task 1 (`adjacentProjectIds` with an unknown id), Task 5.
2. Window narrower than 2 × 320 px of workspace: the divider must stay finite and sane (no NaN, no negative widths). → Task 1 (`clampSplit`).
3. Corrupt or missing stored divider value (empty, "abc", 5, -1): fall back to 0.5. → Task 1 (`parseStoredSplit`).
4. Empty list or a single project: both arrows disabled. → Task 1, Task 4.
5. Leaving while editing lyrics: changed draft is saved to the right project; an unchanged draft writes nothing; previous/next never writes the old draft into the new project. → Task 1 (`shouldFlushLyrics`), Task 4.
6. Esc pressed while typing in notes, tags, rename, lyrics, or any overlay must not leave the project. → Task 1 (`isEditableTarget`), Task 5.

---

## File Structure

- Create `src/lib/project-view.ts` — pure helpers (neighbours, divider math, Esc rule, flush rule).
- Create `tests/project-view.test.ts` — unit tests for the above.
- Create `src/hooks/useMediaQuery.ts`, `src/hooks/useSplitRatio.ts` — small hooks.
- Create `src/components/detail/SplitPane.tsx` — two panes plus draggable divider.
- Create `src/components/detail/InfoRail.tsx` — rail with collapsible sections and icon-strip mode.
- Rename `src/components/detail/DetailPanel.tsx` → `src/components/detail/ProjectView.tsx` (use `git mv` to keep history) and rework it.
- Modify `src/components/detail/tabs/LyricsTab.tsx` (flush on leave), `src/components/library/ProjectList.tsx` (scroll ref), `src/App.tsx` (view switch, Esc, neighbours), `src/styles/app.css`.

---

### Task 1: Pure helpers

**Files:**
- Create: `src/lib/project-view.ts`
- Test: `tests/project-view.test.ts`

**Interfaces:**
- Produces:
  - `export const MIN_PANE_PX = 320`
  - `export const DEFAULT_SPLIT = 0.5`
  - `adjacentProjectIds(ids: readonly string[], currentId: string): { prev: string | null; next: string | null }`
  - `clampSplit(ratio: number, containerPx: number, minPanePx?: number): number` — returns the left (or top) pane's share, 0..1
  - `parseStoredSplit(raw: string | null): number`
  - `isEditableTarget(t: { tagName?: string; isContentEditable?: boolean } | null): boolean`
  - `shouldFlushLyrics(editing: boolean, draft: string, saved: string): boolean`

- [ ] **Step 1: Write the failing tests** in `tests/project-view.test.ts`, following the style of `tests/project-files.test.ts`:
  - `adjacentProjectIds(["a","b","c"], "b")` → `{prev:"a", next:"c"}`; at the first id `prev` is `null`; at the last `next` is `null`; `(["a"], "a")` → both `null`; `([], "a")` and `(["a","b"], "zzz")` → both `null`.
  - `clampSplit(0.1, 1000)` → `0.32`; `clampSplit(0.95, 1000)` → `0.68`; `clampSplit(0.5, 1000)` → `0.5`; `clampSplit(0.2, 500)` → `0.5` (container under 2 × 320); `clampSplit(NaN, 1000)` → `0.5`; `clampSplit(0.5, 0)` → `0.5`.
  - `parseStoredSplit`: `null`, `""`, `"abc"`, `"0"`, `"1"`, `"-1"`, `"5"` → `0.5`; `"0.4"` → `0.4`.
  - `isEditableTarget`: `INPUT`, `TEXTAREA`, `SELECT` → true; `{tagName:"DIV", isContentEditable:true}` → true; `BUTTON`, `DIV`, `BODY`, `null` → false.
  - `shouldFlushLyrics(true,"new","old")` → true; `(true,"same","same")` → false; `(false,"new","old")` → false.
- [ ] **Step 2: Run** `npx vitest run tests/project-view.test.ts` — expected: FAIL (module not found).
- [ ] **Step 3: Implement** the functions in `src/lib/project-view.ts`. `clampSplit` bounds the ratio to `[minPanePx / containerPx, 1 - minPanePx / containerPx]`.
- [ ] **Step 4: Run** the same command — expected: all PASS.
- [ ] **Step 5: Commit** `feat: add pure helpers for the full-screen project view` (files: both above).

---

### Task 2: Hooks and SplitPane

**Files:**
- Create: `src/hooks/useMediaQuery.ts`, `src/hooks/useSplitRatio.ts`, `src/components/detail/SplitPane.tsx`
- Modify: `src/styles/app.css` (append `.split-pane`, `.split-divider` rules)

**Interfaces:**
- Consumes: `clampSplit`, `parseStoredSplit`, `DEFAULT_SPLIT` from Task 1.
- Produces:
  - `useMediaQuery(query: string): boolean` — live `matchMedia` subscription.
  - `useSplitRatio(): [number, (r: number) => void]` — reads/writes `localStorage` key `"sessions.projectSplit"`; every storage access in try/catch; initial value via `parseStoredSplit`.
  - `SplitPane` default export, props `{ first: ReactNode; second: ReactNode }`. It chooses vertical stacking itself when `useMediaQuery("(max-width: 900px)")` is true.

- [ ] **Step 1: Implement** the two hooks.
- [ ] **Step 2: Implement `SplitPane`.** A flex container (row, or column when stacked) with a measured container size (`ResizeObserver`), the two children sized by `clampSplit(ratio, containerPx)`, and a 6 px divider (`role="separator"`, `aria-orientation`). Dragging uses pointer events with `setPointerCapture` and updates the ratio live; each pane gets `min-width: 0; min-height: 0; overflow: auto`. Double-click on the divider calls `setRatio(DEFAULT_SPLIT)`.
- [ ] **Step 3: Add CSS** for the divider (hover/active accent colour using existing `--accent`, `cursor: col-resize` or `row-resize`).
- [ ] **Step 4: Run** `npm run build` — expected: no type errors.
- [ ] **Step 5: Commit** `feat: add draggable SplitPane with remembered position`.

---

### Task 3: InfoRail

**Files:**
- Create: `src/components/detail/InfoRail.tsx`
- Modify: `src/styles/app.css` (`.info-rail`, `.rail-section`, `.rail-icons`, `.rail-flyout`)

**Interfaces:**
- Consumes: `useMediaQuery` (Task 2); `OverviewTab`, `FilesTab`, `TodoTab`, `HistoryTab` with their current props (see `DetailPanel.tsx` for the exact props each one gets today).
- Produces: `InfoRail` default export, props `{ project: Project; allTags: Tag[]; onUpdate: (field: string, value: unknown) => void; onTagChange: () => void }`.

- [ ] **Step 1: Implement `InfoRail`.** Four sections in this order: "Info" (`OverviewTab`), "Files" (`FilesTab`, `key={project.id}`), "To-do" (`TodoTab`, `key={project.id}`), "Sync" (`HistoryTab`). A local `RailSection` renders a clickable title row with a chevron that collapses its body; all sections start open. The rail is 280 px wide and scrolls on its own (`overflow-y: auto`).
- [ ] **Step 2: Icon-strip mode.** When `useMediaQuery("(max-width: 1100px)")` is true, render a 48 px strip with one icon button per section (reuse `Icon` names already used for those tabs in `TABS` of `DetailPanel.tsx`); clicking one opens that section's body in an absolutely positioned 280 px flyout over the workspace; clicking it again or outside closes it.
- [ ] **Step 3: Fit the old tab bodies into 280 px.** Add rail-scoped CSS overrides so `OverviewTab`, `FilesTab`, `TodoTab`, `HistoryTab` lay out single-column without horizontal scroll (the old `.tab-body` padding and `.meta-grid` are the likely culprits). Do not change those components' behaviour.
- [ ] **Step 4: Run** `npm run build` — expected: no type errors.
- [ ] **Step 5: Commit** `feat: add InfoRail with collapsible sections`.

---

### Task 4: ProjectView

**Files:**
- Rename: `src/components/detail/DetailPanel.tsx` → `src/components/detail/ProjectView.tsx` (`git mv`)
- Modify: `src/components/detail/ProjectView.tsx`, `src/components/detail/tabs/LyricsTab.tsx`, `src/styles/app.css`

**Interfaces:**
- Consumes: `SplitPane` (Task 2), `InfoRail` (Task 3), `shouldFlushLyrics` (Task 1).
- Produces: `ProjectView` default export, props:
  `{ project: Project; allTags: Tag[]; prevId: string | null; nextId: string | null; onNavigate: (id: string) => void; onBack: () => void; onOpen: (p: Project) => void; onReveal: (p: Project) => void; onProjectUpdated: () => void; onTagChange: () => void }`

- [ ] **Step 1: Rework the file.** Keep the existing header logic unchanged (inline rename with error display, copy path, DAW badge, size, modified date, Open / Reveal / Archive-Unarchive). Remove the `TABS` array, tab state, and `<div className="tabs">`.
- [ ] **Step 2: New top bar.** A Back button (calls `onBack`) at the far left; the existing header content in the middle; previous (`‹`) and next (`›`) buttons at the right, each disabled when its id is `null` and otherwise calling `onNavigate(id)`.
- [ ] **Step 3: Body.** `<div className="project-view">` containing the top bar and a row of `InfoRail` followed by `<SplitPane first={<LyricsTab key={p.id} …/>} second={<TabTab key={p.id} …/>} />`. The `key={p.id}` is required: `TabTab` reads `p.tabs` only on first render, so without a key, previous/next would show the old project's tab.
- [ ] **Step 4: Make Lyrics and Tab fill their panes.** Adjust `.lyrics-editor` and `.tab-editor` CSS so each fills the pane's full height and scrolls inside it; confirm `LyricsAiOverlay` (positioned `absolute; inset: 0`) is anchored to the Lyrics pane by giving `.lyrics-editor` `position: relative`.
- [ ] **Step 5: Flush on leave in `LyricsTab`.** Keep the latest `editing`, `draft`, and saved text in a ref; in an unmount cleanup effect, if `shouldFlushLyrics(editing, draft, text)` is true, call that render's `onUpdate("lyrics", draft)`. Because of `key={p.id}`, the cleanup belongs to the old project's instance and writes to the old project.
- [ ] **Step 6: Run** `npm run build && npm test` — expected: no type errors, all tests pass.
- [ ] **Step 7: Commit** `feat: add ProjectView replacing the detail side panel`.

---

### Task 5: App wiring, Esc, list state

**Files:**
- Modify: `src/App.tsx`, `src/components/library/ProjectList.tsx`, `src/styles/app.css`; Esc handlers in `src/components/detail/tabs/TabExpandedModal.tsx`, `src/components/detail/tabs/LyricsAiOverlay.tsx`, `src/components/detail/TabAgentModal.tsx`, `src/components/settings/SettingsModal.tsx` as needed

**Interfaces:**
- Consumes: `ProjectView` (Task 4), `adjacentProjectIds`, `isEditableTarget` (Task 1).
- Produces: `ProjectList` gets an optional prop `scrollRef?: RefObject<HTMLDivElement | null>` attached to its `.table-wrap` element.

- [ ] **Step 1: View switch.** In `App.tsx` replace the `DetailPanel` block: when `showDetail && selected`, render `ProjectView` and give the list wrapper a hidden class (`display: none`); otherwise show the list. If `selected` becomes `null` while `showDetail` is true (project removed), set `showDetail` to false in an effect. `prevId`/`nextId` come from `adjacentProjectIds(filtered.map(p => p.id), selectedId)`; `onNavigate` calls `setSelectedId`.
- [ ] **Step 2: CSS.** `.main` becomes a single column; delete the `.no-detail` rule and the two-column `grid-template-columns`; remove `.detail`, `.detail-close`, `.tabs`, `.tab`, `.tab-body` rules that nothing uses any more (search before deleting).
- [ ] **Step 3: Keep scroll position.** Pass a `scrollRef` to `ProjectList`; save its `scrollTop` when opening a project and restore it in a `useLayoutEffect` when returning to the list.
- [ ] **Step 4: Esc.** Add a `keydown` listener on `window` in `App.tsx`, active only while the project view is showing. It calls `setShowDetail(false)` only when `event.key === "Escape"`, `!event.defaultPrevented`, `!isEditableTarget(event.target as HTMLElement | null)`, and `!showSettings && !showAbout`. Audit every existing Esc handler (rename input in `ProjectView`, `TabExpandedModal`, `LyricsAiOverlay`, `TabAgentModal`, `SettingsModal`, `AboutWindow`) and make each call `event.preventDefault()` when it consumes Esc, so the window listener skips it.
- [ ] **Step 5: Run** `npm run build && npm test && npx eslint src tests` — expected: all clean.
- [ ] **Step 6: Run the app** with `npm run tauri dev` and check each item by hand:
  1. Click a project: it fills the whole main area; list is gone.
  2. Back and Esc both return to the list with the same search text, filter, sort, selected row and scroll position.
  3. Rail shows Info, Files, To-do and Sync; each section collapses and expands; nothing scrolls sideways.
  4. Lyrics and Tab are side by side; dragging the divider resizes live and stops at 320 px per pane; double-click resets to 50/50; restart the app and the position is remembered.
  5. Shrink the window below 1100 px: rail becomes icons and sections open in a flyout. Below 900 px: panes stack vertically with a horizontal divider.
  6. Previous/next move through the filtered, sorted list; disabled at either end; Lyrics and Tab show the new project's data.
  7. Type lyrics, press Back without Done: reopen the project and the lyrics are saved. Do the same via next arrow; the new project's lyrics are untouched.
  8. Esc inside notes, tags, the rename box, the lyrics text, the Lyrics AI overlay and the expanded tab modal does not leave the project (it closes the overlay or modal where it did before).
  9. Archive the open project under the default view: the view returns to the list without an error.
  10. Rename, Open, Reveal, Archive, tags, key, rating, to-do and file actions work as before.
- [ ] **Step 7: Commit** `feat: show the project as a full-screen view`.

---

### Task 6: Close out

**Files:**
- Modify: `docs/REQUIREMENTS.md` (US-014 `Status: Implemented`, tick the acceptance boxes that were verified in Task 5)

- [ ] **Step 1:** Update the story. Only tick boxes that were actually verified.
- [ ] **Step 2:** Run `npm test && npm run build && npx eslint src tests` — expected: all pass.
- [ ] **Step 3:** Run `gh pr list --head docs/fullscreen-project-view --state all` to confirm no earlier PR exists for the branch; rename the branch to `feat/fullscreen-project-view`, push, and open a PR into `dev` whose description lists the manual checks from Task 5 and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4: Commit** `docs: mark US-014 implemented`.

# Full-Screen Project View — Design

Story: US-014 in `docs/REQUIREMENTS.md`.

## Intent and why

The project is the main thing in this app. Today, selecting a project opens `DetailPanel` as a narrow column beside the list (`src/App.tsx`, inside `<main>`). Everything about the project is split across six tabs (Overview, Lyrics, Tab, Files, Sync, To-do). Writing lyrics and editing guitar tabs both need much more room than the column gives, and the user has to switch tabs to see the rest of a project's info.

The change: a project opens as a full-screen view. Project info is always visible. Lyrics and Tab are always open, side by side, with a draggable divider.

## Goals

- Selecting a project replaces the list with a full-screen project view; going back restores the list exactly as it was.
- No tabs in this view. All project info is visible without switching.
- Lyrics and Tab editors get the bulk of the screen and are both open at once.
- The user can drag the divider between Lyrics and Tab to give either more room.
- Every existing capability of the six tabs keeps working (nothing is dropped).

## Non-goals

- No change to the list view, sidebar, scanner, or data model.
- No new fields, and no change to how data is saved.
- Not building the other layouts that were considered (a single workspace with a Lyrics/Tab/Both switch, or a card dashboard).
- No new editing features inside Lyrics, Tab, Files, or To-do.

## Anti-goals

- Going back to the list must not lose the user's search, filters, sort, or scroll position.
- It must not feel like the old panel stretched wider: Lyrics and Tab must not be stuck in a tab control.
- Editing in the rail must not be slower or harder than editing in today's tabs.

## Decided by the user

- Layout "A": a left info rail, with Lyrics and Tab side by side to its right.
- The rail is always visible; there are no tabs in the project view.
- The divider between Lyrics and Tab is draggable.
- The reason: lyrics and tabs need space, and info should be visible without scrolling through tabs.

## Layout

```
┌ ← Back │ Song title ✎ │ path (copy) │ Open in <DAW> · Reveal · Archive │ ‹ › ┐
├──────────┬───────────────────────────────┬─┬─────────────────────────────────┤
│ Info     │ Lyrics                        │ │ Tab                             │
│ Files    │                               │↔│                                 │
│ To-do    │                               │ │                                 │
│ Sync     │                               │ │                                 │
└──────────┴───────────────────────────────┴─┴─────────────────────────────────┘
```

- **Top bar:** Back button, title (double-click to rename, as today, with the same error display), file path with copy, DAW badge, size, modified date, Open / Reveal / Archive-or-Unarchive actions, and previous / next project arrows.
- **Left rail** (about a fifth of the width): the contents of today's Overview, Files, To-do, and Sync tabs, stacked as sections. The rail scrolls on its own if it is taller than the window.
- **Workspace:** Lyrics on the left, Tab on the right, a draggable divider between them.
- The Lyrics AI helper (`LyricsAiOverlay`) opens over the Lyrics pane only.

## Behavior

- Opening: clicking a project row opens the view (same trigger as today).
- Leaving: the Back button or Esc returns to the list. The list's search text, filters, sort, selected row, and scroll position are as the user left them.
- Previous / next: moves to the neighbouring project in the currently filtered and sorted list; disabled at either end.
- Divider: dragging resizes the two panes live. Each pane has a minimum width so neither can be dragged shut.
- Everything that saves today (notes, key, BPM, tags, rating, status, lyrics, tab, to-do, rename, archive) keeps saving the same way.

## Constraints

- Tauri 2 + React + TypeScript; styling is in `src/styles/app.css`. Build on the existing components in `src/components/detail/` rather than rewriting them.
- Keep the app's non-destructive, local-first rules; this change touches no project files.
- Performance targets in `CLAUDE.md` still apply; opening a project should feel instant.

## Left to the builder

- How the existing tab components (`OverviewTab`, `FilesTab`, `TodoTab`, `HistoryTab`) are adapted to read well as compact rail sections.
- Whether `DetailPanel` is reshaped or replaced by a new component.
- How Esc is handled when it is already used inside the Lyrics AI overlay, tab editor, or rename field.
- How "back keeps the list state" is achieved (keeping the list mounted but hidden is one option).
- Where the rail's collapse state and the divider position are stored.

## My calls (not confirmed by the user)

- Rail sections can be collapsed individually so a long file list doesn't push the to-do off screen.
- The divider position is remembered between sessions, and double-clicking the divider resets it to 50/50.
- On a narrow window the rail shrinks to icons first; below that width, Lyrics and Tab stack vertically.
- Esc goes back only when no editor, overlay, or rename field has focus.
- Tab-editor expanded modal (`TabExpandedModal`) stays as an option for when a single pane is not enough.
- The "show detail" flag in `App.tsx` becomes a view switch (list ↔ project) rather than a side panel toggle.

More calls, added after the builder check:

- **Pane sizes:** each of Lyrics and Tab has a minimum width of about 320 px, so the divider can't squeeze a pane smaller. The Lyrics AI overlay stays inside the Lyrics pane (it already positions itself inside its container), so it needs a new mount point and no redesign.
- **Rail width:** the rail is a fixed width of about 280 px (not a strict fifth of the window), not user-resizable. Its sections stack and scroll inside the rail, and the Overview fields are laid out single-column.
- **Narrow windows:** below roughly 900 px of window width, Lyrics and Tab stack vertically and the divider becomes horizontal. The rail collapses to icons first (below roughly 1100 px).
- **Previous / next:** they walk the in-memory filtered and sorted list that the list view already uses. They are disabled at the ends.
- **Unsaved edits:** anything pending (for example a debounced save of lyrics, tab, or notes) is flushed before leaving the project, whether by Back, Esc, or previous/next. Leaving must never lose an edit.
- **Esc:** only goes back when focus is not in a text input, textarea, editable cell, rename field, or the Lyrics AI overlay.
- **Keeping the list state:** the builder checks how the list is rendered. If keeping it mounted but hidden is cheap, do that; otherwise save and restore the scroll position and keep the filter, sort, and search state in `App.tsx`, where they already live.
- **Lyrics expanded view:** none. Lyrics gets the space from the divider instead.

## Open questions for the user

None. Everything above that you haven't confirmed is listed under "My calls".

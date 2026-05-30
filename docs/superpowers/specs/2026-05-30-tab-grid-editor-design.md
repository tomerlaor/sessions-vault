# Tab Grid Editor — Design Spec

**Date:** 2026-05-30  
**Status:** Approved  
**Related story:** US-002

---

## Overview

Replace the plain textarea tab editor in `TabTab.tsx` with an interactive visual editor. String lines are rendered as classic tab format (continuous horizontal lines), and the user places fret numbers and annotations directly on them by clicking. The raw text editor is removed entirely.

---

## Data Model

### TabGrid

```typescript
type CellValue =
  | { kind: 'fret'; value: string }        // '0'–'24'
  | { kind: 'annotation'; value: string }  // 'h', 'p', 'b', '/', 'P.M.', etc.

interface TabGrid {
  strings: string[];           // ['e','B','G','D','A','E'] for guitar; ['G','D','A','E'] for bass; ['BD','SN','HH','OH','CY'] for drums
  colCount: number;            // default 32 (compact), 64 (expanded)
  cells: Record<string, CellValue>; // sparse map, key: `${stringIdx}:${colIdx}`
}
```

`TabPart` gains an optional `grid` field:

```typescript
interface TabPart {
  id: string;
  name: string;
  instrument: Instrument;
  content: string;   // plain text — derived from grid, kept in sync for copy/export/AI
  grid?: TabGrid;
}
```

`content` is no longer the source of truth. It is regenerated from the grid on every mutation via `gridToText()`.

### Migration

On first render of a `TabPart` that has `content` but no `grid`:
1. Run `parseTabToGrid(content)` — best-effort text parser.
2. If parsing succeeds, save the resulting grid back via `onUpdate`.
3. If parsing fails, start with an empty grid (same strings, `colCount: 32`, no cells).

---

## Layout

```
┌─────────────────────────────────────────────────┐
│ [Verse Guitar] [Bridge Bass]          [+Part][✦AI] │  ← parts bar
├─────────────────────────────────────────────────┤
│ Artic: [h][p][b][r][~][~~]  Slide: [/][\][sl]  │
│ Special: [x][(n)][T][P.H.][◇]  Effects: [P.M.] │  ← annotation toolbar
│ [let ring][tr]  Strokes: [⊓][V]   ● h active ✕ │
├─────────────────────────────────────────────────┤
│ guitar · Verse Guitar                      [⤢]  │  ← part header + expand btn
├─────────────────────────────────────────────────┤
│                                                 │
│  e |————7—h—9————————————————|————————————————| │
│  B |————8———10———————————————|————————————————| │  ← tab grid (32 cols, 2 bars)
│  G |————————————————————————|————————————————| │
│  D |————————————————————————|————————————————| │
│  A |————————————————————————|————————————————| │
│  E |————————————————————————|————————————————| │
│                                     [+ Extend]  │
└─────────────────────────────────────────────────┘
```

The expanded modal shows the same layout with `colCount: 64` (4 bars).

---

## Rendering

### String lines

Each string row is a `position: relative` flex container:
- **Label** (`e`, `B`, etc.) — fixed-width, left-aligned
- **Opening bar** (`|`) — fixed character
- **Line container** — `position: relative`, fixed pixel width, `cursor: crosshair`
  - Background line: `position: absolute`, `top: 50%`, `height: 1px`, full width, `background: #444`
  - Beat tick marks: thin vertical lines at every 4th column
  - Bar lines: taller vertical lines at every 16th column
- **Closing bar** (`|`) — fixed character

### Constants

```typescript
const COL_WIDTH = 20;      // px per column
const STRING_HEIGHT = 28;  // px per string row
const COLS_PER_BEAT = 2;   // 8th-note resolution
const COLS_PER_BAR = 16;
```

### Fret numbers and annotations

Rendered as `position: absolute` text elements at `left: colIdx * COL_WIDTH`. A small background patch (`background: inherit`) sits behind each value so the line appears to "break" cleanly around the character. Fret numbers render in amber (`#e0c97a`); annotations in orange (`#ff7a45`).

### Chord column highlight

When any cell in a column is selected or hovered, a faint vertical highlight spans all string rows at that column. Rendered by the parent container as an absolutely positioned overlay, not per-row.

### Drums

Same renderer, different string labels (`BD`, `SN`, `HH`, `OH`, `CY`). Accepted values are `x`, `o`, `X` instead of fret numbers — the annotation toolbar is hidden for drums; beat-hit symbols are used instead.

---

## Interaction

### Placing a fret number

1. Click anywhere on a string line → snap to nearest column
2. Cell becomes an autofocused `<input>` (max 2 chars)
3. Type `0`–`24` → Enter or blur → saved to grid, input closes
4. Backspace on an occupied cell → clears it
5. Click an occupied cell → re-opens for editing

### Placing an annotation

1. Click annotation button in toolbar → button highlights, status shows `● h active`
2. Click any cell on any string → annotation placed at that column; active mode persists
3. Click active button again or press Escape → deselect, return to fret mode
4. A fret and an annotation may coexist at the same column on the same string (e.g. `7` at `0:4` and `h` at `0:5`)

### Removing

- Right-click an occupied cell → "Clear" context menu item
- Keyboard: arrow keys to navigate, Backspace to clear selected cell

### Keyboard navigation

| Key | Action |
|---|---|
| ←/→ | Move selected cell left/right on same string |
| ↑/↓ | Move to same column on adjacent string |
| Tab | Next column, same string |
| Escape | Deselect annotation / close input |
| Backspace | Clear selected cell |

### Extending

`+ Extend` button adds 16 columns to `colCount`. There is no maximum enforced.

---

## Expanded View

Triggered by the `⤢` button in the part header. Opens a floating modal (`TabExpandedModal`) containing `TabGridEditor` with `colCount: 64` (4 bars). Edits sync immediately to the shared grid state via `useTabGrid` — both compact and expanded views reflect changes in real time. The modal is dismissed with a close button or Escape.

---

## Annotation Library

Grouped as displayed in the toolbar:

| Group | Symbols |
|---|---|
| Articulation | `h` hammer-on, `p` pull-off, `b` bend, `r` release bend, `~` vibrato, `~~` wide vibrato |
| Slides | `/` slide up, `\` slide down, `sl` legato slide |
| Special | `x` dead note, `(n)` ghost note, `T` tapping, `P.H.` pinched harmonic, `◇` natural harmonic |
| Effects | `P.M.` palm mute, `let ring`, `tr` trill, `P.S.` pick scrape |
| Strokes | `⊓` down stroke, `V` up stroke |

---

## Utilities

### `parseTabToGrid(content: string): TabGrid | null`

Parses existing plain-text tab content into a `TabGrid`. Splits lines by string label, walks characters left to right, extracts fret numbers and known annotation tokens. Returns `null` if the content cannot be parsed.

### `gridToText(grid: TabGrid): string`

Serialises a `TabGrid` back to the classic ASCII tab format. Used to keep `TabPart.content` in sync and to feed the AI context in `TabAgentModal`.

---

## Components

| File | Purpose |
|---|---|
| `src/components/detail/tabs/TabTab.tsx` | Top-level tab screen — replaces textarea/pre with `TabGridEditor` + `AnnotationToolbar`; adds expand button |
| `src/components/detail/tabs/TabGridEditor.tsx` | Renders string lines with floating numbers; handles click-to-place; accepts `colCount` |
| `src/components/detail/tabs/AnnotationToolbar.tsx` | Grouped annotation buttons; tracks active annotation; emits selection |
| `src/components/detail/tabs/TabExpandedModal.tsx` | Floating modal wrapper; renders `TabGridEditor` with `colCount=64` |
| `src/hooks/useTabGrid.ts` | Grid state, selected cell, active annotation, place/clear/extend, `content` sync |
| `src/lib/tab-grid.ts` | `parseTabToGrid`, `gridToText`, constants (`COL_WIDTH`, `COLS_PER_BAR`, etc.) |
| `src/types/index.ts` | Add `TabGrid`, `CellValue`; add `grid?: TabGrid` to `TabPart` |

---

## What Does Not Change

- Parts bar (adding, switching, deleting parts)
- AI generation flow (`TabAgentModal`, `✦ AI` button)
- `gridToText` output feeds `TabAgentModal` as context (replacing direct `content` usage)

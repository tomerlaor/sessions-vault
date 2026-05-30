# Tab Grid Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain textarea tab editor with a visual grid editor where string lines look like classic tab and users place fret numbers/annotations by clicking.

**Architecture:** Grid-first data model (`TabGrid` stored in `TabPart.grid`); plain-text `content` is derived from the grid on every mutation. The editor renders each string as a `position:relative` container with a continuous 1px line and absolutely-positioned fret/annotation tokens on top. Existing text-based parts are migrated to grid on first open.

**Tech Stack:** React, TypeScript, Vitest (for utility unit tests), inline CSS (following existing `app.css` patterns)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/types/index.ts` | Add `CellValue`, `TabGrid`; add `grid?` to `TabPart` |
| Create | `src/lib/tab-grid.ts` | Constants, `defaultGrid`, `gridToText`, `parseTabToGrid` |
| Create | `tests/tab-grid.test.ts` | Unit tests for utility functions |
| Create | `src/hooks/useTabGrid.ts` | Grid state, selected cell, active annotation, place/clear/extend |
| Create | `src/components/detail/tabs/AnnotationToolbar.tsx` | Grouped annotation buttons, active annotation tracking |
| Create | `src/components/detail/tabs/TabGridEditor.tsx` | String lines, floating tokens, chord highlight, click-to-place |
| Create | `src/components/detail/tabs/TabExpandedModal.tsx` | Modal wrapper for 64-col expanded view |
| Modify | `src/components/detail/tabs/TabTab.tsx` | Wire all new components, remove textarea/pre |
| Modify | `src/styles/app.css` | Add CSS for grid editor, annotation toolbar, expanded modal |

---

## Task 1: Add Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `CellValue` and `TabGrid` types, extend `TabPart`**

Open `src/types/index.ts` and add after the `Instrument` type definition (line 16):

```typescript
export type CellValue =
  | { kind: "fret"; value: string }
  | { kind: "annotation"; value: string };

export interface TabGrid {
  strings: string[];
  colCount: number;
  cells: Record<string, CellValue>; // key: `${stringIdx}:${colIdx}`
}
```

Then update `TabPart` (around line 27):

```typescript
export interface TabPart {
  id: string;
  name: string;
  instrument: Instrument;
  content: string;
  grid?: TabGrid;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (new optional field does not break existing usage).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add TabGrid and CellValue types"
```

---

## Task 2: Utility Library — Constants, `defaultGrid`, and `gridToText`

**Files:**
- Create: `src/lib/tab-grid.ts`
- Create: `tests/tab-grid.test.ts`

- [ ] **Step 1: Write failing tests for `gridToText` and `defaultGrid`**

Create `tests/tab-grid.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { gridToText, defaultGrid, COL_WIDTH, COLS_PER_BAR } from "../src/lib/tab-grid";
import type { TabGrid } from "../src/types";

describe("constants", () => {
  it("COL_WIDTH is 20", () => expect(COL_WIDTH).toBe(20));
  it("COLS_PER_BAR is 16", () => expect(COLS_PER_BAR).toBe(16));
});

describe("defaultGrid", () => {
  it("returns guitar grid with correct strings and 32 cols", () => {
    const g = defaultGrid("guitar");
    expect(g.strings).toEqual(["e", "B", "G", "D", "A", "E"]);
    expect(g.colCount).toBe(32);
    expect(g.cells).toEqual({});
  });

  it("returns bass grid with 4 strings", () => {
    const g = defaultGrid("bass");
    expect(g.strings).toEqual(["G", "D", "A", "E"]);
  });

  it("returns drums grid with 5 rows", () => {
    const g = defaultGrid("drums");
    expect(g.strings).toEqual(["BD", "SN", "HH", "OH", "CY"]);
  });
});

describe("gridToText", () => {
  it("produces empty dashes for a grid with no cells", () => {
    const g = defaultGrid("guitar");
    const text = gridToText(g);
    const lines = text.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatch(/^e\|/);
    expect(lines[0]).toMatch(/\|$/);
    // all dashes between the pipes
    const content = lines[0].slice(2, -1);
    expect(content).toBe("-".repeat(g.colCount));
  });

  it("places a fret number at the correct column", () => {
    const g: TabGrid = {
      strings: ["e", "B", "G", "D", "A", "E"],
      colCount: 8,
      cells: { "0:2": { kind: "fret", value: "7" } },
    };
    const lines = gridToText(g).split("\n");
    // col 0 = dash, col 1 = dash, col 2 = '7', cols 3-7 = dash
    expect(lines[0]).toBe("e|--7-----|");
  });

  it("places a two-digit fret, consuming the next column slot", () => {
    const g: TabGrid = {
      strings: ["e", "B", "G", "D", "A", "E"],
      colCount: 8,
      cells: { "0:2": { kind: "fret", value: "12" } },
    };
    const lines = gridToText(g).split("\n");
    // col 2 = '1', col 3 = '2' (two-digit fret consumes two slots)
    expect(lines[0]).toBe("e|--12----|");
  });

  it("places an annotation at the correct column", () => {
    const g: TabGrid = {
      strings: ["e", "B", "G", "D", "A", "E"],
      colCount: 8,
      cells: { "0:3": { kind: "annotation", value: "h" } },
    };
    const lines = gridToText(g).split("\n");
    expect(lines[0]).toBe("e|---h----|");
  });

  it("places values on multiple strings independently", () => {
    const g: TabGrid = {
      strings: ["e", "B", "G", "D", "A", "E"],
      colCount: 4,
      cells: {
        "0:1": { kind: "fret", value: "7" },
        "1:1": { kind: "fret", value: "8" },
      },
    };
    const lines = gridToText(g).split("\n");
    expect(lines[0]).toBe("e|-7--|");
    expect(lines[1]).toBe("B|-8--|");
    expect(lines[2]).toBe("G|----|");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npx vitest run tests/tab-grid.test.ts
```

Expected: all tests FAIL with "Cannot find module '../src/lib/tab-grid'".

- [ ] **Step 3: Create `src/lib/tab-grid.ts` with constants, `defaultGrid`, and `gridToText`**

```typescript
import type { TabGrid, CellValue, Instrument } from "../types";

export const COL_WIDTH = 20;
export const STRING_HEIGHT = 28;
export const COLS_PER_BEAT = 2;
export const COLS_PER_BAR = 16;

const STRINGS: Record<Instrument, string[]> = {
  guitar: ["e", "B", "G", "D", "A", "E"],
  bass: ["G", "D", "A", "E"],
  drums: ["BD", "SN", "HH", "OH", "CY"],
};

export function defaultGrid(instrument: Instrument): TabGrid {
  return {
    strings: STRINGS[instrument],
    colCount: 32,
    cells: {},
  };
}

export function gridToText(grid: TabGrid): string {
  const lines: string[] = [];
  for (let si = 0; si < grid.strings.length; si++) {
    // Build slot array — one entry per column, initially '-'
    const slots: string[] = Array(grid.colCount).fill("-");
    // Fill slots from cells
    for (let ci = 0; ci < grid.colCount; ci++) {
      const cell = grid.cells[`${si}:${ci}`];
      if (!cell) continue;
      if (cell.kind === "fret" && cell.value.length === 2) {
        slots[ci] = cell.value[0];
        if (ci + 1 < grid.colCount) slots[ci + 1] = cell.value[1];
      } else {
        slots[ci] = cell.value;
      }
    }
    lines.push(`${grid.strings[si]}|${slots.join("")}|`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npx vitest run tests/tab-grid.test.ts
```

Expected: all `gridToText` and `defaultGrid` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-grid.ts tests/tab-grid.test.ts
git commit -m "feat: add tab-grid utility — constants, defaultGrid, gridToText"
```

---

## Task 3: Utility Library — `parseTabToGrid`

**Files:**
- Modify: `src/lib/tab-grid.ts`
- Modify: `tests/tab-grid.test.ts`

- [ ] **Step 1: Add failing tests for `parseTabToGrid`**

Append to `tests/tab-grid.test.ts`:

```typescript
import { parseTabToGrid } from "../src/lib/tab-grid";

describe("parseTabToGrid", () => {
  it("returns null for empty/unparseable content", () => {
    expect(parseTabToGrid("")).toBeNull();
    expect(parseTabToGrid("not a tab")).toBeNull();
  });

  it("parses a simple guitar tab with fret numbers", () => {
    const content = [
      "e|--7-----|",
      "B|--8-----|",
      "G|--------|",
      "D|--------|",
      "A|--------|",
      "E|--------|",
    ].join("\n");
    const grid = parseTabToGrid(content);
    expect(grid).not.toBeNull();
    expect(grid!.strings).toEqual(["e", "B", "G", "D", "A", "E"]);
    expect(grid!.cells["0:2"]).toEqual({ kind: "fret", value: "7" });
    expect(grid!.cells["1:2"]).toEqual({ kind: "fret", value: "8" });
    expect(Object.keys(grid!.cells)).toHaveLength(2);
  });

  it("parses a two-digit fret", () => {
    const content = [
      "e|--12----|",
      "B|--------|",
      "G|--------|",
      "D|--------|",
      "A|--------|",
      "E|--------|",
    ].join("\n");
    const grid = parseTabToGrid(content);
    expect(grid!.cells["0:2"]).toEqual({ kind: "fret", value: "12" });
  });

  it("parses a known single-char annotation", () => {
    const content = [
      "e|---h----|",
      "B|--------|",
      "G|--------|",
      "D|--------|",
      "A|--------|",
      "E|--------|",
    ].join("\n");
    const grid = parseTabToGrid(content);
    expect(grid!.cells["0:3"]).toEqual({ kind: "annotation", value: "h" });
  });

  it("round-trips through gridToText → parseTabToGrid", () => {
    const original: TabGrid = {
      strings: ["e", "B", "G", "D", "A", "E"],
      colCount: 8,
      cells: {
        "0:2": { kind: "fret", value: "7" },
        "0:3": { kind: "annotation", value: "h" },
        "0:4": { kind: "fret", value: "9" },
        "1:2": { kind: "fret", value: "8" },
      },
    };
    const text = gridToText(original);
    const parsed = parseTabToGrid(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.cells["0:2"]).toEqual({ kind: "fret", value: "7" });
    expect(parsed!.cells["0:3"]).toEqual({ kind: "annotation", value: "h" });
    expect(parsed!.cells["0:4"]).toEqual({ kind: "fret", value: "9" });
    expect(parsed!.cells["1:2"]).toEqual({ kind: "fret", value: "8" });
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npx vitest run tests/tab-grid.test.ts
```

Expected: `parseTabToGrid` tests FAIL with "parseTabToGrid is not a function".

- [ ] **Step 3: Implement `parseTabToGrid` in `src/lib/tab-grid.ts`**

Add after `gridToText`:

```typescript
const ANNOTATION_CHARS = new Set(["h", "p", "b", "r", "~", "/", "\\", "x", "T", "V", "s"]);

export function parseTabToGrid(content: string): TabGrid | null {
  if (!content) return null;

  const lines = content.split("\n").filter((l) => l.includes("|"));
  if (lines.length === 0) return null;

  const strings: string[] = [];
  const cellSets: Array<Record<string, CellValue>> = [];

  for (const line of lines) {
    const pipeIdx = line.indexOf("|");
    if (pipeIdx === -1) continue;
    const label = line.slice(0, pipeIdx).trim();
    const lastPipe = line.lastIndexOf("|");
    const body = line.slice(pipeIdx + 1, lastPipe === pipeIdx ? undefined : lastPipe);

    strings.push(label);
    const cells: Record<string, CellValue> = {};
    let ci = 0; // column index
    let i = 0;  // char index in body
    while (i < body.length) {
      const ch = body[i];
      if (ch === "-") {
        i++;
        ci++;
      } else if (ch >= "0" && ch <= "9") {
        // collect consecutive digits (max 2)
        let num = ch;
        if (i + 1 < body.length && body[i + 1] >= "0" && body[i + 1] <= "9") {
          num += body[i + 1];
          i += 2;
          ci += 2;
        } else {
          i++;
          ci++;
        }
        cells[`${strings.length - 1}:${ci - (num.length === 2 ? 2 : 1)}`] = {
          kind: "fret",
          value: num,
        };
      } else if (ANNOTATION_CHARS.has(ch)) {
        // 'sl' and '~~' are two-char annotations
        let ann = ch;
        if (
          (ch === "s" && body[i + 1] === "l") ||
          (ch === "~" && body[i + 1] === "~")
        ) {
          ann += body[i + 1];
          i += 2;
          ci += 2;
        } else {
          i++;
          ci++;
        }
        cells[`${strings.length - 1}:${ci - ann.length}`] = {
          kind: "annotation",
          value: ann,
        };
      } else {
        i++;
        ci++;
      }
    }
    cellSets.push(cells);
  }

  if (strings.length === 0) return null;

  // Merge all per-string cell maps
  const allCells: Record<string, CellValue> = {};
  cellSets.forEach((c) => Object.assign(allCells, c));

  // colCount = max column index found + padding, rounded up to nearest bar
  const maxCol = Object.keys(allCells).reduce((m, k) => {
    const col = parseInt(k.split(":")[1], 10);
    return Math.max(m, col + 1);
  }, 32);
  const colCount = Math.ceil(maxCol / COLS_PER_BAR) * COLS_PER_BAR;

  return { strings, colCount, cells: allCells };
}
```

- [ ] **Step 4: Run all tests — expect all to pass**

```bash
npx vitest run tests/tab-grid.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-grid.ts tests/tab-grid.test.ts
git commit -m "feat: add parseTabToGrid to tab-grid utilities"
```

---

## Task 4: `useTabGrid` Hook

**Files:**
- Create: `src/hooks/useTabGrid.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useTabGrid.ts`:

```typescript
import { useState, useCallback } from "react";
import type { TabGrid, CellValue, Instrument } from "../types";
import { defaultGrid, gridToText, parseTabToGrid, COLS_PER_BAR } from "../lib/tab-grid";

export interface SelectedCell {
  stringIdx: number;
  colIdx: number;
}

export interface UseTabGridReturn {
  grid: TabGrid;
  selectedCell: SelectedCell | null;
  activeAnnotation: string | null;
  selectCell: (stringIdx: number, colIdx: number) => void;
  placeValue: (stringIdx: number, colIdx: number, value: string) => void;
  clearCell: (stringIdx: number, colIdx: number) => void;
  setActiveAnnotation: (annotation: string | null) => void;
  extend: () => void;
  moveSelection: (ds: number, dc: number) => void;
}

function initGrid(instrument: Instrument, content: string, existingGrid?: TabGrid): TabGrid {
  if (existingGrid) return existingGrid;
  const parsed = content ? parseTabToGrid(content) : null;
  return parsed ?? defaultGrid(instrument);
}

export function useTabGrid(
  instrument: Instrument,
  content: string,
  existingGrid: TabGrid | undefined,
  onUpdate: (grid: TabGrid, text: string) => void,
): UseTabGridReturn {
  const [grid, setGrid] = useState<TabGrid>(() =>
    initGrid(instrument, content, existingGrid),
  );
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);

  const commit = useCallback(
    (next: TabGrid) => {
      setGrid(next);
      onUpdate(next, gridToText(next));
    },
    [onUpdate],
  );

  const selectCell = useCallback((stringIdx: number, colIdx: number) => {
    setSelectedCell({ stringIdx, colIdx });
  }, []);

  const placeValue = useCallback(
    (stringIdx: number, colIdx: number, value: string) => {
      const key = `${stringIdx}:${colIdx}`;
      const kind: CellValue["kind"] = /^\d+$/.test(value) ? "fret" : "annotation";
      commit({ ...grid, cells: { ...grid.cells, [key]: { kind, value } } });
    },
    [grid, commit],
  );

  const clearCell = useCallback(
    (stringIdx: number, colIdx: number) => {
      const key = `${stringIdx}:${colIdx}`;
      const next = { ...grid, cells: { ...grid.cells } };
      delete next.cells[key];
      commit(next);
    },
    [grid, commit],
  );

  const extend = useCallback(() => {
    commit({ ...grid, colCount: grid.colCount + COLS_PER_BAR });
  }, [grid, commit]);

  const moveSelection = useCallback(
    (ds: number, dc: number) => {
      setSelectedCell((prev) => {
        if (!prev) return prev;
        const nextS = Math.max(0, Math.min(grid.strings.length - 1, prev.stringIdx + ds));
        const nextC = Math.max(0, Math.min(grid.colCount - 1, prev.colIdx + dc));
        return { stringIdx: nextS, colIdx: nextC };
      });
    },
    [grid],
  );

  return {
    grid,
    selectedCell,
    activeAnnotation,
    selectCell,
    placeValue,
    clearCell,
    setActiveAnnotation,
    extend,
    moveSelection,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTabGrid.ts
git commit -m "feat: add useTabGrid hook"
```

---

## Task 5: `AnnotationToolbar` Component

**Files:**
- Create: `src/components/detail/tabs/AnnotationToolbar.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/detail/tabs/AnnotationToolbar.tsx`:

```typescript
interface Annotation {
  value: string;
  title: string;
}

const GROUPS: { label: string; items: Annotation[] }[] = [
  {
    label: "Artic",
    items: [
      { value: "h", title: "Hammer on" },
      { value: "p", title: "Pull off" },
      { value: "b", title: "Bend" },
      { value: "r", title: "Release bend" },
      { value: "~", title: "Vibrato" },
      { value: "~~", title: "Wide vibrato" },
    ],
  },
  {
    label: "Slide",
    items: [
      { value: "/", title: "Slide up" },
      { value: "\\", title: "Slide down" },
      { value: "sl", title: "Legato slide" },
    ],
  },
  {
    label: "Special",
    items: [
      { value: "x", title: "Dead note" },
      { value: "(n)", title: "Ghost note" },
      { value: "T", title: "Tapping" },
      { value: "P.H.", title: "Pinched harmonic" },
      { value: "◇", title: "Natural harmonic" },
    ],
  },
  {
    label: "Effects",
    items: [
      { value: "P.M.", title: "Palm mute" },
      { value: "let ring", title: "Let ring" },
      { value: "tr", title: "Trill" },
      { value: "P.S.", title: "Pick scrape" },
    ],
  },
  {
    label: "Strokes",
    items: [
      { value: "⊓", title: "Down stroke" },
      { value: "V", title: "Up stroke" },
    ],
  },
];

interface Props {
  active: string | null;
  onChange: (value: string | null) => void;
}

export default function AnnotationToolbar({ active, onChange }: Props) {
  return (
    <div className="tab-annotation-bar">
      {GROUPS.map((group, gi) => (
        <div key={group.label} className="tab-annotation-group">
          {gi > 0 && <div className="tab-annotation-sep" />}
          <span className="tab-annotation-label">{group.label}</span>
          {group.items.map((item) => (
            <button
              key={item.value}
              title={item.title}
              className={`tab-annotation-btn${active === item.value ? " active" : ""}`}
              onClick={() => onChange(active === item.value ? null : item.value)}
            >
              {item.value}
            </button>
          ))}
        </div>
      ))}
      {active && (
        <div className="tab-annotation-status">
          <span>● {active} active</span>
          <button onClick={() => onChange(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/detail/tabs/AnnotationToolbar.tsx
git commit -m "feat: add AnnotationToolbar component"
```

---

## Task 6: `TabGridEditor` Component

**Files:**
- Create: `src/components/detail/tabs/TabGridEditor.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/detail/tabs/TabGridEditor.tsx`:

```typescript
import { useState, useRef, useEffect } from "react";
import type { TabGrid } from "../../../types";
import { COL_WIDTH, STRING_HEIGHT, COLS_PER_BAR, COLS_PER_BEAT } from "../../../lib/tab-grid";

interface Props {
  grid: TabGrid;
  selectedCell: { stringIdx: number; colIdx: number } | null;
  activeAnnotation: string | null;
  onCellClick: (stringIdx: number, colIdx: number) => void;
  onPlaceValue: (stringIdx: number, colIdx: number, value: string) => void;
  onClearCell: (stringIdx: number, colIdx: number) => void;
  onExtend: () => void;
  onMoveSelection: (ds: number, dc: number) => void;
}

export default function TabGridEditor({
  grid,
  selectedCell,
  activeAnnotation,
  onCellClick,
  onPlaceValue,
  onClearCell,
  onExtend,
  onMoveSelection,
}: Props) {
  const [editingCell, setEditingCell] = useState<{ stringIdx: number; colIdx: number } | null>(null);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell) inputRef.current?.focus();
  }, [editingCell]);

  const totalWidth = grid.colCount * COL_WIDTH;

  function handleLineClick(e: React.MouseEvent<HTMLDivElement>, stringIdx: number) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const colIdx = Math.min(Math.floor(x / COL_WIDTH), grid.colCount - 1);
    const key = `${stringIdx}:${colIdx}`;

    if (activeAnnotation) {
      onPlaceValue(stringIdx, colIdx, activeAnnotation);
      return;
    }

    const existing = grid.cells[key];
    if (existing) {
      // re-open for editing
      setInputValue(existing.value);
    } else {
      setInputValue("");
    }
    onCellClick(stringIdx, colIdx);
    setEditingCell({ stringIdx, colIdx });
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editingCell) return;
    if (e.key === "Enter") {
      commitInput();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    } else if (e.key === "Backspace" && inputValue === "") {
      onClearCell(editingCell.stringIdx, editingCell.colIdx);
      setEditingCell(null);
    } else if (e.key === "ArrowLeft") {
      commitInput();
      onMoveSelection(0, -1);
    } else if (e.key === "ArrowRight") {
      commitInput();
      onMoveSelection(0, 1);
    } else if (e.key === "ArrowUp") {
      commitInput();
      onMoveSelection(-1, 0);
    } else if (e.key === "ArrowDown") {
      commitInput();
      onMoveSelection(1, 0);
    }
  }

  function commitInput() {
    if (!editingCell) return;
    const v = inputValue.trim();
    if (v) onPlaceValue(editingCell.stringIdx, editingCell.colIdx, v);
    setEditingCell(null);
  }

  function handleContextMenu(e: React.MouseEvent, stringIdx: number, colIdx: number) {
    e.preventDefault();
    onClearCell(stringIdx, colIdx);
  }

  // Collect all occupied columns for chord highlight
  const occupiedCols = new Set(
    Object.keys(grid.cells).map((k) => parseInt(k.split(":")[1], 10)),
  );
  const highlightCol =
    selectedCell?.colIdx !== undefined && occupiedCols.has(selectedCell.colIdx)
      ? selectedCell.colIdx
      : null;

  return (
    <div className="tab-grid-wrap">
      {/* Scrollable area */}
      <div className="tab-grid-scroll">
        <div style={{ display: "inline-block", position: "relative" }}>
          {/* Chord column highlight overlay */}
          {highlightCol !== null && (
            <div
              className="tab-grid-col-highlight"
              style={{
                left: 44 + highlightCol * COL_WIDTH, // 24px label + 2px bar + 18px padding
                width: COL_WIDTH,
                top: 0,
                height: grid.strings.length * STRING_HEIGHT,
              }}
            />
          )}

          {grid.strings.map((label, si) => {
            return (
              <div key={label} className="tab-grid-row" style={{ height: STRING_HEIGHT }}>
                {/* String label */}
                <span className="tab-grid-label">{label}</span>
                {/* Opening bar */}
                <span className="tab-grid-bar">|</span>
                {/* Line container */}
                <div
                  className="tab-grid-line"
                  style={{ width: totalWidth }}
                  onClick={(e) => handleLineClick(e, si)}
                >
                  {/* Background line */}
                  <div className="tab-grid-bg-line" />

                  {/* Beat ticks */}
                  {Array.from({ length: Math.floor(grid.colCount / COLS_PER_BEAT) }).map((_, i) => (
                    <div
                      key={i}
                      className={`tab-grid-tick${i % (COLS_PER_BAR / COLS_PER_BEAT) === 0 ? " bar" : ""}`}
                      style={{ left: i * COLS_PER_BEAT * COL_WIDTH }}
                    />
                  ))}

                  {/* Placed values for this string */}
                  {Object.entries(grid.cells)
                    .filter(([k]) => parseInt(k.split(":")[0], 10) === si)
                    .map(([k, cell]) => {
                      const colIdx = parseInt(k.split(":")[1], 10);
                      const isEditing =
                        editingCell?.stringIdx === si && editingCell?.colIdx === colIdx;
                      if (isEditing) return null;
                      return (
                        <div
                          key={k}
                          className={`tab-grid-token ${cell.kind}`}
                          style={{ left: colIdx * COL_WIDTH }}
                          onContextMenu={(e) => handleContextMenu(e, si, colIdx)}
                        >
                          {cell.value}
                        </div>
                      );
                    })}

                  {/* Inline input for selected cell */}
                  {editingCell?.stringIdx === si && (
                    <div
                      className="tab-grid-input-wrap"
                      style={{ left: editingCell.colIdx * COL_WIDTH }}
                    >
                      <input
                        ref={inputRef}
                        className="tab-grid-input"
                        value={inputValue}
                        maxLength={2}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleInputKeyDown}
                        onBlur={commitInput}
                      />
                    </div>
                  )}
                </div>
                {/* Closing bar */}
                <span className="tab-grid-bar">|</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Extend button */}
      <div className="tab-grid-footer">
        <button className="tb-btn" onClick={onExtend} style={{ fontSize: 11 }}>
          + Extend
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/detail/tabs/TabGridEditor.tsx
git commit -m "feat: add TabGridEditor component"
```

---

## Task 7: `TabExpandedModal` Component

**Files:**
- Create: `src/components/detail/tabs/TabExpandedModal.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/detail/tabs/TabExpandedModal.tsx`:

```typescript
import { useEffect } from "react";
import type { TabGrid } from "../../../types";
import TabGridEditor from "./TabGridEditor";
import AnnotationToolbar from "./AnnotationToolbar";

interface Props {
  grid: TabGrid;
  selectedCell: { stringIdx: number; colIdx: number } | null;
  activeAnnotation: string | null;
  onCellClick: (stringIdx: number, colIdx: number) => void;
  onPlaceValue: (stringIdx: number, colIdx: number, value: string) => void;
  onClearCell: (stringIdx: number, colIdx: number) => void;
  onExtend: () => void;
  onMoveSelection: (ds: number, dc: number) => void;
  onAnnotationChange: (value: string | null) => void;
  onClose: () => void;
}

export default function TabExpandedModal({
  grid,
  selectedCell,
  activeAnnotation,
  onCellClick,
  onPlaceValue,
  onClearCell,
  onExtend,
  onMoveSelection,
  onAnnotationChange,
  onClose,
}: Props) {
  // 64-col expanded grid (4 bars)
  const expandedGrid: TabGrid = { ...grid, colCount: Math.max(grid.colCount, 64) };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="tab-expanded-overlay" onClick={onClose}>
      <div
        className="tab-expanded-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tab-expanded-header">
          <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: "sans-serif" }}>
            Expanded View — 4 bars
          </span>
          <button
            style={{ fontSize: 12, color: "var(--text-3)" }}
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>
        <AnnotationToolbar active={activeAnnotation} onChange={onAnnotationChange} />
        <TabGridEditor
          grid={expandedGrid}
          selectedCell={selectedCell}
          activeAnnotation={activeAnnotation}
          onCellClick={onCellClick}
          onPlaceValue={onPlaceValue}
          onClearCell={onClearCell}
          onExtend={onExtend}
          onMoveSelection={onMoveSelection}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/detail/tabs/TabExpandedModal.tsx
git commit -m "feat: add TabExpandedModal component"
```

---

## Task 8: Wire `TabTab.tsx` and Add CSS

> Note: the grid section is wrapped with `key={active.id}` so that `useTabGrid` re-initializes when the user switches between parts.

**Files:**
- Modify: `src/components/detail/tabs/TabTab.tsx`
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add CSS for the grid editor to `src/styles/app.css`**

Append to `src/styles/app.css` (after the existing `.tab-add-row` block):

```css
/* Tab grid editor */
.tab-annotation-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
  min-height: 36px;
}
.tab-annotation-group {
  display: flex;
  align-items: center;
  gap: 3px;
}
.tab-annotation-sep {
  width: 1px;
  height: 14px;
  background: var(--line);
  margin: 0 4px;
}
.tab-annotation-label {
  font-size: 9px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-right: 2px;
  font-family: var(--font-sans, sans-serif);
}
.tab-annotation-btn {
  padding: 2px 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-2);
  border-radius: 3px;
  background: var(--bg-2);
}
.tab-annotation-btn:hover {
  background: var(--bg-3);
  color: var(--text-0);
}
.tab-annotation-btn.active {
  background: var(--accent);
  color: #1a0a00;
}
.tab-annotation-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 10px;
  color: var(--accent);
  font-family: var(--font-sans, sans-serif);
}
.tab-annotation-status button {
  font-size: 10px;
  color: var(--text-3);
}

.tab-grid-wrap {
  display: flex;
  flex-direction: column;
  background: var(--bg-0);
}
.tab-grid-scroll {
  overflow-x: auto;
  padding: 16px 12px 8px;
}
.tab-grid-row {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}
.tab-grid-label {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-3);
  width: 22px;
  text-align: right;
  padding-right: 2px;
  flex-shrink: 0;
}
.tab-grid-bar {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-3);
  flex-shrink: 0;
  user-select: none;
}
.tab-grid-line {
  position: relative;
  height: 28px;
  flex-shrink: 0;
  cursor: crosshair;
}
.tab-grid-bg-line {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--text-3);
  transform: translateY(-50%);
  pointer-events: none;
}
.tab-grid-tick {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 5px;
  background: var(--line);
  transform: translateY(-50%);
  pointer-events: none;
}
.tab-grid-tick.bar {
  height: 12px;
  background: var(--text-3);
}
.tab-grid-token {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 700;
  background: var(--bg-0);
  padding: 0 1px;
  cursor: pointer;
  z-index: 1;
  white-space: nowrap;
}
.tab-grid-token.fret {
  color: #e0c97a;
}
.tab-grid-token.annotation {
  color: var(--accent);
}
.tab-grid-input-wrap {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  background: var(--bg-0);
  padding: 0 1px;
}
.tab-grid-input {
  width: 22px;
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--accent);
  color: var(--accent);
  font-size: 12.5px;
  font-family: var(--font-mono);
  text-align: center;
  outline: none;
  padding: 0;
}
.tab-grid-col-highlight {
  position: absolute;
  background: rgba(224, 201, 122, 0.06);
  border-left: 1px solid rgba(224, 201, 122, 0.15);
  border-right: 1px solid rgba(224, 201, 122, 0.15);
  pointer-events: none;
  z-index: 0;
}
.tab-grid-footer {
  padding: 6px 12px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: flex-end;
}

/* Expanded modal */
.tab-expanded-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tab-expanded-modal {
  background: var(--bg-0);
  border: 1px solid var(--line);
  border-radius: var(--radius-m);
  width: min(1100px, 95vw);
  max-height: 85vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.tab-expanded-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-1);
}
```

- [ ] **Step 2: Rewrite `TabTab.tsx` to use the new components**

Replace the entire contents of `src/components/detail/tabs/TabTab.tsx`.

Key design note: `useTabGrid` is called at the top of `TabTab`. A `key={active.id}` prop on the grid section forces React to remount `AnnotationToolbar` + `TabGridEditor` when the active part changes, which re-initializes `useTabGrid` with the new part's data.

```typescript
import { useState, useCallback } from "react";
import TabAgentModal from "../TabAgentModal";
import TabGridEditor from "./TabGridEditor";
import AnnotationToolbar from "./AnnotationToolbar";
import TabExpandedModal from "./TabExpandedModal";
import { useTabGrid } from "../../../hooks/useTabGrid";
import type { Project, TabPart, Instrument, TabGrid } from "../../../types";
import { defaultGrid } from "../../../lib/tab-grid";

function parseParts(raw: string | null): TabPart[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

function makeNew(instrument: Instrument, existing: TabPart[]): TabPart {
  const count = existing.filter((p) => p.instrument === instrument).length;
  const base = { guitar: "Guitar", bass: "Bass", drums: "Drums" }[instrument];
  return {
    id: crypto.randomUUID(),
    name: count > 0 ? `${base} ${count + 1}` : base,
    instrument,
    content: "",
    grid: defaultGrid(instrument),
  };
}

interface Props {
  project: Project;
  onUpdate: (field: string, value: unknown) => void;
}

// Inner component so key={active.id} remounts useTabGrid on part switch
function ActivePartEditor({
  part,
  onPartUpdate,
  expanded,
  onExpand,
  onCollapse,
}: {
  part: TabPart;
  onPartUpdate: (changes: Partial<TabPart>) => void;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const handleGridUpdate = useCallback(
    (grid: TabGrid, text: string) => onPartUpdate({ grid, content: text }),
    [onPartUpdate],
  );

  const {
    grid,
    selectedCell,
    activeAnnotation,
    selectCell,
    placeValue,
    clearCell,
    setActiveAnnotation,
    extend,
    moveSelection,
  } = useTabGrid(part.instrument, part.content, part.grid, handleGridUpdate);

  return (
    <>
      <AnnotationToolbar active={activeAnnotation} onChange={setActiveAnnotation} />
      <TabGridEditor
        grid={grid}
        selectedCell={selectedCell}
        activeAnnotation={activeAnnotation}
        onCellClick={selectCell}
        onPlaceValue={placeValue}
        onClearCell={clearCell}
        onExtend={extend}
        onMoveSelection={moveSelection}
      />
      {expanded && (
        <TabExpandedModal
          grid={grid}
          selectedCell={selectedCell}
          activeAnnotation={activeAnnotation}
          onCellClick={selectCell}
          onPlaceValue={placeValue}
          onClearCell={clearCell}
          onExtend={extend}
          onMoveSelection={moveSelection}
          onAnnotationChange={setActiveAnnotation}
          onClose={onCollapse}
        />
      )}
    </>
  );
}

export default function TabTab({ project: p, onUpdate }: Props) {
  const [parts, setParts] = useState<TabPart[]>(() => parseParts(p.tabs));
  const [activeId, setActiveId] = useState<string | null>(
    () => parseParts(p.tabs)[0]?.id ?? null,
  );
  const [adding, setAdding] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const active = parts.find((pt) => pt.id === activeId) ?? null;

  const persist = useCallback(
    (updated: TabPart[]) => onUpdate("tabs", JSON.stringify(updated)),
    [onUpdate],
  );

  const updateActive = useCallback(
    (changes: Partial<TabPart>) => {
      if (!active) return;
      const updated = parts.map((pt) =>
        pt.id === active.id ? { ...pt, ...changes } : pt,
      );
      setParts(updated);
      persist(updated);
    },
    [active, parts, persist],
  );

  const handleInsertGenerated = useCallback(
    (generated: TabPart[]) => {
      const updated = [...parts, ...generated];
      setParts(updated);
      setActiveId(generated[0]?.id ?? activeId);
      persist(updated);
    },
    [parts, activeId, persist],
  );

  const addPart = (instrument: Instrument) => {
    const part = makeNew(instrument, parts);
    const updated = [...parts, part];
    setParts(updated);
    setActiveId(part.id);
    setAdding(false);
    persist(updated);
  };

  const deletePart = (id: string) => {
    const updated = parts.filter((pt) => pt.id !== id);
    setParts(updated);
    setActiveId(updated[0]?.id ?? null);
    setEditingName(false);
    persist(updated);
  };

  if (parts.length === 0) {
    return (
      <>
        <div className="tab-editor">
          <div
            style={{
              color: "var(--text-3)",
              textAlign: "center",
              padding: "28px 16px 12px",
              fontSize: 12,
            }}
          >
            No tablature yet — add a part manually or let the AI generate a structure.
          </div>
          <div className="tab-add-row">
            <button className="tb-btn primary" onClick={() => setAgentOpen(true)}>
              ✦ Generate with AI
            </button>
          </div>
          <div className="tab-add-row" style={{ paddingTop: 0 }}>
            {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
              <button key={inst} className="tb-btn" onClick={() => addPart(inst)}>
                + {inst.charAt(0).toUpperCase() + inst.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {agentOpen && (
          <TabAgentModal
            project={p}
            onInsert={handleInsertGenerated}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="tab-editor">
        {/* Parts bar */}
        <div className="tab-parts-bar">
          {parts.map((pt) => (
            <button
              key={pt.id}
              className={`tab-part-btn ${pt.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(pt.id);
                setEditingName(false);
                setAdding(false);
                setExpanded(false);
              }}
            >
              {pt.name}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {adding ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
                <button
                  key={inst}
                  className="tb-btn"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => addPart(inst)}
                >
                  {inst.charAt(0).toUpperCase() + inst.slice(1)}
                </button>
              ))}
              <button
                style={{ fontSize: 11, color: "var(--text-3)", padding: "2px 6px" }}
                onClick={() => setAdding(false)}
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <button className="tab-part-btn" onClick={() => setAdding(true)}>+ Part</button>
              <button
                className="tab-part-btn"
                style={{ color: "var(--accent)" }}
                onClick={() => setAgentOpen(true)}
              >
                ✦ AI
              </button>
            </>
          )}
        </div>

        {active && (
          <>
            {/* Part header */}
            <div className="tab-part-header">
              {editingName ? (
                <>
                  {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
                    <button
                      key={inst}
                      className={`tb-btn ${active.instrument === inst ? "active-inst" : ""}`}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => updateActive({ instrument: inst })}
                    >
                      {inst.charAt(0).toUpperCase() + inst.slice(1)}
                    </button>
                  ))}
                  <input
                    className="tab-name-input"
                    value={active.name}
                    onChange={(e) => updateActive({ name: e.target.value })}
                    placeholder="Part name"
                  />
                  <button
                    style={{ fontSize: 11, color: "var(--red)" }}
                    onClick={() => deletePart(active.id)}
                  >
                    Delete
                  </button>
                  <button
                    style={{ fontSize: 11, color: "var(--accent)" }}
                    onClick={() => setEditingName(false)}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {active.instrument}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-0)" }}>{active.name}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    style={{ fontSize: 11, color: "var(--text-3)" }}
                    title="Expand to 4 bars"
                    onClick={() => setExpanded(true)}
                  >
                    ⤢
                  </button>
                  <button
                    style={{ fontSize: 11, color: "var(--accent)" }}
                    onClick={() => setEditingName(true)}
                  >
                    ✎ Edit
                  </button>
                </>
              )}
            </div>

            {/* key={active.id} remounts ActivePartEditor (and useTabGrid) when switching parts */}
            <ActivePartEditor
              key={active.id}
              part={active}
              onPartUpdate={updateActive}
              expanded={expanded}
              onExpand={() => setExpanded(true)}
              onCollapse={() => setExpanded(false)}
            />
          </>
        )}
      </div>

      {agentOpen && (
        <TabAgentModal
          project={p}
          onInsert={handleInsertGenerated}
          onClose={() => setAgentOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/detail/tabs/TabTab.tsx src/styles/app.css
git commit -m "feat: wire tab grid editor into TabTab — replace textarea with visual grid"
```

The current `TabTab.tsx` draft in Task 8 has duplicated grid mutation logic between `PartEditor` and the expanded modal lifted state. This task consolidates it.

**Files:**
- Modify: `src/components/detail/tabs/TabTab.tsx`

- [ ] **Step 1: Move `useTabGrid` out of `PartEditor` into `TabTab` and pass handlers down**

Remove the inner `PartEditor` component entirely. Instead, call `useTabGrid` at the top of `TabTab` whenever `active` exists. Pass the hook's return values through props to `TabGridEditor`, `AnnotationToolbar`, and `TabExpandedModal`.

Replace the `TabTab` function body with:

```typescript
export default function TabTab({ project: p, onUpdate }: Props) {
  const [parts, setParts] = useState<TabPart[]>(() => parseParts(p.tabs));
  const [activeId, setActiveId] = useState<string | null>(
    () => parseParts(p.tabs)[0]?.id ?? null,
  );
  const [adding, setAdding] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const active = parts.find((pt) => pt.id === activeId) ?? null;

  const persist = useCallback(
    (updated: TabPart[]) => {
      onUpdate("tabs", JSON.stringify(updated));
    },
    [onUpdate],
  );

  const updateActive = useCallback(
    (changes: Partial<TabPart>) => {
      if (!active) return;
      const updated = parts.map((pt) =>
        pt.id === active.id ? { ...pt, ...changes } : pt,
      );
      setParts(updated);
      persist(updated);
    },
    [active, parts, persist],
  );

  const handleGridUpdate = useCallback(
    (grid: TabGrid, text: string) => {
      updateActive({ grid, content: text });
    },
    [updateActive],
  );

  const {
    grid,
    selectedCell,
    activeAnnotation,
    selectCell,
    placeValue,
    clearCell,
    setActiveAnnotation,
    extend,
    moveSelection,
  } = useTabGrid(
    active?.instrument ?? "guitar",
    active?.content ?? "",
    active?.grid,
    handleGridUpdate,
  );

  const handleInsertGenerated = useCallback(
    (generated: TabPart[]) => {
      const updated = [...parts, ...generated];
      setParts(updated);
      setActiveId(generated[0]?.id ?? activeId);
      persist(updated);
    },
    [parts, activeId, persist],
  );

  const addPart = (instrument: Instrument) => {
    const part = makeNew(instrument, parts);
    const updated = [...parts, part];
    setParts(updated);
    setActiveId(part.id);
    setAdding(false);
    persist(updated);
  };

  const deletePart = (id: string) => {
    const updated = parts.filter((pt) => pt.id !== id);
    setParts(updated);
    setActiveId(updated[0]?.id ?? null);
    setEditingName(false);
    persist(updated);
  };

  if (parts.length === 0) {
    return (
      <>
        <div className="tab-editor">
          <div
            style={{
              color: "var(--text-3)",
              textAlign: "center",
              padding: "28px 16px 12px",
              fontSize: 12,
            }}
          >
            No tablature yet — add a part manually or let the AI generate a structure.
          </div>
          <div className="tab-add-row">
            <button className="tb-btn primary" onClick={() => setAgentOpen(true)}>
              ✦ Generate with AI
            </button>
          </div>
          <div className="tab-add-row" style={{ paddingTop: 0 }}>
            {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
              <button key={inst} className="tb-btn" onClick={() => addPart(inst)}>
                + {inst.charAt(0).toUpperCase() + inst.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {agentOpen && (
          <TabAgentModal
            project={p}
            onInsert={handleInsertGenerated}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="tab-editor">
        {/* Parts bar */}
        <div className="tab-parts-bar">
          {parts.map((pt) => (
            <button
              key={pt.id}
              className={`tab-part-btn ${pt.id === activeId ? "active" : ""}`}
              onClick={() => {
                setActiveId(pt.id);
                setEditingName(false);
                setAdding(false);
              }}
            >
              {pt.name}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {adding ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
                <button
                  key={inst}
                  className="tb-btn"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => addPart(inst)}
                >
                  {inst.charAt(0).toUpperCase() + inst.slice(1)}
                </button>
              ))}
              <button
                style={{ fontSize: 11, color: "var(--text-3)", padding: "2px 6px" }}
                onClick={() => setAdding(false)}
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <button className="tab-part-btn" onClick={() => setAdding(true)}>+ Part</button>
              <button
                className="tab-part-btn"
                style={{ color: "var(--accent)" }}
                onClick={() => setAgentOpen(true)}
              >
                ✦ AI
              </button>
            </>
          )}
        </div>

        {active && (
          <>
            {/* Part header */}
            <div className="tab-part-header">
              {editingName ? (
                <>
                  {(["guitar", "bass", "drums"] as Instrument[]).map((inst) => (
                    <button
                      key={inst}
                      className={`tb-btn ${active.instrument === inst ? "active-inst" : ""}`}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => updateActive({ instrument: inst })}
                    >
                      {inst.charAt(0).toUpperCase() + inst.slice(1)}
                    </button>
                  ))}
                  <input
                    className="tab-name-input"
                    value={active.name}
                    onChange={(e) => updateActive({ name: e.target.value })}
                    placeholder="Part name"
                  />
                  <button
                    style={{ fontSize: 11, color: "var(--red)" }}
                    onClick={() => deletePart(active.id)}
                  >
                    Delete
                  </button>
                  <button
                    style={{ fontSize: 11, color: "var(--accent)" }}
                    onClick={() => setEditingName(false)}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {active.instrument}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-0)" }}>{active.name}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    style={{ fontSize: 11, color: "var(--text-3)" }}
                    title="Expand to 4 bars"
                    onClick={() => setExpanded(true)}
                  >
                    ⤢
                  </button>
                  <button
                    style={{ fontSize: 11, color: "var(--accent)" }}
                    onClick={() => setEditingName(true)}
                  >
                    ✎ Edit
                  </button>
                </>
              )}
            </div>

            {/* Annotation toolbar + Grid editor */}
            <AnnotationToolbar active={activeAnnotation} onChange={setActiveAnnotation} />
            <TabGridEditor
              grid={grid}
              selectedCell={selectedCell}
              activeAnnotation={activeAnnotation}
              onCellClick={selectCell}
              onPlaceValue={placeValue}
              onClearCell={clearCell}
              onExtend={extend}
              onMoveSelection={moveSelection}
            />
          </>
        )}
      </div>

      {expanded && active && (
        <TabExpandedModal
          grid={grid}
          selectedCell={selectedCell}
          activeAnnotation={activeAnnotation}
          onCellClick={selectCell}
          onPlaceValue={placeValue}
          onClearCell={clearCell}
          onExtend={extend}
          onMoveSelection={moveSelection}
          onAnnotationChange={setActiveAnnotation}
          onClose={() => setExpanded(false)}
        />
      )}

      {agentOpen && (
        <TabAgentModal
          project={p}
          onInsert={handleInsertGenerated}
          onClose={() => setAgentOpen(false)}
        />
      )}
    </>
  );
}
```

Also remove the `PartEditor` inner component from the file — it's no longer used.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Final commit**

```bash
git add src/components/detail/tabs/TabTab.tsx
git commit -m "refactor: lift grid state to TabTab, remove PartEditor inner component"
```

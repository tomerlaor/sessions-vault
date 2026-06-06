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
  addString: (label: string) => void;
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

  const addString = useCallback(
    (label: string) => {
      commit({ ...grid, strings: [...grid.strings, label] });
    },
    [grid, commit],
  );

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
    addString,
    moveSelection,
  };
}

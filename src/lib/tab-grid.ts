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

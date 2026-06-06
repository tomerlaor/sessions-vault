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
    colCount: 4 * COLS_PER_BAR,
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

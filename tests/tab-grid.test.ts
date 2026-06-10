import { describe, it, expect } from "vitest";
import { gridToText, defaultGrid, COL_WIDTH, COLS_PER_BAR, parseTabToGrid } from "../src/lib/tab-grid";
import type { TabGrid } from "../src/types";

describe("constants", () => {
  it("COL_WIDTH is 20", () => expect(COL_WIDTH).toBe(20));
  it("COLS_PER_BAR is 16", () => expect(COLS_PER_BAR).toBe(16));
});

describe("defaultGrid", () => {
  it("returns guitar grid with correct strings and 64 cols (4 bars)", () => {
    const g = defaultGrid("guitar");
    expect(g.strings).toEqual(["e", "B", "G", "D", "A", "E"]);
    expect(g.colCount).toBe(64);
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

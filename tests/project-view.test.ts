import { describe, it, expect } from "vitest";
import {
  adjacentProjectIds,
  clampSplit,
  MIN_PANE_PX,
  MIN_STACKED_PANE_PX,
  DIVIDER_PX,
  shouldStack,
  parseStoredSplit,
  isEditableTarget,
  shouldFlushLyrics,
} from "../src/lib/project-view";

describe("adjacentProjectIds", () => {
  it("returns neighbours in the middle", () => {
    expect(adjacentProjectIds(["a", "b", "c"], "b")).toEqual({
      prev: "a",
      next: "c",
    });
  });

  it("has no prev at the first id", () => {
    expect(adjacentProjectIds(["a", "b", "c"], "a")).toEqual({
      prev: null,
      next: "b",
    });
  });

  it("has no next at the last id", () => {
    expect(adjacentProjectIds(["a", "b", "c"], "c")).toEqual({
      prev: "b",
      next: null,
    });
  });

  it("returns nulls for a single id, empty list or unknown id", () => {
    const none = { prev: null, next: null };
    expect(adjacentProjectIds(["a"], "a")).toEqual(none);
    expect(adjacentProjectIds([], "a")).toEqual(none);
    expect(adjacentProjectIds(["a", "b"], "zzz")).toEqual(none);
  });
});

describe("clampSplit", () => {
  it("clamps to the minimum pane width on each side", () => {
    expect(clampSplit(0.1, 1000)).toBeCloseTo(0.32);
    expect(clampSplit(0.95, 1000)).toBeCloseTo(0.68);
  });

  it("keeps in-range ratios", () => {
    expect(clampSplit(0.5, 1000)).toBe(0.5);
  });

  it("returns 0.5 when the container is too small", () => {
    expect(clampSplit(0.2, 500)).toBe(0.5);
    expect(clampSplit(0.5, 0)).toBe(0.5);
  });

  it("returns 0.5 for NaN", () => {
    expect(clampSplit(NaN, 1000)).toBe(0.5);
  });

  it("honours a smaller minimum for stacked panes", () => {
    expect(MIN_STACKED_PANE_PX).toBe(160);
    expect(clampSplit(0.1, 400, MIN_STACKED_PANE_PX)).toBeCloseTo(0.4);
    expect(clampSplit(0.9, 400, MIN_STACKED_PANE_PX)).toBeCloseTo(0.6);
    expect(clampSplit(0.2, 300, MIN_STACKED_PANE_PX)).toBe(0.5);
  });

  it("never returns NaN or out-of-range values", () => {
    for (const c of [0, 1, 319, 320, 640, 641, 5000]) {
      for (const r of [-1, 0, 0.3, 1, 2]) {
        const v = clampSplit(r, c);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});

describe("shouldStack", () => {
  it("stacks only when two minimum panes and the divider do not fit", () => {
    const limit = 2 * MIN_PANE_PX + DIVIDER_PX;
    expect(shouldStack(limit - 1)).toBe(true);
    expect(shouldStack(limit)).toBe(false);
  });

  it("does not stack before the container has been measured", () => {
    expect(shouldStack(0)).toBe(false);
  });
});

describe("parseStoredSplit", () => {
  it("falls back to 0.5 for missing or invalid values", () => {
    for (const raw of [null, "", "abc", "0", "1", "-1", "5"]) {
      expect(parseStoredSplit(raw)).toBe(0.5);
    }
  });

  it("parses a valid ratio", () => {
    expect(parseStoredSplit("0.4")).toBe(0.4);
  });
});

describe("isEditableTarget", () => {
  it("is true for form fields", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
  });

  it("is true for contenteditable elements", () => {
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("is false for other elements and null", () => {
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("shouldFlushLyrics", () => {
  it("flushes when editing with unsaved changes", () => {
    expect(shouldFlushLyrics(true, "new", "old")).toBe(true);
  });

  it("does not flush when unchanged", () => {
    expect(shouldFlushLyrics(true, "same", "same")).toBe(false);
  });

  it("does not flush when not editing", () => {
    expect(shouldFlushLyrics(false, "new", "old")).toBe(false);
  });
});

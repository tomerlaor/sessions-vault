import { describe, it, expect } from "vitest";
import {
  adjacentProjectIds,
  clampSplit,
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

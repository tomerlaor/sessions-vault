import { describe, it, expect } from "vitest";
import { adjacentProjectIds, isEditableTarget } from "../src/lib/project-view";

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

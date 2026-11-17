import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TAB_IDS,
  parseTabHash,
  tabHash,
  rovingTabTarget,
  markDirty,
  startSaving,
  saveSucceeded,
  saveFailed,
  showUnsavedDot,
  createAutosaveController,
  resolveShortcut,
  type ShortcutEventLike,
} from "../src/lib/project-tabs";

// ── Tab hash parsing/serialization ──────────────────────────────────────────

describe("parseTabHash", () => {
  it("parses each known tab id, with or without a leading #", () => {
    expect(parseTabHash("#project")).toBe("project");
    expect(parseTabHash("lyrics")).toBe("lyrics");
    expect(parseTabHash("#tabs")).toBe("tabs");
  });

  it("falls back to project for unknown, empty, or malformed hashes", () => {
    expect(parseTabHash("")).toBe("project");
    expect(parseTabHash("#")).toBe("project");
    expect(parseTabHash("#bogus")).toBe("project");
    expect(parseTabHash("#Project")).toBe("project");
  });
});

describe("tabHash", () => {
  it("serializes a tab id to a hash string", () => {
    for (const id of TAB_IDS) {
      expect(tabHash(id)).toBe(`#${id}`);
      expect(parseTabHash(tabHash(id))).toBe(id);
    }
  });
});

// ── Tablist keyboard navigation ─────────────────────────────────────────────

describe("rovingTabTarget", () => {
  it("moves right and wraps past the last tab", () => {
    expect(rovingTabTarget("project", "ArrowRight")).toBe("lyrics");
    expect(rovingTabTarget("lyrics", "ArrowRight")).toBe("tabs");
    expect(rovingTabTarget("tabs", "ArrowRight")).toBe("project");
  });

  it("moves left and wraps before the first tab", () => {
    expect(rovingTabTarget("lyrics", "ArrowLeft")).toBe("project");
    expect(rovingTabTarget("project", "ArrowLeft")).toBe("tabs");
    expect(rovingTabTarget("tabs", "ArrowLeft")).toBe("lyrics");
  });

  it("Home jumps to the first tab, End to the last", () => {
    expect(rovingTabTarget("tabs", "Home")).toBe("project");
    expect(rovingTabTarget("project", "End")).toBe("tabs");
  });

  it("returns null for non-navigation keys", () => {
    expect(rovingTabTarget("project", "Enter")).toBeNull();
    expect(rovingTabTarget("project", "a")).toBeNull();
  });
});

// ── Shortcut resolution ─────────────────────────────────────────────────────

function evt(partial: Partial<ShortcutEventLike>): ShortcutEventLike {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: null,
    ...partial,
  };
}

describe("resolveShortcut", () => {
  it("maps Cmd+1/2/3 to tab selection on mac", () => {
    expect(resolveShortcut(evt({ key: "1", metaKey: true }), true)).toEqual({
      type: "select-tab",
      tab: "project",
    });
    expect(resolveShortcut(evt({ key: "2", metaKey: true }), true)).toEqual({
      type: "select-tab",
      tab: "lyrics",
    });
    expect(resolveShortcut(evt({ key: "3", metaKey: true }), true)).toEqual({
      type: "select-tab",
      tab: "tabs",
    });
  });

  it("accepts Ctrl in place of Cmd on non-mac", () => {
    expect(resolveShortcut(evt({ key: "2", ctrlKey: true }), false)).toEqual({
      type: "select-tab",
      tab: "lyrics",
    });
    // Ctrl does not substitute for Cmd on mac.
    expect(resolveShortcut(evt({ key: "2", ctrlKey: true }), true)).toBeNull();
  });

  it("maps other shortcuts to their actions", () => {
    expect(resolveShortcut(evt({ key: "o", metaKey: true }), true)).toEqual({
      type: "open",
    });
    expect(resolveShortcut(evt({ key: "Escape" }), true)).toEqual({
      type: "back",
    });
    expect(resolveShortcut(evt({ key: "[", metaKey: true }), true)).toEqual({
      type: "prev-project",
    });
    expect(resolveShortcut(evt({ key: "]", metaKey: true }), true)).toEqual({
      type: "next-project",
    });
    expect(
      resolveShortcut(evt({ key: "c", metaKey: true, shiftKey: true }), true),
    ).toEqual({ type: "copy-path" });
    expect(resolveShortcut(evt({ key: "e" }), true)).toEqual({
      type: "edit-lyrics",
    });
    expect(resolveShortcut(evt({ key: "t" }), true)).toEqual({
      type: "add-todo",
    });
  });

  it("returns null for keys that aren't shortcuts", () => {
    expect(resolveShortcut(evt({ key: "a" }), true)).toBeNull();
    expect(resolveShortcut(evt({ key: "4", metaKey: true }), true)).toBeNull();
  });

  it("ignores shortcuts while typing in an editable target", () => {
    const target = { tagName: "INPUT" };
    expect(resolveShortcut(evt({ key: "e", target }), true)).toBeNull();
    expect(resolveShortcut(evt({ key: "t", target }), true)).toBeNull();
    expect(
      resolveShortcut(evt({ key: "1", metaKey: true, target }), true),
    ).toBeNull();
    expect(
      resolveShortcut(
        evt({ key: "c", metaKey: true, shiftKey: true, target }),
        true,
      ),
    ).toBeNull();
  });

  it("still allows Escape and Cmd+O while typing", () => {
    const target = { tagName: "TEXTAREA" };
    expect(resolveShortcut(evt({ key: "Escape", target }), true)).toEqual({
      type: "back",
    });
    expect(
      resolveShortcut(evt({ key: "o", metaKey: true, target }), true),
    ).toEqual({ type: "open" });
  });

  it("treats contenteditable targets as editable too", () => {
    const target = { tagName: "DIV", isContentEditable: true };
    expect(resolveShortcut(evt({ key: "e", target }), true)).toBeNull();
  });
});

// ── Lyrics save-state / unsaved dot ─────────────────────────────────────────

describe("lyrics save-state machine", () => {
  it("walks dirty -> saving -> saved", () => {
    let state = markDirty();
    expect(state).toBe("dirty");
    state = startSaving(state);
    expect(state).toBe("saving");
    state = saveSucceeded();
    expect(state).toBe("saved");
  });

  it("walks dirty -> saving -> error", () => {
    let state = markDirty();
    state = startSaving(state);
    state = saveFailed();
    expect(state).toBe("error");
  });

  it("startSaving is a no-op unless dirty", () => {
    expect(startSaving("clean")).toBe("clean");
    expect(startSaving("saved")).toBe("saved");
    expect(startSaving("error")).toBe("error");
  });

  it("shows the unsaved dot while dirty or error (and while saving)", () => {
    expect(showUnsavedDot("dirty")).toBe(true);
    expect(showUnsavedDot("saving")).toBe(true);
    expect(showUnsavedDot("error")).toBe(true);
  });

  it("hides the unsaved dot once clean or saved", () => {
    expect(showUnsavedDot("clean")).toBe(false);
    expect(showUnsavedDot("saved")).toBe(false);
  });
});

// ── Autosave controller ──────────────────────────────────────────────────────

describe("createAutosaveController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the scheduled value after the debounce delay", () => {
    const onSave = vi.fn();
    const ctrl = createAutosaveController(500, onSave);
    ctrl.schedule("a");
    vi.advanceTimersByTime(499);
    expect(onSave).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("a");
  });

  it("debounces repeated schedules into a single save of the latest value", () => {
    const onSave = vi.fn();
    const ctrl = createAutosaveController(500, onSave);
    ctrl.schedule("a");
    vi.advanceTimersByTime(200);
    ctrl.schedule("b");
    vi.advanceTimersByTime(200);
    ctrl.schedule("c");
    vi.advanceTimersByTime(500);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("c");
  });

  it("flush saves immediately without waiting for the delay", () => {
    const onSave = vi.fn();
    const ctrl = createAutosaveController(500, onSave);
    ctrl.schedule("a");
    ctrl.flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("a");
    // The timer that would have fired later must not double-save.
    vi.advanceTimersByTime(500);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is pending", () => {
    const onSave = vi.fn();
    const ctrl = createAutosaveController(500, onSave);
    ctrl.flush();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cancel discards the pending save", () => {
    const onSave = vi.fn();
    const ctrl = createAutosaveController(500, onSave);
    ctrl.schedule("a");
    ctrl.cancel();
    vi.advanceTimersByTime(1000);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("works with injected timers instead of the real globals", () => {
    const calls: Array<[() => void, number]> = [];
    const fakeTimers = {
      setTimeout: (cb: () => void, ms: number) => {
        calls.push([cb, ms]);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => {},
    };
    const onSave = vi.fn();
    const ctrl = createAutosaveController(500, onSave, fakeTimers);
    ctrl.schedule("x");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(500);
    calls[0][0](); // manually fire the scheduled callback
    expect(onSave).toHaveBeenCalledWith("x");
  });
});

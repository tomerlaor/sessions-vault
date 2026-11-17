import { isEditableTarget } from "./project-view";

/** The three top-level sections of the project page. */
export type TabId = "project" | "lyrics" | "tabs";
export const TAB_IDS: readonly TabId[] = ["project", "lyrics", "tabs"];

/** Parse a `location.hash` (with or without the leading `#`) into a tab id,
 * falling back to "project" for anything unrecognized. */
export function parseTabHash(hash: string): TabId {
  const id = hash.replace(/^#/, "");
  return (TAB_IDS as readonly string[]).includes(id)
    ? (id as TabId)
    : "project";
}

/** The `location.hash` (including the leading `#`) for a given tab. */
export function tabHash(tab: TabId): string {
  return `#${tab}`;
}

/** The tab a tablist keydown should move focus/selection to, or null if the
 * key isn't a navigation key. Left/Right wrap around; Home/End jump to the
 * first/last tab. */
export function rovingTabTarget(current: TabId, key: string): TabId | null {
  const i = TAB_IDS.indexOf(current);
  const n = TAB_IDS.length;
  switch (key) {
    case "ArrowRight":
      return TAB_IDS[(i + 1) % n];
    case "ArrowLeft":
      return TAB_IDS[(i - 1 + n) % n];
    case "Home":
      return TAB_IDS[0];
    case "End":
      return TAB_IDS[n - 1];
    default:
      return null;
  }
}

// ── Lyrics autosave state machine ──────────────────────────────────────────

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

export function markDirty(): SaveState {
  return "dirty";
}

/** Begin a save attempt; a no-op unless there was something to save. */
export function startSaving(state: SaveState): SaveState {
  return state === "dirty" ? "saving" : state;
}

export function saveSucceeded(): SaveState {
  return "saved";
}

export function saveFailed(): SaveState {
  return "error";
}

/** Whether the "unsaved changes" dot should be shown for this state. */
export function showUnsavedDot(state: SaveState): boolean {
  return state === "dirty" || state === "saving" || state === "error";
}

// ── Autosave controller ─────────────────────────────────────────────────────

export interface AutosaveTimers {
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
}

const REAL_TIMERS: AutosaveTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export interface AutosaveController<T> {
  /** Debounce a save of `value`, replacing any pending save. */
  schedule: (value: T) => void;
  /** Immediately run any pending save, skipping the remaining delay. No-op if idle. */
  flush: () => void;
  /** Discard any pending save without running it. */
  cancel: () => void;
}

/** A debounced autosave queue: `schedule` replaces the pending value and
 * resets the timer; after `delayMs` of inactivity (or on `flush`) the most
 * recent value is handed to `onSave`. Timers are injectable so tests can
 * drive it with `vi.useFakeTimers()` without touching React. */
export function createAutosaveController<T>(
  delayMs: number,
  onSave: (value: T) => void,
  timers: AutosaveTimers = REAL_TIMERS,
): AutosaveController<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const clear = () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
  };

  const runPending = () => {
    if (!pending) return;
    const { value } = pending;
    pending = null;
    onSave(value);
  };

  return {
    schedule(value) {
      pending = { value };
      clear();
      timer = timers.setTimeout(runPending, delayMs);
    },
    flush() {
      clear();
      runPending();
    },
    cancel() {
      clear();
      pending = null;
    },
  };
}

// ── Misc project-page helpers ───────────────────────────────────────────────

/** Done/total counts out of the JSON-encoded todo list stored on a project. */
export function todoProgress(todosJson: string | null): {
  done: number;
  total: number;
} {
  try {
    const items = JSON.parse(todosJson ?? "[]") as { done?: boolean }[];
    return { done: items.filter((t) => t.done).length, total: items.length };
  } catch {
    return { done: 0, total: 0 };
  }
}

/** The highest `vN` version label among a project's files, or null if none. */
export function latestVersionLabel(labels: readonly string[]): string | null {
  let max = 0;
  for (const label of labels) {
    const m = label.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max > 0 ? `v${max}` : null;
}

// ── Keyboard shortcuts ──────────────────────────────────────────────────────

export type ShortcutAction =
  | { type: "select-tab"; tab: TabId }
  | { type: "open" }
  | { type: "back" }
  | { type: "prev-project" }
  | { type: "next-project" }
  | { type: "edit-lyrics" }
  | { type: "add-todo" }
  | { type: "copy-path" };

export interface ShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

/** Resolve a keydown to the shortcut action it maps to, or null if it isn't
 * one of the project view's shortcuts. `isMac` selects whether Cmd or Ctrl is
 * the modifier; on non-mac, Ctrl substitutes for Cmd.
 *
 * Shortcuts are inactive while the event target is editable (input/textarea/
 * contenteditable), except Escape and open-in-DAW — those two always work so
 * a user can back out or launch the DAW mid-edit. */
export function resolveShortcut(
  e: ShortcutEventLike,
  isMac: boolean,
): ShortcutAction | null {
  const mod = isMac ? e.metaKey : e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  const editable = isEditableTarget(e.target);

  if (e.key === "Escape") return { type: "back" };
  if (mod && key === "o") return { type: "open" };
  if (editable) return null;

  if (mod && ["1", "2", "3"].includes(e.key)) {
    return { type: "select-tab", tab: TAB_IDS[Number(e.key) - 1] };
  }
  if (mod && e.key === "[") return { type: "prev-project" };
  if (mod && e.key === "]") return { type: "next-project" };
  if (mod && e.shiftKey && key === "c") return { type: "copy-path" };
  if (!mod && key === "e") return { type: "edit-lyrics" };
  if (!mod && key === "t") return { type: "add-todo" };

  return null;
}

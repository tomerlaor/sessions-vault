/** Minimum width (or height) of either pane in the split view, in pixels. */
export const MIN_PANE_PX = 320;
/** Minimum height of either pane when the panes are stacked vertically. */
export const MIN_STACKED_PANE_PX = 160;
/** Thickness of the draggable divider, in pixels. */
export const DIVIDER_PX = 6;
/** Default share of the container given to the left (or top) pane. */
export const DEFAULT_SPLIT = 0.5;

/** The ids before and after `currentId` in `ids`, or null at the edges / when unknown. */
export function adjacentProjectIds(
  ids: readonly string[],
  currentId: string,
): { prev: string | null; next: string | null } {
  const i = ids.indexOf(currentId);
  if (i === -1) return { prev: null, next: null };
  return { prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null };
}

/** Whether the panes should stack, given the measured container width (0 = not measured yet). */
export function shouldStack(widthPx: number): boolean {
  return widthPx > 0 && widthPx < 2 * MIN_PANE_PX + DIVIDER_PX;
}

/** Clamp the left/top pane share so both panes keep at least `minPanePx`. */
export function clampSplit(
  ratio: number,
  containerPx: number,
  minPanePx: number = MIN_PANE_PX,
): number {
  if (
    !Number.isFinite(ratio) ||
    !Number.isFinite(containerPx) ||
    containerPx < 2 * minPanePx
  ) {
    return DEFAULT_SPLIT;
  }
  const min = minPanePx / containerPx;
  return Math.min(1 - min, Math.max(min, ratio));
}

/** Parse a persisted split ratio; anything not strictly between 0 and 1 falls back to the default. */
export function parseStoredSplit(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_SPLIT;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_SPLIT;
}

/** True when keyboard shortcuts should be ignored because the user is typing. */
export function isEditableTarget(
  t: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  return (
    t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"
  );
}

/** Whether pending lyrics edits should be saved before leaving the view. */
export function shouldFlushLyrics(
  editing: boolean,
  draft: string,
  saved: string,
): boolean {
  return editing && draft !== saved;
}

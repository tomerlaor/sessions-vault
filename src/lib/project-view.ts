/** The ids before and after `currentId` in `ids`, or null at the edges / when unknown. */
export function adjacentProjectIds(
  ids: readonly string[],
  currentId: string,
): { prev: string | null; next: string | null } {
  const i = ids.indexOf(currentId);
  if (i === -1) return { prev: null, next: null };
  return { prev: ids[i - 1] ?? null, next: ids[i + 1] ?? null };
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

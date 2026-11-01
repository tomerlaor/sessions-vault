import type { RestoreOutcome, RestoredFile, VerifyReport } from "../types";

function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? "" : path.slice(0, idx);
}

function pathSeparator(path: string): string {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function sanitizeForFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "restored project";
}

/** `YYYY-MM-DD HHMM` in UTC, so the same `nowSecs` always formats the same way
 * regardless of the machine's local timezone. */
function formatDateTime(nowSecs: number): string {
  const iso = new Date(nowSecs * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16).replace(":", "")}`;
}

/** The default restore destination: a new sibling folder next to the original
 * project file, named after the project and the restore time — never the
 * project directory itself or an existing project path. */
export function defaultRestoreTarget(
  originalPath: string,
  title: string,
  nowSecs: number,
): string {
  const dir = dirnameOf(originalPath);
  const sep = pathSeparator(originalPath);
  const folder = `${sanitizeForFolderName(title)} restored ${formatDateTime(nowSecs)}`;
  return dir ? `${dir}${sep}${folder}` : folder;
}

/** Mirrors `HistoryTab.tsx`'s `destinationLabel()` heuristic: a `gdrive`
 * backup's `destination` is a real local path when made through a mounted
 * Drive folder, and a bare Drive file ID (no path separators) when made
 * through the Drive API. */
export function isLocalDestination(destination: string): boolean {
  return destination.includes("/") || destination.includes("\\");
}

export function summarizeVerify(report: VerifyReport): string {
  const total = report.okCount + report.missingCount + report.corruptCount;
  if (report.missingCount === 0 && report.corruptCount === 0) {
    return `All ${total} file${total === 1 ? "" : "s"} verified ok`;
  }
  const parts = [`${report.okCount} ok`];
  if (report.missingCount > 0) parts.push(`${report.missingCount} missing`);
  if (report.corruptCount > 0) parts.push(`${report.corruptCount} corrupt`);
  return parts.join(", ");
}

export function summarizeRestore(outcome: RestoreOutcome): string {
  const total =
    outcome.okCount +
    outcome.mismatchCount +
    outcome.conflictCount +
    outcome.rejectedCount;
  if (
    outcome.mismatchCount === 0 &&
    outcome.conflictCount === 0 &&
    outcome.rejectedCount === 0
  ) {
    return `Restored ${total} file${total === 1 ? "" : "s"} ok`;
  }
  const parts = [`${outcome.okCount} ok`];
  if (outcome.mismatchCount > 0)
    parts.push(`${outcome.mismatchCount} mismatch`);
  if (outcome.conflictCount > 0)
    parts.push(`${outcome.conflictCount} conflict`);
  if (outcome.rejectedCount > 0)
    parts.push(`${outcome.rejectedCount} rejected`);
  return parts.join(", ");
}

/** Buckets restored files by status for the result screen's expandable
 * per-status lists; statuses with no files simply don't get a key. */
export function groupRestoreFilesByStatus(
  files: RestoredFile[],
): Record<string, RestoredFile[]> {
  const groups: Record<string, RestoredFile[]> = {};
  for (const f of files) {
    (groups[f.status] ??= []).push(f);
  }
  return groups;
}

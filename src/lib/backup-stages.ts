import type { ProjectFile, StageGroup, ManifestMissing } from "../types";

const ONE_GIB = 1024 * 1024 * 1024;

const KIND_LABELS: Record<string, string> = {
  mix_project: "Record / Mix",
  master_project: "Mastering",
};

const EXPORT_LABELS: Record<string, string> = {
  mix: "Exports · Mix",
  master: "Exports · Master",
  stems: "Exports · Stems",
  instrumental: "Exports · Instrumental",
  alternate: "Exports · Alternate",
};

/** Groups a project's files into a finer key than `kind` alone, so a user
 * can skip just the heavy stem set without skipping every export. */
export function stageKey(
  file: Pick<ProjectFile, "kind" | "exportType">,
): string {
  if (file.kind === "export") {
    return `export:${file.exportType ?? "mix"}`;
  }
  return file.kind;
}

function stageLabel(key: string): string {
  if (key.startsWith("export:")) {
    const exportType = key.slice("export:".length);
    return EXPORT_LABELS[exportType] ?? `Exports · ${exportType}`;
  }
  return KIND_LABELS[key] ?? key;
}

const STAGE_ORDER = [
  "mix_project",
  "master_project",
  "export:mix",
  "export:master",
  "export:stems",
  "export:instrumental",
  "export:alternate",
];

function stageRank(key: string): number {
  const i = STAGE_ORDER.indexOf(key);
  return i === -1 ? STAGE_ORDER.length : i;
}

export function groupFilesByStage(files: ProjectFile[]): StageGroup[] {
  const groups = new Map<string, StageGroup>();
  for (const f of files) {
    const key = stageKey(f);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalBytes += f.sizeBytes;
    } else {
      groups.set(key, {
        key,
        label: stageLabel(key),
        count: 1,
        totalBytes: f.sizeBytes,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => stageRank(a.key) - stageRank(b.key),
  );
}

/** All stages, minus any whose total size is heavy enough to likely be a
 * stem set someone would want to skip by default. */
export function defaultStageSelection(groups: StageGroup[]): string[] {
  return groups.filter((g) => g.totalBytes <= ONE_GIB).map((g) => g.key);
}

/** The remembered selection, intersected with the stages this project
 * actually has. Falls back to the default rule if nothing remembered
 * survives that intersection. */
export function resolveStageSelection(
  groups: StageGroup[],
  remembered: string[] | null,
): string[] {
  if (remembered && remembered.length > 0) {
    const present = new Set(groups.map((g) => g.key));
    const kept = remembered.filter((k) => present.has(k));
    if (kept.length > 0) return kept;
  }
  return defaultStageSelection(groups);
}

export interface StageFileInput {
  filePath: string;
  fileName: string;
  kind: string;
  exportType: string | null;
  versionLabel: string;
  isFinal: boolean;
}

/** Shapes a `ProjectFile` row into the payload the Rust `backup_local` /
 * `backup_gdrive` commands expect. */
export function toStageFileInput(f: ProjectFile): StageFileInput {
  return {
    filePath: f.filePath,
    fileName: f.fileName,
    kind: f.kind,
    exportType: f.exportType,
    versionLabel: f.versionLabel,
    isFinal: f.isFinal,
  };
}

/** Parses the `missing` list out of a backup's stored manifest JSON for
 * display. Never throws — malformed or absent JSON just yields no entries. */
export function parseMissing(manifestJson: string | null): ManifestMissing[] {
  if (!manifestJson) return [];
  try {
    const parsed = JSON.parse(manifestJson) as { missing?: ManifestMissing[] };
    return parsed.missing ?? [];
  } catch {
    return [];
  }
}

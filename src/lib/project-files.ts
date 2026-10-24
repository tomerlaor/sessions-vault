import type { ExportType } from "../types";

export function nextVersionLabel(labels: string[]): string {
  let max = 0;
  for (const label of labels) {
    const match = label.match(/(\d+)\s*$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `v${max + 1}`;
}

export function markFinal<T extends { id: string; isFinal: boolean }>(
  files: T[],
  id: string,
): T[] {
  if (!files.some((f) => f.id === id)) {
    throw new Error(`File ${id} not found`);
  }
  return files.map((f) => ({ ...f, isFinal: f.id === id }));
}

export function inferExportType(fileName: string): ExportType {
  const name = fileName.toLowerCase();
  if (name.includes("instrumental")) return "instrumental";
  if (name.includes("master")) return "master";
  return "mix";
}

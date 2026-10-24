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

function formatRate(hz: number): string {
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

function formatDuration(secs: number): string {
  const total = Math.round(secs);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export function formatAudioSummary(info: {
  sampleRate: number | null;
  bitDepth: number | null;
  durationSecs: number | null;
  peakDb: number | null;
}): string {
  const parts: string[] = [];
  if (info.sampleRate != null) parts.push(formatRate(info.sampleRate));
  if (info.bitDepth != null) parts.push(`${info.bitDepth}-bit`);
  if (info.durationSecs != null) parts.push(formatDuration(info.durationSecs));
  if (info.peakDb != null) parts.push(`peak ${info.peakDb.toFixed(1)} dBFS`);
  return parts.join(" · ");
}

export function audioWarnings(info: {
  clipped: boolean;
  lossy: boolean;
}): string[] {
  const warnings: string[] = [];
  if (info.clipped) warnings.push("Clipping");
  if (info.lossy) warnings.push("Lossy");
  return warnings;
}

export function formatMediaSummary(
  missing: number | null,
  external: number | null,
): string | null {
  if (missing == null || external == null) return null;
  const parts: string[] = [];
  if (missing > 0) parts.push(`${missing} missing`);
  if (external > 0) parts.push(`${external} outside folder`);
  return parts.length ? parts.join(" · ") : "All media found";
}

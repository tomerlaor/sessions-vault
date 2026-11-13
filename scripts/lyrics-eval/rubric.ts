// Blind human-scoring CSV: one row per trial output, shuffled within each
// case so row order doesn't hint at which trial produced which output.
// There's only one model per eval run, so there's nothing to blind *across*
// models here — the point is to stop raters from anchoring on trial order
// (e.g. always rating the first attempt generously).
import type { EvalRunResult } from "./runner";

const HEADER = ["case_id", "output", "fit", "craft", "singability", "keep"];

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildRubricCsv(run: EvalRunResult): string {
  const rows: string[][] = [HEADER];
  for (const c of run.cases) {
    const outputs = shuffled(c.trials.map((t) => t.rawOutput));
    for (const output of outputs) {
      rows.push([c.id, output, "", "", "", ""]);
    }
  }
  return rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}

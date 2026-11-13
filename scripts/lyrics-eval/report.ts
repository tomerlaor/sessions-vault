// Turns an EvalRunResult into the markdown summary written alongside the
// raw JSON. Pure string formatting — no I/O here, the CLI handles writing.
import {
  CHECK_NAMES,
  type CaseResult,
  type CheckName,
  type EvalRunResult,
} from "./runner";

interface PassFailSkip {
  pass: number;
  fail: number;
  skip: number;
}

function emptyPFS(): PassFailSkip {
  return { pass: 0, fail: 0, skip: 0 };
}

function addResult(bucket: PassFailSkip, status: "pass" | "fail" | "skip") {
  bucket[status]++;
}

function passRate(bucket: PassFailSkip): number | null {
  const scored = bucket.pass + bucket.fail;
  if (scored === 0) return null;
  return bucket.pass / scored;
}

function pct(n: number | null): string {
  return n === null ? "n/a" : `${(n * 100).toFixed(1)}%`;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface EvalStats {
  totalTrials: number;
  errorCount: number;
  overallTrialPassRate: number | null;
  byCheck: Record<CheckName, PassFailSkip>;
  byMode: Record<string, PassFailSkip>;
  byLang: Record<string, PassFailSkip>;
  latency: {
    meanTotalMs: number | null;
    p50TotalMs: number | null;
    p95TotalMs: number | null;
    meanTtftMs: number | null;
  };
  tokens: {
    meanInput: number | null;
    meanOutput: number | null;
    meanTotal: number | null;
  };
  // Only populated for trials that went through the OpenRouter decisions
  // "generate, then decide" pipeline (src/lib/ai.ts) — null fields mean no
  // trial reported that stage.
  decisionsPipeline: {
    trialsWithRanker: number;
    meanGeneratorMs: number | null;
    meanRankerMs: number | null;
    meanRankerInputTokens: number | null;
    meanRankerOutputTokens: number | null;
    totalRankerCost: number | null;
  };
  failingCases: { caseId: string; trial: number; failedChecks: string[] }[];
}

// A trial "passes" overall if the call succeeded and none of its checks
// failed. A trial that errored (e.g. network failure) never counts as a
// pass, even though its checks are all "skip" rather than "fail".
function trialPassed(trial: CaseResult["trials"][number]): boolean {
  if (trial.error) return false;
  return CHECK_NAMES.every((name) => trial.checks[name].status !== "fail");
}

export function computeStats(run: EvalRunResult): EvalStats {
  const byCheck: Record<CheckName, PassFailSkip> = {
    format: emptyPFS(),
    syllables: emptyPFS(),
    rhyme: emptyPFS(),
    noCopy: emptyPFS(),
    language: emptyPFS(),
    cliche: emptyPFS(),
  };
  const byMode: Record<string, PassFailSkip> = {};
  const byLang: Record<string, PassFailSkip> = {};
  const totalMsValues: number[] = [];
  const ttftMsValues: number[] = [];
  const inputTokens: number[] = [];
  const outputTokens: number[] = [];
  const totalTokens: number[] = [];
  const failingCases: EvalStats["failingCases"] = [];
  const generatorMsValues: number[] = [];
  const rankerMsValues: number[] = [];
  const rankerInputTokens: number[] = [];
  const rankerOutputTokens: number[] = [];
  const rankerCosts: number[] = [];

  let totalTrials = 0;
  let errorCount = 0;
  let passedTrials = 0;

  for (const c of run.cases) {
    byMode[c.mode] ??= emptyPFS();
    byLang[c.lang] ??= emptyPFS();

    c.trials.forEach((trial, trialIdx) => {
      totalTrials++;
      if (trial.error) errorCount++;

      const passed = trialPassed(trial);
      if (passed) passedTrials++;
      addResult(byMode[c.mode], passed ? "pass" : "fail");
      addResult(byLang[c.lang], passed ? "pass" : "fail");

      const failedChecks: string[] = [];
      for (const name of CHECK_NAMES) {
        const status = trial.checks[name].status;
        addResult(byCheck[name], status);
        if (status === "fail") failedChecks.push(name);
      }
      if (trial.error) failedChecks.push(`error: ${trial.error}`);
      if (failedChecks.length > 0) {
        failingCases.push({ caseId: c.id, trial: trialIdx, failedChecks });
      }

      if (!trial.error) {
        totalMsValues.push(trial.totalMs);
        if (trial.ttftMs !== null) ttftMsValues.push(trial.ttftMs);
        if (trial.usage) {
          if (typeof trial.usage.inputTokens === "number") {
            inputTokens.push(trial.usage.inputTokens);
          }
          if (typeof trial.usage.outputTokens === "number") {
            outputTokens.push(trial.usage.outputTokens);
          }
          const total =
            (trial.usage.inputTokens ?? 0) + (trial.usage.outputTokens ?? 0);
          if (total > 0) totalTokens.push(total);
        }
        if (trial.generator) generatorMsValues.push(trial.generator.durationMs);
        if (trial.ranker) {
          rankerMsValues.push(trial.ranker.durationMs);
          rankerInputTokens.push(trial.ranker.usage.inputTokens);
          rankerOutputTokens.push(trial.ranker.usage.outputTokens);
          if (typeof trial.ranker.cost === "number") {
            rankerCosts.push(trial.ranker.cost);
          }
        }
      }
    });
  }

  const sortedTotalMs = [...totalMsValues].sort((a, b) => a - b);

  return {
    totalTrials,
    errorCount,
    overallTrialPassRate: totalTrials > 0 ? passedTrials / totalTrials : null,
    byCheck,
    byMode,
    byLang,
    latency: {
      meanTotalMs: mean(totalMsValues),
      p50TotalMs: percentile(sortedTotalMs, 0.5),
      p95TotalMs: percentile(sortedTotalMs, 0.95),
      meanTtftMs: mean(ttftMsValues),
    },
    tokens: {
      meanInput: mean(inputTokens),
      meanOutput: mean(outputTokens),
      meanTotal: mean(totalTokens),
    },
    decisionsPipeline: {
      trialsWithRanker: rankerMsValues.length,
      meanGeneratorMs: mean(generatorMsValues),
      meanRankerMs: mean(rankerMsValues),
      meanRankerInputTokens: mean(rankerInputTokens),
      meanRankerOutputTokens: mean(rankerOutputTokens),
      totalRankerCost:
        rankerCosts.length > 0 ? rankerCosts.reduce((a, b) => a + b, 0) : null,
    },
    failingCases,
  };
}

function fmtMs(n: number | null): string {
  return n === null ? "n/a" : `${Math.round(n)}ms`;
}

function fmtTokens(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(1);
}

function fmtCost(n: number | null): string {
  return n === null ? "n/a" : `$${n.toFixed(6)}`;
}

export function buildMarkdownReport(run: EvalRunResult): string {
  const stats = computeStats(run);
  const lines: string[] = [];
  const isDecisions = !!run.meta.generatorModel;

  lines.push(
    `# Lyrics AI eval — ${run.meta.model}${isDecisions ? ` (ranker) + ${run.meta.generatorModel} (generator)` : ""}`,
  );
  lines.push("");
  lines.push(
    `- Provider: \`${run.meta.provider}\` · Model: \`${run.meta.model}\`${isDecisions ? ` (decisions) · Generator: \`${run.meta.generatorModel}\`` : ""}`,
  );
  lines.push(
    `- Generated: ${run.meta.generatedAt} · Fixtures: ${run.meta.fixtureCount} · n per case: ${run.meta.n}`,
  );
  lines.push(
    `- Total trials: ${stats.totalTrials} (errors: ${stats.errorCount})`,
  );
  lines.push(`- **Overall pass rate: ${pct(stats.overallTrialPassRate)}**`);
  lines.push("");

  lines.push("## Pass rate per check");
  lines.push("");
  lines.push("| Check | Pass | Fail | Skip | Pass rate |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const name of CHECK_NAMES) {
    const b = stats.byCheck[name];
    lines.push(
      `| ${name} | ${b.pass} | ${b.fail} | ${b.skip} | ${pct(passRate(b))} |`,
    );
  }
  lines.push("");

  lines.push("## Pass rate per mode");
  lines.push("");
  lines.push("| Mode | Pass | Fail | Pass rate |");
  lines.push("| --- | --- | --- | --- |");
  for (const [mode, b] of Object.entries(stats.byMode)) {
    lines.push(`| ${mode} | ${b.pass} | ${b.fail} | ${pct(passRate(b))} |`);
  }
  lines.push("");

  lines.push("## Pass rate per language");
  lines.push("");
  lines.push("| Lang | Pass | Fail | Pass rate |");
  lines.push("| --- | --- | --- | --- |");
  for (const [lang, b] of Object.entries(stats.byLang)) {
    lines.push(`| ${lang} | ${b.pass} | ${b.fail} | ${pct(passRate(b))} |`);
  }
  lines.push("");

  lines.push("## Latency & tokens");
  lines.push("");
  lines.push(
    `- Total duration — mean: ${fmtMs(stats.latency.meanTotalMs)}, p50: ${fmtMs(stats.latency.p50TotalMs)}, p95: ${fmtMs(stats.latency.p95TotalMs)}`,
  );
  lines.push(`- TTFT — mean: ${fmtMs(stats.latency.meanTtftMs)}`);
  lines.push(
    `- Tokens — mean input: ${fmtTokens(stats.tokens.meanInput)}, mean output: ${fmtTokens(stats.tokens.meanOutput)}, mean total: ${fmtTokens(stats.tokens.meanTotal)}`,
  );
  lines.push("");

  if (stats.decisionsPipeline.trialsWithRanker > 0) {
    const dp = stats.decisionsPipeline;
    lines.push("## Decisions pipeline (generator + ranker)");
    lines.push("");
    lines.push(
      `- Trials ranked: ${dp.trialsWithRanker}/${stats.totalTrials} · Generator: \`${run.meta.generatorModel}\` · Ranker: \`${run.meta.model}\``,
    );
    lines.push(
      `- Generator stage — mean duration: ${fmtMs(dp.meanGeneratorMs)}`,
    );
    lines.push(
      `- Ranker stage — mean duration: ${fmtMs(dp.meanRankerMs)}, mean tokens: ${fmtTokens(dp.meanRankerInputTokens)} in / ${fmtTokens(dp.meanRankerOutputTokens)} out, total cost: ${fmtCost(dp.totalRankerCost)}`,
    );
    lines.push("");
  }

  lines.push("## Failing cases");
  lines.push("");
  if (stats.failingCases.length === 0) {
    lines.push("None — every trial passed all applicable checks.");
  } else {
    lines.push("| Case | Trial | Failed checks |");
    lines.push("| --- | --- | --- |");
    for (const f of stats.failingCases) {
      lines.push(`| ${f.caseId} | ${f.trial} | ${f.failedChecks.join(", ")} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

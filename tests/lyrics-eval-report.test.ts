import { describe, it, expect } from "vitest";
import {
  type CheckName,
  type EvalRunResult,
  type ScoredCandidate,
  type TrialOutcome,
} from "../scripts/lyrics-eval/runner";
import {
  buildMarkdownReport,
  computeStats,
} from "../scripts/lyrics-eval/report";
import type { CheckResult } from "../scripts/lyrics-eval/checks";

function allPass(): Record<CheckName, CheckResult> {
  return {
    format: { status: "pass" },
    syllables: { status: "pass" },
    rhyme: { status: "pass" },
    noCopy: { status: "pass" },
    language: { status: "pass" },
    cliche: { status: "pass" },
  };
}

function withFails(names: CheckName[]): Record<CheckName, CheckResult> {
  const checks = allPass();
  for (const name of names) checks[name] = { status: "fail", detail: name };
  return checks;
}

function candidate(
  text: string,
  index: number,
  fails: CheckName[],
  isPick: boolean,
): ScoredCandidate {
  return {
    text,
    index,
    isPick,
    isFirst: index === 0,
    checks: withFails(fails),
  };
}

function trial(
  candidates: ScoredCandidate[],
  pickedIndex: number,
): TrialOutcome {
  const pick = candidates[pickedIndex] ?? candidates[0];
  return {
    rawOutput: pick.text,
    ttftMs: 100,
    totalMs: 100,
    checks: pick.checks,
    candidates,
    pickedIndex,
  };
}

function runWith(
  trials: TrialOutcome[],
  mode: EvalRunResult["cases"][number]["mode"] = "next_line",
): EvalRunResult {
  return {
    meta: {
      model: "typesafe/jev-1.14",
      provider: "openrouter",
      n: trials.length,
      generatedAt: "2026-11-13T00:00:00.000Z",
      fixtureCount: 1,
      generatorModel: "anthropic/claude-haiku-4.5",
    },
    cases: [
      {
        id: "en-next-line-aabb",
        lang: "en",
        mode,
        expect: { rhymeWith: "door" },
        trials,
      },
    ],
  };
}

describe("picker accuracy", () => {
  it("is empty when no trial has pre-ranking candidates", () => {
    const stats = computeStats(
      runWith([
        {
          rawOutput: "a lone line",
          ttftMs: 10,
          totalMs: 10,
          checks: allPass(),
        },
      ]),
    );
    expect(stats.pickerAccuracy.trialsWithCandidates).toBe(0);
    expect(stats.pickerAccuracy.pickPassRate).toBeNull();
    expect(
      buildMarkdownReport(
        runWith([
          {
            rawOutput: "a lone line",
            ttftMs: 10,
            totalMs: 10,
            checks: allPass(),
          },
        ]),
      ),
    ).not.toContain("## Picker accuracy");
  });

  it("reports pick vs first, random, and oracle, and whether the pick was best", () => {
    // Trial 0: first fails rhyme, pick (index 1) is clean — pick beats first
    // and is the unique best.
    // Trial 1: first is clean, pick fails syllables — pick is worse than first.
    // Random pass rate: trial 0 is 1/2, trial 1 is 1/2, mean 50%.
    // Oracle: both trials have a passing candidate, 100%.
    // Pick pass: 1/2. First pass: 1/2. Pick is best: 1/2.
    const run = runWith([
      trial(
        [
          candidate("fails rhyme", 0, ["rhyme"], false),
          candidate("clean pick", 1, [], true),
        ],
        1,
      ),
      trial(
        [
          candidate("clean first", 0, [], false),
          candidate("fails syllables", 1, ["syllables"], true),
        ],
        1,
      ),
    ]);

    const pa = computeStats(run).pickerAccuracy;
    expect(pa.trialsWithCandidates).toBe(2);
    expect(pa.meanCandidates).toBe(2);
    expect(pa.pickPassRate).toBe(0.5);
    expect(pa.firstPassRate).toBe(0.5);
    expect(pa.randomPassRate).toBe(0.5);
    expect(pa.oraclePassRate).toBe(1);
    expect(pa.pickIsBestRate).toBe(0.5);
    expect(pa.pickBeatFirstRate).toBe(0.5);
    expect(pa.pickTiedFirstRate).toBe(0);
    expect(pa.pickWorseThanFirstRate).toBe(0.5);
    expect(pa.pickEqualsFirstRate).toBe(0);

    const md = buildMarkdownReport(run);
    expect(md).toContain("## Picker accuracy");
    expect(md).toContain("| jev pick | 50.0% |");
    expect(md).toContain("| first candidate | 50.0% |");
    expect(md).toContain("| random candidate | 50.0% |");
    expect(md).toContain("| oracle (best candidate) | 100.0% |");
    expect(md).toContain(
      "Picker accuracy (pick is a best-scoring candidate): 50.0%",
    );
  });

  it("counts a tied best as accurate and treats picking index 0 as equals-first", () => {
    const run = runWith([
      trial(
        [
          candidate("also clean", 0, [], true),
          candidate("also clean too", 1, [], false),
        ],
        0,
      ),
    ]);
    const pa = computeStats(run).pickerAccuracy;
    expect(pa.pickIsBestRate).toBe(1);
    expect(pa.pickTiedFirstRate).toBe(1);
    expect(pa.pickBeatFirstRate).toBe(0);
    expect(pa.pickEqualsFirstRate).toBe(1);
    expect(pa.pickPassRate).toBe(1);
    expect(pa.firstPassRate).toBe(1);
    expect(pa.randomPassRate).toBe(1);
    expect(pa.oraclePassRate).toBe(1);
  });

  it("does not count error trials even if they list candidates", () => {
    const run = runWith([
      {
        rawOutput: "",
        ttftMs: null,
        totalMs: 0,
        error: "boom",
        checks: {
          format: { status: "skip" },
          syllables: { status: "skip" },
          rhyme: { status: "skip" },
          noCopy: { status: "skip" },
          language: { status: "skip" },
          cliche: { status: "skip" },
        },
        candidates: [candidate("a", 0, [], true), candidate("b", 1, [], false)],
        pickedIndex: 0,
      },
    ]);
    expect(computeStats(run).pickerAccuracy.trialsWithCandidates).toBe(0);
  });
});

function skipChecks(): Record<CheckName, CheckResult> {
  return {
    format: { status: "skip" },
    syllables: { status: "skip" },
    rhyme: { status: "skip" },
    noCopy: { status: "skip" },
    language: { status: "skip" },
    cliche: { status: "skip" },
  };
}

function errorOutcome(
  error: string,
  opts: { finishReason?: string; reasoningTokens?: number } = {},
): TrialOutcome {
  return {
    rawOutput: "",
    ttftMs: null,
    totalMs: 0,
    error,
    finishReason: opts.finishReason,
    reasoningTokens: opts.reasoningTokens,
    checks: skipChecks(),
  };
}

describe("error kind split and mean reasoning tokens", () => {
  it("splits errorCount into length/reasoning vs other", () => {
    const run = runWith([
      errorOutcome("empty output: finishReason=length, reasoningTokens=80/80", {
        finishReason: "length",
        reasoningTokens: 80,
      }),
      errorOutcome("ran out mid-thought", { reasoningTokens: 12 }),
      errorOutcome("network timeout"),
    ]);
    const stats = computeStats(run);
    expect(stats.errorCount).toBe(3);
    expect(stats.errorKinds).toEqual({ lengthOrReasoning: 2, other: 1 });

    const md = buildMarkdownReport(run);
    expect(md).toContain("errors: 3 (length/reasoning: 2, other: 1)");
  });

  it("reports mean reasoning tokens in the latency & tokens section", () => {
    const run = runWith([
      { ...trial([candidate("a", 0, [], true)], 0), reasoningTokens: 10 },
      { ...trial([candidate("b", 0, [], true)], 0), reasoningTokens: 30 },
    ]);
    const stats = computeStats(run);
    expect(stats.tokens.meanReasoning).toBe(20);

    const md = buildMarkdownReport(run);
    expect(md).toContain("mean reasoning: 20.0");
  });

  it("is n/a when no trial reports reasoning tokens", () => {
    const run = runWith([trial([candidate("a", 0, [], true)], 0)]);
    expect(computeStats(run).tokens.meanReasoning).toBeNull();
    expect(buildMarkdownReport(run)).toContain("mean reasoning: n/a");
  });
});

describe("omitted leading space diagnostic (#102)", () => {
  it("counts flagged trials and computes a rate, scoped to completion-mode trials", () => {
    const run = runWith(
      [
        {
          ...trial([candidate("a", 0, [], true)], 0),
          omittedLeadingSpace: true,
        },
        {
          ...trial([candidate("b", 0, [], true)], 0),
          omittedLeadingSpace: false,
        },
      ],
      "completion",
    );
    const stats = computeStats(run);
    expect(stats.omittedLeadingSpace).toEqual({
      count: 1,
      eligibleTrials: 2,
      rate: 0.5,
    });
    // Does not affect pass rate — both trials above pass all their checks.
    expect(stats.overallTrialPassRate).toBe(1);

    const md = buildMarkdownReport(run);
    expect(md).toContain(
      "Model omitted leading space (diagnostic, does not affect pass rate): 1/2 completion trials (50.0%)",
    );
  });

  it("ignores non-completion-mode trials and error trials", () => {
    const run = runWith(
      [
        {
          ...trial([candidate("a", 0, [], true)], 0),
          omittedLeadingSpace: true,
        },
      ],
      "next_line",
    );
    expect(computeStats(run).omittedLeadingSpace).toEqual({
      count: 0,
      eligibleTrials: 0,
      rate: null,
    });
    expect(buildMarkdownReport(run)).toContain(
      "Model omitted leading space (diagnostic, does not affect pass rate): 0/0 completion trials (n/a)",
    );
  });

  it("is false/undefined by default when a trial doesn't report it", () => {
    const run = runWith(
      [trial([candidate("a", 0, [], true)], 0)],
      "completion",
    );
    expect(computeStats(run).omittedLeadingSpace).toEqual({
      count: 0,
      eligibleTrials: 1,
      rate: 0,
    });
  });
});

describe("formatRaw diagnostic", () => {
  it("aggregates pass/fail independently of the sanitized format check", () => {
    const run = runWith([
      {
        ...trial([candidate("a", 0, [], true)], 0),
        formatRaw: { status: "fail", detail: "starts with a label" },
      },
      {
        ...trial([candidate("b", 0, [], true)], 0),
        formatRaw: { status: "pass" },
      },
    ]);
    const stats = computeStats(run);
    expect(stats.formatRaw).toEqual({ pass: 1, fail: 1, skip: 0 });

    const md = buildMarkdownReport(run);
    expect(md).toContain(
      "Raw (pre-sanitize) format pass rate (diagnostic, does not affect pass rate): 1/2 (50.0%)",
    );
  });

  it("ignores trials that didn't report formatRaw", () => {
    const run = runWith([trial([candidate("a", 0, [], true)], 0)]);
    expect(computeStats(run).formatRaw).toEqual({
      pass: 0,
      fail: 0,
      skip: 0,
    });
  });
});

describe("prompt version metadata", () => {
  it("includes the prompt version in the report header when present", () => {
    const run = runWith([trial([candidate("a", 0, [], true)], 0)]);
    run.meta.promptVersion = "2026-11-21.1";
    expect(buildMarkdownReport(run)).toContain(
      "Prompt version: `2026-11-21.1`",
    );
  });

  it("omits the prompt version segment when absent", () => {
    const run = runWith([trial([candidate("a", 0, [], true)], 0)]);
    expect(buildMarkdownReport(run)).not.toContain("Prompt version");
  });
});

describe("fixture notes", () => {
  it("flags a case whose fixture carries a note", () => {
    const run = runWith([
      {
        rawOutput: "a lone line",
        ttftMs: 10,
        totalMs: 10,
        checks: allPass(),
      },
    ]);
    run.cases[0].notes = "Rewritten to fix a scheme-detection bug (abc1234).";
    const md = buildMarkdownReport(run);
    expect(md).toContain("## Fixture notes");
    expect(md).toContain(
      "**en-next-line-aabb**: Rewritten to fix a scheme-detection bug (abc1234).",
    );
  });

  it("omits the section when no case has a note", () => {
    const run = runWith([
      {
        rawOutput: "a lone line",
        ttftMs: 10,
        totalMs: 10,
        checks: allPass(),
      },
    ]);
    expect(buildMarkdownReport(run)).not.toContain("## Fixture notes");
  });
});

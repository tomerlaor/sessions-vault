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

function runWith(trials: TrialOutcome[]): EvalRunResult {
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
        mode: "next_line",
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

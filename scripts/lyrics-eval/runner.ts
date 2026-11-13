// Drives each fixture through the production prompt builders and model
// calls (src/lib/lyrics-ai.ts, src/lib/ai.ts), applies the checkers, and
// collects timing/usage. This module makes live network calls — it is only
// ever invoked from the `eval` CLI command, never from tests.
import type { LanguageModelUsage } from "ai";
import {
  generateNextWordOptions,
  isLyricsModelDecisions,
  streamLyricsSuggestion,
  type LyricsCallMetrics,
  type LyricsGeneratorStageMetrics,
  type LyricsRankerStageMetrics,
} from "../../src/lib/ai";
import {
  buildLyricsSuggestionPrompt,
  buildNextWordOptionsPrompt,
  normalizeNextWord,
  normalizeNextWordOptions,
  type LyricsSuggestionInput,
  type NextWordOption,
} from "../../src/lib/lyrics-ai";
import type { AIConfig } from "../../src/types";
import { rawTextFromObjectError } from "../../src/lib/parse-ai-json";
import {
  checkCliche,
  checkFormat,
  checkLanguage,
  checkNoCopy,
  checkRhyme,
  checkSyllables,
  type CheckContext,
  type CheckResult,
} from "./checks";
import type { EvalExpect, EvalFixture, EvalLang, EvalMode } from "./types";

export const CHECK_NAMES = [
  "format",
  "syllables",
  "rhyme",
  "noCopy",
  "language",
  "cliche",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

// One pre-ranking candidate, scored with the same checkers as the trial
// winner. Present on the decisions "generate, then decide" path so the
// report can measure picker accuracy against first/random/best.
export interface ScoredCandidate {
  text: string;
  index: number;
  isPick: boolean;
  isFirst: boolean;
  checks: Record<CheckName, CheckResult>;
}

export interface TrialOutcome {
  rawOutput: string;
  ttftMs: number | null;
  totalMs: number;
  usage?: LanguageModelUsage;
  error?: string;
  checks: Record<CheckName, CheckResult>;
  // Present only when `model` is an OpenRouter decisions model — see
  // src/lib/ai.ts's "generate, then decide" pipeline.
  generator?: LyricsGeneratorStageMetrics;
  ranker?: LyricsRankerStageMetrics;
  candidates?: ScoredCandidate[];
  pickedIndex?: number;
}

export interface CaseResult {
  id: string;
  lang: EvalLang;
  mode: EvalMode;
  expect: EvalExpect;
  trials: TrialOutcome[];
}

export interface EvalRunResult {
  meta: {
    model: string;
    provider: string;
    n: number;
    generatedAt: string;
    fixtureCount: number;
    // Set only when `model` was run as a decisions model (ranker); the
    // generator produced the actual candidate text it ranked.
    generatorModel?: string;
  };
  cases: CaseResult[];
}

interface CursorInfo {
  currentLine: string;
  textBeforeCursor: string;
  selectionStart: number;
  selectionEnd: number;
  prevLine?: string;
}

// See the comment on EvalFixture in ./types.ts for the selection rule.
function deriveCursorInfo(fixture: EvalFixture): CursorInfo {
  const { lyrics, cursor, mode } = fixture;
  const lineStart = lyrics.lastIndexOf("\n", cursor - 1) + 1;
  const nextNewline = lyrics.indexOf("\n", cursor);
  const lineEnd = nextNewline === -1 ? lyrics.length : nextNewline;
  const currentLine = lyrics.slice(lineStart, lineEnd);
  const textBeforeCursor = lyrics.slice(lineStart, cursor);

  const before = lyrics.slice(0, lineStart);
  const prevLines = before
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return {
    currentLine,
    textBeforeCursor,
    selectionStart: cursor,
    selectionEnd: mode === "alternative" ? lineEnd : cursor,
    prevLine: prevLines[prevLines.length - 1],
  };
}

function buildPromptInput(
  fixture: EvalFixture,
  cursor: CursorInfo,
): Omit<LyricsSuggestionInput, "mode"> {
  return {
    lyrics: fixture.lyrics,
    currentLine: cursor.currentLine,
    textBeforeCursor: cursor.textBeforeCursor,
    selectionStart: cursor.selectionStart,
    selectionEnd: cursor.selectionEnd,
    title: "Eval Song",
    bpm: fixture.bpm ?? null,
    key: fixture.key ?? null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    songContext: fixture.songContext ?? null,
  };
}

// format/language/cliché/no-copy apply to every option — the case only
// passes the check if every option does. If every option skips, the check
// skips; otherwise any single failure fails the whole check.
function aggregateOptionChecks(
  options: NextWordOption[],
  checkFn: (text: string) => CheckResult,
): CheckResult {
  if (options.length === 0) {
    return { status: "fail", detail: "no options returned" };
  }
  const results = options.map((o) => checkFn(o.text));
  const failed = results.find((r) => r.status === "fail");
  if (failed) return failed;
  if (results.every((r) => r.status === "skip")) return { status: "skip" };
  return { status: "pass" };
}

// Rhyme applies to the option marked kind="rhyme", or to at least one option
// if no option carries that tag.
function aggregateRhymeForNextWord(
  options: NextWordOption[],
  expect: EvalExpect,
  ctx: CheckContext,
): CheckResult {
  if (!expect.rhymeWith) return { status: "skip" };
  const tagged = options.filter((o) => o.kind === "rhyme");
  const candidates = tagged.length > 0 ? tagged : options;
  const anyPass = candidates.some(
    (o) => checkRhyme(o.text, expect, ctx).status === "pass",
  );
  return anyPass
    ? { status: "pass" }
    : { status: "fail", detail: "no option satisfies the rhyme" };
}

function scoreText(
  text: string,
  fixture: EvalFixture,
  ctx: CheckContext,
): Record<CheckName, CheckResult> {
  return {
    format: checkFormat(text, ctx, fixture.expect),
    syllables: checkSyllables(text, fixture.expect, ctx),
    rhyme: checkRhyme(text, fixture.expect, ctx),
    noCopy: checkNoCopy(text, fixture.lyrics),
    language: checkLanguage(text, fixture.lang),
    cliche: checkCliche(text, fixture.expect.rhymeWith),
  };
}

function scoreUnrankedCandidates(
  texts: string[] | undefined,
  pickedIndex: number | undefined,
  fixture: EvalFixture,
  ctx: CheckContext,
): { candidates: ScoredCandidate[]; pickedIndex: number } | undefined {
  if (!texts || texts.length === 0) return undefined;
  const pick = pickedIndex ?? 0;
  return {
    pickedIndex: pick,
    candidates: texts.map((raw, index) => {
      const text =
        fixture.mode === "next_word"
          ? normalizeNextWord(raw, ctx.linePrefix)
          : raw;
      return {
        text,
        index,
        isPick: index === pick,
        isFirst: index === 0,
        checks: scoreText(text, fixture, ctx),
      };
    }),
  };
}

function errorTrial(message: string): TrialOutcome {
  const skip: CheckResult = { status: "skip" };
  return {
    rawOutput: "",
    ttftMs: null,
    totalMs: 0,
    error: message,
    checks: {
      format: skip,
      syllables: skip,
      rhyme: skip,
      noCopy: skip,
      language: skip,
      cliche: skip,
    },
  };
}

export async function runTrial(
  cfg: AIConfig,
  fixture: EvalFixture,
): Promise<TrialOutcome> {
  const cursor = deriveCursorInfo(fixture);
  const promptInput = buildPromptInput(fixture, cursor);
  const ctx: CheckContext = {
    mode: fixture.mode,
    lang: fixture.lang,
    linePrefix: cursor.textBeforeCursor,
    prevLine: cursor.prevLine,
  };

  try {
    if (fixture.mode === "next_word") {
      const { system, prompt } = buildNextWordOptionsPrompt(promptInput);
      let metrics: LyricsCallMetrics | undefined;
      const result = await generateNextWordOptions(
        cfg,
        system,
        prompt,
        undefined,
        (m) => {
          metrics = m;
        },
      );
      const options = normalizeNextWordOptions(
        result.options,
        cursor.textBeforeCursor,
      );
      // Score the generator-order texts (pre-ranking). Only present on
      // the decisions path, where the ranker actually chose a winner.
      const scored = scoreUnrankedCandidates(
        metrics?.unrankedCandidates,
        metrics?.pickedIndex,
        fixture,
        ctx,
      );
      return {
        rawOutput: JSON.stringify(options),
        ttftMs: metrics?.ttftMs ?? null,
        totalMs: metrics?.totalMs ?? 0,
        usage: metrics?.usage,
        generator: metrics?.generator,
        ranker: metrics?.ranker,
        candidates: scored?.candidates,
        pickedIndex: scored?.pickedIndex,
        checks: {
          format: aggregateOptionChecks(options, (t) =>
            checkFormat(t, ctx, fixture.expect),
          ),
          syllables: aggregateOptionChecks(options, (t) =>
            checkSyllables(t, fixture.expect, ctx),
          ),
          rhyme: aggregateRhymeForNextWord(options, fixture.expect, ctx),
          noCopy: aggregateOptionChecks(options, (t) =>
            checkNoCopy(t, fixture.lyrics),
          ),
          language: aggregateOptionChecks(options, (t) =>
            checkLanguage(t, fixture.lang),
          ),
          cliche: aggregateOptionChecks(options, (t) =>
            checkCliche(t, fixture.expect.rhymeWith),
          ),
        },
      };
    }

    const { system, prompt } = buildLyricsSuggestionPrompt({
      ...promptInput,
      mode: fixture.mode,
    });
    let metrics: LyricsCallMetrics | undefined;
    let output = "";
    for await (const chunk of streamLyricsSuggestion(
      cfg,
      system,
      prompt,
      undefined,
      (m) => {
        metrics = m;
      },
    )) {
      output += chunk;
    }
    const scored = scoreUnrankedCandidates(
      metrics?.unrankedCandidates,
      metrics?.pickedIndex,
      fixture,
      ctx,
    );
    return {
      rawOutput: output,
      ttftMs: metrics?.ttftMs ?? null,
      totalMs: metrics?.totalMs ?? 0,
      usage: metrics?.usage,
      generator: metrics?.generator,
      ranker: metrics?.ranker,
      candidates: scored?.candidates,
      pickedIndex: scored?.pickedIndex,
      checks: {
        format: checkFormat(output, ctx, fixture.expect),
        syllables: checkSyllables(output, fixture.expect, ctx),
        rhyme: checkRhyme(output, fixture.expect, ctx),
        noCopy: checkNoCopy(output, fixture.lyrics),
        language: checkLanguage(output, fixture.lang),
        cliche: checkCliche(output, fixture.expect.rhymeWith),
      },
    };
  } catch (e) {
    const trial = errorTrial(e instanceof Error ? e.message : String(e));
    const raw = rawTextFromObjectError(e);
    if (raw) trial.rawOutput = raw;
    return trial;
  }
}

export async function runEval(
  cfg: AIConfig,
  fixtures: EvalFixture[],
  n: number,
  onProgress?: (info: { caseId: string; done: number; total: number }) => void,
): Promise<EvalRunResult> {
  const cases: CaseResult[] = [];
  const total = fixtures.length * n;
  let done = 0;

  for (const fixture of fixtures) {
    const trials: TrialOutcome[] = [];
    for (let i = 0; i < n; i++) {
      trials.push(await runTrial(cfg, fixture));
      done++;
      onProgress?.({ caseId: fixture.id, done, total });
    }
    cases.push({
      id: fixture.id,
      lang: fixture.lang,
      mode: fixture.mode,
      expect: fixture.expect,
      trials,
    });
  }

  const decisions = await isLyricsModelDecisions(cfg);
  return {
    meta: {
      model: cfg.model,
      provider: cfg.provider,
      n,
      generatedAt: new Date().toISOString(),
      fixtureCount: fixtures.length,
      generatorModel: decisions ? cfg.lyricsGeneratorModel : undefined,
    },
    cases,
  };
}

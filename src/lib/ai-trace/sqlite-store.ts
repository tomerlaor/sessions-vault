// Batched, best-effort SQLite sink for the opt-in AI activity log (T2, #90).
// Tracing must never slow down or fail a model call, so every DB operation
// here is wrapped so failures are swallowed (and counted) rather than
// thrown. `getDb` is injected so tests can hand in a fake with just
// execute()/select() instead of a real @tauri-apps/plugin-sql Database.
import type { TraceDb } from "../../db/trace-client";
import type { AttemptRecord, SpanRecord, TraceStore } from "./types";

export const RETENTION_DAYS = 30;
export const RETENTION_MAX_SPANS = 20000;
export const FLUSH_INTERVAL_MS = 2000;
export const FLUSH_BATCH_SIZE = 50;
export const PRUNE_EVERY_N_INSERTS = 500;

function n(value: unknown): unknown {
  return value === undefined ? null : value;
}

function bool(value: boolean | undefined): number {
  return value ? 1 : 0;
}

const INSERT_SPAN_SQL = `INSERT INTO ai_spans (
  span_id, trace_id, parent_span_id, started_at, feature, operation, mode, trigger,
  provider, locality, request_model, response_model, params_json, prompt_id,
  prompt_version, prompt_hash, system_chars, prompt_chars, output_chars, lang,
  project_ref, cache_hit, attempts, status, error_type, error_message, finish_reason,
  ttft_ms, duration_ms, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
  usage_source, cost_usd_estimate, cost_source, candidates, app_version
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

function spanParams(span: SpanRecord): unknown[] {
  return [
    span.spanId,
    span.traceId,
    n(span.parentSpanId),
    span.startedAt,
    span.feature,
    span.operation,
    n(span.mode),
    n(span.trigger),
    n(span.provider),
    n(span.locality),
    n(span.requestModel),
    n(span.responseModel),
    n(span.paramsJson),
    n(span.promptId),
    n(span.promptVersion),
    n(span.promptHash),
    n(span.systemChars),
    n(span.promptChars),
    n(span.outputChars),
    n(span.lang),
    n(span.projectRef),
    bool(span.cacheHit),
    span.attempts,
    span.status,
    n(span.errorType),
    n(span.errorMessage),
    n(span.finishReason),
    n(span.ttftMs),
    n(span.durationMs),
    n(span.inputTokens),
    n(span.outputTokens),
    n(span.cachedInputTokens),
    n(span.reasoningTokens),
    n(span.usageSource),
    n(span.costUsdEstimate),
    n(span.costSource),
    n(span.candidates),
    n(span.appVersion),
  ];
}

const INSERT_ATTEMPT_SQL = `INSERT INTO ai_attempts (
  span_id, attempt, started_at, duration_ms, ttft_ms, status, error_type, http_status, response_id
) VALUES (?,?,?,?,?,?,?,?,?)`;

function attemptParams(attempt: AttemptRecord): unknown[] {
  return [
    attempt.spanId,
    attempt.attempt,
    attempt.startedAt,
    n(attempt.durationMs),
    n(attempt.ttftMs),
    attempt.status,
    n(attempt.errorType),
    n(attempt.httpStatus),
    n(attempt.responseId),
  ];
}

// Vite inlines import.meta.env at build time; the DEV flag is false (not
// undefined) in a release build, so this never logs there.
function devWarn(...args: unknown[]): void {
  if (import.meta.env?.DEV) console.warn(...args);
}

export class SqliteTraceStore implements TraceStore {
  private spanBuffer: SpanRecord[] = [];
  private attemptBuffer: AttemptRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private insertsSincePrune = 0;
  private errorCount = 0;

  constructor(private readonly getDb: () => Promise<TraceDb>) {
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => void this.flush());
    }
    void this.prune();
  }

  get droppedRecordCount(): number {
    return this.errorCount;
  }

  write(span: SpanRecord): void {
    this.spanBuffer.push(span);
    this.flushIfBatchFull();
  }

  writeAttempt(attempt: AttemptRecord): void {
    this.attemptBuffer.push(attempt);
    this.flushIfBatchFull();
  }

  private flushIfBatchFull(): void {
    if (
      this.spanBuffer.length + this.attemptBuffer.length >=
      FLUSH_BATCH_SIZE
    ) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.spanBuffer.length === 0 && this.attemptBuffer.length === 0) return;
    const spans = this.spanBuffer;
    const attempts = this.attemptBuffer;
    this.spanBuffer = [];
    this.attemptBuffer = [];
    try {
      const db = await this.getDb();
      for (const span of spans) {
        await db.execute(INSERT_SPAN_SQL, spanParams(span));
      }
      for (const attempt of attempts) {
        await db.execute(INSERT_ATTEMPT_SQL, attemptParams(attempt));
      }
      this.insertsSincePrune += spans.length + attempts.length;
      if (this.insertsSincePrune >= PRUNE_EVERY_N_INSERTS) {
        this.insertsSincePrune = 0;
        await this.prune();
      }
    } catch (err) {
      this.errorCount += spans.length + attempts.length;
      devWarn("[ai-trace] flush failed; records dropped", err);
    }
  }

  // Deletes spans older than RETENTION_DAYS, and any beyond the newest
  // RETENTION_MAX_SPANS, whichever is hit first — then cascades to
  // attempts/outcomes, and separately sweeps expired debug-capture payloads.
  async prune(): Promise<void> {
    try {
      const db = await this.getDb();
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
      await db.execute(
        `DELETE FROM ai_spans WHERE started_at < ? OR span_id IN (
           SELECT span_id FROM ai_spans ORDER BY started_at DESC LIMIT -1 OFFSET ?
         )`,
        [cutoff, RETENTION_MAX_SPANS],
      );
      await db.execute(
        `DELETE FROM ai_attempts WHERE span_id NOT IN (SELECT span_id FROM ai_spans)`,
        [],
      );
      await db.execute(
        `DELETE FROM ai_outcomes WHERE span_id NOT IN (SELECT span_id FROM ai_spans)`,
        [],
      );
      await db.execute(`DELETE FROM ai_payloads WHERE expires_at < ?`, [
        Date.now(),
      ]);
    } catch (err) {
      this.errorCount += 1;
      devWarn("[ai-trace] prune failed", err);
    }
  }

  // "Keep AI activity log" was just turned off (or the user clicked "Clear
  // log" while it's still on): drop anything buffered in memory — it must
  // never reach disk — then delete every row so far, keeping only
  // ai_trace_meta (schema_version/install_salt survive a clear).
  async clearAll(): Promise<void> {
    this.spanBuffer = [];
    this.attemptBuffer = [];
    try {
      const db = await this.getDb();
      await db.execute(`DELETE FROM ai_payloads`, []);
      await db.execute(`DELETE FROM ai_outcomes`, []);
      await db.execute(`DELETE FROM ai_attempts`, []);
      await db.execute(`DELETE FROM ai_spans`, []);
    } catch (err) {
      this.errorCount += 1;
      devWarn("[ai-trace] clearAll failed", err);
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

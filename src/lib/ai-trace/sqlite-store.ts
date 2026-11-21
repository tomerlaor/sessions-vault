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

interface Buffered<T> {
  record: T;
  generation: number;
}

export class SqliteTraceStore implements TraceStore {
  private spanBuffer: Buffered<SpanRecord>[] = [];
  private attemptBuffer: Buffered<AttemptRecord>[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private insertsSincePrune = 0;
  private errorCount = 0;
  // Flipped off by clearAll() (disable or "Clear log") and back on by
  // runtime.ts's getActiveTraceStore() on the next call while the setting
  // is on. `generation` is bumped alongside so a flush already mid-loop
  // over a now-stale buffer snapshot can tell its records apart from
  // anything written since (M1, #118).
  private enabled = true;
  private generation = 0;
  // Serializes flush() and clearAll() — each acquires this lock before
  // touching the DB, so a clear's DELETEs can never run while a flush's
  // own INSERTs for an earlier generation are still in flight.
  private mutex: Promise<void> = Promise.resolve();

  constructor(
    private readonly getDb: () => Promise<TraceDb>,
    // Injected so the real singleton (runtime.ts) can rotate ai-traces.db's
    // install_salt on every clear/disable (L2) without this store needing
    // to know about trace-client.ts's module-level salt cache.
    private readonly rotateSalt?: () => Promise<void>,
  ) {
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => void this.flush());
    }
    void this.prune();
  }

  get droppedRecordCount(): number {
    return this.errorCount;
  }

  isActive(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  write(span: SpanRecord): void {
    if (!this.enabled) return;
    this.spanBuffer.push({ record: span, generation: this.generation });
    this.flushIfBatchFull();
  }

  writeAttempt(attempt: AttemptRecord): void {
    if (!this.enabled) return;
    this.attemptBuffer.push({ record: attempt, generation: this.generation });
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

  // FIFO async mutex: each call chains onto whatever's currently running,
  // so flush() and clearAll() never touch the DB concurrently.
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async flush(): Promise<void> {
    return this.withLock(async () => {
      if (this.spanBuffer.length === 0 && this.attemptBuffer.length === 0) {
        return;
      }
      const spans = this.spanBuffer;
      const attempts = this.attemptBuffer;
      this.spanBuffer = [];
      this.attemptBuffer = [];
      let db: TraceDb;
      try {
        db = await this.getDb();
      } catch (err) {
        this.errorCount += spans.length + attempts.length;
        devWarn("[ai-trace] flush failed; records dropped", err);
        return;
      }
      try {
        await db.execute(`BEGIN`, []);
        for (const { record, generation } of spans) {
          // Re-checked before EACH insert: a clearAll() that ran while this
          // loop was suspended mid-insert (awaiting a prior statement)
          // disables the store and bumps the generation — any record from
          // before that point must be skipped, not written (M1, #118).
          if (!this.enabled || generation !== this.generation) continue;
          await db.execute(INSERT_SPAN_SQL, spanParams(record));
        }
        for (const { record, generation } of attempts) {
          if (!this.enabled || generation !== this.generation) continue;
          await db.execute(INSERT_ATTEMPT_SQL, attemptParams(record));
        }
        if (!this.enabled) {
          // clearAll() ran mid-flush: roll back the whole batch rather than
          // commit whatever slipped in before the per-record checks above
          // started skipping (M1, #118) — "disabled" must mean nothing from
          // this flush reaches disk, not "most of it does."
          await db.execute(`ROLLBACK`, []);
          return;
        }
        await db.execute(`COMMIT`, []);
        // Spans only (nit, #118): pruning is driven by RETENTION_MAX_SPANS, a
        // span-count limit, so the trigger should track span volume rather
        // than being inflated by attempt-only bursts (e.g. SDK retries).
        this.insertsSincePrune += spans.length;
        if (this.insertsSincePrune >= PRUNE_EVERY_N_INSERTS) {
          this.insertsSincePrune = 0;
          await this.prune();
        }
      } catch (err) {
        await db.execute(`ROLLBACK`, []).catch(() => {});
        this.errorCount += spans.length + attempts.length;
        devWarn("[ai-trace] flush failed; records dropped", err);
      }
    });
  }

  // Deletes spans older than RETENTION_DAYS, and any beyond the newest
  // RETENTION_MAX_SPANS, whichever is hit first — then cascades to
  // attempts/outcomes, but ONLY for the span_ids this call actually
  // deleted. An attempt is written (and can be flushed) well before its
  // span — the middleware records attempts while the model call is still
  // running, but the span itself isn't written until the whole traced()
  // operation resolves — so "span_id NOT IN ai_spans" would also match an
  // attempt whose span is simply still sitting in the write buffer, not
  // actually pruned (nit, #118). Capturing the deleted ids up front and
  // scoping the cascade to exactly those avoids orphaning live attempts.
  // No ai_payloads table here — debug capture payloads are T7, a separate
  // opt-in this PR doesn't create.
  async prune(): Promise<void> {
    try {
      const db = await this.getDb();
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const toDelete = await db.select<{ span_id: string }[]>(
        `SELECT span_id FROM ai_spans WHERE started_at < ? OR span_id IN (
           SELECT span_id FROM ai_spans ORDER BY started_at DESC LIMIT -1 OFFSET ?
         )`,
        [cutoff, RETENTION_MAX_SPANS],
      );
      if (toDelete.length === 0) return;
      const ids = toDelete.map((row) => row.span_id);
      const placeholders = ids.map(() => "?").join(",");
      await db.execute(
        `DELETE FROM ai_spans WHERE span_id IN (${placeholders})`,
        ids,
      );
      await db.execute(
        `DELETE FROM ai_attempts WHERE span_id IN (${placeholders})`,
        ids,
      );
      await db.execute(
        `DELETE FROM ai_outcomes WHERE span_id IN (${placeholders})`,
        ids,
      );
    } catch (err) {
      this.errorCount += 1;
      devWarn("[ai-trace] prune failed", err);
    }
  }

  // "Keep AI activity log" was just turned off (or the user clicked "Clear
  // log" while it's still on): disable the store and bump the generation
  // immediately (so any write/flush already in flight drops or skips its
  // records — M1, #118), drop anything buffered in memory — it must never
  // reach disk — then wait for a flush that's already running before
  // deleting every row so far, keeping only ai_trace_meta (schema_version
  // survives; install_salt survives the row but is rotated right after —
  // L2, #118). secure_delete+VACUUM make sure the deleted pages don't
  // linger in the file's free space.
  async clearAll(): Promise<void> {
    this.enabled = false;
    this.generation += 1;
    this.spanBuffer = [];
    this.attemptBuffer = [];
    await this.withLock(async () => {
      try {
        const db = await this.getDb();
        await db.execute(`DELETE FROM ai_outcomes`, []);
        await db.execute(`DELETE FROM ai_attempts`, []);
        await db.execute(`DELETE FROM ai_spans`, []);
        await db.execute(`PRAGMA secure_delete=ON`, []);
        await db.execute(`VACUUM`, []);
        await this.rotateSalt?.();
      } catch (err) {
        this.errorCount += 1;
        devWarn("[ai-trace] clearAll failed", err);
      }
    });
  }

  // Settings' "Keep AI activity log" row needs this to decide whether
  // unchecking the box should ask for confirmation, and what count to show.
  // Includes spans still sitting in the write buffer (not yet flushed) so
  // the number matches what "Clear log" is about to delete.
  async count(): Promise<number> {
    try {
      const db = await this.getDb();
      const rows = await db.select<{ c: number }[]>(
        `SELECT COUNT(*) as c FROM ai_spans`,
        [],
      );
      return Number(rows[0]?.c ?? 0) + this.spanBuffer.length;
    } catch (err) {
      this.errorCount += 1;
      devWarn("[ai-trace] count failed", err);
      return this.spanBuffer.length;
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

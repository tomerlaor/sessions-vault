// Batched, best-effort SQLite sink for the opt-in AI activity log (T2, #90).
// Tracing must never slow down or fail a model call, so every DB operation
// here is wrapped so failures are swallowed (and counted) rather than
// thrown. `getDb` is injected so tests can hand in a fake with just
// execute()/select() instead of a real @tauri-apps/plugin-sql Database.
//
// IMPORTANT (M1/H2, #118): tauri-plugin-sql (sqlx) pools several real
// connections and hands each execute()/select() call to whichever one is
// free. There is no guarantee two consecutive calls land on the same
// connection, so BEGIN/COMMIT/ROLLBACK sent as separate statements do NOT
// form a real transaction here — they can land on different connections,
// leaving one holding an open transaction forever (SQLITE_BUSY) while
// ROLLBACK/COMMIT on another connection fails outright ("no transaction is
// active"). This file never issues multi-statement transactions. Instead,
// every write is a sequence of standalone multi-row INSERT statements (each
// one round trip, inherently atomic on whichever connection runs it), and
// every destructive operation (clearAll) issues its DELETE/VACUUM
// statements as independent standalone statements too.
import type { TraceDb } from "../../db/trace-client";
import type { AttemptRecord, SpanRecord, TraceStore } from "./types";

export const RETENTION_DAYS = 30;
export const RETENTION_MAX_SPANS = 20000;
export const FLUSH_INTERVAL_MS = 2000;
export const FLUSH_BATCH_SIZE = 50;
export const PRUNE_EVERY_N_INSERTS = 500;

// SQLite's own bound-parameter ceiling is 32766; MAX_BOUND_PARAMS stays
// comfortably under that, and MAX_ROWS_PER_INSERT caps how large a single
// multi-row INSERT can get even for narrow tables (H2, #118). The number of
// rows that actually fit in one statement is whichever of the two is
// smaller once divided by the table's column count.
export const MAX_BOUND_PARAMS = 32000;
export const MAX_ROWS_PER_INSERT = 800;

function n(value: unknown): unknown {
  return value === undefined ? null : value;
}

function bool(value: boolean | undefined): number {
  return value ? 1 : 0;
}

const SPAN_COLUMNS = `span_id, trace_id, parent_span_id, started_at, feature, operation, mode, trigger,
  provider, locality, request_model, response_model, params_json, prompt_id,
  prompt_version, prompt_hash, system_chars, prompt_chars, output_chars, lang,
  project_ref, cache_hit, attempts, status, error_type, error_message, finish_reason,
  ttft_ms, duration_ms, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
  usage_source, cost_usd_estimate, cost_source, candidates, app_version`;
const SPAN_COLUMN_COUNT = 38;

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

const ATTEMPT_COLUMNS = `span_id, attempt, started_at, duration_ms, ttft_ms, status, error_type, http_status, response_id`;
const ATTEMPT_COLUMN_COUNT = 9;

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

// How many rows of a given column width fit in one multi-row INSERT:
// whichever of MAX_ROWS_PER_INSERT or the bound-parameter budget is
// smaller once divided by the column count (H2, #118).
function rowsPerChunk(columnCount: number): number {
  return Math.max(
    1,
    Math.min(MAX_ROWS_PER_INSERT, Math.floor(MAX_BOUND_PARAMS / columnCount)),
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function buildMultiRowInsertSql(
  table: string,
  columns: string,
  columnCount: number,
  rowCount: number,
): string {
  const rowPlaceholder = `(${Array(columnCount).fill("?").join(",")})`;
  const values = Array(rowCount).fill(rowPlaceholder).join(",");
  return `INSERT INTO ${table} (${columns}) VALUES ${values}`;
}

// Deletes children (ai_attempts/ai_outcomes) by a set-based "span_id is one
// of the doomed ones" condition rather than binding every id as its own
// parameter — SQLite's bound-parameter limit (32766) is easy to exceed
// once RETENTION_MAX_SPANS (20000) is approached (nit, #118). Reusing this
// exact subquery (instead of "NOT IN ai_spans") is what preserves the
// no-orphan guarantee: a span still sitting in the write buffer (not yet
// flushed) has no row in ai_spans yet, so it simply never matches this
// subquery and its attempts/outcomes are left alone — "NOT IN ai_spans"
// would have wrongly matched it.
const DOOMED_SPAN_IDS_SQL = `SELECT span_id FROM ai_spans WHERE started_at < ? OR span_id IN (
  SELECT span_id FROM ai_spans ORDER BY started_at DESC LIMIT -1 OFFSET ?
)`;

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
  // is on. `_generation` is bumped alongside so any record written through
  // a handle() captured before this point can tell itself apart from
  // anything written since (M1/M3, #118).
  private enabled = true;
  private _generation = 0;
  // Serializes flush(), clearAll(), count() and prune() — each acquires
  // this lock before touching the DB, so e.g. a clear's DELETEs can never
  // run while a flush's own INSERTs for an earlier generation are still in
  // flight, and count() never reads mid-clear (H2, #118).
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

  // Exposed read-only so runtime.ts's getActiveTraceStore() can detect a
  // concurrent clearAll()/disable (M3, #118) without this store exposing a
  // way to mutate generation from the outside except via bumpGeneration().
  get generation(): number {
    return this._generation;
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

  // Disables the store and bumps the generation, both synchronously and
  // without touching the DB (M3, #118) — callers (runtime.ts's
  // setKeepAiActivityLog(false) and clearAiActivityLog()) use this to stop
  // new writes from landing *immediately*, before awaiting anything else
  // (the settings write, clearAll's DELETEs). Any TraceStore handle() handed
  // out before this call carries the old generation, so its write/
  // writeAttempt/isActive all go dead the instant this runs.
  bumpGeneration(): void {
    this.enabled = false;
    this._generation += 1;
  }

  private pushSpan(span: SpanRecord, generation: number): void {
    this.spanBuffer.push({ record: span, generation });
    this.flushIfBatchFull();
  }

  private pushAttempt(attempt: AttemptRecord, generation: number): void {
    this.attemptBuffer.push({ record: attempt, generation });
    this.flushIfBatchFull();
  }

  write(span: SpanRecord): void {
    if (!this.enabled) return;
    this.pushSpan(span, this._generation);
  }

  writeAttempt(attempt: AttemptRecord): void {
    if (!this.enabled) return;
    this.pushAttempt(attempt, this._generation);
  }

  // Returns a TraceStore whose generation is captured *now*, at call start
  // (M3, #118) — not at write time, which can be long after the model call
  // that triggered it finished. Without this, a call that started while
  // logging was on but finishes after a "Clear log" (which disables+bumps,
  // then a later call re-enables the store) would have its write stamped
  // with whatever generation happens to be current at write time, wrongly
  // surviving the clear. Every write/writeAttempt/isActive through this
  // handle checks both `enabled` and that the generation hasn't moved.
  handle(): TraceStore {
    const gen = this._generation;
    return {
      write: (span: SpanRecord) => {
        if (!this.enabled || gen !== this._generation) return;
        this.pushSpan(span, gen);
      },
      writeAttempt: (attempt: AttemptRecord) => {
        if (!this.enabled || gen !== this._generation) return;
        this.pushAttempt(attempt, gen);
      },
      flush: () => this.flush(),
      isActive: () => this.enabled && gen === this._generation,
    };
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
  // so flush()/clearAll()/count()/prune() never touch the DB concurrently
  // (H2, #118).
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

  // Writes one table's already-filtered, already-stamped records as a
  // sequence of standalone multi-row INSERT statements (never a
  // multi-statement transaction — see the file header). `gen` is the
  // generation captured once at the start of flush(); it re-checks
  // `enabled`/`generation` immediately before EACH statement, not once up
  // front, because a clearAll() can disable the store and bump the
  // generation synchronously (bumpGeneration()) while this loop is
  // between statements, and anything not yet written at that point must
  // stop, not just skip one record at a time (M1/H2, #118). Returns true if
  // the store went inactive/rotated mid-loop, so the caller can stop
  // entirely (e.g. skip attempts once spans hit this) rather than just
  // skipping the rest of this table.
  private async writeChunks<T>(
    db: TraceDb,
    records: T[],
    gen: number,
    table: string,
    columns: string,
    columnCount: number,
    toParams: (record: T) => unknown[],
  ): Promise<boolean> {
    for (const slice of chunkArray(records, rowsPerChunk(columnCount))) {
      if (!this.enabled || this._generation !== gen) return true;
      const sql = buildMultiRowInsertSql(
        table,
        columns,
        columnCount,
        slice.length,
      );
      const params = slice.flatMap(toParams);
      try {
        await db.execute(sql, params);
      } catch (err) {
        this.errorCount += slice.length;
        devWarn("[ai-trace] flush failed; records dropped", err);
      }
    }
    return false;
  }

  async flush(): Promise<void> {
    return this.withLock(async () => {
      if (this.spanBuffer.length === 0 && this.attemptBuffer.length === 0) {
        return;
      }
      // Filter the whole snapshot ONCE, synchronously, right here (H2,
      // #118) — nothing else can run between grabbing the buffers and this
      // filter, so it correctly captures "was this record still live as of
      // the moment flush() started". Records from a stale generation (or
      // everything, if the store is currently disabled) are dropped here
      // and never looked at again.
      const gen = this._generation;
      const liveAtStart = this.enabled;
      const bufferedSpans = this.spanBuffer;
      const bufferedAttempts = this.attemptBuffer;
      this.spanBuffer = [];
      this.attemptBuffer = [];
      const spans = liveAtStart
        ? bufferedSpans.filter((b) => b.generation === gen).map((b) => b.record)
        : [];
      const attempts = liveAtStart
        ? bufferedAttempts
            .filter((b) => b.generation === gen)
            .map((b) => b.record)
        : [];
      if (spans.length === 0 && attempts.length === 0) return;
      let db: TraceDb;
      try {
        db = await this.getDb();
      } catch (err) {
        this.errorCount += spans.length + attempts.length;
        devWarn("[ai-trace] flush failed; records dropped", err);
        return;
      }
      // Spans before attempts (nit, #118): attempts reference span_id, so
      // writing spans first keeps a reader of the table never seeing an
      // attempt whose span row doesn't exist yet.
      const stoppedAtSpans = await this.writeChunks(
        db,
        spans,
        gen,
        "ai_spans",
        SPAN_COLUMNS,
        SPAN_COLUMN_COUNT,
        spanParams,
      );
      if (!stoppedAtSpans) {
        await this.writeChunks(
          db,
          attempts,
          gen,
          "ai_attempts",
          ATTEMPT_COLUMNS,
          ATTEMPT_COLUMN_COUNT,
          attemptParams,
        );
      }
      // Spans only (nit, #118): pruning is driven by RETENTION_MAX_SPANS, a
      // span-count limit, so the trigger should track span volume rather
      // than being inflated by attempt-only bursts (e.g. SDK retries).
      this.insertsSincePrune += spans.length;
      if (this.insertsSincePrune >= PRUNE_EVERY_N_INSERTS) {
        this.insertsSincePrune = 0;
        // Call the unlocked implementation directly — flush() already
        // holds the mutex, and prune() (the public method) re-acquiring it
        // here would deadlock against itself (H2, #118).
        await this.pruneLocked();
      }
    });
  }

  // Best-effort PRAGMA right before a DELETE batch. Pooled connections
  // don't share pragmas under tauri-plugin-sql (sqlx hands each execute()
  // to whichever of several open connections is free), so this is NOT a
  // guarantee — it only helps on whichever single connection happens to run
  // it. What actually removes deleted rows' old pages from the file is
  // VACUUM (M2, #118).
  private async trySecureDelete(db: TraceDb): Promise<void> {
    try {
      await db.execute(`PRAGMA secure_delete=ON`, []);
    } catch (err) {
      devWarn("[ai-trace] PRAGMA secure_delete failed (best-effort)", err);
    }
  }

  private async countLocked(db: TraceDb): Promise<number> {
    const rows = await db.select<{ c: number }[]>(
      `SELECT COUNT(*) as c FROM ai_spans`,
      [],
    );
    return Number(rows[0]?.c ?? 0);
  }

  // Deletes spans older than RETENTION_DAYS, and any beyond the newest
  // RETENTION_MAX_SPANS, whichever is hit first — then cascades to
  // attempts/outcomes using the same set-based condition (see
  // DOOMED_SPAN_IDS_SQL above), never by binding every matched id as its
  // own parameter. No ai_payloads table here — debug capture payloads are
  // T7, a separate opt-in this PR doesn't create. Assumes the caller
  // already holds `mutex` — see prune() for the public, lock-acquiring
  // entry point.
  private async pruneLocked(): Promise<void> {
    try {
      const db = await this.getDb();
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const params = [cutoff, RETENTION_MAX_SPANS];
      const probe = await db.select<{ span_id: string }[]>(
        `${DOOMED_SPAN_IDS_SQL} LIMIT 1`,
        params,
      );
      if (probe.length === 0) return;
      await this.trySecureDelete(db);
      // Children first, while ai_spans still holds the rows the subquery
      // needs to identify them; ai_spans itself last.
      await db.execute(
        `DELETE FROM ai_attempts WHERE span_id IN (${DOOMED_SPAN_IDS_SQL})`,
        params,
      );
      await db.execute(
        `DELETE FROM ai_outcomes WHERE span_id IN (${DOOMED_SPAN_IDS_SQL})`,
        params,
      );
      await db.execute(
        `DELETE FROM ai_spans WHERE started_at < ? OR span_id IN (
           SELECT span_id FROM ai_spans ORDER BY started_at DESC LIMIT -1 OFFSET ?
         )`,
        params,
      );
      // auto_vacuum=INCREMENTAL (set at migration time) means this reclaims
      // the pages the deletes above just freed without a full VACUUM (M2,
      // #118). Best-effort: a failure here just means the freed pages wait
      // for the next VACUUM instead.
      try {
        await db.execute(`PRAGMA incremental_vacuum`, []);
      } catch (err) {
        devWarn(
          "[ai-trace] PRAGMA incremental_vacuum failed (best-effort)",
          err,
        );
      }
    } catch (err) {
      this.errorCount += 1;
      devWarn("[ai-trace] prune failed", err);
    }
  }

  async prune(): Promise<void> {
    return this.withLock(() => this.pruneLocked());
  }

  // "Keep AI activity log" was just turned off (or the user clicked "Clear
  // log" while it's still on). By the time this runs, bumpGeneration() has
  // already disabled the store and bumped the generation synchronously
  // (M3, #118) — runtime.ts calls that before awaiting anything else, so
  // this method only needs to worry about the DB side. Drop anything
  // buffered in memory — it must never reach disk — then wait for a flush
  // that's already running (via withLock) before deleting every row so far,
  // keeping only ai_trace_meta (schema_version survives; install_salt
  // survives the row but is rotated right after — L2, #118). DELETEs and
  // VACUUM are each standalone statements (never a BEGIN/COMMIT/ROLLBACK
  // transaction — see the file header); VACUUM is what actually removes
  // the deleted rows' old pages from the file, so it's retried a few times
  // before giving up, and the result is verified with a COUNT(*) (H2,
  // #118). rotateSalt always runs, even if everything above it failed —
  // losing the ability to correlate old prompt hashes matters more than a
  // clean VACUUM. Every failure here is swallowed and counted, never
  // thrown to the caller; the returned `ok` flag is how callers (Settings,
  // via runtime.ts) learn a clear didn't fully succeed.
  async clearAll(): Promise<{ ok: boolean }> {
    this.bumpGeneration();
    this.spanBuffer = [];
    this.attemptBuffer = [];
    return this.withLock(async () => {
      let deletesOk = false;
      let vacuumOk = false;
      let countOk = false;
      try {
        const db = await this.getDb();
        try {
          await this.trySecureDelete(db);
          await db.execute(`DELETE FROM ai_outcomes`, []);
          await db.execute(`DELETE FROM ai_attempts`, []);
          await db.execute(`DELETE FROM ai_spans`, []);
          deletesOk = true;
        } catch (err) {
          this.errorCount += 1;
          devWarn("[ai-trace] clearAll delete failed", err);
        }
        for (let attempt = 0; attempt < 3 && !vacuumOk; attempt++) {
          try {
            await db.execute(`VACUUM`, []);
            vacuumOk = true;
          } catch (err) {
            this.errorCount += 1;
            devWarn("[ai-trace] VACUUM failed", err);
          }
        }
        try {
          countOk = (await this.countLocked(db)) === 0;
        } catch (err) {
          this.errorCount += 1;
          devWarn("[ai-trace] clearAll verify failed", err);
        }
      } catch (err) {
        this.errorCount += 1;
        devWarn("[ai-trace] clearAll failed", err);
      }
      try {
        await this.rotateSalt?.();
      } catch (err) {
        this.errorCount += 1;
        devWarn("[ai-trace] salt rotation failed", err);
      }
      return { ok: deletesOk && vacuumOk && countOk };
    });
  }

  // Settings' "Keep AI activity log" row needs this to decide whether
  // unchecking the box should ask for confirmation, and what count to show.
  // Includes spans still sitting in the write buffer (not yet flushed) so
  // the number matches what "Clear log" is about to delete. Shares the
  // flush/clearAll/prune mutex (H2, #118) so it never reads mid-clear.
  async count(): Promise<number> {
    return this.withLock(async () => {
      try {
        const db = await this.getDb();
        return (await this.countLocked(db)) + this.spanBuffer.length;
      } catch (err) {
        this.errorCount += 1;
        devWarn("[ai-trace] count failed", err);
        return this.spanBuffer.length;
      }
    });
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

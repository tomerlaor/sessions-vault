import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SqliteTraceStore,
  RETENTION_DAYS,
  RETENTION_MAX_SPANS,
  FLUSH_INTERVAL_MS,
  PRUNE_EVERY_N_INSERTS,
  MAX_ROWS_PER_INSERT,
} from "../src/lib/ai-trace/sqlite-store";
import type { TraceDb } from "../src/db/trace-client";
import type { AttemptRecord, SpanRecord } from "../src/lib/ai-trace/types";

interface Call {
  sql: string;
  params: unknown[];
}

function makeFakeDb(selectResult: unknown[] = []): {
  db: TraceDb;
  calls: Call[];
  setShouldFail: (v: boolean) => void;
} {
  const calls: Call[] = [];
  let shouldFail = false;
  const db: TraceDb = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (shouldFail) throw new Error("boom");
    },
    async select(sql, params) {
      calls.push({ sql, params });
      if (shouldFail) throw new Error("boom");
      return selectResult as never;
    },
  };
  return { db, calls, setShouldFail: (v) => (shouldFail = v) };
}

function makeSpan(id: string): SpanRecord {
  return {
    spanId: id,
    traceId: id,
    startedAt: Date.now(),
    feature: "lyrics",
    operation: "stream_suggestion",
    cacheHit: false,
    attempts: 1,
    status: "ok",
  };
}

function makeAttempt(spanId: string): AttemptRecord {
  return { spanId, attempt: 1, startedAt: Date.now(), status: "ok" };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("SqliteTraceStore", () => {
  let stores: SqliteTraceStore[] = [];
  const makeStore = (getDb: () => Promise<TraceDb>) => {
    const store = new SqliteTraceStore(getDb);
    stores.push(store);
    return store;
  };

  afterEach(() => {
    stores.forEach((s) => s.dispose());
    stores = [];
  });

  it("buffers writes and flushes automatically once 50 records are buffered", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    for (let i = 0; i < 49; i++) store.write(makeSpan(`s${i}`));
    await tick();
    expect(
      calls.filter((c) => c.sql.includes("INSERT INTO ai_spans")),
    ).toHaveLength(0);

    store.write(makeSpan("s49"));
    await tick();
    // All 50 fit in a single multi-row INSERT (well under
    // MAX_ROWS_PER_INSERT), so one statement carries all 50 rows' params.
    const spanInserts = calls.filter((c) =>
      c.sql.includes("INSERT INTO ai_spans"),
    );
    expect(spanInserts).toHaveLength(1);
    expect(spanInserts[0].params).toHaveLength(50 * 38);
  });

  it("flushes on the 2s timer even under the batch size", async () => {
    vi.useFakeTimers();
    try {
      const { db, calls } = makeFakeDb();
      const store = makeStore(async () => db);
      store.write(makeSpan("only-one"));
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
      expect(
        calls.filter((c) => c.sql.includes("INSERT INTO ai_spans")),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes on 'beforeunload'", async () => {
    // No jsdom in this test env — stub just enough of `window` (an
    // EventTarget) for the store's own addEventListener/dispatchEvent use.
    const fakeWindow = new EventTarget();
    vi.stubGlobal("window", fakeWindow);
    try {
      const { db, calls } = makeFakeDb();
      const store = makeStore(async () => db);
      store.write(makeSpan("unload-span"));
      fakeWindow.dispatchEvent(new Event("beforeunload"));
      await tick();
      expect(
        calls.filter((c) => c.sql.includes("INSERT INTO ai_spans")),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("swallows a flush failure and counts it instead of throwing", async () => {
    const { db, setShouldFail } = makeFakeDb();
    const store = makeStore(async () => db);
    setShouldFail(true);
    store.write(makeSpan("will-fail"));
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.droppedRecordCount).toBeGreaterThan(0);
  });

  it("writeAttempt is batched the same way as write", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    store.writeAttempt({
      spanId: "s1",
      attempt: 1,
      startedAt: Date.now(),
      status: "ok",
    });
    await store.flush();
    expect(
      calls.filter((c) => c.sql.includes("INSERT INTO ai_attempts")),
    ).toHaveLength(1);
  });

  it("prune() selects the spans beyond 30 days / the newest 20000, then cascades to attempts/outcomes by exactly those ids", async () => {
    const { db, calls } = makeFakeDb([
      { span_id: "old1" },
      { span_id: "old2" },
    ]);
    const store = makeStore(async () => db);
    calls.length = 0; // drop the constructor's own startup prune
    await store.prune();

    const spanSelect = calls.find(
      (c) =>
        c.sql.includes("SELECT span_id FROM ai_spans") && c.params.length === 2,
    );
    expect(spanSelect).toBeDefined();
    const [cutoff, limit] = spanSelect!.params as [number, number];
    expect(limit).toBe(RETENTION_MAX_SPANS);
    const expectedCutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5000);

    // Set-based deletes (nit/BLOCKER, #118): the doomed ids are identified
    // by a subquery, never by binding every matched span_id as its own
    // parameter — only [cutoff, limit] are ever bound, regardless of how
    // many ids matched.
    const spanDelete = calls.find((c) =>
      c.sql.startsWith("DELETE FROM ai_spans"),
    );
    const attemptDelete = calls.find((c) =>
      c.sql.startsWith("DELETE FROM ai_attempts"),
    );
    const outcomeDelete = calls.find((c) =>
      c.sql.startsWith("DELETE FROM ai_outcomes"),
    );
    expect(spanDelete?.sql).toContain("span_id IN (");
    expect(attemptDelete?.sql).toContain("span_id IN (");
    expect(outcomeDelete?.sql).toContain("span_id IN (");
    expect(spanDelete?.sql).not.toMatch(/\?,\s*\?/);
    expect(attemptDelete?.sql).not.toMatch(/\?,\s*\?/);
    expect(outcomeDelete?.sql).not.toMatch(/\?,\s*\?/);
    expect(spanDelete?.params).toEqual([cutoff, RETENTION_MAX_SPANS]);
    expect(attemptDelete?.params).toEqual([cutoff, RETENTION_MAX_SPANS]);
    expect(outcomeDelete?.params).toEqual([cutoff, RETENTION_MAX_SPANS]);
    expect(calls.some((c) => c.sql.includes("ai_payloads"))).toBe(false);
  });

  it("prune() is a no-op (no DELETEs) when nothing is beyond the retention window — never deletes attempts whose span just isn't flushed yet (nit, #118)", async () => {
    const { db, calls } = makeFakeDb([]);
    const store = makeStore(async () => db);
    calls.length = 0;

    await store.prune();

    expect(calls.some((c) => c.sql.startsWith("DELETE"))).toBe(false);
  });

  it("prunes automatically every 500 inserts", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    await tick(); // let the constructor's own startup prune land first
    calls.length = 0;

    for (let batch = 0; batch < PRUNE_EVERY_N_INSERTS / 50; batch++) {
      for (let i = 0; i < 50; i++) store.write(makeSpan(`b${batch}-${i}`));
      await tick();
    }

    // flush() calls the internal prune directly (never the public prune(),
    // which would re-acquire its own mutex and deadlock against the
    // flush already holding it) — observe the probe SELECT it issues
    // instead of spying on a method name.
    const pruneProbes = calls.filter((c) =>
      c.sql.includes("SELECT span_id FROM ai_spans WHERE started_at"),
    );
    expect(pruneProbes.length).toBeGreaterThan(0);
  });

  it("swallows a prune failure and counts it instead of throwing", async () => {
    const { db, setShouldFail } = makeFakeDb();
    const store = makeStore(async () => db);
    setShouldFail(true);
    await expect(store.prune()).resolves.toBeUndefined();
    expect(store.droppedRecordCount).toBeGreaterThan(0);
  });

  it("clearAll drops the in-memory buffer, deletes every row except ai_trace_meta, secure-deletes, VACUUMs, verifies the count, and reports ok (H2, #118)", async () => {
    const { db, calls } = makeFakeDb([{ c: 0 }]);
    const store = makeStore(async () => db);
    store.write(makeSpan("buffered-not-yet-flushed"));
    calls.length = 0;

    const result = await store.clearAll();

    expect(result).toEqual({ ok: true });
    expect(calls.some((c) => c.sql.includes("ai_payloads"))).toBe(false);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_outcomes")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_attempts")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
    expect(calls.some((c) => c.sql.includes("ai_trace_meta"))).toBe(false);
    expect(calls.some((c) => c.sql === "PRAGMA secure_delete=ON")).toBe(true);
    expect(calls.some((c) => c.sql === "VACUUM")).toBe(true);
    expect(
      calls.some((c) => c.sql === "SELECT COUNT(*) as c FROM ai_spans"),
    ).toBe(true);

    // The buffered (never-flushed) span must not surface after clearAll.
    calls.length = 0;
    await store.flush();
    expect(calls).toHaveLength(0);
  });

  it("clearAll rotates the install salt", async () => {
    const { db } = makeFakeDb([{ c: 0 }]);
    const rotateSalt = vi.fn().mockResolvedValue(undefined);
    const store = new SqliteTraceStore(async () => db, rotateSalt);
    stores.push(store);

    await store.clearAll();

    expect(rotateSalt).toHaveBeenCalledTimes(1);
  });

  it("clearAll reports { ok: false } when VACUUM keeps failing (retried 3x), but still rotates the salt (H2, #118)", async () => {
    const calls: Call[] = [];
    const db: TraceDb = {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (sql === "VACUUM") throw new Error("disk full");
      },
      async select() {
        return [{ c: 0 }] as never;
      },
    };
    const rotateSalt = vi.fn().mockResolvedValue(undefined);
    const store = new SqliteTraceStore(async () => db, rotateSalt);
    stores.push(store);

    const result = await store.clearAll();

    expect(result).toEqual({ ok: false });
    expect(calls.filter((c) => c.sql === "VACUUM")).toHaveLength(3);
    expect(rotateSalt).toHaveBeenCalledTimes(1);
  });

  it("clearAll reports { ok: false } when rows remain after VACUUM (count check, H2, #118)", async () => {
    const { db } = makeFakeDb([{ c: 3 }]);
    const store = makeStore(async () => db);

    const result = await store.clearAll();

    expect(result).toEqual({ ok: false });
  });

  it("disable()/enable() flip isActive() and suppress writes while disabled (M1, #118)", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    calls.length = 0;

    store.disable();
    expect(store.isActive()).toBe(false);
    store.write(makeSpan("dropped-while-disabled"));
    await store.flush();
    expect(calls.some((c) => c.sql.includes("INSERT"))).toBe(false);

    store.enable();
    expect(store.isActive()).toBe(true);
    store.write(makeSpan("written-once-enabled"));
    await store.flush();
    expect(calls.some((c) => c.sql.includes("INSERT INTO ai_spans"))).toBe(
      true,
    );
  });

  it("a clearAll() landing between the spans INSERT and the attempts INSERT drops the attempts entirely, and deletes the spans that did land (M1/H2, #118)", async () => {
    const calls: Call[] = [];
    let gated = false;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseGate = resolve));
    const db: TraceDb = {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (!gated && sql.includes("INSERT INTO ai_spans")) {
          gated = true;
          await gate;
        }
      },
      async select() {
        return [{ c: 0 }] as never;
      },
    };
    const store = makeStore(async () => db);
    calls.length = 0; // drop the constructor's own startup prune
    store.write(makeSpan("s0"));
    store.writeAttempt(makeAttempt("s0"));

    const flushPromise = store.flush();
    await tick();
    // flush is parked mid-way through the (single, multi-row) spans INSERT.
    expect(
      calls.filter((c) => c.sql.includes("INSERT INTO ai_spans")),
    ).toHaveLength(1);

    // bumpGeneration() (inside clearAll) runs synchronously the moment
    // clearAll() is called — before the gate below is even released — so
    // the disable/generation bump lands strictly before the attempts
    // INSERT's own pre-statement check further down in the same flush.
    const clearPromise = store.clearAll();
    releaseGate();
    await Promise.all([flushPromise, clearPromise]);

    expect(calls.some((c) => c.sql.includes("INSERT INTO ai_attempts"))).toBe(
      false,
    );
    const deleteIndex = calls.findIndex(
      (c) => c.sql === "DELETE FROM ai_spans",
    );
    expect(deleteIndex).toBeGreaterThan(-1);
    // Nothing is written after clearAll's DELETEs run.
    expect(calls.slice(deleteIndex).some((c) => c.sql.includes("INSERT"))).toBe(
      false,
    );
  });

  it("flush writes spans then attempts as standalone multi-row INSERT statements, never a BEGIN/COMMIT/ROLLBACK transaction (M1, #118)", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    await tick(); // let the constructor's own startup prune land first
    calls.length = 0;
    store.write(makeSpan("a"));
    store.write(makeSpan("b"));
    store.writeAttempt(makeAttempt("a"));

    await store.flush();

    expect(calls.some((c) => c.sql === "BEGIN")).toBe(false);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(false);
    const spanIndex = calls.findIndex((c) =>
      c.sql.includes("INSERT INTO ai_spans"),
    );
    const attemptIndex = calls.findIndex((c) =>
      c.sql.includes("INSERT INTO ai_attempts"),
    );
    expect(spanIndex).toBeGreaterThan(-1);
    expect(attemptIndex).toBeGreaterThan(spanIndex);
  });

  it("a failed INSERT drops just that chunk's records (counted), with no transaction to roll back", async () => {
    const calls: Call[] = [];
    const db: TraceDb = {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("INSERT INTO ai_spans")) throw new Error("boom");
      },
      async select() {
        return [] as never;
      },
    };
    const store = makeStore(async () => db);
    calls.length = 0;
    store.write(makeSpan("will-fail"));

    await expect(store.flush()).resolves.toBeUndefined();

    expect(calls.some((c) => c.sql === "BEGIN")).toBe(false);
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(false);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
    expect(store.droppedRecordCount).toBeGreaterThan(0);
  });

  it("flush chunks a multi-row INSERT to at most MAX_ROWS_PER_INSERT rows per statement (H2, #118)", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    await tick();
    calls.length = 0;
    const total = MAX_ROWS_PER_INSERT + 1;
    for (let i = 0; i < total; i++) store.write(makeSpan(`s${i}`));

    await store.flush();

    const spanInserts = calls.filter((c) =>
      c.sql.includes("INSERT INTO ai_spans"),
    );
    expect(spanInserts).toHaveLength(2);
    expect(spanInserts[0].params).toHaveLength(MAX_ROWS_PER_INSERT * 38);
    expect(spanInserts[1].params).toHaveLength(1 * 38);
  });

  it("count() reports the ai_spans row count", async () => {
    const { db } = makeFakeDb([{ c: 3 }]);
    const store = makeStore(async () => db);
    expect(await store.count()).toBe(3);
  });

  it("count() adds spans still sitting in the write buffer", async () => {
    const { db } = makeFakeDb([{ c: 3 }]);
    const store = makeStore(async () => db);
    store.write(makeSpan("not-flushed-yet"));
    expect(await store.count()).toBe(4);
  });

  it("count() falls back to the buffered count on a query failure", async () => {
    const { db, setShouldFail } = makeFakeDb();
    const store = makeStore(async () => db);
    store.write(makeSpan("buffered"));
    setShouldFail(true);
    expect(await store.count()).toBe(1);
    expect(store.droppedRecordCount).toBeGreaterThan(0);
  });

  it("count() and prune() share the flush/clearAll mutex — count() waits for an in-flight flush rather than reading mid-write (H2, #118)", async () => {
    const calls: Call[] = [];
    let gated = false;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseGate = resolve));
    const db: TraceDb = {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (!gated && sql.includes("INSERT INTO ai_spans")) {
          gated = true;
          await gate;
        }
      },
      async select(sql, params) {
        calls.push({ sql, params });
        return [{ c: 5 }] as never;
      },
    };
    const store = makeStore(async () => db);
    calls.length = 0; // drop the constructor's own startup prune
    store.write(makeSpan("s0"));

    const flushPromise = store.flush();
    await tick();
    // flush is parked mid-insert, holding the mutex.
    const countPromise = store.count();
    releaseGate();
    await Promise.all([flushPromise, countPromise]);

    const insertIndex = calls.findIndex((c) =>
      c.sql.includes("INSERT INTO ai_spans"),
    );
    const selectIndex = calls.findIndex((c) =>
      c.sql.includes("SELECT COUNT(*)"),
    );
    expect(insertIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeGreaterThan(insertIndex);
  });

  it("handle() captures the generation at call time: a write through a stale handle is dropped even after the store is re-enabled for a new generation (M3, #118)", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    await tick();
    calls.length = 0;

    const staleHandle = store.handle();
    expect(staleHandle.isActive?.()).toBe(true);

    // Simulates "Clear log" (disable + bump) followed by a new call
    // re-enabling the store for the next generation.
    store.bumpGeneration();
    store.enable();

    expect(staleHandle.isActive?.()).toBe(false);
    staleHandle.write(makeSpan("from-stale-handle"));
    staleHandle.writeAttempt(makeAttempt("from-stale-handle"));
    await store.flush();

    expect(calls.some((c) => c.sql.includes("INSERT"))).toBe(false);

    // A handle captured after the bump writes normally.
    const freshHandle = store.handle();
    freshHandle.write(makeSpan("from-fresh-handle"));
    await store.flush();
    expect(calls.some((c) => c.sql.includes("INSERT INTO ai_spans"))).toBe(
      true,
    );
  });
});

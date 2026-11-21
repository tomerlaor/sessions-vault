import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SqliteTraceStore,
  RETENTION_DAYS,
  RETENTION_MAX_SPANS,
  FLUSH_INTERVAL_MS,
  PRUNE_EVERY_N_INSERTS,
} from "../src/lib/ai-trace/sqlite-store";
import type { TraceDb } from "../src/db/trace-client";
import type { SpanRecord } from "../src/lib/ai-trace/types";

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
    expect(
      calls.filter((c) => c.sql.includes("INSERT INTO ai_spans")),
    ).toHaveLength(50);
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

    const spanDelete = calls.find(
      (c) => c.sql === "DELETE FROM ai_spans WHERE span_id IN (?,?)",
    );
    const attemptDelete = calls.find(
      (c) => c.sql === "DELETE FROM ai_attempts WHERE span_id IN (?,?)",
    );
    const outcomeDelete = calls.find(
      (c) => c.sql === "DELETE FROM ai_outcomes WHERE span_id IN (?,?)",
    );
    expect(spanDelete?.params).toEqual(["old1", "old2"]);
    expect(attemptDelete?.params).toEqual(["old1", "old2"]);
    expect(outcomeDelete?.params).toEqual(["old1", "old2"]);
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
    const { db } = makeFakeDb();
    const store = makeStore(async () => db);
    const pruneSpy = vi.spyOn(store, "prune");
    pruneSpy.mockClear(); // drop the constructor's startup call

    for (let batch = 0; batch < PRUNE_EVERY_N_INSERTS / 50; batch++) {
      for (let i = 0; i < 50; i++) store.write(makeSpan(`b${batch}-${i}`));
      await tick();
    }

    expect(pruneSpy).toHaveBeenCalled();
  });

  it("swallows a prune failure and counts it instead of throwing", async () => {
    const { db, setShouldFail } = makeFakeDb();
    const store = makeStore(async () => db);
    setShouldFail(true);
    await expect(store.prune()).resolves.toBeUndefined();
    expect(store.droppedRecordCount).toBeGreaterThan(0);
  });

  it("clearAll drops the in-memory buffer, deletes every row except ai_trace_meta, then secure-deletes and VACUUMs (M1, #118)", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    store.write(makeSpan("buffered-not-yet-flushed"));
    calls.length = 0;

    await store.clearAll();

    expect(calls.some((c) => c.sql.includes("ai_payloads"))).toBe(false);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_outcomes")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_attempts")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
    expect(calls.some((c) => c.sql.includes("ai_trace_meta"))).toBe(false);
    expect(calls.some((c) => c.sql === "PRAGMA secure_delete=ON")).toBe(true);
    expect(calls.some((c) => c.sql === "VACUUM")).toBe(true);

    // The buffered (never-flushed) span must not surface after clearAll.
    calls.length = 0;
    await store.flush();
    expect(calls).toHaveLength(0);
  });

  it("clearAll rotates the install salt", async () => {
    const { db } = makeFakeDb();
    const rotateSalt = vi.fn().mockResolvedValue(undefined);
    const store = new SqliteTraceStore(async () => db, rotateSalt);
    stores.push(store);

    await store.clearAll();

    expect(rotateSalt).toHaveBeenCalledTimes(1);
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

  it("a flush suspended mid-insert rolls back its whole batch once clearAll disables the store, and nothing survives the DELETEs (M1, #118)", async () => {
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
        return [] as never;
      },
    };
    const store = makeStore(async () => db);
    calls.length = 0; // drop the constructor's own startup prune
    store.write(makeSpan("s0"));
    store.write(makeSpan("s1"));
    store.write(makeSpan("s2"));

    const flushPromise = store.flush();
    await tick();
    // flush is now parked mid-loop, awaiting s0's INSERT.
    expect(
      calls.filter((c) => c.sql.includes("INSERT INTO ai_spans")),
    ).toHaveLength(1);

    const clearPromise = store.clearAll();
    releaseGate();
    await Promise.all([flushPromise, clearPromise]);

    const spanInserts = calls.filter((c) =>
      c.sql.includes("INSERT INTO ai_spans"),
    );
    // s0's INSERT was issued inside the still-open transaction before
    // clearAll flipped enabled/generation; s1/s2 are skipped. The flush
    // then rolls the whole transaction back instead of committing it, so
    // s0 never actually lands on disk either.
    expect(spanInserts).toHaveLength(1);
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
    const deleteIndex = calls.findIndex(
      (c) => c.sql === "DELETE FROM ai_spans",
    );
    expect(deleteIndex).toBeGreaterThan(-1);
    // Nothing is written after clearAll's DELETEs run.
    expect(calls.slice(deleteIndex).some((c) => c.sql.includes("INSERT"))).toBe(
      false,
    );
  });

  it("flush runs its INSERTs inside a single BEGIN/COMMIT transaction (item 4, #118)", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    await tick(); // let the constructor's own startup prune land first
    calls.length = 0;
    store.write(makeSpan("a"));
    store.write(makeSpan("b"));

    await store.flush();

    expect(calls[0].sql).toBe("BEGIN");
    expect(calls[calls.length - 1].sql).toBe("COMMIT");
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(false);
  });

  it("flush rolls back the transaction (not just drops records) when a mid-batch insert fails", async () => {
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

    expect(calls.some((c) => c.sql === "BEGIN")).toBe(true);
    expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
    expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
    expect(store.droppedRecordCount).toBeGreaterThan(0);
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
});

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

function makeFakeDb(): {
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
    async select() {
      return [] as never;
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

  it("prune() deletes spans older than 30 days or beyond the newest 20000, cascading to attempts/outcomes, plus expired payloads", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    calls.length = 0; // drop the constructor's own startup prune
    await store.prune();

    const spanDelete = calls.find((c) =>
      c.sql.includes("DELETE FROM ai_spans"),
    );
    expect(spanDelete).toBeDefined();
    const [cutoff, limit] = spanDelete!.params as [number, number];
    expect(limit).toBe(RETENTION_MAX_SPANS);
    const expectedCutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5000);

    expect(calls.some((c) => c.sql.includes("DELETE FROM ai_attempts"))).toBe(
      true,
    );
    expect(calls.some((c) => c.sql.includes("DELETE FROM ai_outcomes"))).toBe(
      true,
    );
    expect(calls.some((c) => c.sql.includes("DELETE FROM ai_payloads"))).toBe(
      true,
    );
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

  it("clearAll drops the in-memory buffer and deletes every row except ai_trace_meta", async () => {
    const { db, calls } = makeFakeDb();
    const store = makeStore(async () => db);
    store.write(makeSpan("buffered-not-yet-flushed"));
    calls.length = 0;

    await store.clearAll();

    expect(calls.some((c) => c.sql === "DELETE FROM ai_payloads")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_outcomes")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_attempts")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
    expect(calls.some((c) => c.sql.includes("ai_trace_meta"))).toBe(false);

    // The buffered (never-flushed) span must not surface after clearAll.
    calls.length = 0;
    await store.flush();
    expect(calls).toHaveLength(0);
  });
});

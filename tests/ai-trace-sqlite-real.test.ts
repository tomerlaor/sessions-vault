// Real-SQLite coverage for the M1/H2 (#118) pooled-connection fixes: the
// fake-DB tests elsewhere in this suite prove the *shape* of the SQL (no
// BEGIN/COMMIT, set-based deletes, chunked multi-row INSERTs), but they
// can't prove those statements actually behave correctly against real
// SQLite when spread across several physical connections the way
// tauri-plugin-sql's pool spreads them. Node 24 ships `node:sqlite`
// (DatabaseSync) — no new dependency — so this file builds a tiny pool of
// 3 separate connections to the same temp-file database and round-robins
// statements across them, the same way sqlx's pool does, then runs the
// store's real flush/clearAll/prune logic against it.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SqliteTraceStore,
  RETENTION_DAYS,
} from "../src/lib/ai-trace/sqlite-store";
import { runMigrations, ensureMeta } from "../src/db/trace-client";
import type { TraceDb } from "../src/db/trace-client";
import type { SpanRecord } from "../src/lib/ai-trace/types";

// node:sqlite is built into Node >= 22.5. Load it lazily so this file is
// skipped (not a failing import) on older Node versions.
type DatabaseSyncCtor = typeof import("node:sqlite").DatabaseSync;
let DatabaseSync: DatabaseSyncCtor | undefined;
try {
  DatabaseSync = (
    createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: DatabaseSyncCtor;
    }
  ).DatabaseSync;
} catch {
  DatabaseSync = undefined;
}

// Mirrors tauri-plugin-sql (sqlx): several real connections to the same
// file, each execute()/select() call handed to whichever is next in the
// rotation — never the one the previous statement used.
class ConnectionPool {
  private readonly connections: InstanceType<DatabaseSyncCtor>[];
  private next = 0;

  constructor(path: string, size: number) {
    this.connections = Array.from(
      { length: size },
      () => new DatabaseSync!(path),
    );
  }

  pick(): InstanceType<DatabaseSyncCtor> {
    const db = this.connections[this.next % this.connections.length];
    this.next += 1;
    return db;
  }

  closeAll(): void {
    for (const c of this.connections) c.close();
  }
}

function makePooledTraceDb(pool: ConnectionPool): TraceDb {
  return {
    async execute(sql: string, params: unknown[]) {
      pool
        .pick()
        .prepare(sql)
        .run(...(params as never[]));
    },
    async select<T>(sql: string, params: unknown[]) {
      return pool
        .pick()
        .prepare(sql)
        .all(...(params as never[])) as T;
    },
  };
}

function randomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes; i++)
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  return out;
}

async function readSalt(db: TraceDb): Promise<string> {
  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM ai_trace_meta WHERE key = 'install_salt'`,
    [],
  );
  return rows[0]?.value ?? "";
}

function makeSpan(id: string, startedAt = Date.now()): SpanRecord {
  return {
    spanId: id,
    traceId: id,
    startedAt,
    feature: "lyrics",
    operation: "stream_suggestion",
    provider: "openai",
    locality: "cloud",
    requestModel: "gpt-4.1-mini",
    cacheHit: false,
    attempts: 1,
    status: "ok",
  };
}

describe.skipIf(!DatabaseSync)(
  "SqliteTraceStore against a real multi-connection SQLite pool (node:sqlite, M1/H2 #118)",
  () => {
    let dir: string;
    let pool: ConnectionPool;
    let db: TraceDb;
    let stores: SqliteTraceStore[] = [];

    async function setup(): Promise<void> {
      dir = mkdtempSync(join(tmpdir(), "ai-trace-real-"));
      pool = new ConnectionPool(join(dir, "ai-traces.db"), 3);
      db = makePooledTraceDb(pool);
      await runMigrations(db);
      await ensureMeta(db);
    }

    afterEach(() => {
      stores.forEach((s) => s.dispose());
      stores = [];
      pool?.closeAll();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it("(c) a normal flush writes the expected rows via multi-row INSERTs", async () => {
      await setup();
      const store = new SqliteTraceStore(async () => db);
      stores.push(store);
      await store.prune(); // let the constructor's own startup prune land

      for (let i = 0; i < 5; i++) store.write(makeSpan(`span-${i}`));
      await store.flush();

      const rows = await db.select<{ span_id: string }[]>(
        `SELECT span_id FROM ai_spans ORDER BY span_id`,
        [],
      );
      expect(rows.map((r) => r.span_id)).toEqual([
        "span-0",
        "span-1",
        "span-2",
        "span-3",
        "span-4",
      ]);
    });

    it("(a) a flush interrupted by a disable between its spans and attempts statements leaves no trace rows once cleared", async () => {
      await setup();
      const storeRef: { current?: SqliteTraceStore } = {};
      // Hooks the adapter to bump the store's generation (disable) the
      // instant the spans INSERT lands, before the attempts INSERT (the
      // "next statement") gets a chance to run.
      let disabledAfterSpansInsert = false;
      const hookedDb: TraceDb = {
        async execute(sql: string, params: unknown[]) {
          pool
            .pick()
            .prepare(sql)
            .run(...(params as never[]));
          if (
            !disabledAfterSpansInsert &&
            sql.includes("INSERT INTO ai_spans")
          ) {
            disabledAfterSpansInsert = true;
            storeRef.current?.bumpGeneration();
          }
        },
        async select<T>(sql: string, params: unknown[]) {
          return pool
            .pick()
            .prepare(sql)
            .all(...(params as never[])) as T;
        },
      };
      const store = new SqliteTraceStore(async () => hookedDb);
      storeRef.current = store;
      stores.push(store);
      await store.prune();

      store.write(makeSpan("interrupted-span"));
      store.writeAttempt({
        spanId: "interrupted-span",
        attempt: 1,
        startedAt: Date.now(),
        status: "ok",
      });
      await store.flush();

      // The attempts INSERT must never have run — the spans INSERT's own
      // disable landed before the pre-statement check ahead of it.
      const attemptRows = await db.select<unknown[]>(
        `SELECT * FROM ai_attempts`,
        [],
      );
      expect(attemptRows).toHaveLength(0);

      // The span itself did land (its INSERT was already issued before the
      // disable), but a subsequent clear must still wipe it — "leaves no
      // trace rows" is the end state after clearAll runs, not a guarantee
      // that an in-flight statement rolls itself back.
      const result = await store.clearAll();
      expect(result.ok).toBe(true);
      const spanRows = await db.select<unknown[]>(`SELECT * FROM ai_spans`, []);
      expect(spanRows).toHaveLength(0);
    });

    it("(b) clearAll deletes every row, VACUUMs, and rotates the salt", async () => {
      await setup();
      const store = new SqliteTraceStore(
        async () => db,
        async () => {
          await db.execute(
            `INSERT INTO ai_trace_meta (key, value) VALUES ('install_salt', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [randomHex(32)],
          );
        },
      );
      stores.push(store);
      await store.prune();

      for (let i = 0; i < 3; i++) store.write(makeSpan(`clear-me-${i}`));
      store.writeAttempt({
        spanId: "clear-me-0",
        attempt: 1,
        startedAt: Date.now(),
        status: "ok",
      });
      await store.flush();
      expect(await store.count()).toBeGreaterThan(0);
      const saltBefore = await readSalt(db);

      const result = await store.clearAll();

      expect(result).toEqual({ ok: true });
      const spanRows = await db.select<unknown[]>(`SELECT * FROM ai_spans`, []);
      const attemptRows = await db.select<unknown[]>(
        `SELECT * FROM ai_attempts`,
        [],
      );
      expect(spanRows).toHaveLength(0);
      expect(attemptRows).toHaveLength(0);
      const metaRows = await db.select<{ key: string }[]>(
        `SELECT key FROM ai_trace_meta`,
        [],
      );
      expect(metaRows.some((r) => r.key === "schema_version")).toBe(true);
      const saltAfter = await readSalt(db);
      expect(saltAfter).not.toBe(saltBefore);
      expect(saltAfter).toHaveLength(64);
    });

    it("(d) prune deletes only spans past the retention window via set-based SQL, cascades to their attempts, and never touches an orphan attempt whose span row doesn't exist", async () => {
      await setup();
      const store = new SqliteTraceStore(async () => db);
      stores.push(store);

      const oldCutoff = Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
      // Two old spans, each with a matching attempt — both should be pruned.
      await db.execute(
        `INSERT INTO ai_spans (span_id, trace_id, started_at, feature, operation, provider, locality, request_model, cache_hit, attempts, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          "old-1",
          "old-1",
          oldCutoff,
          "lyrics",
          "op",
          "openai",
          "cloud",
          "m",
          0,
          1,
          "ok",
          "old-2",
          "old-2",
          oldCutoff,
          "lyrics",
          "op",
          "openai",
          "cloud",
          "m",
          0,
          1,
          "ok",
        ],
      );
      await db.execute(
        `INSERT INTO ai_attempts (span_id, attempt, started_at, status) VALUES (?,?,?,?), (?,?,?,?)`,
        ["old-1", 1, oldCutoff, "ok", "old-2", 1, oldCutoff, "ok"],
      );
      // A fresh span that must survive.
      await db.execute(
        `INSERT INTO ai_spans (span_id, trace_id, started_at, feature, operation, provider, locality, request_model, cache_hit, attempts, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          "fresh-1",
          "fresh-1",
          Date.now(),
          "lyrics",
          "op",
          "openai",
          "cloud",
          "m",
          0,
          1,
          "ok",
        ],
      );
      // An orphan attempt whose span was never flushed (no ai_spans row at
      // all) — must survive prune: it can never match the
      // "span_id IN (SELECT span_id FROM ai_spans WHERE ...)" subquery used
      // for the doomed set, unlike a "NOT IN ai_spans" condition which would
      // have wrongly swept it up.
      await db.execute(
        `INSERT INTO ai_attempts (span_id, attempt, started_at, status) VALUES (?,?,?,?)`,
        ["buffered-not-yet-flushed", 1, Date.now(), "ok"],
      );

      await store.prune();

      const remainingSpans = await db.select<{ span_id: string }[]>(
        `SELECT span_id FROM ai_spans ORDER BY span_id`,
        [],
      );
      expect(remainingSpans.map((r) => r.span_id)).toEqual(["fresh-1"]);

      const remainingAttempts = await db.select<{ span_id: string }[]>(
        `SELECT span_id FROM ai_attempts ORDER BY span_id`,
        [],
      );
      expect(remainingAttempts.map((r) => r.span_id)).toEqual([
        "buffered-not-yet-flushed",
      ]);
    });
  },
);

// Separate SQLite file for the opt-in AI activity log (tracing T2, #90).
// Deliberately its own database — never sessions.db — so it can be wiped,
// VACUUM'd, or corrupted without touching project data, and so it never
// shows up in a project backup (those only ever zip project-directory
// files; see src-tauri/src/backup/mod.rs). Loaded via plugin-sql's
// `sqlite:` URL, which resolves relative to Tauri's app *config* dir — not
// the app data dir — so "sqlite:ai-traces.db" ends up at
// `<app_config_dir>/ai-traces.db`. Schema matches llm-tracing-plan.md §3.2
// exactly; no prompt/output text columns here — debug capture (T7) will
// add its own `ai_payloads` table behind a separate opt-in, and this PR
// does not create it.
import Database from "@tauri-apps/plugin-sql";

let _raw: Database | null = null;
let _rawPromise: Promise<Database> | null = null;
let _salt: string | null = null;

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function runMigrations(raw: Database): Promise<void> {
  // Every DELETE in this file (clearAll, prune) relies on the freed pages
  // never lingering in plaintext in the file's free space (M1, #118), so
  // this is set unconditionally on every load, not just after a clear.
  await raw.execute(`PRAGMA secure_delete=ON`, []);
  await raw.execute(`PRAGMA auto_vacuum=INCREMENTAL`, []);

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS ai_spans (
    span_id            TEXT PRIMARY KEY,
    trace_id           TEXT NOT NULL,
    parent_span_id     TEXT,
    started_at         INTEGER NOT NULL,
    feature            TEXT NOT NULL,
    operation          TEXT NOT NULL,
    mode               TEXT,
    trigger            TEXT,
    provider           TEXT NOT NULL,
    locality           TEXT NOT NULL,
    request_model      TEXT NOT NULL,
    response_model     TEXT,
    params_json        TEXT,
    prompt_id          TEXT,
    prompt_version     TEXT,
    prompt_hash        TEXT,
    system_chars       INTEGER,
    prompt_chars       INTEGER,
    output_chars       INTEGER,
    lang               TEXT,
    project_ref        TEXT,
    cache_hit          INTEGER NOT NULL DEFAULT 0,
    attempts           INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL,
    error_type         TEXT,
    error_message      TEXT,
    finish_reason      TEXT,
    ttft_ms            INTEGER,
    duration_ms        INTEGER,
    input_tokens       INTEGER,
    output_tokens      INTEGER,
    cached_input_tokens INTEGER,
    reasoning_tokens   INTEGER,
    usage_source       TEXT,
    cost_usd_estimate  REAL,
    cost_source        TEXT,
    candidates         INTEGER,
    app_version        TEXT
  )`,
    [],
  );
  await raw.execute(
    `CREATE INDEX IF NOT EXISTS ai_spans_started ON ai_spans(started_at)`,
    [],
  );
  await raw.execute(
    `CREATE INDEX IF NOT EXISTS ai_spans_trace ON ai_spans(trace_id)`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS ai_attempts (
    span_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER,
    ttft_ms INTEGER,
    status TEXT NOT NULL,
    error_type TEXT,
    http_status INTEGER,
    response_id TEXT,
    PRIMARY KEY (span_id, attempt)
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS ai_outcomes (
    suggestion_id TEXT PRIMARY KEY,
    span_id TEXT NOT NULL,
    candidate_index INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    tag TEXT,
    decided_at INTEGER NOT NULL,
    latency_to_decision_ms INTEGER
  )`,
    [],
  );

  // ai_payloads (debug capture, T7) is a separate, not-yet-built opt-in —
  // drop it in case an earlier dev build of this branch already created
  // it, so no stale table lingers alongside the T2 schema (L3, #118).
  await raw.execute(`DROP TABLE IF EXISTS ai_payloads`, []);

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS ai_trace_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
    [],
  );
}

const SCHEMA_VERSION = "1";

async function ensureMeta(raw: Database): Promise<void> {
  await raw.execute(
    `INSERT INTO ai_trace_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO NOTHING`,
    [SCHEMA_VERSION],
  );
  const existing = await raw.select<{ value: string }[]>(
    `SELECT value FROM ai_trace_meta WHERE key = 'install_salt'`,
    [],
  );
  if (existing.length === 0) {
    await raw.execute(
      `INSERT INTO ai_trace_meta (key, value) VALUES ('install_salt', ?)
       ON CONFLICT(key) DO NOTHING`,
      [randomHex(32)],
    );
  }
}

// Memoizes the in-flight load, not just the resolved Database — so
// concurrent first callers (e.g. the store's constructor kicking off
// prune() at the same moment a call site resolves its trace store) all
// await the same Database.load()+migrations run instead of each starting
// their own (nit, #118). Reset on failure so the next call retries from
// scratch rather than replaying a rejected promise forever.
async function getRaw(): Promise<Database> {
  if (_raw) return _raw;
  if (!_rawPromise) {
    _rawPromise = (async () => {
      const raw = await Database.load("sqlite:ai-traces.db");
      await runMigrations(raw);
      await ensureMeta(raw);
      _raw = raw;
      return raw;
    })().catch((err: unknown) => {
      _rawPromise = null;
      throw err;
    });
  }
  return _rawPromise;
}

// The Database shape SqliteTraceStore needs — satisfied by the real
// @tauri-apps/plugin-sql Database and by a hand-rolled fake in tests.
export interface TraceDb {
  execute(sql: string, params: unknown[]): Promise<unknown>;
  select<T>(sql: string, params: unknown[]): Promise<T>;
}

export async function getTraceDb(): Promise<TraceDb> {
  return getRaw();
}

export async function getInstallSalt(): Promise<string> {
  if (_salt) return _salt;
  const raw = await getRaw();
  const rows = await raw.select<{ value: string }[]>(
    `SELECT value FROM ai_trace_meta WHERE key = 'install_salt'`,
    [],
  );
  _salt = rows[0]?.value ?? "";
  return _salt;
}

// Generates a fresh install_salt and replaces both the DB row and the
// in-memory cache above, so the very next hashPrompt() call uses it. Called
// by SqliteTraceStore.clearAll() on every clear and disable (L2, #118) —
// prompt hashes recorded before a clear/disable can never be correlated
// with ones recorded after.
export async function rotateInstallSalt(): Promise<void> {
  const raw = await getRaw();
  const next = randomHex(32);
  await raw.execute(
    `INSERT INTO ai_trace_meta (key, value) VALUES ('install_salt', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [next],
  );
  _salt = next;
}

// Test-only: forces the next getTraceDb()/getInstallSalt() call to
// re-initialize instead of reusing the module-level singleton.
export function resetTraceDbForTests(): void {
  _raw = null;
  _rawPromise = null;
  _salt = null;
}

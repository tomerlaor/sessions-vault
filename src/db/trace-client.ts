// Separate SQLite file for the opt-in AI activity log (tracing T2, #90).
// Deliberately its own database — never sessions.db — so it can be wiped,
// VACUUM'd, or corrupted without touching project data, and so it never
// shows up in a project backup (those only ever zip project-directory
// files; see src-tauri/src/backup/mod.rs). Schema matches
// llm-tracing-plan.md §3.2 exactly; no prompt/output text columns here —
// only `ai_payloads` (debug capture, T7) will ever hold that, and this PR
// doesn't create writers for it.
import Database from "@tauri-apps/plugin-sql";

let _raw: Database | null = null;
let _salt: string | null = null;

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function runMigrations(raw: Database): Promise<void> {
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

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS ai_payloads (
    span_id TEXT PRIMARY KEY,
    system TEXT,
    prompt TEXT,
    output TEXT,
    expires_at INTEGER NOT NULL
  )`,
    [],
  );

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

async function getRaw(): Promise<Database> {
  if (!_raw) {
    const raw = await Database.load("sqlite:ai-traces.db");
    await runMigrations(raw);
    await ensureMeta(raw);
    _raw = raw;
  }
  return _raw;
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

// Test-only: forces the next getTraceDb()/getInstallSalt() call to
// re-initialize instead of reusing the module-level singleton.
export function resetTraceDbForTests(): void {
  _raw = null;
  _salt = null;
}

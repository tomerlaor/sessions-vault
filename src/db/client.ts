import Database from "@tauri-apps/plugin-sql";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle> | null = null;
let _raw: Database | null = null;

async function getRaw(): Promise<Database> {
  if (!_raw) {
    _raw = await Database.load("sqlite:sessions.db");
    await runMigrations(_raw);
  }
  return _raw;
}

export async function checkpointDb(): Promise<void> {
  const raw = await getRaw();
  await raw.execute(`PRAGMA wal_checkpoint(TRUNCATE)`, []);
}

async function runMigrations(raw: Database): Promise<void> {
  // Recover any WAL data left uncommitted by a previous unclean shutdown
  await raw.execute(`PRAGMA wal_checkpoint(FULL)`, []);
  // Checkpoint every 50 pages instead of the default 1000, reducing data at risk
  await raw.execute(`PRAGMA wal_autocheckpoint=50`, []);

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    file_hash TEXT,
    title TEXT NOT NULL,
    daw TEXT NOT NULL,
    daw_version TEXT,
    bpm REAL,
    key TEXT,
    time_signature TEXT,
    track_count INTEGER,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    rating INTEGER,
    notes TEXT,
    lyrics TEXT,
    todos TEXT,
    duration_secs REAL,
    created_at INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    last_scanned_at INTEGER NOT NULL
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS project_tags (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, tag_id)
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS watched_folders (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  )`,
    [],
  );

  await raw.execute(
    `CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts
    USING fts5(title, notes, content='projects', content_rowid='rowid')`,
    [],
  );

  // Add lyrics column to existing DBs that predate this column
  try {
    await raw.execute(`ALTER TABLE projects ADD COLUMN lyrics TEXT`, []);
  } catch {}
  try {
    await raw.execute(`ALTER TABLE projects ADD COLUMN todos TEXT`, []);
  } catch {}
  try {
    await raw.execute(`ALTER TABLE projects ADD COLUMN duration_secs REAL`, []);
  } catch {}
  try {
    await raw.execute(`ALTER TABLE projects ADD COLUMN tabs TEXT`, []);
  } catch {}

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    destination TEXT NOT NULL,
    snapshot_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    size_bytes INTEGER,
    checksum TEXT,
    error_msg TEXT
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS backup_configs (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS lyric_style_events (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    suggestion_text TEXT NOT NULL,
    mode TEXT NOT NULL,
    accepted INTEGER NOT NULL,
    tag TEXT,
    created_at INTEGER NOT NULL
  )`,
    [],
  );

  await raw.execute(
    `CREATE TABLE IF NOT EXISTS lyric_style_profile (
    id TEXT PRIMARY KEY,
    summary_text TEXT NOT NULL,
    last_updated_at INTEGER NOT NULL
  )`,
    [],
  );

  // Remove projects that live inside an Ableton Backup folder (case-insensitive, any depth)
  await raw.execute(
    `DELETE FROM projects WHERE file_path LIKE '%/Backup/%' OR file_path LIKE '%\\Backup\\%'`,
    [],
  );
}

export async function getDb(): Promise<
  ReturnType<typeof drizzle<typeof schema>>
> {
  if (!_db) {
    const raw = await getRaw();
    _db = drizzle(
      async (sql, params, method) => {
        if (method === "run") {
          await raw.execute(sql, params as unknown[]);
          return { rows: [] };
        }
        const rows = await raw.select<Record<string, unknown>[]>(
          sql,
          params as unknown[],
        );
        return {
          rows: rows.map((row) => Object.values(row)),
        };
      },
      { schema },
    );
  }
  return _db as ReturnType<typeof drizzle<typeof schema>>;
}

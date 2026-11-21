// Wires the "Keep AI activity log" setting (db/queries/ai-trace.ts) to a
// real SqliteTraceStore (T2, #90). Not re-exported from ./index — that
// barrel is imported by scripts/ai-cli.ts and the eval runner (Node, no
// Tauri), and must stay free of a @tauri-apps/plugin-sql dependency.
import {
  getAiActivityConfig,
  setAiActivityConfig,
} from "../../db/queries/ai-trace";
import {
  getInstallSalt,
  getTraceDb,
  rotateInstallSalt,
} from "../../db/trace-client";
import { SqliteTraceStore } from "./sqlite-store";
import type { TraceStore } from "./types";

let _store: SqliteTraceStore | null = null;
// Set the moment anything actually needs the store — the constructor's own
// startup prune() opens (and, if missing, creates) ai-traces.db, so this
// doubles as "has this session touched the DB file yet" (nit, #118).
let _dbTouchedThisSession = false;

function getStoreSingleton(): SqliteTraceStore {
  _dbTouchedThisSession = true;
  if (!_store) _store = new SqliteTraceStore(getTraceDb, rotateInstallSalt);
  return _store;
}

// Every traced call site should call this right before building its
// TracedMeta. Reads the setting fresh each time (a single local DB read)
// so toggling it in Settings takes effect on the very next call — when
// it's off (the default), no store or salt is handed out, so nothing is
// written and no prompt gets hashed. Re-enables the singleton on every
// active call (M1, #118): clearAll() (disable, or "Clear log" while still
// on) disables the store, and this is the only place that re-arms it, so a
// "Clear log" click while logging stays on doesn't silently stop future
// writes.
export async function getActiveTraceStore(): Promise<{
  store?: TraceStore;
  salt?: string;
}> {
  try {
    const { keepAiActivityLog } = await getAiActivityConfig();
    if (!keepAiActivityLog) return {};
    const store = getStoreSingleton();
    store.enable();
    const salt = await getInstallSalt();
    return { store, salt };
  } catch {
    // A settings-read or DB-open failure here must never break an AI call —
    // tracing is strictly best-effort. Fall back to "no store", identical
    // to the opted-out path above.
    return {};
  }
}

// Deletes every ai_spans/ai_attempts/ai_outcomes row (and drops any
// in-memory buffer), keeping ai_trace_meta's salt/schema rows — though the
// salt itself is rotated right after (L2, #118). Used by the "Clear log"
// button in Settings and whenever the log is turned off.
export async function clearAiActivityLog(): Promise<void> {
  await getStoreSingleton().clearAll();
}

// Number of logged spans, for the "Keep AI activity log" row (confirm-on-
// disable copy) and the "Clear log" button's disabled state. Short-circuits
// to 0 while the setting is off, since that path keeps the log empty
// without ever opening the trace DB.
export async function getAiActivityLogCount(): Promise<number> {
  const { keepAiActivityLog } = await getAiActivityConfig();
  if (!keepAiActivityLog) return 0;
  return getStoreSingleton().count();
}

// Settings' single entry point for the "Keep AI activity log" checkbox.
// Turning it off must stop writes immediately (handled by every call site
// re-reading the setting via getActiveTraceStore) and delete what's already
// on disk — the setting copy promises both. But if the log was never
// turned on (or was on but nothing ever touched the DB this session), there
// is nothing to delete — skip opening ai-traces.db just to clear a file
// that may not even exist yet (nit, #118).
export async function setKeepAiActivityLog(enabled: boolean): Promise<void> {
  const shouldClear =
    !enabled &&
    (_dbTouchedThisSession || (await getAiActivityConfig()).keepAiActivityLog);
  await setAiActivityConfig({ keepAiActivityLog: enabled });
  if (shouldClear) await clearAiActivityLog();
}

// Fire-and-forget: called once from app bootstrap so the retention window
// (RETENTION_DAYS/RETENTION_MAX_SPANS) gets enforced promptly at launch
// rather than waiting for the 500th insert of a session that might make
// very few AI calls (nit, #118). A no-op while the setting is off, and
// never throws — pruning must never be able to break app startup.
export async function pruneAiActivityLogIfEnabled(): Promise<void> {
  try {
    const { keepAiActivityLog } = await getAiActivityConfig();
    if (!keepAiActivityLog) return;
    await getStoreSingleton().prune();
  } catch {
    // best-effort only
  }
}

// Test-only: forces the next getActiveTraceStore() call to build a fresh
// SqliteTraceStore instead of reusing the module-level singleton.
export function resetTraceRuntimeForTests(): void {
  _store?.dispose();
  _store = null;
  _dbTouchedThisSession = false;
}

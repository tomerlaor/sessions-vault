// Wires the "Keep AI activity log" setting (db/queries/ai-trace.ts) to a
// real SqliteTraceStore (T2, #90). Not re-exported from ./index — that
// barrel is imported by scripts/ai-cli.ts and the eval runner (Node, no
// Tauri), and must stay free of a @tauri-apps/plugin-sql dependency.
import {
  getAiActivityConfig,
  setAiActivityConfig,
} from "../../db/queries/ai-trace";
import { getInstallSalt, getTraceDb } from "../../db/trace-client";
import { SqliteTraceStore } from "./sqlite-store";
import type { TraceStore } from "./types";

let _store: SqliteTraceStore | null = null;

function getStoreSingleton(): SqliteTraceStore {
  if (!_store) _store = new SqliteTraceStore(getTraceDb);
  return _store;
}

// Every traced call site should call this right before building its
// TracedMeta. Reads the setting fresh each time (a single local DB read)
// so toggling it in Settings takes effect on the very next call — when
// it's off (the default), no store or salt is handed out, so nothing is
// written and no prompt gets hashed.
export async function getActiveTraceStore(): Promise<{
  store?: TraceStore;
  salt?: string;
}> {
  const { keepAiActivityLog } = await getAiActivityConfig();
  if (!keepAiActivityLog) return {};
  const store = getStoreSingleton();
  const salt = await getInstallSalt();
  return { store, salt };
}

// Deletes every ai_spans/ai_attempts/ai_outcomes/ai_payloads row (and drops
// any in-memory buffer), keeping ai_trace_meta's salt/schema rows. Used by
// the "Clear log" button in Settings and whenever the log is turned off.
export async function clearAiActivityLog(): Promise<void> {
  await getStoreSingleton().clearAll();
}

// Settings' single entry point for the "Keep AI activity log" checkbox.
// Turning it off must stop writes immediately (handled by every call site
// re-reading the setting via getActiveTraceStore) and delete what's already
// on disk — the setting copy promises both.
export async function setKeepAiActivityLog(enabled: boolean): Promise<void> {
  await setAiActivityConfig({ keepAiActivityLog: enabled });
  if (!enabled) await clearAiActivityLog();
}

// Test-only: forces the next getActiveTraceStore() call to build a fresh
// SqliteTraceStore instead of reusing the module-level singleton.
export function resetTraceRuntimeForTests(): void {
  _store?.dispose();
  _store = null;
}

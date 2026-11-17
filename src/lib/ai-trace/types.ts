// Local-first LLM tracing core (T1, #89). No persistence in this PR — the
// store is in-memory only (see memory-store.ts). T2 adds a real sink and
// makes the activity log opt-in; nothing here is written to disk.

export type SpanFeature =
  "lyrics" | "tab_agent" | "settings" | "eval" | "cli" | "unknown";

// Open-ended on purpose: new operations can be added without a type-level
// change, but the ones ai.ts produces today are listed for documentation.
export type SpanOperation =
  | "stream_suggestion"
  | "next_word"
  | "popup"
  | "style_summary"
  | "tab_structure"
  | "tab_chat"
  | "test_connection"
  | (string & {});

export type SpanMode =
  "completion" | "next_line" | "alternative" | "next_word" | "popup";

export type SpanProvider =
  "openai" | "anthropic" | "openrouter" | "ollama" | "lmstudio";

export type SpanLocality = "local" | "cloud";

export type SpanStatus =
  "ok" | "error" | "cancelled" | "timeout" | "cache_hit" | "invalid_output";

export type UsageSource = "provider" | "missing";

// Mirrors `ai_spans` from the tracing plan (§3.2), camelCase. One row per
// logical operation — what the feature code asked for, not per provider
// attempt (see AttemptRecord for that).
export interface SpanRecord {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  startedAt: number; // epoch ms

  feature: SpanFeature;
  operation: SpanOperation;
  mode?: SpanMode;
  trigger?: string;

  provider?: SpanProvider;
  locality?: SpanLocality;
  requestModel?: string;
  responseModel?: string;

  paramsJson?: string;

  promptId?: string;
  promptVersion?: string;
  promptHash?: string;

  systemChars?: number;
  promptChars?: number;
  outputChars?: number;
  lang?: "en" | "he";

  projectRef?: string;

  cacheHit: boolean;
  attempts: number;
  status: SpanStatus;
  errorType?: string;
  errorMessage?: string;
  finishReason?: string;

  ttftMs?: number | null; // streaming only; null for generateObject
  durationMs?: number;

  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  usageSource?: UsageSource;

  // Cost estimation is T4. Left unset here on purpose.
  costUsdEstimate?: number | null;
  costSource?: string;

  candidates?: number;
  appVersion?: string;
}

// Mirrors `ai_attempts`: one row per provider attempt (SDK retries show up
// as additional rows against the same spanId).
export interface AttemptRecord {
  spanId: string;
  attempt: number;
  startedAt: number;
  durationMs?: number;
  ttftMs?: number | null;
  status: SpanStatus;
  errorType?: string;
  httpStatus?: number;
  responseId?: string;
}

export interface TraceStore {
  write(span: SpanRecord): void | Promise<void>;
  writeAttempt(attempt: AttemptRecord): void | Promise<void>;
  flush(): void | Promise<void>;
}

// Threaded explicitly through call sites (no AsyncLocalStorage in the
// webview). `span` is mutated in place as the operation and its model-level
// attempts progress; `store` and `salt` are optional — with no store,
// nothing is persisted (by design, for this PR).
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  span: SpanRecord;
  store?: TraceStore;
  salt?: string; // HMAC salt for hashPrompt(); no salt → no prompt hash
}

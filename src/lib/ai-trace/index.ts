// Local-first LLM tracing core (T1, #89): span model + single choke point.
// No persistence yet — see memory-store.ts and each type's doc comment.
export type {
  AttemptRecord,
  SpanFeature,
  SpanLocality,
  SpanMode,
  SpanOperation,
  SpanProvider,
  SpanRecord,
  SpanStatus,
  TraceContext,
  TraceStore,
  UsageSource,
} from "./types";
export { MemoryTraceStore } from "./memory-store";
export { hashPrompt } from "./hash";
export { scrubError } from "./scrub";
export type { ScrubbedError } from "./scrub";
export { createTracingMiddleware } from "./middleware";

import { scrubError } from "./scrub";
import type {
  SpanFeature,
  SpanMode,
  SpanOperation,
  SpanStatus,
  TraceContext,
  TraceStore,
} from "./types";

export interface TracedMeta {
  // Defaults to "unknown" — used for the auto-span fallback when a caller
  // hasn't threaded a TraceContext through yet.
  feature?: SpanFeature;
  operation: SpanOperation;
  mode?: SpanMode;
  trigger?: string;
  promptId?: string;
  promptVersion?: string;
  projectRef?: string;
  parentSpanId?: string;
  traceId?: string;
  store?: TraceStore;
  salt?: string;
}

export function createTraceContext(meta: TracedMeta): TraceContext {
  const traceId = meta.traceId ?? globalThis.crypto.randomUUID();
  const spanId = globalThis.crypto.randomUUID();
  return {
    traceId,
    spanId,
    parentSpanId: meta.parentSpanId,
    store: meta.store,
    salt: meta.salt,
    span: {
      spanId,
      traceId,
      parentSpanId: meta.parentSpanId,
      startedAt: Date.now(),
      feature: meta.feature ?? "unknown",
      operation: meta.operation,
      mode: meta.mode,
      trigger: meta.trigger,
      promptId: meta.promptId,
      promptVersion: meta.promptVersion,
      projectRef: meta.projectRef,
      cacheHit: false,
      attempts: 0,
      status: "ok",
    },
  };
}

function classifyOperationError(err: unknown): Pick<
  ReturnType<typeof scrubError>,
  "errorType" | "errorMessage"
> & {
  status: SpanStatus;
} {
  const { errorType, errorMessage } = scrubError(err);
  const status: SpanStatus =
    errorType === "abort"
      ? err instanceof Error && err.name === "TimeoutError"
        ? "timeout"
        : "cancelled"
      : "error";
  return { status, errorType, errorMessage };
}

async function safeWrite(ctx: TraceContext): Promise<void> {
  if (!ctx.store) return;
  try {
    await ctx.store.write(ctx.span);
    await ctx.store.flush();
  } catch {
    // a tracing failure must never break the caller
  }
}

// Times the whole operation, classifies its outcome onto ctx.span, and
// writes the completed span (best-effort) to ctx.store if one was given.
// Never throws because of tracing — only fn's own error is rethrown.
export async function traced<T>(
  meta: TracedMeta,
  fn: (ctx: TraceContext) => Promise<T>,
): Promise<T> {
  const ctx = createTraceContext(meta);
  const startedAt = Date.now();
  try {
    const result = await fn(ctx);
    ctx.span.durationMs = Date.now() - startedAt;
    if (ctx.span.cacheHit && ctx.span.status === "ok") {
      ctx.span.status = "cache_hit";
    }
    await safeWrite(ctx);
    return result;
  } catch (err) {
    ctx.span.durationMs = Date.now() - startedAt;
    const classified = classifyOperationError(err);
    ctx.span.status = classified.status;
    ctx.span.errorType = classified.errorType;
    ctx.span.errorMessage = classified.errorMessage;
    await safeWrite(ctx);
    throw err;
  }
}

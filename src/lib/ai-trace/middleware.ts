import type { LanguageModelMiddleware } from "ai";
import { scrubError } from "./scrub";
import type { AttemptRecord, SpanStatus, TraceContext } from "./types";

// Derived straight from the SDK's own middleware type (no extra import from
// @ai-sdk/provider): a span-level child record per wrapGenerate/wrapStream
// invocation, so SDK retries show up as additional AttemptRecords without
// touching SDK internals.
type WrapGenerateOptions = Parameters<
  NonNullable<LanguageModelMiddleware["wrapGenerate"]>
>[0];
type GenerateResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>
>;
type WrapStreamOptions = Parameters<
  NonNullable<LanguageModelMiddleware["wrapStream"]>
>[0];
type StreamResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer P> ? P : never;
type Usage = GenerateResult["usage"];

interface ClassifiedCallError {
  status: SpanStatus;
  errorType: string;
  errorMessage: string;
  httpStatus?: number;
}

function classifyCallError(err: unknown): ClassifiedCallError {
  const { errorType, errorMessage } = scrubError(err);
  const status: SpanStatus =
    errorType === "abort"
      ? err instanceof Error && err.name === "TimeoutError"
        ? "timeout"
        : "cancelled"
      : "error";
  const httpStatus = errorType.startsWith("http_")
    ? Number(errorType.slice("http_".length))
    : undefined;
  return { status, errorType, errorMessage, httpStatus };
}

function applyUsage(ctx: TraceContext, usage: Usage | undefined): void {
  if (!usage) {
    ctx.span.usageSource = ctx.span.usageSource ?? "missing";
    return;
  }
  ctx.span.inputTokens = usage.inputTokens?.total ?? ctx.span.inputTokens;
  ctx.span.outputTokens = usage.outputTokens?.total ?? ctx.span.outputTokens;
  ctx.span.cachedInputTokens =
    usage.inputTokens?.cacheRead ?? ctx.span.cachedInputTokens;
  ctx.span.reasoningTokens =
    usage.outputTokens?.reasoning ?? ctx.span.reasoningTokens;
  ctx.span.usageSource = "provider";
}

// One `LanguageModelMiddleware` instance per model-level call site
// (buildProvider creates a fresh one per call). TTFT is recorded at the
// first text/object delta; usage and finish reason at the 'finish' part;
// tracing failures are swallowed so they can never fail or delay the
// underlying model call.
export function createTracingMiddleware(
  ctx: TraceContext,
): LanguageModelMiddleware {
  let attemptCounter = 0;

  function recordAttempt(record: Omit<AttemptRecord, "spanId">): void {
    ctx.span.attempts = attemptCounter;
    // Same write-time liveness check as safeWrite (M1, #118): the store was
    // resolved when the model call started, so re-check it right before
    // writing instead of trusting that snapshot.
    if (ctx.store?.isActive && !ctx.store.isActive()) return;
    try {
      ctx.store?.writeAttempt({ spanId: ctx.spanId, ...record });
    } catch {
      // a tracing failure must never fail or delay a model call
    }
  }

  return {
    specificationVersion: "v3",

    async wrapGenerate({
      doGenerate,
      model,
    }: WrapGenerateOptions): Promise<GenerateResult> {
      attemptCounter += 1;
      const attempt = attemptCounter;
      const startedAt = Date.now();
      ctx.span.requestModel = ctx.span.requestModel || model.modelId;

      try {
        const result = await doGenerate();
        ctx.span.responseModel =
          result.response?.modelId ?? ctx.span.responseModel;
        ctx.span.finishReason = result.finishReason.unified;
        applyUsage(ctx, result.usage);
        recordAttempt({
          attempt,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: "ok",
          responseId: result.response?.id,
        });
        return result;
      } catch (err) {
        const classified = classifyCallError(err);
        ctx.span.status = classified.status;
        ctx.span.errorType = classified.errorType;
        ctx.span.errorMessage = classified.errorMessage;
        recordAttempt({
          attempt,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: classified.status,
          errorType: classified.errorType,
          httpStatus: classified.httpStatus,
        });
        throw err;
      }
    },

    async wrapStream({
      doStream,
      model,
      params,
    }: WrapStreamOptions): Promise<StreamResult> {
      attemptCounter += 1;
      const attempt = attemptCounter;
      const startedAt = Date.now();
      ctx.span.requestModel = ctx.span.requestModel || model.modelId;

      try {
        const result = await doStream();
        let ttftRecorded = false;
        let responseId: string | undefined;
        let recorded = false;

        // Records the attempt exactly once no matter which terminal path
        // gets there first (normal "done", a mid-stream "error" chunk, a
        // reader.read() rejection, or abort) — `recorded` guards against a
        // race between e.g. the abortSignal firing and the stream finishing
        // around the same time.
        function finishOnce(
          status: SpanStatus,
          extra?: { errorType?: string; errorMessage?: string },
        ): void {
          if (recorded) return;
          recorded = true;
          if (extra) {
            ctx.span.status = status;
            ctx.span.errorType = extra.errorType;
            ctx.span.errorMessage = extra.errorMessage;
          }
          recordAttempt({
            attempt,
            startedAt,
            durationMs: Date.now() - startedAt,
            ttftMs: ctx.span.ttftMs ?? null,
            status,
            errorType: extra?.errorType,
            responseId,
          });
        }

        function finishOnAbort(): void {
          const reason = params.abortSignal?.reason;
          const isTimeout =
            reason instanceof Error && reason.name === "TimeoutError";
          finishOnce(isTimeout ? "timeout" : "cancelled", {
            errorType: "abort",
          });
        }

        const reader = result.stream.getReader();
        // The AI SDK's own high-level stream processing does not reliably
        // call `.cancel()` on this stream when the user's abortSignal
        // fires — it can simply stop forwarding chunks downstream while
        // still draining us in the background. Listening to the signal
        // directly is the only path guaranteed to fire promptly.
        params.abortSignal?.addEventListener("abort", finishOnAbort);
        const disposeAbortListener = () =>
          params.abortSignal?.removeEventListener("abort", finishOnAbort);

        const wrapped = new ReadableStream<StreamPart>({
          async pull(controller) {
            try {
              const { done, value: chunk } = await reader.read();
              if (done) {
                disposeAbortListener();
                finishOnce("ok");
                controller.close();
                return;
              }
              if (
                !ttftRecorded &&
                (chunk.type === "text-delta" ||
                  chunk.type === "reasoning-delta" ||
                  chunk.type === "tool-input-delta")
              ) {
                ttftRecorded = true;
                ctx.span.ttftMs = Date.now() - startedAt;
              }
              if (chunk.type === "response-metadata") {
                if (chunk.modelId) ctx.span.responseModel = chunk.modelId;
                if (chunk.id) responseId = chunk.id;
              }
              if (chunk.type === "finish") {
                ctx.span.finishReason = chunk.finishReason.unified;
                applyUsage(ctx, chunk.usage);
              }
              if (chunk.type === "error") {
                const classified = classifyCallError(chunk.error);
                disposeAbortListener();
                finishOnce(classified.status, {
                  errorType: classified.errorType,
                  errorMessage: classified.errorMessage,
                });
              }
              controller.enqueue(chunk);
            } catch (err) {
              disposeAbortListener();
              const classified = classifyCallError(err);
              finishOnce(classified.status, {
                errorType: classified.errorType,
                errorMessage: classified.errorMessage,
              });
              controller.error(err);
            }
          },
          async cancel(reason) {
            disposeAbortListener();
            await reader.cancel(reason).catch(() => {});
            const isTimeout =
              reason instanceof Error && reason.name === "TimeoutError";
            finishOnce(isTimeout ? "timeout" : "cancelled", {
              errorType: "abort",
            });
          },
        });

        return { ...result, stream: wrapped };
      } catch (err) {
        const classified = classifyCallError(err);
        ctx.span.status = classified.status;
        ctx.span.errorType = classified.errorType;
        ctx.span.errorMessage = classified.errorMessage;
        recordAttempt({
          attempt,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: classified.status,
          errorType: classified.errorType,
          httpStatus: classified.httpStatus,
        });
        throw err;
      }
    },
  };
}

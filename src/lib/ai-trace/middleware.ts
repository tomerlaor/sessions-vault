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
    }: WrapStreamOptions): Promise<StreamResult> {
      attemptCounter += 1;
      const attempt = attemptCounter;
      const startedAt = Date.now();
      ctx.span.requestModel = ctx.span.requestModel || model.modelId;

      try {
        const result = await doStream();
        let ttftRecorded = false;
        let responseId: string | undefined;
        let streamError: ClassifiedCallError | null = null;

        const transform = new TransformStream<StreamPart, StreamPart>({
          transform(chunk, controller) {
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
              streamError = classifyCallError(chunk.error);
              ctx.span.status = streamError.status;
              ctx.span.errorType = streamError.errorType;
              ctx.span.errorMessage = streamError.errorMessage;
            }
            controller.enqueue(chunk);
          },
          flush() {
            recordAttempt({
              attempt,
              startedAt,
              durationMs: Date.now() - startedAt,
              ttftMs: ctx.span.ttftMs ?? null,
              status: streamError?.status ?? "ok",
              errorType: streamError?.errorType,
              responseId,
            });
          },
        });

        return { ...result, stream: result.stream.pipeThrough(transform) };
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

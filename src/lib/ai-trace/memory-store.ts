import type { AttemptRecord, SpanRecord, TraceStore } from "./types";

// In-memory TraceStore for tests (and any in-process consumer). There is no
// on-disk default store in this PR — persistence is T2's job.
export class MemoryTraceStore implements TraceStore {
  readonly spans: SpanRecord[] = [];
  readonly attempts: AttemptRecord[] = [];

  write(span: SpanRecord): void {
    this.spans.push(span);
  }

  writeAttempt(attempt: AttemptRecord): void {
    this.attempts.push(attempt);
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

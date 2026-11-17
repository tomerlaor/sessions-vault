// Request-lifecycle helpers for the lyrics AI overlay: debouncing, abort +
// timeout handling, a small result cache, and the skip-decision logic that
// keeps a keystroke from firing a wasted or duplicate AI call. Kept free of
// React and DB imports so it can be unit tested in plain Node.
import type { AIConfig, LyricSuggestionMode } from "../types";
import {
  streamLyricsSuggestion,
  generateNextWordOptions,
  generatePopupSuggestions,
  nextWordOptionsSchema,
  popupSuggestionsSchema,
} from "./ai";
import { z } from "zod";

// ── Abort + timeout ──────────────────────────────────────────────────────────

// Combines a parent AbortSignal with a timeout into a single signal, without
// relying on AbortSignal.any/AbortSignal.timeout (not in this project's DOM
// lib typings). `clearTimeout()` cancels just the timeout (e.g. once a first
// token arrives, so the rest of the stream isn't still bound by that
// window) while the parent-abort relay stays live for the whole operation.
// `dispose()` tears both down — call it once the operation is fully done to
// avoid leaking the parent listener.
export function withTimeoutSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; clearTimeout: () => void; dispose: () => void } {
  const controller = new AbortController();

  if (parent?.aborted) {
    controller.abort();
    return {
      signal: controller.signal,
      clearTimeout: () => {},
      dispose: () => {},
    };
  }

  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort);

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  const clearTimeoutFn = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const dispose = () => {
    clearTimeoutFn();
    parent?.removeEventListener("abort", onParentAbort);
  };

  return { signal: controller.signal, clearTimeout: clearTimeoutFn, dispose };
}

// ── LRU cache ────────────────────────────────────────────────────────────────

export class LruCache<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency: delete + re-insert moves it to the end of Map's
    // iteration order, which is what makes `.keys().next()` the LRU entry.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// FNV-1a — fast, deterministic, and plenty collision-resistant for a 50-entry
// in-memory cache (not a security boundary).
export function hashRequestKey(
  mode: string,
  system: string,
  prompt: string,
): string {
  const input = `${mode}\u0000${system}\u0000${prompt}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// ── Debounce ─────────────────────────────────────────────────────────────────

export interface Debouncer {
  schedule(fn: () => void): void;
  cancel(): void;
}

export function createDebouncer(delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(fn) {
      clearTimeout(timer);
      timer = setTimeout(fn, delayMs);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

// ── Skip decisions ───────────────────────────────────────────────────────────

export interface RunSignature {
  mode: LyricSuggestionMode | null;
  currentLine: string;
  draft: string;
}

export function sameRunSignature(
  a: RunSignature | null,
  b: RunSignature,
): boolean {
  return (
    a !== null &&
    a.mode === b.mode &&
    a.currentLine === b.currentLine &&
    a.draft === b.draft
  );
}

export function isBlankContext(text: string): boolean {
  return text.trim().length === 0;
}

// Single gate a debounced run passes through before any AI call is made:
// no mode resolved, empty/whitespace-only context, or nothing meaningful
// changed since the last completed request (including a pure cursor move,
// or an autosave reload that only changed object identity).
export function shouldRunRequest(
  last: RunSignature | null,
  next: RunSignature,
): boolean {
  if (next.mode === null) return false;
  if (isBlankContext(next.draft)) return false;
  if (sameRunSignature(last, next)) return false;
  return true;
}

// ── Cached, abortable requests to the AI layer ──────────────────────────────

type RequestOutcome<T> = { status: "ok"; value: T } | { status: "aborted" };

const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 5000;
const DEFAULT_OBJECT_TIMEOUT_MS = 8000;

export interface StreamRequestParams {
  aiConfig: AIConfig;
  cacheMode: string; // e.g. the suggestion mode — part of the cache key
  system: string;
  prompt: string;
  signal?: AbortSignal;
  cache: LruCache<string, string>;
  firstTokenTimeoutMs?: number;
  onToken: (accumulated: string) => void;
}

// Streams an inline suggestion. Enforces a first-token timeout (the rest of
// the stream is unbounded once it starts) and serves straight from cache
// when (mode, system, prompt) was seen before — no AI call in that case.
export async function requestStreamSuggestion(
  params: StreamRequestParams,
): Promise<RequestOutcome<string>> {
  const key = hashRequestKey(params.cacheMode, params.system, params.prompt);
  const cached = params.cache.get(key);
  if (cached !== undefined) {
    params.onToken(cached);
    return { status: "ok", value: cached };
  }

  const {
    signal,
    clearTimeout: clearFirstTokenTimeout,
    dispose,
  } = withTimeoutSignal(
    params.signal,
    params.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  );
  let accumulated = "";
  let gotFirstToken = false;
  try {
    for await (const chunk of streamLyricsSuggestion(
      params.aiConfig,
      params.system,
      params.prompt,
      signal,
    )) {
      if (!gotFirstToken) {
        gotFirstToken = true;
        // Only the first-token timeout is lifted — the parent-abort relay
        // (new keystroke, unmount) must keep working for the rest of the
        // stream.
        clearFirstTokenTimeout();
      }
      accumulated += chunk;
      params.onToken(accumulated);
    }
    params.cache.set(key, accumulated);
    return { status: "ok", value: accumulated };
  } catch (err) {
    if (signal.aborted) return { status: "aborted" };
    throw err;
  } finally {
    dispose();
  }
}

export interface ObjectRequestParams<T> {
  aiConfig: AIConfig;
  cacheMode: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  cache: LruCache<string, T>;
  timeoutMs?: number;
  call: (
    cfg: AIConfig,
    system: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<T>;
}

async function requestCachedObject<T>(
  params: ObjectRequestParams<T>,
): Promise<RequestOutcome<T>> {
  const key = hashRequestKey(params.cacheMode, params.system, params.prompt);
  const cached = params.cache.get(key);
  if (cached !== undefined) return { status: "ok", value: cached };

  const { signal, dispose } = withTimeoutSignal(
    params.signal,
    params.timeoutMs ?? DEFAULT_OBJECT_TIMEOUT_MS,
  );
  try {
    const value = await params.call(
      params.aiConfig,
      params.system,
      params.prompt,
      signal,
    );
    params.cache.set(key, value);
    return { status: "ok", value };
  } catch (err) {
    if (signal.aborted) return { status: "aborted" };
    throw err;
  } finally {
    dispose();
  }
}

export type NextWordOptionsResult = z.infer<typeof nextWordOptionsSchema>;
export type PopupSuggestionsResult = z.infer<typeof popupSuggestionsSchema>;

export function requestNextWordOptions(params: {
  aiConfig: AIConfig;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  cache: LruCache<string, NextWordOptionsResult>;
  timeoutMs?: number;
}): Promise<RequestOutcome<NextWordOptionsResult>> {
  return requestCachedObject({
    ...params,
    cacheMode: "next_word",
    call: generateNextWordOptions,
  });
}

export function requestPopupSuggestions(params: {
  aiConfig: AIConfig;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  cache: LruCache<string, PopupSuggestionsResult>;
  timeoutMs?: number;
}): Promise<RequestOutcome<PopupSuggestionsResult>> {
  return requestCachedObject({
    ...params,
    cacheMode: "popup",
    call: generatePopupSuggestions,
  });
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  streamLyricsSuggestionMock,
  generateNextWordOptionsMock,
  generatePopupSuggestionsMock,
} = vi.hoisted(() => ({
  streamLyricsSuggestionMock: vi.fn(),
  generateNextWordOptionsMock: vi.fn(),
  generatePopupSuggestionsMock: vi.fn(),
}));

vi.mock("../src/lib/ai", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/ai")>("../src/lib/ai");
  return {
    ...actual,
    streamLyricsSuggestion: streamLyricsSuggestionMock,
    generateNextWordOptions: generateNextWordOptionsMock,
    generatePopupSuggestions: generatePopupSuggestionsMock,
  };
});

import {
  LruCache,
  createDebouncer,
  shouldRunRequest,
  sameRunSignature,
  isBlankContext,
  hashRequestKey,
  withTimeoutSignal,
  requestStreamSuggestion,
  requestNextWordOptions,
  requestPopupSuggestions,
  type RunSignature,
} from "../src/lib/lyrics-ai-request";
import type { AIConfig } from "../src/types";

const cfg: AIConfig = {
  provider: "openai",
  apiKey: "test-key",
  baseUrl: "",
  model: "gpt-4.1-mini",
};

beforeEach(() => {
  streamLyricsSuggestionMock.mockReset();
  generateNextWordOptionsMock.mockReset();
  generatePopupSuggestionsMock.mockReset();
});

// ── Debounce ─────────────────────────────────────────────────────────────────

describe("createDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("typing continuously then pausing once produces exactly one request", () => {
    const fn = vi.fn();
    const debouncer = createDebouncer(800);

    // Simulate keystrokes: each one reschedules before the previous fires.
    for (let i = 0; i < 5; i++) {
      debouncer.schedule(fn);
      vi.advanceTimersByTime(200);
    }
    expect(fn).not.toHaveBeenCalled();

    // The pause: no further keystrokes, let the debounce elapse.
    vi.advanceTimersByTime(800);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel discards a pending run", () => {
    const fn = vi.fn();
    const debouncer = createDebouncer(800);
    debouncer.schedule(fn);
    debouncer.cancel();
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── Skip decisions ───────────────────────────────────────────────────────────

describe("shouldRunRequest", () => {
  const sig = (over: Partial<RunSignature> = {}): RunSignature => ({
    mode: "completion",
    currentLine: "hello wor",
    draft: "hello wor",
    ...over,
  });

  it("allows the first run (no prior signature)", () => {
    expect(shouldRunRequest(null, sig())).toBe(true);
  });

  it("allows a run when something actually changed", () => {
    const last = sig();
    const next = sig({ draft: "hello world" });
    expect(shouldRunRequest(last, next)).toBe(true);
  });

  it("skips when mode could not be determined", () => {
    expect(shouldRunRequest(null, sig({ mode: null }))).toBe(false);
  });

  it("skips empty or whitespace-only context", () => {
    expect(shouldRunRequest(null, sig({ draft: "" }))).toBe(false);
    expect(shouldRunRequest(null, sig({ draft: "   \n  " }))).toBe(false);
  });

  it("skips a pure cursor move that doesn't change mode or line", () => {
    // Selection start/end aren't part of the signature at all — a cursor
    // move within the same line produces an identical signature.
    const last = sig();
    const next = sig(); // same mode/currentLine/draft, different "selection"
    expect(sameRunSignature(last, next)).toBe(true);
    expect(shouldRunRequest(last, next)).toBe(false);
  });

  it("skips an autosave reload that only changes project object identity", () => {
    // The project fields (title/bpm/key/etc.) aren't part of the run
    // signature either, so a new project object with the same lyrics-
    // relevant content produces an identical signature.
    const projectA = { id: "p1", title: "Song", bpm: 120 };
    const projectB = { ...projectA }; // new object, same values — like autosave
    expect(projectA).not.toBe(projectB);

    const last = sig();
    const next = sig(); // draft/mode/currentLine unaffected by project identity
    expect(shouldRunRequest(last, next)).toBe(false);
  });
});

describe("isBlankContext", () => {
  it("is true for empty and whitespace-only text", () => {
    expect(isBlankContext("")).toBe(true);
    expect(isBlankContext("   \n\t  ")).toBe(true);
  });

  it("is false once there is real content", () => {
    expect(isBlankContext("hello")).toBe(false);
  });
});

// ── LRU cache ────────────────────────────────────────────────────────────────

describe("LruCache", () => {
  it("returns cached values and evicts the least recently used entry past max", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a" (least recently used)
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("touching a key via get refreshes its recency", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" is now more recently used than "b"
    cache.set("c", 3); // evicts "b", not "a"
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("hashRequestKey", () => {
  it("is deterministic for identical inputs", () => {
    expect(hashRequestKey("completion", "sys", "prompt")).toBe(
      hashRequestKey("completion", "sys", "prompt"),
    );
  });

  it("differs when mode, system, or prompt differ", () => {
    const base = hashRequestKey("completion", "sys", "prompt");
    expect(hashRequestKey("next_line", "sys", "prompt")).not.toBe(base);
    expect(hashRequestKey("completion", "sys2", "prompt")).not.toBe(base);
    expect(hashRequestKey("completion", "sys", "prompt2")).not.toBe(base);
  });
});

// ── withTimeoutSignal ────────────────────────────────────────────────────────

describe("withTimeoutSignal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts after the timeout elapses", () => {
    const { signal } = withTimeoutSignal(undefined, 5000);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(signal.aborted).toBe(true);
  });

  it("clearTimeout() prevents the timeout from firing", () => {
    const { signal, clearTimeout: clearTimeoutFn } = withTimeoutSignal(
      undefined,
      5000,
    );
    clearTimeoutFn();
    vi.advanceTimersByTime(10000);
    expect(signal.aborted).toBe(false);
  });

  it("dispose() also prevents the timeout from firing", () => {
    const { signal, dispose } = withTimeoutSignal(undefined, 5000);
    dispose();
    vi.advanceTimersByTime(10000);
    expect(signal.aborted).toBe(false);
  });

  it("propagates abort from the parent signal immediately", () => {
    const parent = new AbortController();
    const { signal } = withTimeoutSignal(parent.signal, 5000);
    parent.abort();
    expect(signal.aborted).toBe(true);
  });
});

// ── requestStreamSuggestion ──────────────────────────────────────────────────

describe("requestStreamSuggestion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("streams tokens and caches the accumulated text", async () => {
    streamLyricsSuggestionMock.mockImplementation(async function* () {
      yield "hel";
      yield "lo";
    });
    const cache = new LruCache<string, string>(50);
    const tokens: string[] = [];

    const result = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: (acc) => tokens.push(acc),
    });

    expect(result).toEqual({ status: "ok", value: "hello" });
    expect(tokens).toEqual(["hel", "hello"]);
    expect(streamLyricsSuggestionMock).toHaveBeenCalledTimes(1);
  });

  it("serves a second identical request from cache without calling the AI", async () => {
    streamLyricsSuggestionMock.mockImplementation(async function* () {
      yield "hello";
    });
    const cache = new LruCache<string, string>(50);

    await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: () => {},
    });
    expect(streamLyricsSuggestionMock).toHaveBeenCalledTimes(1);

    const tokens: string[] = [];
    const second = await requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: (acc) => tokens.push(acc),
    });

    expect(second).toEqual({ status: "ok", value: "hello" });
    expect(tokens).toEqual(["hello"]);
    // Still only the one call from before — the second request never hit the AI.
    expect(streamLyricsSuggestionMock).toHaveBeenCalledTimes(1);
  });

  // Simulates how the real AI SDK call behaves: it rejects with an
  // AbortError once the signal it was given fires, rather than ignoring it.
  function rejectOnAbort(signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
      const fail = () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal.aborted) fail();
      else signal.addEventListener("abort", fail);
    });
  }

  it("aborts and reports status 'aborted' when no first token arrives within 5s", async () => {
    let capturedSignal: AbortSignal | undefined;
    streamLyricsSuggestionMock.mockImplementation(async function* (
      _cfg: AIConfig,
      _system: string,
      _prompt: string,
      signal: AbortSignal,
    ) {
      capturedSignal = signal;
      await rejectOnAbort(signal);
      yield "too late";
    });
    const cache = new LruCache<string, string>(50);

    const promise = requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "prompt",
      cache,
      onToken: () => {},
    });

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual({ status: "aborted" });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("aborts when the caller's parent signal is aborted mid-stream (after the first token)", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    streamLyricsSuggestionMock.mockImplementation(async function* (
      _cfg: AIConfig,
      _system: string,
      _prompt: string,
      signal: AbortSignal,
    ) {
      capturedSignal = signal;
      yield "first";
      await rejectOnAbort(signal);
      yield "second";
    });
    const cache = new LruCache<string, string>(50);

    const promise = requestStreamSuggestion({
      aiConfig: cfg,
      cacheMode: "completion",
      system: "sys",
      prompt: "prompt",
      signal: controller.signal,
      cache,
      onToken: () => {},
    });

    // Let the first token flow through, then simulate a new keystroke /
    // unmount aborting the request well within the first-token window.
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const result = await promise;

    expect(result).toEqual({ status: "aborted" });
    expect(capturedSignal?.aborted).toBe(true);
  });
});

// ── requestNextWordOptions / requestPopupSuggestions (8s object timeout) ─────

describe("requestNextWordOptions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the result and caches it", async () => {
    generateNextWordOptionsMock.mockResolvedValue({
      options: [{ text: "world", kind: "continuation" }],
    });
    const cache = new LruCache<
      string,
      Awaited<ReturnType<typeof generateNextWordOptionsMock>>
    >(50);

    const result = await requestNextWordOptions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });

    expect(result.status).toBe("ok");
    expect(generateNextWordOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("serves identical requests from cache without calling the AI again", async () => {
    generateNextWordOptionsMock.mockResolvedValue({
      options: [{ text: "world", kind: "continuation" }],
    });
    const cache = new LruCache<
      string,
      Awaited<ReturnType<typeof generateNextWordOptionsMock>>
    >(50);

    await requestNextWordOptions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });
    await requestNextWordOptions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });

    expect(generateNextWordOptionsMock).toHaveBeenCalledTimes(1);
  });

  it("aborts after the 8s overall timeout and reports status 'aborted'", async () => {
    let capturedSignal: AbortSignal | undefined;
    generateNextWordOptionsMock.mockImplementation(
      (
        _cfg: AIConfig,
        _system: string,
        _prompt: string,
        signal: AbortSignal,
      ) => {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    );
    const cache = new LruCache<string, unknown>(50);

    const promise = requestNextWordOptions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });

    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;

    expect(result).toEqual({ status: "aborted" });
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe("requestPopupSuggestions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts after the 8s overall timeout and reports status 'aborted'", async () => {
    let capturedSignal: AbortSignal | undefined;
    generatePopupSuggestionsMock.mockImplementation(
      (
        _cfg: AIConfig,
        _system: string,
        _prompt: string,
        signal: AbortSignal,
      ) => {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    );
    const cache = new LruCache<string, unknown>(50);

    const promise = requestPopupSuggestions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });

    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;

    expect(result).toEqual({ status: "aborted" });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("serves identical requests from cache without calling the AI again", async () => {
    generatePopupSuggestionsMock.mockResolvedValue({
      suggestions: [{ mode: "completion", text: "world" }],
    });
    const cache = new LruCache<
      string,
      Awaited<ReturnType<typeof generatePopupSuggestionsMock>>
    >(50);

    await requestPopupSuggestions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });
    await requestPopupSuggestions({
      aiConfig: cfg,
      system: "sys",
      prompt: "prompt",
      cache,
    });

    expect(generatePopupSuggestionsMock).toHaveBeenCalledTimes(1);
  });
});

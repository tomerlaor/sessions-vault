import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getAiActivityConfigMock, setAiActivityConfigMock } = vi.hoisted(() => ({
  getAiActivityConfigMock: vi.fn(),
  setAiActivityConfigMock: vi.fn(),
}));

vi.mock("../src/db/queries/ai-trace", () => ({
  getAiActivityConfig: getAiActivityConfigMock,
  setAiActivityConfig: setAiActivityConfigMock,
}));

const { getTraceDbMock, getInstallSaltMock } = vi.hoisted(() => ({
  getTraceDbMock: vi.fn(),
  getInstallSaltMock: vi.fn(),
}));

vi.mock("../src/db/trace-client", () => ({
  getTraceDb: getTraceDbMock,
  getInstallSalt: getInstallSaltMock,
}));

import {
  getActiveTraceStore,
  clearAiActivityLog,
  setKeepAiActivityLog,
  resetTraceRuntimeForTests,
} from "../src/lib/ai-trace/runtime";

function makeFakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    db: {
      async execute(sql: string, params: unknown[]) {
        calls.push({ sql, params });
      },
      async select() {
        return [] as never;
      },
    },
  };
}

beforeEach(() => {
  getAiActivityConfigMock.mockReset();
  setAiActivityConfigMock.mockReset();
  getTraceDbMock.mockReset();
  getInstallSaltMock.mockReset();
  resetTraceRuntimeForTests();
});

afterEach(() => {
  resetTraceRuntimeForTests();
});

describe("getActiveTraceStore", () => {
  it("returns nothing (off by default) — no store, no salt, no hash input", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: false });
    const result = await getActiveTraceStore();
    expect(result.store).toBeUndefined();
    expect(result.salt).toBeUndefined();
    expect(getTraceDbMock).not.toHaveBeenCalled();
    expect(getInstallSaltMock).not.toHaveBeenCalled();
  });

  it("hands out a store and salt once the setting is enabled", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: true });
    const { db } = makeFakeDb();
    getTraceDbMock.mockResolvedValue(db);
    getInstallSaltMock.mockResolvedValue("test-salt");

    const result = await getActiveTraceStore();
    expect(result.store).toBeDefined();
    expect(result.salt).toBe("test-salt");
  });

  it("re-reads the setting on every call, so toggling takes effect on the next call", async () => {
    getAiActivityConfigMock.mockResolvedValueOnce({ keepAiActivityLog: false });
    expect((await getActiveTraceStore()).store).toBeUndefined();

    getAiActivityConfigMock.mockResolvedValueOnce({ keepAiActivityLog: true });
    getTraceDbMock.mockResolvedValue(makeFakeDb().db);
    getInstallSaltMock.mockResolvedValue("salt-2");
    expect((await getActiveTraceStore()).store).toBeDefined();
  });
});

describe("setKeepAiActivityLog", () => {
  it("persists the setting", async () => {
    getTraceDbMock.mockResolvedValue(makeFakeDb().db);
    await setKeepAiActivityLog(true);
    expect(setAiActivityConfigMock).toHaveBeenCalledWith({
      keepAiActivityLog: true,
    });
  });

  it("deletes all trace rows when turned off, keeping ai_trace_meta", async () => {
    const { db, calls } = makeFakeDb();
    getTraceDbMock.mockResolvedValue(db);

    await setKeepAiActivityLog(false);

    expect(setAiActivityConfigMock).toHaveBeenCalledWith({
      keepAiActivityLog: false,
    });
    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_attempts")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_outcomes")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_payloads")).toBe(true);
    expect(calls.some((c) => c.sql.includes("ai_trace_meta"))).toBe(false);
  });
});

describe("clearAiActivityLog", () => {
  it("clears rows via the same store call sites use, even if logging is currently off", async () => {
    const { db, calls } = makeFakeDb();
    getTraceDbMock.mockResolvedValue(db);

    await clearAiActivityLog();

    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
  });
});

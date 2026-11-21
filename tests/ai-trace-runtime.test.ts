import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getAiActivityConfigMock, setAiActivityConfigMock } = vi.hoisted(() => ({
  getAiActivityConfigMock: vi.fn(),
  setAiActivityConfigMock: vi.fn(),
}));

vi.mock("../src/db/queries/ai-trace", () => ({
  getAiActivityConfig: getAiActivityConfigMock,
  setAiActivityConfig: setAiActivityConfigMock,
}));

const { getTraceDbMock, getInstallSaltMock, rotateInstallSaltMock } =
  vi.hoisted(() => ({
    getTraceDbMock: vi.fn(),
    getInstallSaltMock: vi.fn(),
    rotateInstallSaltMock: vi.fn(),
  }));

vi.mock("../src/db/trace-client", () => ({
  getTraceDb: getTraceDbMock,
  getInstallSalt: getInstallSaltMock,
  rotateInstallSalt: rotateInstallSaltMock,
}));

import {
  getActiveTraceStore,
  clearAiActivityLog,
  getAiActivityLogCount,
  setKeepAiActivityLog,
  pruneAiActivityLogIfEnabled,
  resetTraceRuntimeForTests,
} from "../src/lib/ai-trace/runtime";

function makeFakeDb(selectResult: unknown[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    db: {
      async execute(sql: string, params: unknown[]) {
        calls.push({ sql, params });
      },
      async select() {
        return selectResult as never;
      },
    },
  };
}

beforeEach(() => {
  getAiActivityConfigMock.mockReset();
  setAiActivityConfigMock.mockReset();
  getTraceDbMock.mockReset();
  getInstallSaltMock.mockReset();
  rotateInstallSaltMock.mockReset();
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

  it("never throws — a settings-read failure returns no store/salt instead of breaking the caller (item 3, #118)", async () => {
    getAiActivityConfigMock.mockRejectedValue(new Error("db locked"));
    const result = await getActiveTraceStore();
    expect(result).toEqual({});
  });

  it("never throws — a trace-DB-open failure (setting is on) returns no store/salt (item 3, #118)", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: true });
    getInstallSaltMock.mockRejectedValue(new Error("disk full"));

    const result = await getActiveTraceStore();
    expect(result).toEqual({});
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

  it("deletes all trace rows when turned off (setting was previously on), keeping ai_trace_meta, and rotates install_salt (L2, #118)", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: true });
    const { db, calls } = makeFakeDb();
    getTraceDbMock.mockResolvedValue(db);

    await setKeepAiActivityLog(false);

    expect(setAiActivityConfigMock).toHaveBeenCalledWith({
      keepAiActivityLog: false,
    });
    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_attempts")).toBe(true);
    expect(calls.some((c) => c.sql === "DELETE FROM ai_outcomes")).toBe(true);
    expect(calls.some((c) => c.sql.includes("ai_trace_meta"))).toBe(false);
    expect(rotateInstallSaltMock).toHaveBeenCalled();
  });

  it("never opens ai-traces.db when turning off a setting that was already off and never touched this session (nit, #118)", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: false });

    await setKeepAiActivityLog(false);

    expect(getTraceDbMock).not.toHaveBeenCalled();
    expect(rotateInstallSaltMock).not.toHaveBeenCalled();
  });

  it("still clears when the setting was already off but this session already touched the store (nit, #118)", async () => {
    // e.g. the user turned it on, an AI call ran (opening the DB), then
    // turned it off and on again in the same session before this call.
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: true });
    const { db, calls } = makeFakeDb();
    getTraceDbMock.mockResolvedValue(db);
    getInstallSaltMock.mockResolvedValue("salt");
    await getActiveTraceStore(); // touches the store this session

    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: false });
    calls.length = 0;
    await setKeepAiActivityLog(false);

    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
  });
});

describe("pruneAiActivityLogIfEnabled (nit, #118)", () => {
  it("does nothing while the setting is off", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: false });

    await pruneAiActivityLogIfEnabled();

    expect(getTraceDbMock).not.toHaveBeenCalled();
  });

  it("prunes once when the setting is on", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: true });
    const { db, calls } = makeFakeDb([{ span_id: "old-span" }]);
    getTraceDbMock.mockResolvedValue(db);

    await pruneAiActivityLogIfEnabled();

    expect(calls.some((c) => c.sql.includes("DELETE FROM ai_spans"))).toBe(
      true,
    );
  });

  it("never throws, even if the settings read fails", async () => {
    getAiActivityConfigMock.mockRejectedValue(new Error("db locked"));
    await expect(pruneAiActivityLogIfEnabled()).resolves.toBeUndefined();
  });
});

describe("clearAiActivityLog", () => {
  it("clears rows via the same store call sites use, even if logging is currently off, and rotates install_salt (L2, #118)", async () => {
    const { db, calls } = makeFakeDb();
    getTraceDbMock.mockResolvedValue(db);

    await clearAiActivityLog();

    expect(calls.some((c) => c.sql === "DELETE FROM ai_spans")).toBe(true);
    expect(rotateInstallSaltMock).toHaveBeenCalled();
  });
});

describe("getAiActivityLogCount", () => {
  it("returns 0 without touching the trace DB while the setting is off", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: false });

    const count = await getAiActivityLogCount();

    expect(count).toBe(0);
    expect(getTraceDbMock).not.toHaveBeenCalled();
  });

  it("returns the ai_spans row count once the setting is on", async () => {
    getAiActivityConfigMock.mockResolvedValue({ keepAiActivityLog: true });
    const { db } = makeFakeDb([{ c: 7 }]);
    getTraceDbMock.mockResolvedValue(db);

    expect(await getAiActivityLogCount()).toBe(7);
  });
});

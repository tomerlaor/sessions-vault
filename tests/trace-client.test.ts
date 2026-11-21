import { describe, it, expect, vi, beforeEach } from "vitest";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: loadMock },
}));

import { getTraceDb, resetTraceDbForTests } from "../src/db/trace-client";

function makeFakeRaw() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    raw: {
      async execute(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        return { rowsAffected: 0 };
      },
      async select() {
        return [] as never;
      },
    },
  };
}

beforeEach(() => {
  loadMock.mockReset();
  resetTraceDbForTests();
});

describe("getTraceDb (item 5 nit: memoized pending load, #118)", () => {
  it("calls Database.load exactly once under concurrent first callers", async () => {
    const { raw } = makeFakeRaw();
    let resolveLoad!: (db: unknown) => void;
    loadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const p1 = getTraceDb();
    const p2 = getTraceDb();
    const p3 = getTraceDb();
    resolveLoad(raw);

    const [db1, db2, db3] = await Promise.all([p1, p2, p3]);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(db1).toBe(db2);
    expect(db2).toBe(db3);
  });

  it("retries on the next call after a failed load, instead of replaying the rejection forever", async () => {
    loadMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(getTraceDb()).rejects.toThrow("disk full");

    const { raw } = makeFakeRaw();
    loadMock.mockResolvedValueOnce(raw);
    await expect(getTraceDb()).resolves.toBeDefined();
    expect(loadMock).toHaveBeenCalledTimes(2);
  });

  it("runs secure_delete=ON as part of loading the DB", async () => {
    const { raw, calls } = makeFakeRaw();
    loadMock.mockResolvedValue(raw);

    await getTraceDb();

    expect(calls.some((c) => c.sql === "PRAGMA secure_delete=ON")).toBe(true);
  });
});

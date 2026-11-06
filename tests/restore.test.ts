import { describe, it, expect } from "vitest";
import {
  defaultRestoreTarget,
  groupRestoreFilesByStatus,
  isLocalDestination,
  summarizeRestore,
  summarizeVerify,
} from "../src/lib/restore";
import type { RestoredFile, RestoreOutcome, VerifyReport } from "../src/types";

function restoredFile(overrides: Partial<RestoredFile>): RestoredFile {
  return {
    archivePath: "stages/export/song.wav",
    restoredPath: "/restored/song.wav",
    stage: "export",
    versionLabel: "v1",
    isFinal: false,
    status: "ok",
    detail: null,
    ...overrides,
  };
}

describe("defaultRestoreTarget", () => {
  it("builds a sibling folder next to a posix original path", () => {
    const target = defaultRestoreTarget(
      "/Users/me/Music/Song/song.als",
      "Song",
      1_793_000_000,
    );
    expect(target).toMatch(
      /^\/Users\/me\/Music\/Song\/Song restored \d{4}-\d{2}-\d{2} \d{4}$/,
    );
  });

  it("builds a sibling folder next to a windows-style original path", () => {
    const target = defaultRestoreTarget(
      "C:\\Music\\Song\\song.als",
      "Song",
      1_793_000_000,
    );
    expect(target).toMatch(
      /^C:\\Music\\Song\\Song restored \d{4}-\d{2}-\d{2} \d{4}$/,
    );
  });

  it("is deterministic for the same timestamp", () => {
    const a = defaultRestoreTarget("/a/song.als", "Song", 1_793_000_000);
    const b = defaultRestoreTarget("/a/song.als", "Song", 1_793_000_000);
    expect(a).toBe(b);
  });

  it("sanitizes path-breaking characters in the title", () => {
    const target = defaultRestoreTarget(
      "/a/song.als",
      "Song: Part/2?",
      1_793_000_000,
    );
    expect(target).not.toContain(":");
    expect(target.split("/").length).toBe(3); // /a/<folder>, no extra segments
  });

  it("falls back to a bare folder name when the original path has no directory", () => {
    const target = defaultRestoreTarget("song.als", "Song", 1_793_000_000);
    expect(target.startsWith("/")).toBe(false);
    expect(target).toMatch(/^Song restored /);
  });
});

describe("isLocalDestination", () => {
  it("is true for a posix path", () => {
    expect(isLocalDestination("/Users/me/Backups/song.zip")).toBe(true);
  });

  it("is true for a windows path", () => {
    expect(isLocalDestination("C:\\Backups\\song.zip")).toBe(true);
  });

  it("is false for a bare drive file id", () => {
    expect(isLocalDestination("1A2b3C4d5E6f7G8h9I0j")).toBe(false);
  });
});

describe("summarizeVerify", () => {
  function report(overrides: Partial<VerifyReport>): VerifyReport {
    return {
      okCount: 0,
      missingCount: 0,
      corruptCount: 0,
      files: [],
      ...overrides,
    };
  }

  it("reports all-ok as a single count", () => {
    expect(summarizeVerify(report({ okCount: 5 }))).toBe(
      "All 5 files verified ok",
    );
  });

  it("uses singular wording for exactly one file", () => {
    expect(summarizeVerify(report({ okCount: 1 }))).toBe(
      "All 1 file verified ok",
    );
  });

  it("lists missing and corrupt counts alongside ok", () => {
    expect(
      summarizeVerify(report({ okCount: 3, missingCount: 1, corruptCount: 2 })),
    ).toBe("3 ok, 1 missing, 2 corrupt");
  });

  it("omits a zero count from the breakdown", () => {
    expect(summarizeVerify(report({ okCount: 3, corruptCount: 1 }))).toBe(
      "3 ok, 1 corrupt",
    );
  });
});

describe("summarizeRestore", () => {
  function outcome(overrides: Partial<RestoreOutcome>): RestoreOutcome {
    return {
      restoredTo: "/restored",
      okCount: 0,
      mismatchCount: 0,
      conflictCount: 0,
      rejectedCount: 0,
      files: [],
      ...overrides,
    };
  }

  it("reports all-ok as a single count", () => {
    expect(summarizeRestore(outcome({ okCount: 4 }))).toBe(
      "Restored 4 files ok",
    );
  });

  it("uses singular wording for exactly one file", () => {
    expect(summarizeRestore(outcome({ okCount: 1 }))).toBe(
      "Restored 1 file ok",
    );
  });

  it("lists every non-zero breakdown", () => {
    expect(
      summarizeRestore(
        outcome({
          okCount: 2,
          mismatchCount: 1,
          conflictCount: 3,
          rejectedCount: 1,
        }),
      ),
    ).toBe("2 ok, 1 mismatch, 3 conflict, 1 rejected");
  });
});

describe("groupRestoreFilesByStatus", () => {
  it("buckets files by status", () => {
    const files = [
      restoredFile({ archivePath: "a", status: "ok" }),
      restoredFile({ archivePath: "b", status: "conflict" }),
      restoredFile({ archivePath: "c", status: "ok" }),
    ];
    const groups = groupRestoreFilesByStatus(files);
    expect(groups.ok?.map((f) => f.archivePath)).toEqual(["a", "c"]);
    expect(groups.conflict?.map((f) => f.archivePath)).toEqual(["b"]);
  });

  it("omits statuses with no files", () => {
    const groups = groupRestoreFilesByStatus([restoredFile({ status: "ok" })]);
    expect(groups.mismatch).toBeUndefined();
    expect(groups.rejected).toBeUndefined();
  });

  it("returns an empty object for no files", () => {
    expect(groupRestoreFilesByStatus([])).toEqual({});
  });
});

import { describe, it, expect } from "vitest";
import {
  stageKey,
  groupFilesByStage,
  defaultStageSelection,
  resolveStageSelection,
  parseMissing,
  toStageFileInput,
} from "../src/lib/backup-stages";
import type { ProjectFile, StageGroup } from "../src/types";

function file(overrides: Partial<ProjectFile>): ProjectFile {
  return {
    id: "f1",
    projectId: "p1",
    kind: "export",
    exportType: "mix",
    filePath: "/song/mix.wav",
    fileName: "mix.wav",
    sizeBytes: 1000,
    versionLabel: "v1",
    fileDate: 0,
    isFinal: false,
    linkedProjectId: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    durationSecs: null,
    peakDb: null,
    clipped: false,
    lossy: false,
    mediaMissingCount: null,
    mediaExternalCount: null,
    note: null,
    createdAt: 0,
    ...overrides,
  };
}

describe("stageKey", () => {
  it("uses the kind directly for mix/master projects", () => {
    expect(stageKey({ kind: "mix_project", exportType: null })).toBe(
      "mix_project",
    );
    expect(stageKey({ kind: "master_project", exportType: null })).toBe(
      "master_project",
    );
  });

  it("splits exports by export type", () => {
    expect(stageKey({ kind: "export", exportType: "stems" })).toBe(
      "export:stems",
    );
  });

  it("defaults a null export type to mix", () => {
    expect(stageKey({ kind: "export", exportType: null })).toBe("export:mix");
  });
});

describe("groupFilesByStage", () => {
  it("collapses mix_project and master_project rows into one group each", () => {
    const files = [
      file({ id: "a", kind: "mix_project", exportType: null, sizeBytes: 100 }),
      file({ id: "b", kind: "mix_project", exportType: null, sizeBytes: 200 }),
      file({
        id: "c",
        kind: "master_project",
        exportType: null,
        sizeBytes: 50,
      }),
    ];
    const groups = groupFilesByStage(files);
    const mix = groups.find((g) => g.key === "mix_project")!;
    const master = groups.find((g) => g.key === "master_project")!;
    expect(mix.count).toBe(2);
    expect(mix.totalBytes).toBe(300);
    expect(master.count).toBe(1);
    expect(master.totalBytes).toBe(50);
  });

  it("splits export rows into separate groups by export type", () => {
    const files = [
      file({ id: "a", kind: "export", exportType: "mix", sizeBytes: 100 }),
      file({ id: "b", kind: "export", exportType: "stems", sizeBytes: 900 }),
      file({ id: "c", kind: "export", exportType: "stems", sizeBytes: 100 }),
    ];
    const groups = groupFilesByStage(files);
    expect(groups.find((g) => g.key === "export:mix")?.totalBytes).toBe(100);
    const stems = groups.find((g) => g.key === "export:stems")!;
    expect(stems.count).toBe(2);
    expect(stems.totalBytes).toBe(1000);
  });

  it("returns an empty array for no files", () => {
    expect(groupFilesByStage([])).toEqual([]);
  });
});

describe("defaultStageSelection", () => {
  const groups: StageGroup[] = [
    { key: "mix_project", label: "Record / Mix", count: 1, totalBytes: 100 },
    {
      key: "export:stems",
      label: "Exports · Stems",
      count: 20,
      totalBytes: 2 * 1024 * 1024 * 1024,
    },
    {
      key: "export:mix",
      label: "Exports · Mix",
      count: 1,
      totalBytes: 50_000_000,
    },
  ];

  it("excludes a group over 1 GiB", () => {
    const selected = defaultStageSelection(groups);
    expect(selected).not.toContain("export:stems");
  });

  it("includes everything else", () => {
    const selected = defaultStageSelection(groups);
    expect(selected).toContain("mix_project");
    expect(selected).toContain("export:mix");
  });
});

describe("resolveStageSelection", () => {
  const groups: StageGroup[] = [
    { key: "mix_project", label: "Record / Mix", count: 1, totalBytes: 100 },
    { key: "export:mix", label: "Exports · Mix", count: 1, totalBytes: 100 },
  ];

  it("keeps remembered keys that still exist", () => {
    expect(resolveStageSelection(groups, ["mix_project"])).toEqual([
      "mix_project",
    ]);
  });

  it("drops a remembered key for a stage no longer present", () => {
    const result = resolveStageSelection(groups, ["export:stems"]);
    // nothing survives the intersection, so it falls back to the default rule
    expect(result).toEqual(["mix_project", "export:mix"]);
  });

  it("falls back to the default rule when nothing is remembered", () => {
    expect(resolveStageSelection(groups, null)).toEqual([
      "mix_project",
      "export:mix",
    ]);
  });

  it("falls back to the default rule for an empty remembered list", () => {
    expect(resolveStageSelection(groups, [])).toEqual([
      "mix_project",
      "export:mix",
    ]);
  });
});

describe("toStageFileInput", () => {
  it("maps the fields the Rust command expects", () => {
    const f = file({
      filePath: "/song/mix.wav",
      fileName: "mix.wav",
      kind: "export",
      exportType: "mix",
      versionLabel: "v2",
      isFinal: true,
    });
    expect(toStageFileInput(f)).toEqual({
      filePath: "/song/mix.wav",
      fileName: "mix.wav",
      kind: "export",
      exportType: "mix",
      versionLabel: "v2",
      isFinal: true,
    });
  });
});

describe("parseMissing", () => {
  it("returns an empty array for a null manifest", () => {
    expect(parseMissing(null)).toEqual([]);
  });

  it("returns the missing entries from a valid manifest", () => {
    const manifest = JSON.stringify({
      missing: [
        { originalPath: "/a.wav", stage: "export", reason: "not found" },
        { originalPath: "/b.wav", stage: "export", reason: "not found" },
      ],
    });
    expect(parseMissing(manifest)).toHaveLength(2);
  });

  it("returns an empty array for malformed JSON without throwing", () => {
    expect(() => parseMissing("{not json")).not.toThrow();
    expect(parseMissing("{not json")).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  nextVersionLabel,
  markFinal,
  inferExportType,
} from "../src/lib/project-files";

describe("nextVersionLabel", () => {
  it("returns v1 when there are no labels", () => {
    expect(nextVersionLabel([])).toBe("v1");
  });

  it("increments past the highest numeric label", () => {
    expect(nextVersionLabel(["v1", "v3", "v2"])).toBe("v4");
  });

  it("ignores labels without a version number", () => {
    expect(nextVersionLabel(["Final", "draft"])).toBe("v1");
  });

  it("reads the number out of labels like 'Master v2' and 'rev3'", () => {
    expect(nextVersionLabel(["Master v2", "rev3"])).toBe("v4");
  });
});

describe("markFinal", () => {
  const files = [
    { id: "a", isFinal: true },
    { id: "b", isFinal: false },
    { id: "c", isFinal: false },
  ];

  it("leaves exactly one file final", () => {
    const result = markFinal(files, "c");
    expect(result.filter((f) => f.isFinal).map((f) => f.id)).toEqual(["c"]);
  });

  it("does not mutate the input", () => {
    markFinal(files, "c");
    expect(files[0].isFinal).toBe(true);
  });

  it("throws for an unknown id", () => {
    expect(() => markFinal(files, "zzz")).toThrow();
  });
});

describe("inferExportType", () => {
  it("detects master from the file name", () => {
    expect(inferExportType("Song_master_v2.wav")).toBe("master");
  });

  it("detects instrumental", () => {
    expect(inferExportType("Song (Instrumental).wav")).toBe("instrumental");
  });

  it("defaults to mix", () => {
    expect(inferExportType("Song.wav")).toBe("mix");
  });
});

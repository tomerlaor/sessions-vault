import { describe, it, expect } from "vitest";
import {
  nextVersionLabel,
  markFinal,
  inferExportType,
  formatAudioSummary,
  audioWarnings,
  formatMediaSummary,
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

describe("formatAudioSummary", () => {
  it("joins rate, depth, duration and peak", () => {
    expect(
      formatAudioSummary({
        sampleRate: 48000,
        bitDepth: 24,
        durationSecs: 222,
        peakDb: -3.14,
      }),
    ).toBe("48 kHz · 24-bit · 3:42 · peak -3.1 dBFS");
  });

  it("shows 44.1 kHz with a decimal", () => {
    expect(
      formatAudioSummary({
        sampleRate: 44100,
        bitDepth: 16,
        durationSecs: 60,
        peakDb: 0,
      }),
    ).toBe("44.1 kHz · 16-bit · 1:00 · peak 0.0 dBFS");
  });

  it("skips fields that are unknown", () => {
    expect(
      formatAudioSummary({
        sampleRate: null,
        bitDepth: null,
        durationSecs: null,
        peakDb: null,
      }),
    ).toBe("");
  });
});

describe("audioWarnings", () => {
  it("warns about clipping and lossy files", () => {
    expect(audioWarnings({ clipped: true, lossy: true })).toEqual([
      "Clipping",
      "Lossy",
    ]);
  });

  it("returns nothing for a clean file", () => {
    expect(audioWarnings({ clipped: false, lossy: false })).toEqual([]);
  });
});

describe("formatMediaSummary", () => {
  it("is null when the check did not run", () => {
    expect(formatMediaSummary(null, null)).toBeNull();
  });

  it("says all media found when nothing is wrong", () => {
    expect(formatMediaSummary(0, 0)).toBe("All media found");
  });

  it("lists missing and outside-folder counts", () => {
    expect(formatMediaSummary(2, 5)).toBe("2 missing · 5 outside folder");
  });

  it("omits the zero part", () => {
    expect(formatMediaSummary(0, 3)).toBe("3 outside folder");
  });
});

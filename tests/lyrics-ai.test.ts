import { describe, it, expect } from "vitest";
import {
  buildLyricsSuggestionPrompt,
  buildLyricsPopupPrompt,
  determineSuggestionMode,
} from "../src/lib/lyrics-ai";

describe("buildLyricsSuggestionPrompt", () => {
  const base = {
    lyrics: "verse one\n",
    currentLine: "verse one",
    selectionStart: 9,
    selectionEnd: 9,
    title: "My Song",
    bpm: 120,
    key: "C Major",
    timeSignature: "4/4",
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    mode: "completion" as const,
  };

  it("includes song metadata in system prompt", () => {
    const { system } = buildLyricsSuggestionPrompt(base);
    expect(system).toContain("My Song");
    expect(system).toContain("120");
    expect(system).toContain("C Major");
    expect(system).toContain("4/4");
  });

  it("includes style context when profiles are set", () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...base,
      globalProfile: "ABAB rhyme, dark imagery",
      projectProfile: "introspective",
    });
    expect(system).toContain("ABAB rhyme, dark imagery");
    expect(system).toContain("introspective");
  });

  it("omits style context block when both profiles are null", () => {
    const { system } = buildLyricsSuggestionPrompt(base);
    expect(system).not.toContain("style context");
  });

  it("includes recent accepted examples", () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...base,
      recentAccepted: ["burning like the sun", "cold as winter rain"],
    });
    expect(system).toContain("burning like the sun");
    expect(system).toContain("cold as winter rain");
  });

  it("puts full lyrics and current line in the user prompt", () => {
    const { prompt } = buildLyricsSuggestionPrompt(base);
    expect(prompt).toContain("verse one");
    expect(prompt).toContain("Current line");
  });
});

describe("buildLyricsPopupPrompt", () => {
  it("lists all enabled modes in system prompt", () => {
    const { system } = buildLyricsPopupPrompt({
      lyrics: "",
      currentLine: "",
      selectionStart: 0,
      selectionEnd: 0,
      title: "Song",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      enabledModes: ["completion", "next_line"],
    });
    expect(system).toContain("completion");
    expect(system).toContain("next_line");
    expect(system).not.toContain("alternative");
  });
});

describe("determineSuggestionMode", () => {
  it("returns alternative when text is selected and mode is enabled", () => {
    expect(
      determineSuggestionMode("hello world", 0, 5, [
        "completion",
        "alternative",
        "next_line",
      ]),
    ).toBe("alternative");
  });

  it("returns completion when cursor is mid-line", () => {
    expect(
      determineSuggestionMode("hello wor", 9, 9, ["completion", "next_line"]),
    ).toBe("completion");
  });

  it("returns next_line when cursor is at end of a complete line", () => {
    // 'hello world\n' — cursor at index 11 (end of "hello world", before \n)
    expect(
      determineSuggestionMode("hello world\n", 11, 11, [
        "completion",
        "next_line",
      ]),
    ).toBe("next_line");
  });

  it("returns null when enabledModes is empty", () => {
    expect(determineSuggestionMode("hello", 5, 5, [])).toBeNull();
  });

  it("falls back to completion when alternative is disabled but text is selected", () => {
    expect(determineSuggestionMode("hello world", 0, 5, ["completion"])).toBe(
      "completion",
    );
  });

  it("returns first enabled mode as last resort", () => {
    expect(determineSuggestionMode("", 0, 0, ["next_line"])).toBe("next_line");
  });
});

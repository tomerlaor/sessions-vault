import { describe, it, expect } from "vitest";
import {
  buildLyricsSuggestionPrompt,
  buildLyricsPopupPrompt,
  determineSuggestionMode,
  normalizeNextWord,
  buildNextWordOptionsPrompt,
  normalizeNextWordOptions,
} from "../src/lib/lyrics-ai";

describe("buildLyricsSuggestionPrompt", () => {
  const base = {
    lyrics: "verse one\n",
    currentLine: "verse one",
    textBeforeCursor: "verse one",
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

  it("puts full lyrics and the typed text in the user prompt", () => {
    const { prompt } = buildLyricsSuggestionPrompt(base);
    expect(prompt).toContain("verse one");
    expect(prompt).toContain("Writer typed");
  });

  it("asks next_line mode for a new line given the entire lyrics", () => {
    const { system, prompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics: "verse one\nverse two\n",
      currentLine: "verse two",
      mode: "next_line",
    });
    expect(system).toContain("write the next line");
    expect(system).not.toContain("Complete what the writer has started");
    expect(prompt).toContain("Entire lyrics");
    expect(prompt).toContain("verse one\nverse two");
    expect(prompt).toContain("Write the next line");
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

describe("next_word mode", () => {
  it("is chosen right after a finished word when completion is also on", () => {
    expect(
      determineSuggestionMode("hello ", 6, 6, ["completion", "next_word"]),
    ).toBe("next_word");
  });

  it("falls back to completion mid-word when both are on", () => {
    expect(
      determineSuggestionMode("hello wor", 9, 9, ["completion", "next_word"]),
    ).toBe("completion");
  });

  it("is used mid-word when it is the only inline mode", () => {
    expect(determineSuggestionMode("hello wor", 9, 9, ["next_word"])).toBe(
      "next_word",
    );
  });
});

describe("normalizeNextWord", () => {
  it("keeps at most two words", () => {
    expect(normalizeNextWord("the quiet night sky", "hello ")).toBe(
      "the quiet",
    );
  });

  it("adds a space when the cursor follows a letter", () => {
    expect(normalizeNextWord("world", "hello")).toBe(" world");
  });

  it("adds no space after whitespace or at line start", () => {
    expect(normalizeNextWord(" world\n", "hello ")).toBe("world");
    expect(normalizeNextWord("world", "")).toBe("world");
  });

  it("returns empty for an empty reply", () => {
    expect(normalizeNextWord("  ", "hello")).toBe("");
  });
});

describe("song context", () => {
  const base = {
    lyrics: "verse one\nverse two\n",
    currentLine: "verse two",
    textBeforeCursor: "verse two",
    selectionStart: 19,
    selectionEnd: 19,
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    mode: "next_line" as const,
  };

  it("adds the writer's context to the system prompt for every inline mode", () => {
    for (const mode of ["completion", "next_line", "alternative"] as const) {
      const { system } = buildLyricsSuggestionPrompt({
        ...base,
        mode,
        songContext: "A breakup song. Bittersweet and nostalgic.",
      });
      expect(system).toContain("A breakup song. Bittersweet and nostalgic.");
    }
  });

  it("is included in the popup prompt", () => {
    const { system } = buildLyricsPopupPrompt({
      ...base,
      enabledModes: ["next_line"],
      songContext: "About leaving home",
    });
    expect(system).toContain("About leaving home");
  });

  it("changes nothing when empty or blank", () => {
    const without = buildLyricsSuggestionPrompt(base);
    expect(buildLyricsSuggestionPrompt({ ...base, songContext: "  " })).toEqual(
      without,
    );
    expect(buildLyricsSuggestionPrompt({ ...base, songContext: null })).toEqual(
      without,
    );
  });
});

describe("next_line must yield a complete line", () => {
  const input = {
    lyrics: "I walk alone\nthrough the empty street\n",
    currentLine: "through the empty street",
    textBeforeCursor: "through the empty street",
    selectionStart: 38,
    selectionEnd: 38,
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
  };

  it("inline: asks for a full line and treats the rhyme as a hint only", () => {
    const { system, prompt } = buildLyricsSuggestionPrompt({
      ...input,
      mode: "next_line",
    });
    expect(system).toContain("complete, singable line");
    expect(prompt).toContain("Write a full line whose last word rhymes with");
  });

  it("popup: forbids returning a rhyme word or advice instead of a line", () => {
    const { system } = buildLyricsPopupPrompt({
      ...input,
      enabledModes: ["next_line"],
    });
    expect(system).toContain("complete new lyric line");
    expect(system).toContain("never a rhyme word");
    expect(system).toContain("must still be a complete line");
  });
});

describe("popup rhyming alternative for next_line", () => {
  const input = {
    lyrics: "I walk alone\nthrough the empty street.\n",
    currentLine: "through the empty street.",
    textBeforeCursor: "through the empty street.",
    selectionStart: 38,
    selectionEnd: 38,
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
  };

  it("always asks for an extra next_line that rhymes with the last line's final word", () => {
    const { system } = buildLyricsPopupPrompt({
      ...input,
      enabledModes: ["next_line"],
    });
    expect(system).toContain("ALWAYS return one extra next_line");
    expect(system).toContain('rhymes with "street"');
  });

  it("is omitted when next_line is not enabled", () => {
    const { system } = buildLyricsPopupPrompt({
      ...input,
      enabledModes: ["completion"],
    });
    expect(system).not.toContain("extra next_line");
  });

  it("is omitted when there is no last line yet", () => {
    const { system } = buildLyricsPopupPrompt({
      ...input,
      lyrics: "",
      currentLine: "",
      enabledModes: ["next_line"],
    });
    expect(system).not.toContain("extra next_line");
  });

  it("has a Hebrew version", () => {
    const { system } = buildLyricsPopupPrompt({
      ...input,
      lyrics: "אני הולך לבד\nברחוב הריק.\n",
      currentLine: "ברחוב הריק.",
      enabledModes: ["next_line"],
    });
    expect(system).toContain('מתחרזת עם "הריק"');
  });
});

describe("songwriting craft guidance", () => {
  const input = {
    lyrics: "[Verse]\nI walk alone\n",
    currentLine: "I walk alone",
    textBeforeCursor: "I walk alone",
    selectionStart: 21,
    selectionEnd: 21,
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
  };

  it("is included for line-level inline modes", () => {
    for (const mode of ["completion", "next_line", "alternative"] as const) {
      const { system } = buildLyricsSuggestionPrompt({ ...input, mode });
      expect(system).toContain("Songwriting craft to apply");
      expect(system).toContain("Show, don't tell");
      expect(system).toContain("slant rhymes");
    }
  });

  it("is included in the popup prompt", () => {
    const { system } = buildLyricsPopupPrompt({
      ...input,
      enabledModes: ["next_line"],
    });
    expect(system).toContain("Songwriting craft to apply");
  });

  it("has a Hebrew version", () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...input,
      lyrics: "אני הולך לבד",
      currentLine: "אני הולך לבד",
      mode: "next_line",
    });
    expect(system).toContain("עקרונות כתיבת שירים");
  });
});

describe("next_word options", () => {
  const input = {
    lyrics: "[Verse]\nI walk alone\nthrough the empty ",
    currentLine: "through the empty ",
    textBeforeCursor: "through the empty ",
    selectionStart: 40,
    selectionEnd: 40,
    title: "My Song",
    bpm: 90,
    key: "A minor",
    timeSignature: "4/4",
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    songContext: "A breakup song, bittersweet.",
  };

  it("sends the entire song and the typed text", () => {
    const { prompt } = buildNextWordOptionsPrompt(input);
    expect(prompt).toContain("Entire lyrics");
    expect(prompt).toContain("I walk alone\nthrough the empty");
    expect(prompt).toContain("Current line up to the cursor");
  });

  it("asks for at least three options with a rhyme for the line above", () => {
    const { system } = buildNextWordOptionsPrompt(input);
    expect(system).toContain("never fewer than 3");
    expect(system).toContain('must rhyme with "alone"');
    expect(system).toContain('kind="rhyme"');
  });

  it("includes the songwriting craft block and the song context", () => {
    const { system } = buildNextWordOptionsPrompt(input);
    expect(system).toContain("Songwriting craft to apply");
    expect(system).toContain("A breakup song, bittersweet.");
    expect(system).toContain("My Song");
  });

  it("still asks for a rhyme-marked option when there is no line above", () => {
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics: "I walk ",
      currentLine: "I walk ",
      textBeforeCursor: "I walk ",
    });
    expect(system).not.toContain("must rhyme with");
    expect(system).toContain('kind="rhyme"');
  });

  it("has a Hebrew version", () => {
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics: "אני הולך לבד\nברחוב ה",
      currentLine: "ברחוב ה",
      textBeforeCursor: "ברחוב ה",
    });
    expect(system).toContain("לפחות אפשרות אחת חייבת להתחרז");
    expect(system).toContain("עקרונות כתיבת שירים");
  });

  it("normalizes options: trims, dedupes, spaces, and puts the rhyme last", () => {
    const out = normalizeNextWordOptions(
      [
        { text: "stone", kind: "rhyme" },
        { text: "road ahead", kind: "continuation" },
        { text: " Road Ahead ", kind: "continuation" },
        { text: "   ", kind: "continuation" },
        { text: "night", kind: "continuation" },
      ],
      "through the empty",
    );
    expect(out).toEqual([
      { text: " road ahead", kind: "continuation" },
      { text: " night", kind: "continuation" },
      { text: " stone", kind: "rhyme" },
    ]);
  });

  it("caps the list at five options", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      text: `w${i}`,
      kind: "continuation" as const,
    }));
    expect(normalizeNextWordOptions(many, "x ")).toHaveLength(5);
  });
});

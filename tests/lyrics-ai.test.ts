import { describe, it, expect, beforeAll } from "vitest";
import {
  buildLyricsSuggestionPrompt,
  buildLyricsPopupPrompt,
  determineSuggestionMode,
  normalizeNextWord,
  buildNextWordOptionsPrompt,
  normalizeNextWordOptions,
  sanitizePopupSuggestions,
} from "../src/lib/lyrics-ai";
import { loadEnglishDict } from "../src/lib/prosody";

beforeAll(async () => {
  await loadEnglishDict();
});

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
    const lyrics = "verse one\nverse two\n";
    const { system, prompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics,
      currentLine: "verse two",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
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
  // Two lines that actually rhyme (rain/lane) so nextLineTargets() has
  // enough signal to produce a rhyme hint — unlike the old
  // extractRhymeContext, the real engine only hints a rhyme when the
  // existing lines actually show one.
  const lyricsWithRhyme = "I walk through the rain\nAlone down the lane\n";
  const input = {
    lyrics: lyricsWithRhyme,
    currentLine: "Alone down the lane",
    textBeforeCursor: "Alone down the lane",
    selectionStart: lyricsWithRhyme.length,
    selectionEnd: lyricsWithRhyme.length,
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

  it("asks for at least three options, with an explicit rhyme target from the single prior line", () => {
    // Only one complete lyric line exists before the in-progress one — not
    // enough for nextLineTargets to infer a scheme (AABB needs two lines to
    // show a rhyme at all) — but the line directly above is still the
    // obvious rhyme partner for the line being typed, so next_word must
    // name it explicitly rather than leave the model guessing (#79 / R6 fix).
    const { system } = buildNextWordOptionsPrompt(input);
    expect(system).toContain("never fewer than 3");
    expect(system).toContain('must rhyme with "alone"');
    expect(system).toContain('kind="rhyme"');
  });

  it("asks for a rhyme with the line above once a scheme is established", () => {
    const lyrics =
      "[Verse]\nI walk down the road\nsearching for a code\nthrough the empty ";
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics,
      currentLine: "through the empty ",
      textBeforeCursor: "through the empty ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(system).toContain('must rhyme with "code"');
    expect(system).toContain('kind="rhyme"');
  });

  it("includes the songwriting craft block and the song context", () => {
    const { system } = buildNextWordOptionsPrompt(input);
    expect(system).toContain("Songwriting craft to apply");
    expect(system).toContain("A breakup song, bittersweet.");
    expect(system).toContain("My Song");
  });

  it("still asks for a rhyme-marked option when there is no line above", () => {
    const lyrics = "I walk ";
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(system).not.toContain("must rhyme with");
    expect(system).toContain('kind="rhyme"');
  });

  it("has a Hebrew version", () => {
    // Two prior lines that rhyme (תפילה/הלילה) so a scheme is established
    // before the in-progress third line.
    const lyrics = "אני שר תפילה\nלבד בתוך הלילה\nברחוב ה";
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics,
      currentLine: "ברחוב ה",
      textBeforeCursor: "ברחוב ה",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(system).toContain('לפחות אפשרות אחת חייבת להתחרז עם "הלילה"');
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

// ─── R6 (#79): cursor marker, section context, explicit targets ───────────

describe("R6: cursor marker is present in the lyrics sent to the model", () => {
  const lyrics =
    "I walk alone through the empty street\nThinking of all the things I could not";
  const inputBase = {
    lyrics,
    currentLine: "Thinking of all the things I could not",
    textBeforeCursor: "Thinking of all the things I could not",
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
  };

  it("completion", () => {
    const { prompt } = buildLyricsSuggestionPrompt({
      ...inputBase,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      mode: "completion",
    });
    expect(prompt).toContain("⟨CURSOR⟩");
  });

  it("next_line", () => {
    const { prompt } = buildLyricsSuggestionPrompt({
      ...inputBase,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      mode: "next_line",
    });
    expect(prompt).toContain("⟨CURSOR⟩");
  });

  it("alternative", () => {
    const lineEnd = lyrics.indexOf("\n");
    const { prompt } = buildLyricsSuggestionPrompt({
      ...inputBase,
      selectionStart: 0,
      selectionEnd: lineEnd,
      mode: "alternative",
    });
    expect(prompt).toContain("⟨CURSOR⟩");
  });

  it("next_word", () => {
    const wordLyrics = "I walk alone\nthrough the empty ";
    const { prompt } = buildNextWordOptionsPrompt({
      ...inputBase,
      lyrics: wordLyrics,
      currentLine: "through the empty ",
      textBeforeCursor: "through the empty ",
      selectionStart: wordLyrics.length,
      selectionEnd: wordLyrics.length,
    });
    expect(prompt).toContain("⟨CURSOR⟩");
  });

  it("includes the text after the cursor too", () => {
    const full =
      "[Verse]\nI walk alone\nthrough the empty street\n[Chorus]\nWe rise again\n";
    const cursor = full.indexOf("through the empty street");
    const { prompt } = buildLyricsSuggestionPrompt({
      ...inputBase,
      lyrics: full,
      currentLine: "through the empty street",
      textBeforeCursor: "",
      selectionStart: cursor,
      selectionEnd: cursor,
      mode: "completion",
    });
    expect(prompt).toContain("We rise again");
  });
});

describe("R6: lyrics sent to the model strip chords/remarks but keep section headers", () => {
  it("strips a bare chord line and inline chord/remark tokens", () => {
    const lyrics =
      "[Verse]\nC G Am\nI walk [C]alone (whisper) down the street\n";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I walk [C]alone (whisper) down the street",
      textBeforeCursor: "I walk [C]alone (whisper) down the street",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "next_line",
    });
    expect(prompt).toContain("[Verse]");
    expect(prompt).not.toContain("C G Am");
    expect(prompt).not.toContain("[C]");
    expect(prompt).not.toContain("(whisper)");
    expect(prompt).toContain("I walk alone down the street");
  });
});

describe("fix: cursor marker survives a cursor sitting inside a (remark) or [chord]", () => {
  it("cursor inside a parenthetical ad-lib keeps the marker instead of deleting it with the remark", () => {
    const lyrics = "I walk alone (ooh yeah) tonight";
    const cursor = lyrics.indexOf("yeah");
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics.slice(0, cursor),
      selectionStart: cursor,
      selectionEnd: cursor,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain("⟨CURSOR⟩");
    expect(prompt).toContain("I walk alone (ooh ⟨CURSOR⟩yeah) tonight");
  });

  it("cursor inside an inline [chord] token keeps the marker", () => {
    const lyrics = "I walk [C]alone tonight";
    const cursor = lyrics.indexOf("alone");
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics.slice(0, cursor),
      selectionStart: cursor,
      selectionEnd: cursor,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain("⟨CURSOR⟩");
    expect(prompt).toContain("I walk⟨CURSOR⟩alone tonight");
  });

  it("removes a user-typed cursor marker before inserting the real one", () => {
    const lyrics = "I typed ⟨CURSOR⟩ by mistake\nI walk alone";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I walk alone",
      textBeforeCursor: "I walk alone",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "next_line",
    });
    // The prompt always contains exactly one other literal "⟨CURSOR⟩" as
    // part of the static "(⟨CURSOR⟩ marks the cursor):" instruction, so a
    // correctly-deduped prompt has exactly 2 occurrences total — not 3,
    // which is what an un-stripped, user-typed marker would add.
    const markerCount = prompt.split("⟨CURSOR⟩").length - 1;
    expect(markerCount).toBe(2);
    expect(prompt).toContain("I typed by mistake");
  });
});

describe("fix: a [Section] name is sanitized before it enters the prompt", () => {
  function promptWithSection(headerInner: string): string {
    const lyrics = `[${headerInner}]\nI walk alone\nI `;
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I",
      textBeforeCursor: "I ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    return prompt;
  }

  it("caps the section name length to about 40 characters in the 'Current section' line", () => {
    // The raw header is still echoed verbatim in the lyrics block itself
    // (the model needs to see the writer's actual structure) — only the
    // name interpolated into the "Current section: ..." sentence is capped.
    const longName = "Verse " + "x".repeat(60);
    const prompt = promptWithSection(longName);
    const match = /Current section: (.*?) \(line/.exec(prompt);
    expect(match).not.toBeNull();
    expect((match?.[1] ?? "").length).toBeLessThanOrEqual(40);
  });

  it("strips control characters and stray brackets from the name", () => {
    expect(promptWithSection("Verse\x07")).toContain(
      "Current section: Verse (line",
    );
    expect(promptWithSection("[Verse")).toContain(
      "Current section: Verse (line",
    );
  });
});

describe("R6: no contradictory explain/question instructions in any lyrics system prompt", () => {
  const baseEn = {
    lyrics: "I walk alone\nthrough the city lights\n",
    currentLine: "through the city lights",
    textBeforeCursor: "through the city lights",
    selectionStart: 10,
    selectionEnd: 10,
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: "x",
    projectProfile: "y",
    recentAccepted: ["walking down the empty road"],
  };
  const baseHe = {
    ...baseEn,
    lyrics: "אני הולך לבד\nברחוב האורות\n",
    currentLine: "ברחוב האורות",
  };

  function assertClean(system: string) {
    const lower = system.toLowerCase();
    expect(lower).not.toContain("explain");
    expect(lower).not.toContain("question");
  }

  it("inline prompts, every mode, EN+HE", () => {
    for (const mode of ["completion", "next_line", "alternative"] as const) {
      assertClean(buildLyricsSuggestionPrompt({ ...baseEn, mode }).system);
      assertClean(buildLyricsSuggestionPrompt({ ...baseHe, mode }).system);
    }
  });

  it("popup prompt, EN+HE", () => {
    const modes = [
      "completion",
      "next_line",
      "alternative",
      "next_word",
    ] as const;
    assertClean(
      buildLyricsPopupPrompt({ ...baseEn, enabledModes: [...modes] }).system,
    );
    assertClean(
      buildLyricsPopupPrompt({ ...baseHe, enabledModes: [...modes] }).system,
    );
  });

  it("next_word prompt, EN+HE", () => {
    assertClean(buildNextWordOptionsPrompt(baseEn).system);
    assertClean(buildNextWordOptionsPrompt(baseHe).system);
  });
});

describe("R6: empty-draft language rule follows songContext/title when the draft itself is empty", () => {
  const emptyBase = {
    lyrics: "",
    currentLine: "",
    textBeforeCursor: "",
    selectionStart: 0,
    selectionEnd: 0,
    title: "Eval Song",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    mode: "next_line" as const,
  };

  it("picks the Hebrew prompt and opening-line rule when songContext is Hebrew", () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...emptyBase,
      songContext: "שיר פתיחה על התחלה חדשה.",
    });
    expect(system).toContain("כתוב שורת פתיחה אחת חזקה בעברית");
  });

  it("stays English when nothing in lyrics/currentLine/songContext/title is Hebrew", () => {
    const { system } = buildLyricsSuggestionPrompt({
      ...emptyBase,
      songContext: "An opening song about a new beginning.",
    });
    expect(system).toContain("write one striking opening line in English");
  });
});

describe("R6: completion gets a remaining-syllable target, not the full line length", () => {
  it("EN: states a shorter remaining budget than the full line target", () => {
    const lyrics =
      "The city lights flicker like a dying flame\nEvery corner holds a memory I can't reclaim\nAnd still I find myself walking back to the same old";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "And still I find myself walking back to the same old",
      textBeforeCursor: "And still I find myself walking back to the same old",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toMatch(
      /Add about \d+-\d+ more syllables to finish the line\./,
    );
  });

  it("HE version", () => {
    const lyrics = "ועדיין אני מוצא את עצמי חוזר\nלאותו מקום שאהבתי\nאני ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "אני ",
      textBeforeCursor: "אני ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toMatch(/השלם בעוד \d+-\d+ הברות בערך כדי לסיים את השורה\./);
  });
});

describe("R6: explicit rhyme target in the task text when a scheme is established", () => {
  it("completion", () => {
    const lyrics =
      "[Chorus]\nYou were the only light in a town gone dark\nAnd I was just a boy chasing a spark\nNow the streets are quiet, and I carry the mark\nOf every";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "Of every",
      textBeforeCursor: "Of every",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain('rhyme with: "mark"');
  });

  it("next_line", () => {
    const lyrics =
      "I walked down a street in the rain\nTrying to shake off the pain\nI found an old coat by the door";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I found an old coat by the door",
      textBeforeCursor: "I found an old coat by the door",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "next_line",
    });
    expect(prompt).toContain('rhymes with: "door"');
  });
});

describe("fix: completion falls back to the line above when no scheme is established", () => {
  it("single prior line — not enough for a scheme, but still an obvious target", () => {
    const lyrics = "Under the bridge where the shadows stay\nI ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I",
      textBeforeCursor: "I ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain('rhyme with: "stay"');
  });

  it("Hebrew: free verse (2+ prior lines, none of which rhyme) gets no forced rhyme target", () => {
    // Fixed bug: the old fallback always targeted the immediately preceding
    // line even when the prior lines show no AABB/ABAB pattern at all —
    // wrong for genuine free verse. With 2+ non-rhyming prior lines, the
    // instruction should be omitted entirely rather than forcing a rhyme.
    const lyrics =
      "[פזמון]\nהיית האור היחיד בעיר שכבתה\nואני הייתי רק ילד רודף ניצוץ\nעכשיו הרחובות שקטים ואני נושא את הסימן\nשל כל";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "של כל",
      textBeforeCursor: "של כל",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).not.toContain("להתחרז עם");
  });
});

describe("fix: impliedRhymeTarget respects the AABB/ABAB/free-verse scheme", () => {
  it("AABB: two prior lines that rhyme as a couplet target the previous line", () => {
    const lyrics =
      "I walked down a street in the rain\nTrying to shake off the pain\nI found an old coat by the";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I found an old coat by the",
      textBeforeCursor: "I found an old coat by the",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain('rhyme with: "pain"');
  });

  it("ABAB: line n-1 rhymes with n-3, so the completion targets line n-2 (not n-1)", () => {
    // "rain" (line 1) rhymes with "lane" (line 3); "tree" (line 2) rhymes
    // with neither — an alternating scheme, not a couplet. The line being
    // completed (line 4) should target line 2's end word ("tree"), two
    // lines back, not line 3's ("lane").
    const lyrics =
      "I walk through the rain\nLost beneath a tree\nAlone down the lane\nI ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I",
      textBeforeCursor: "I ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain('rhyme with: "tree"');
  });

  it("free verse: 2+ prior lines with no rhyme pattern get no forced target", () => {
    const lyrics =
      "I walk through the city\nUnder the bridge at noon\nThinking of nothing at all\nI ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "I",
      textBeforeCursor: "I ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).not.toContain("rhyme with:");
  });

  it("single prior line still gets the obvious-partner fallback (next_word)", () => {
    const lyrics = "I walk alone\nthrough the empty ";
    const { system } = buildNextWordOptionsPrompt({
      lyrics,
      currentLine: "through the empty ",
      textBeforeCursor: "through the empty ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
    });
    expect(system).toContain('must rhyme with "alone"');
  });
});

describe("R6: current section and line position", () => {
  it("names the section and flags a repeated chorus", () => {
    const lyrics =
      "[Verse]\nI packed my bags before the sun came up\n[Chorus]\nWe are the fire that never burns out\n[Chorus]\nWe are the fire that never burns out\nWe are";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "We are",
      textBeforeCursor: "We are",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "completion",
    });
    expect(prompt).toContain("Current section: Chorus");
    expect(prompt).toContain("repeated chorus");
  });
});

describe("R6: recentAccepted drops single-word examples", () => {
  it("keeps only accepted lines with 3+ words, capped at 5", () => {
    const { system } = buildLyricsSuggestionPrompt({
      lyrics: "verse one\n",
      currentLine: "verse one",
      textBeforeCursor: "verse one",
      selectionStart: 9,
      selectionEnd: 9,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: ["fire", "the quiet night", "burning like the sun above"],
      mode: "completion",
    });
    expect(system).not.toContain("- fire\n");
    expect(system).toContain("the quiet night");
    expect(system).toContain("burning like the sun above");
  });
});

describe("fix: sanitizePopupSuggestions cleans popup items the same way ghost text is cleaned", () => {
  it("sanitizes completion/next_line/alternative items via the shared sanitizer", () => {
    const out = sanitizePopupSuggestions(
      [
        { mode: "completion" as const, text: 'Completion: "away"' },
        { mode: "next_line" as const, text: "Next line: a quiet leaving" },
        { mode: "alternative" as const, text: "'a quiet leaving'" },
      ],
      "",
    );
    expect(out).toEqual([
      { mode: "completion", text: "away" },
      { mode: "next_line", text: "a quiet leaving" },
      // Single quotes are never stripped (see lyrics-sanitize.ts) — the
      // alternative item's wrapping single quotes stay as-is.
      { mode: "alternative", text: "'a quiet leaving'" },
    ]);
  });

  it("normalizes next_word items via normalizeNextWord", () => {
    const out = sanitizePopupSuggestions(
      [{ mode: "next_word" as const, text: "  world  " }],
      "hello",
    );
    expect(out).toEqual([{ mode: "next_word", text: " world" }]);
  });

  it("drops items that sanitize down to nothing", () => {
    const out = sanitizePopupSuggestions(
      [
        { mode: "next_line" as const, text: "```" },
        { mode: "completion" as const, text: "away" },
      ],
      "",
    );
    expect(out).toEqual([{ mode: "completion", text: "away" }]);
  });

  it("preserves extra fields (e.g. a display label) through the mapping", () => {
    const out = sanitizePopupSuggestions(
      [
        {
          mode: "next_line" as const,
          text: "Next line: a line",
          label: "rhyme",
        },
      ],
      "",
    );
    expect(out).toEqual([
      { mode: "next_line", text: "a line", label: "rhyme" },
    ]);
  });
});

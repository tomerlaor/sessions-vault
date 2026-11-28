import { describe, it, expect, beforeAll } from "vitest";
import {
  buildLyricsSuggestionPrompt,
  buildLyricsPopupPrompt,
  determineSuggestionMode,
  normalizeNextWord,
  buildNextWordOptionsPrompt,
  normalizeNextWordOptions,
  sanitizePopupSuggestions,
  verifyNextWordRhymes,
} from "../src/lib/lyrics-ai";
import { loadEnglishDict } from "../src/lib/prosody";
import { loadFixtures } from "../scripts/lyrics-eval/fixtures";
import type { EvalFixture } from "../scripts/lyrics-eval/types";

beforeAll(async () => {
  await loadEnglishDict();
});

const fixtures = loadFixtures();
function fixture(id: string): EvalFixture {
  const f = fixtures.find((x) => x.id === id);
  if (!f) throw new Error(`missing fixture ${id}`);
  return f;
}

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
  // Three lines so nextLineTargets() has enough signal to produce a rhyme
  // hint for the 4th: rain/lane (lines 1-2) rhyme and close a couplet, so
  // "cold" (line 3) is the odd-one-out awaiting its own partner — the
  // couplet-parity rule (R6 §2.3) still names it as a hard target for the
  // line being written. Unlike the old extractRhymeContext, the real
  // engine only hints a rhyme when the existing lines actually show a
  // scheme.
  const lyricsWithRhyme =
    "I walk through the rain\nAlone down the lane\nNow the night is cold\n";
  const input = {
    lyrics: lyricsWithRhyme,
    currentLine: "Now the night is cold",
    textBeforeCursor: "Now the night is cold",
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

  it("asks for at least three options, with a soft, position-based rhyme target from the single prior line", () => {
    // Only one complete lyric line exists before the in-progress one — not
    // enough for nextLineTargets to infer an actual scheme (AABB needs two
    // lines to show a rhyme at all) — but the line directly above is still
    // a reasonable position-based guess for the line being typed. With no
    // rhyme evidence yet this is a soft suggestion, not a hard requirement
    // (#79 / R6 §2.3 fix — the old version forced this as a hard target).
    const { system } = buildNextWordOptionsPrompt(input);
    expect(system).toContain("never fewer than 3");
    expect(system).toContain('ideally rhyme with "alone"');
    expect(system).not.toContain("must rhyme with");
    expect(system).toContain('kind="rhyme"');
  });

  it("asks for a hard rhyme with the line above once a scheme is established", () => {
    // road/code (lines 1-2) rhyme and close a couplet; "wide" (line 3) is
    // the odd-one-out awaiting its own partner — the couplet-parity rule
    // (§2.3) targets it as a hard requirement for the word being typed on
    // line 4, not "code" (closing an already-closed couplet would push
    // the verse toward AAA).
    const lyrics =
      "[Verse]\nI walk down the road\nsearching for a code\nunder a sky so wide\nthrough the empty ";
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics,
      currentLine: "through the empty ",
      textBeforeCursor: "through the empty ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(system).toContain('must rhyme with "wide"');
    expect(system).toContain("the line above");
    expect(system).not.toContain("two lines up");
    expect(system).toContain('kind="rhyme"');
  });

  it("names the target as two lines up, not the line above, for an ABAB scheme", () => {
    // "rain" (line 1) rhymes with "lane" (line 3); "tree" (line 2) rhymes
    // with neither — an alternating scheme. The word being typed on line
    // 4 should target line 2's end word ("tree"), two lines back, and the
    // instruction must say so instead of always saying "the line above".
    const lyrics =
      "I walk through the rain\nLost beneath a tree\nAlone down the lane\nI ";
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics,
      currentLine: "I ",
      textBeforeCursor: "I ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(system).toContain('must rhyme with "tree"');
    expect(system).toContain("two lines up");
    expect(system).not.toContain("the line above");
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
    // תפילה/הלילה (lines 1-2) rhyme and close a couplet; כחולים (line 3) is
    // the odd-one-out awaiting its own partner, so the hard target for the
    // word being typed on line 4 is "כחולים", not "הלילה".
    const lyrics = "אני שר תפילה\nלבד בתוך הלילה\nמתחת לשמיים כחולים\nברחוב ה";
    const { system } = buildNextWordOptionsPrompt({
      ...input,
      lyrics,
      currentLine: "ברחוב ה",
      textBeforeCursor: "ברחוב ה",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(system).toContain('לפחות אפשרות אחת חייבת להתחרז עם "כחולים"');
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

describe("verifyNextWordRhymes", () => {
  // Builds an Omit<LyricsSuggestionInput, "mode"> from a fixture the same
  // way scripts/lyrics-eval/runner.ts's deriveCursorInfo does: every
  // next_word fixture's cursor sits at the end of the lyrics, so
  // currentLine/textBeforeCursor are just the text after the last newline.
  function inputFromFixture(
    id: string,
  ): Parameters<typeof verifyNextWordRhymes>[1] {
    const f = fixture(id);
    const lineStart = f.lyrics.lastIndexOf("\n") + 1;
    const currentLine = f.lyrics.slice(lineStart);
    return {
      lyrics: f.lyrics,
      currentLine,
      textBeforeCursor: currentLine,
      selectionStart: f.cursor,
      selectionEnd: f.cursor,
      title: "Eval Song",
      bpm: f.bpm ?? null,
      key: f.key ?? null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      songContext: f.songContext ?? null,
    };
  }

  it("English: keeps the badge only for options that actually rhyme with the soft, position-based target (woke)", () => {
    // en-next-word-rhyme: a single finished line ending in "woke" — a soft,
    // position-based target (see impliedRhymeTarget). "spoke"/"smoke" are
    // real rhymes; "deep"/"dark" are the kind of unrelated word the model
    // tags "rhyme" in practice despite no actual rhyme (the bug this fixes).
    const out = verifyNextWordRhymes(
      [
        { text: " spoke", kind: "rhyme" },
        { text: " smoke", kind: "rhyme" },
        { text: " deep", kind: "rhyme" },
        { text: " dark", kind: "rhyme" },
        { text: " tears", kind: "continuation" },
      ],
      inputFromFixture("en-next-word-rhyme"),
    );
    expect(out).toEqual([
      { text: " spoke", kind: "rhyme" },
      { text: " smoke", kind: "rhyme" },
      { text: " deep", kind: "continuation" },
      { text: " dark", kind: "continuation" },
      { text: " tears", kind: "continuation" },
    ]);
  });

  it("English: keeps the badge for real rhymes and drops it for a non-rhyme against a different target (goodbyes)", () => {
    // en-next-word-context: single finished line ending in "goodbyes".
    // "skies"/"cries" are real rhymes; "coat" (a candidate actually seen
    // tagged kind="rhyme" against this kind of target in recorded evals)
    // isn't.
    const out = verifyNextWordRhymes(
      [
        { text: " skies", kind: "rhyme" },
        { text: " cries", kind: "rhyme" },
        { text: " coat", kind: "rhyme" },
      ],
      inputFromFixture("en-next-word-context"),
    );
    expect(out).toEqual([
      { text: " skies", kind: "rhyme" },
      { text: " cries", kind: "rhyme" },
      { text: " coat", kind: "continuation" },
    ]);
  });

  it("keeps the badge for either candidate when the rhyme scheme isn't settled yet (altWord)", () => {
    // Two finished lines ending in "road" and "sky", neither rhyming with
    // the other — freeVerseRhymeCandidates' k=2 case, which gives
    // impliedRhymeTarget both a primary word and an altWord. An option
    // tagged "rhyme" should keep the badge whichever of the two it matches.
    const lyrics = "I walk along the road\nThinking of the sky\nUnder the ";
    const input: Parameters<typeof verifyNextWordRhymes>[1] = {
      lyrics,
      currentLine: "Under the ",
      textBeforeCursor: "Under the ",
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      songContext: null,
    };
    const out = verifyNextWordRhymes(
      [
        { text: " code", kind: "rhyme" }, // rhymes with "road" (target.word)
        { text: " fly", kind: "rhyme" }, // rhymes with "sky" (target.altWord)
        { text: " cat", kind: "rhyme" }, // rhymes with neither
      ],
      input,
    );
    expect(out).toEqual([
      { text: " code", kind: "rhyme" },
      { text: " fly", kind: "rhyme" },
      { text: " cat", kind: "continuation" },
    ]);
  });

  it("downgrades every rhyme-tagged option when there is no rhyme target at all", () => {
    // No finished lines anywhere yet (the cursor is on the very first,
    // still-in-progress line) — impliedRhymeTarget returns undefined, so
    // nothing can be verified and every kind="rhyme" tag is downgraded.
    const lyrics = "I walk ";
    const input: Parameters<typeof verifyNextWordRhymes>[1] = {
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      songContext: null,
    };
    const out = verifyNextWordRhymes(
      [
        { text: " slowly", kind: "rhyme" },
        { text: " quietly", kind: "continuation" },
      ],
      input,
    );
    expect(out).toEqual([
      { text: " slowly", kind: "continuation" },
      { text: " quietly", kind: "continuation" },
    ]);
  });

  it("leaves non-rhyme-kind options untouched even when their last word would actually rhyme", () => {
    const out = verifyNextWordRhymes(
      [{ text: " spoke", kind: "continuation" }],
      inputFromFixture("en-next-word-rhyme"),
    );
    expect(out).toEqual([{ text: " spoke", kind: "continuation" }]);
  });

  it("Hebrew: keeps the badge for a real rhyme and drops it for a non-rhyme against the same target (פרידות)", () => {
    // he-next-word-context: single finished line ending in "פרידות".
    // "תמונות" shares the -ות suffix (a real rhyme per prosody/he.ts);
    // "ארון" is the kind of unrelated word recorded evals show the model
    // tagging kind="rhyme" despite no actual rhyme.
    const out = verifyNextWordRhymes(
      [
        { text: " תמונות", kind: "rhyme" },
        { text: " ארון", kind: "rhyme" },
      ],
      inputFromFixture("he-next-word-context"),
    );
    expect(out).toEqual([
      { text: " תמונות", kind: "rhyme" },
      { text: " ארון", kind: "continuation" },
    ]);
  });

  it("Hebrew: downgrades a last-letter-only slant even though the engine tags it, but keeps a perfect shared-suffix rhyme (פרידות)", () => {
    // he-next-word-context target: פרידות (rhymeKey "ות"). "הדלת"/"הבית"
    // share only a final ת with פרידות — he.ts's rhymes() calls that
    // "slant", but the badge is stricter than the eval checker and requires
    // "perfect". "תמונות" shares the -ות suffix (rhymeKey match) and is
    // "perfect", so it keeps the badge — this is the behavior change.
    const out = verifyNextWordRhymes(
      [
        { text: " הדלת", kind: "rhyme" },
        { text: " הבית", kind: "rhyme" },
        { text: " תמונות", kind: "rhyme" },
      ],
      inputFromFixture("he-next-word-context"),
    );
    expect(out).toEqual([
      { text: " הדלת", kind: "continuation" },
      { text: " הבית", kind: "continuation" },
      { text: " תמונות", kind: "rhyme" },
    ]);
  });

  it("English: keeps the badge for a two-word option whose last word rhymes (goodbyes)", () => {
    const out = verifyNextWordRhymes(
      [{ text: " tired eyes", kind: "rhyme" }],
      inputFromFixture("en-next-word-context"),
    );
    expect(out).toEqual([{ text: " tired eyes", kind: "rhyme" }]);
  });

  it("downgrades an empty or whitespace-only rhyme-tagged option without throwing", () => {
    const out = verifyNextWordRhymes(
      [
        { text: "", kind: "rhyme" },
        { text: "   ", kind: "rhyme" },
      ],
      inputFromFixture("he-next-word-context"),
    );
    expect(out).toEqual([
      { text: "", kind: "continuation" },
      { text: "   ", kind: "continuation" },
    ]);
  });

  it("Hebrew with niqqud: keeps the badge for a pointed perfect rhyme, downgrades a pointed last-letter slant (פרידות)", () => {
    const out = verifyNextWordRhymes(
      [
        { text: " תְּמוּנוֹת", kind: "rhyme" },
        { text: " הַדֶּלֶת", kind: "rhyme" },
      ],
      inputFromFixture("he-next-word-context"),
    );
    expect(out).toEqual([
      { text: " תְּמוּנוֹת", kind: "rhyme" },
      { text: " הַדֶּלֶת", kind: "continuation" },
    ]);
  });

  it("English: still keeps the badge for a slant rhyme (cold/woke), unaffected by the Hebrew tightening", () => {
    const out = verifyNextWordRhymes(
      [{ text: " cold", kind: "rhyme" }],
      inputFromFixture("en-next-word-rhyme"),
    );
    expect(out).toEqual([{ text: " cold", kind: "rhyme" }]);
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
  it("cursor inside a parenthetical ad-lib keeps the marker and drops the whole remark, not half-fragments", () => {
    // Splitting "(ooh yeah)" naively at the cursor used to leave "(ooh"
    // and "yeah)" in the lyrics block — neither half is a complete
    // remark token, so cleanLine couldn't strip either. The whole token
    // must be dropped, with the marker left where it used to be.
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
    expect(prompt).toContain("I walk alone ⟨CURSOR⟩ tonight");
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

  it("cursor strictly inside a [chord] token drops the whole bracket instead of leaking a half-fragment", () => {
    // Splitting "[Am]" naively at the cursor (between A and m) leaves "[A"
    // and "m]" — neither half is a complete bracket token, so cleanLine
    // can't strip either and both fragments would leak into the prompt.
    const lyrics = "I walk [Am]alone tonight";
    const cursor = lyrics.indexOf("m]");
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
    // The lyrics block passed to the model must drop the whole chord
    // bracket, not leak the "[A" / "m]" half-fragments splitting it at the
    // cursor would otherwise produce (the raw "Writer typed"/"Already
    // written" lines elsewhere in the prompt still quote what was
    // literally typed, chords included — that's unrelated and unchanged).
    expect(prompt).toContain("I walk ⟨CURSOR⟩alone tonight");
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
    // Not the en-completion-long eval fixture — its remaining budget is
    // small enough (<=3 syllables) to trigger the F2 short-finish wording
    // instead (see the dedicated describe block below); this fixture has
    // more room left on the line so it still gets the generic wording.
    const lyrics =
      "The city lights flicker like a dying flame\nEvery corner holds a memory I can't reclaim\nAnd still I find myself walking back to";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "And still I find myself walking back to",
      textBeforeCursor: "And still I find myself walking back to",
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

describe("R6 review F2: short-finish wording when almost nothing is left", () => {
  function promptForFixture(id: string) {
    const f = fixture(id);
    const lineStart = f.lyrics.lastIndexOf("\n", f.cursor - 1) + 1;
    const currentLine = f.lyrics.slice(lineStart, f.cursor);
    return buildLyricsSuggestionPrompt({
      lyrics: f.lyrics,
      currentLine,
      textBeforeCursor: currentLine,
      selectionStart: f.cursor,
      selectionEnd: f.cursor,
      title: "T",
      bpm: f.bpm ?? null,
      key: f.key ?? null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      songContext: f.songContext ?? null,
      mode: "completion",
    });
  }

  it("en-completion-long: finish-in-a-word-or-two wording, and no forced rhyme target (flame/reclaim is a genuine closed couplet)", () => {
    const { prompt } = promptForFixture("en-completion-long");
    expect(prompt).toMatch(
      /The line is almost complete: finish it in one or two words \(about \d+-\d+ syllables\) — don't start a new clause\./,
    );
    // "reclaim" is in the lyrics block itself (it's a real line of the
    // fixture) — the thing that must be absent is a forced rhyme target.
    expect(prompt).not.toMatch(/rhyme with: "reclaim"/);
  });

  it("a short Hebrew remaining budget gets the Hebrew finish-in-a-word-or-two wording", () => {
    const lyrics =
      "אורות העיר מרצדים כמו להבה גוועת\nכל פינה מחזיקה זיכרון שאיני יכול לשכוח\nועדיין אני מוצא את עצמי חוזר לאותו מקום הישן והחם";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "ועדיין אני מוצא את עצמי חוזר לאותו מקום הישן והחם",
      textBeforeCursor: "ועדיין אני מוצא את עצמי חוזר לאותו מקום הישן והחם",
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
      /השורה כמעט שלמה: סיים אותה במילה אחת או שתיים \(בערך \d+-\d+ הברות\) — אל תתחיל משפט חדש\./,
    );
  });
});

describe("R6: explicit rhyme target in the task text when a scheme is established", () => {
  it("completion", () => {
    // "rain"/"pain" close the first couplet; "door" doesn't rhyme with
    // "pain", so it opens a fresh, still-unpaired one — the line being
    // completed should target "door".
    const lyrics =
      "[Chorus]\nI walked down a street in the rain\nTrying to shake off the pain\nI found an old coat by the door\nOf every";
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
    expect(prompt).toContain('must rhyme with: "door"');
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

  it("Hebrew: genuine free verse (4+ prior lines, none of which rhyme) gets no forced rhyme target", () => {
    // Fixed bug: the old fallback always targeted the immediately preceding
    // line even when the prior lines show no AABB/ABAB pattern at all —
    // wrong for genuine free verse. R6 §2.3 still infers a soft, position-
    // based target for a 2nd/3rd/4th line with no scheme yet (see the
    // "respects the AABB/ABAB/free-verse scheme" describe block below), so
    // this needs 4+ non-rhyming prior lines to really have no target.
    const lyrics =
      "[פזמון]\nהיית האור היחיד בעיר שכבתה\nואני הייתי רק ילד רודף ניצוץ\nעכשיו הרחובות שקטים ואני נושא את הסימן\nמחפש משהו שכבר אינו קיים\nשל כל";
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

describe("fix: impliedRhymeTarget respects the AABB/ABAB/free-verse scheme (R6 §2.3)", () => {
  it("AABB closed couplet: a fresh 3rd line gets NO forced rhyme (last-line bias fix)", () => {
    // "rain"/"pain" (lines 1-2) rhyme and close a couplet. The 3rd line
    // starts a fresh pair, so forcing it to rhyme with "pain" would push
    // the verse toward an unintended AAA run — this is the exact bug the
    // review flagged (en-completion-long: "flame"/"reclaim").
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
    expect(prompt).not.toContain("rhyme with:");
  });

  it("monorhyme (AAA run): three lines that all actually rhyme still target the last line", () => {
    // "dark"/"spark"/"mark" all rhyme with each other, not just the last
    // two — a monorhyme run, not a closed AABB couplet. The naive "last two
    // lines rhyme -> couplet closed -> no target" rule would wrongly drop
    // the rhyme instruction here (en-completion-chorus-rhyme eval fixture).
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
    expect(prompt).toContain('must rhyme with: "mark"');
  });

  it("Hebrew monorhyme (AAA run): three lines that all actually rhyme still target the last line", () => {
    // Mirrors the English monorhyme case above, and the
    // he-completion-chorus-rhyme eval fixture: הזמן/ישן/הסימן all rhyme
    // with each other (shared -ן ending), so the run continues instead of
    // closing a couplet.
    const lyrics =
      "[פזמון]\nהיית האור היחיד בעיר שאיבדה את הזמן\nואני הייתי רק ילד שרדף אחרי חלום ישן\nעכשיו הרחובות שקטים ואני נושא את הסימן\nשל כל";
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
    expect(prompt).toContain('חייבת להתחרז עם: "הסימן"');
  });

  it("AABB with an unpaired intro line: a closed couplet gets NO target (parity would misfire here)", () => {
    // "sky" is an unpaired intro line; "door"/"floor" actually rhyme and
    // close the couplet. 3 finished lines is an odd count, so the old
    // line-count-parity rule would have wrongly forced a target onto the
    // line starting the next pair — the real check (do lines[n-1] and
    // lines[n-2] actually rhyme?) correctly reports no target.
    const lyrics =
      "Alone beneath a quiet sky\nI found an old coat by the door\nEvery lonely step led to the floor\nOf every";
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
    expect(prompt).not.toContain("rhyme with:");
  });

  it("AABB with an unpaired intro line: an open couplet DOES get a target (parity would misfire here too)", () => {
    // Same intro + closed "door"/"floor" couplet, plus "holds" which
    // doesn't rhyme with "floor" and so opens a fresh, still-unpaired
    // couplet. 4 finished lines is an even count, so the old parity rule
    // would have wrongly reported no target; the real rhyme check
    // correctly targets "holds" for the line being completed.
    const lyrics =
      "Alone beneath a quiet sky\nI found an old coat by the door\nEvery lonely step led to the floor\nNow I wonder what tomorrow holds\nOf every";
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
    expect(prompt).toContain('must rhyme with: "holds"');
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
    expect(prompt).toContain('must rhyme with: "tree"');
  });

  it("no scheme, line 3 (k=2): soft target is the 1st prior line", () => {
    const lyrics = "I walk through the city\nUnder the bridge at noon\nI ";
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
    expect(prompt).toContain('ideally rhyme with: "city"');
    expect(prompt).not.toContain("must rhyme with:");
  });

  it("no scheme, line 4 (k=3): soft target is the 2nd prior line, not the 3rd", () => {
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
    expect(prompt).toContain('ideally rhyme with: "noon"');
    expect(prompt).not.toContain("must rhyme with:");
  });

  it("free verse: 4+ prior lines with no rhyme anywhere get no forced target at all", () => {
    const lyrics =
      "I walk through the city\nUnder the bridge at noon\nThinking of nothing at all\nJust watching the traffic go by\nI ";
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

  it("single prior line still gets a soft, position-based target (next_word)", () => {
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
    expect(system).toContain('ideally rhyme with "alone"');
    expect(system).not.toContain("must rhyme with");
  });

  it("no scheme, line 3 (k=2, next_word): offers two rhyme-tagged options, one per candidate line", () => {
    const lyrics =
      "I walk through the city\nUnder the bridge at noon\nthrough the empty ";
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
    expect(system).toContain('ideally rhymes with "city"');
    expect(system).toContain('ideally rhymes with "noon"');
    expect(system).not.toContain("must rhyme with");
  });

  it("no scheme, line 4 (k=3, next_word): offers two rhyme-tagged options for the 2nd and 3rd lines", () => {
    const lyrics =
      "I walk through the city\nUnder the bridge at noon\nThinking of nothing at all\nthrough the empty ";
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
    expect(system).toContain('ideally rhymes with "noon"');
    expect(system).toContain('ideally rhymes with "all"');
  });

  it("free verse: 4+ prior lines with no rhyme anywhere get no target at all (next_word)", () => {
    const lyrics =
      "I walk through the city\nUnder the bridge at noon\nThinking of nothing at all\nJust watching the traffic go by\nthrough the empty ";
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
    expect(system).not.toContain("rhyme with");
    expect(system).toContain(
      'Mark kind="rhyme" only for an option that rhymes with the end of an earlier line',
    );
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

  it("infers a line position from blank-line-separated stanzas when there's no [Section] header", () => {
    // #79: a headerless draft still has stanzas — blank lines bound them —
    // so the prompt can still say "line N of it" instead of saying nothing.
    const lyrics =
      "I packed my bags before the sun came up\nI left a note behind\n\nNow the city hums a different tune\nI ";
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
    // The cursor's stanza is the 2nd block, not the whole song — "line 2
    // of it" (one finished line — "Now the city hums a different tune" —
    // plus the in-progress "I " being completed right now, which in
    // completion mode doesn't yet count as its own finished line; see the
    // R6 line-position fix below), not some line number counting from the
    // very first stanza.
    expect(prompt).toContain("Current section: this verse (line 2 of it)");
    expect(prompt).not.toContain("line 3 of it");
    expect(prompt).not.toContain("line 4 of it");
  });

  it("says nothing about section/line position for a genuinely empty draft", () => {
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics: "",
      currentLine: "",
      textBeforeCursor: "",
      selectionStart: 0,
      selectionEnd: 0,
      title: "T",
      bpm: null,
      key: null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      mode: "next_line",
    });
    expect(prompt).not.toContain("Current section");
  });

  it("does not count the cursor's own in-progress line as finished in completion mode", () => {
    // Three finished lines, then "And so are " is still being completed —
    // it's the 4th line of the section, not the 5th. The old code counted
    // the cursor's line as finished just because the cursor sits at its
    // end (true even mid-completion, since there's nothing typed after
    // it), double-counting it.
    const lyrics =
      "Line one here today\nLine two also fine\nLine three keeps going\nAnd so are ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "And so are ",
      textBeforeCursor: "And so are ",
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
    expect(prompt).toContain("Current section: this verse (line 4 of it)");
    expect(prompt).not.toContain("line 5 of it");
  });

  it("the first line of a freshly-headered chorus is line 1, not line 2, in completion mode", () => {
    const lyrics = "[Chorus]\nla la ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "la la ",
      textBeforeCursor: "la la ",
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
    expect(prompt).toContain("Current section: Chorus (line 1 of it)");
    expect(prompt).not.toContain("line 2 of it");
  });

  it("DOES count the cursor's finished line in next_line mode, since the next line comes after it", () => {
    const lyrics = "Line one\nLine two\nLine three";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "Line three",
      textBeforeCursor: "Line three",
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
    expect(prompt).toContain("Current section: this verse (line 4 of it)");
  });

  it("a headerless draft with the cursor on a blank line treats it as continuing the stanza above, not starting a new one", () => {
    // The old stanzaStartAt matched the cursor's OWN blank line as the
    // separator, forcing sectionStart just past the cursor and always
    // reporting line 1 no matter how much of the stanza above was
    // already written.
    const lyrics = "Line one\nLine two\nLine three\n";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "",
      textBeforeCursor: "",
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
    expect(prompt).toContain("Current section: this verse (line 4 of it)");
    expect(prompt).not.toContain("line 1 of it");
  });
});

describe("R6 review fix 1: a repeated chorus line is a refrain, not something to copy", () => {
  function promptForFixture(id: string) {
    const f = fixture(id);
    const lineStart = f.lyrics.lastIndexOf("\n", f.cursor - 1) + 1;
    const currentLine = f.lyrics.slice(lineStart);
    return buildLyricsSuggestionPrompt({
      lyrics: f.lyrics,
      currentLine,
      textBeforeCursor: currentLine,
      selectionStart: f.cursor,
      selectionEnd: f.cursor,
      title: "T",
      bpm: f.bpm ?? null,
      key: f.key ?? null,
      timeSignature: null,
      globalProfile: null,
      projectProfile: null,
      recentAccepted: [],
      songContext: f.songContext ?? null,
      mode: "next_line",
    });
  }

  it('en-edge-chords-chorus: targets "comes" and tells the model to extend, not repeat', () => {
    const { prompt } = promptForFixture("en-edge-chords-chorus");
    expect(prompt).toContain('rhymes with: "comes"');
    expect(prompt).toContain(
      "This repeated chorus is already as long as the earlier one; write a new line that extends it. Don't repeat an existing line.",
    );
  });

  it('he-edge-chords-chorus: targets "מגיע" and tells the model (in Hebrew) to extend, not repeat', () => {
    const { prompt } = promptForFixture("he-edge-chords-chorus");
    expect(prompt).toContain('מתחרזת עם: "מגיע"');
    expect(prompt).toContain(
      "הפזמון החוזר כבר באורך של הפזמון הקודם; כתוב שורה חדשה שמרחיבה אותו. אל תחזור על שורה קיימת.",
    );
  });

  it("mirrors the earlier chorus's line when it HAS a line at this position", () => {
    const lyrics =
      "[Chorus]\nWe rise again\nWhen the night is long\n[Chorus]\nWe rise again\n";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: "",
      textBeforeCursor: "",
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
    expect(prompt).toContain(
      'The earlier chorus has this line here: "When the night is long" — mirror it.',
    );
    expect(prompt).not.toContain("already as long as the earlier one");
  });
});

describe("#79: punctuation awareness for completion", () => {
  const base = {
    title: "T",
    bpm: null,
    key: null,
    timeSignature: null,
    globalProfile: null,
    projectProfile: null,
    recentAccepted: [],
    mode: "completion" as const,
  };

  it("tells the model to continue mid-clause after a comma", () => {
    const lyrics = "I walked away, ";
    const { prompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(prompt).toContain("ends mid-clause");
    expect(prompt).not.toContain("ends a full sentence");
  });

  it("tells the model to start a fresh clause after a period", () => {
    const lyrics = "I walked away. ";
    const { prompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(prompt).toContain("ends a full sentence");
    expect(prompt).not.toContain("ends mid-clause");
  });

  it("says the same for ! and ? as for a period", () => {
    for (const mark of ["!", "?"]) {
      const lyrics = `I walked away${mark} `;
      const { prompt } = buildLyricsSuggestionPrompt({
        ...base,
        lyrics,
        currentLine: lyrics,
        textBeforeCursor: lyrics,
        selectionStart: lyrics.length,
        selectionEnd: lyrics.length,
      });
      expect(prompt).toContain("ends a full sentence");
    }
  });

  it("treats an ellipsis as mid-clause (trailing off), not a sentence end", () => {
    for (const ellipsis of ["...", "…"]) {
      const lyrics = `I walked away${ellipsis} `;
      const { prompt } = buildLyricsSuggestionPrompt({
        ...base,
        lyrics,
        currentLine: lyrics,
        textBeforeCursor: lyrics,
        selectionStart: lyrics.length,
        selectionEnd: lyrics.length,
      });
      expect(prompt).toContain("ends mid-clause");
      expect(prompt).not.toContain("ends a full sentence");
    }
  });

  it("says nothing when the text doesn't end in clause-boundary punctuation", () => {
    const lyrics = "I walked away";
    const { prompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics,
      selectionStart: lyrics.length,
      selectionEnd: lyrics.length,
    });
    expect(prompt).not.toContain("ends mid-clause");
    expect(prompt).not.toContain("ends a full sentence");
  });

  it("has a Hebrew version for both postures", () => {
    const midClause = "הלכתי משם, ";
    const { prompt: midPrompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics: midClause,
      currentLine: midClause,
      textBeforeCursor: midClause,
      selectionStart: midClause.length,
      selectionEnd: midClause.length,
    });
    expect(midPrompt).toContain("אמצע משפט");

    const newClause = "הלכתי משם. ";
    const { prompt: newPrompt } = buildLyricsSuggestionPrompt({
      ...base,
      lyrics: newClause,
      currentLine: newClause,
      textBeforeCursor: newClause,
      selectionStart: newClause.length,
      selectionEnd: newClause.length,
    });
    expect(newPrompt).toContain("סוף משפט");
  });
});

describe("#79: completion doesn't repeat text already after the cursor", () => {
  it("tells the model what's already written after the cursor", () => {
    const lyrics = "I walk alone tonight";
    const cursor = "I walk ".length;
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
    expect(prompt).toContain(
      'Already written after the cursor: "alone tonight"',
    );
  });

  it("says nothing about after-cursor text when the cursor is at the end of the line", () => {
    const lyrics = "I walk ";
    const { prompt } = buildLyricsSuggestionPrompt({
      lyrics,
      currentLine: lyrics,
      textBeforeCursor: lyrics,
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
    expect(prompt).not.toContain("Already written after the cursor");
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
      "",
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
      "",
    );
    expect(out).toEqual([
      { mode: "next_line", text: "a line", label: "rhyme" },
    ]);
  });

  it("drops a next_line/completion/alternative item that's a verbatim copy of an existing lyric line", () => {
    const lyrics = "[Chorus]\nWe rise again when the morning comes\n";
    const out = sanitizePopupSuggestions(
      [
        {
          mode: "next_line" as const,
          text: "We rise again when the morning comes",
        },
        { mode: "next_line" as const, text: "A brand new thought" },
      ],
      "",
      lyrics,
    );
    expect(out).toEqual([{ mode: "next_line", text: "A brand new thought" }]);
  });

  it("does not drop a next_word item even if it happens to match a whole existing line", () => {
    const lyrics = "comes\n";
    const out = sanitizePopupSuggestions(
      [{ mode: "next_word" as const, text: "comes" }],
      "",
      lyrics,
    );
    expect(out).toEqual([{ mode: "next_word", text: "comes" }]);
  });

  it("the chorus-mirror allow exemption keeps the mirrored line", () => {
    const lyrics = "[Chorus]\nWe rise again when the morning comes\n";
    const out = sanitizePopupSuggestions(
      [
        {
          mode: "next_line" as const,
          text: "We rise again when the morning comes",
        },
      ],
      "",
      lyrics,
      "We rise again when the morning comes",
    );
    expect(out).toEqual([
      { mode: "next_line", text: "We rise again when the morning comes" },
    ]);
  });
});

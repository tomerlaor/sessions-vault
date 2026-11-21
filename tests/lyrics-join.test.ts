import { describe, it, expect, beforeAll } from "vitest";
import { smartJoinCompletion } from "../src/lib/lyrics-join";
import { loadEnglishDict } from "../src/lib/prosody";

beforeAll(async () => {
  await loadEnglishDict();
});

// Full joined line, the way the app and the eval harness both render it:
// prefix followed by whatever smartJoinCompletion decides to insert.
function join(prefix: string, suggestion: string): string {
  return prefix + smartJoinCompletion(prefix, suggestion);
}

describe("smartJoinCompletion", () => {
  it("adds a space between two finished words (#102 repro)", () => {
    expect(join("could not", "say")).toBe("could not say");
  });

  it("does not double a space the prefix already has", () => {
    expect(join("I ", "walk")).toBe("I walk");
  });

  it("does not add a space when the suggestion already starts with one", () => {
    expect(smartJoinCompletion("could not", " say")).toBe(" say");
    expect(join("could not", " say")).toBe("could not say");
  });

  describe("prefix ends in whitespace: strip the suggestion's leading spaces/tabs", () => {
    it('"not " + " say" -> "not say" (no double space)', () => {
      expect(smartJoinCompletion("not ", " say")).toBe("say");
      expect(join("not ", " say")).toBe("not say");
    });

    it("collapses a doubled-up space between prefix and suggestion", () => {
      expect(smartJoinCompletion("I ", " walk")).toBe("walk");
      expect(join("I ", " walk")).toBe("I walk");
    });

    it("strips leading tabs too", () => {
      expect(smartJoinCompletion("not ", "\tsay")).toBe("say");
    });

    it("never strips a leading newline (a line break is meaningful)", () => {
      expect(smartJoinCompletion("not ", "\nsay")).toBe("\nsay");
      expect(join("not ", "\nsay")).toBe("not \nsay");
    });
  });

  describe("Latin mid-word completions stay glued (fragment is not itself a word)", () => {
    it('"tomor" + "row" -> "tomorrow"', () => {
      expect(join("tomor", "row")).toBe("tomorrow");
    });

    it('"toget" + "her" -> "together"', () => {
      expect(join("toget", "her")).toBe("together");
    });

    it('"beauti" + "ful" -> "beautiful"', () => {
      expect(join("beauti", "ful")).toBe("beautiful");
    });
  });

  describe("Latin completions starting a new word get a space", () => {
    it('"walking back to the same old" + "place" -> adds a space', () => {
      expect(join("walking back to the same old", "place")).toBe(
        "walking back to the same old place",
      );
    });

    it('"Of every" + "word" -> adds a space', () => {
      expect(join("Of every", "word")).toBe("Of every word");
    });

    it('"it won\'t be" + "long" -> adds a space ("be" is already a word)', () => {
      expect(join("it won't be", "long")).toBe("it won't be long");
    });

    it('"so" + "me" -> adds a space ("so" is already a word)', () => {
      expect(join("so", "me")).toBe("so me");
    });

    it('"in" + "to the night" -> adds a space ("in" is already a word)', () => {
      expect(join("in", "to the night")).toBe("in to the night");
    });

    it('"for" + "ever" -> adds a space ("for" is already a word)', () => {
      expect(join("for", "ever")).toBe("for ever");
    });

    it('"be" + "cause" -> adds a space ("be" is already a word)', () => {
      expect(join("be", "cause")).toBe("be cause");
    });

    it('"no" + "thing" -> adds a space ("no" is already a word)', () => {
      expect(join("no", "thing")).toBe("no thing");
    });

    it('"a" + "live" -> adds a space ("a" is already a word)', () => {
      expect(join("a", "live")).toBe("a live");
    });

    it('"to" + "gether" -> adds a space ("to" is already a word)', () => {
      expect(join("to", "gether")).toBe("to gether");
    });
  });

  describe("accepted trade-off: a complete-word fragment that was actually mid-word still gets a space", () => {
    it('"to" + "morrow" -> "to morrow" (rarer than the common case above, visible in the ghost preview)', () => {
      expect(join("to", "morrow")).toBe("to morrow");
    });

    it('"I wan" + "na" -> "I wan na" ("wan" is itself a known word)', () => {
      expect(join("I wan", "na")).toBe("I wan na");
    });
  });

  describe("non-ASCII letters count as letters (Unicode \\p{L}/\\p{M}, not just [A-Za-z])", () => {
    it("a prefix ending in an accented letter is still recognized as a word boundary and can glue", () => {
      // With the old [A-Za-z]-only regexes, a prefix ending in "é" would
      // never even enter this branch (it would fall straight through to
      // the space default). "understané" is constructed so the "é" is a
      // decorative extra letter, not one the real spelling needs:
      // isKnownEnglishWord() strips non-ASCII letters before looking a
      // word up, so the fragment normalizes to "understan" (not a word,
      // so it doesn't take the early "fragment is already a word" exit),
      // and the combined "understané" + "ding" normalizes to
      // "understanding" — a real word — so it glues.
      expect(join("understané", "ding")).toBe("understanéding");
    });

    it('documented limit: "café" + "s" gets a space, not "cafés"', () => {
      // Here the accent isn't decorative — "café" without it normalizes to
      // "caf" (not a word), and "cafés" normalizes to "cafs" (also not a
      // word, since stripping the accent deletes the letter rather than
      // replacing it with a plain "e"). Neither check matches, so this
      // falls through to the space default rather than gluing.
      expect(join("café", "s")).toBe("café s");
    });
  });

  describe("punctuation", () => {
    it("a suggestion starting with closing punctuation stays glued", () => {
      expect(join("love", ", baby")).toBe("love, baby");
    });

    it("a prefix ending in an opening bracket stays glued", () => {
      expect(join("He said (", "quietly")).toBe("He said (quietly");
    });

    it("a prefix ending in sentence punctuation gets a space", () => {
      expect(join("Hello.", "World")).toBe("Hello. World");
    });
  });

  describe("quotes and apostrophes", () => {
    it("an opening single quote preceded by whitespace stays glued", () => {
      expect(join("said '", "hello'")).toBe("said 'hello'");
    });

    it("an opening double quote preceded by whitespace stays glued", () => {
      expect(join('say "', 'hi"')).toBe('say "hi"');
    });

    it("an opening quote at the very start of the text stays glued", () => {
      expect(join("'", "hello")).toBe("'hello");
    });

    it("a possessive apostrophe after a letter gets a space, not glued", () => {
      expect(join("boys'", "toys")).toBe("boys' toys");
    });

    it("a contraction apostrophe followed by a suffix glues", () => {
      expect(join("don'", "t")).toBe("don't");
      expect(join("I'", "ll see you")).toBe("I'll see you");
      expect(join("we'", "re here")).toBe("we're here");
      expect(join("they'", "ve gone")).toBe("they've gone");
    });

    it("a closing double quote after a letter gets a space", () => {
      expect(join('he said "hi"', "Then")).toBe('he said "hi" Then');
    });

    it("curly quotes are handled the same as straight ones", () => {
      expect(join("said ‘", "hello’")).toBe("said ‘hello’");
      expect(join("boys’", "toys")).toBe("boys’ toys");
    });
  });

  describe("dashes", () => {
    it("a hyphen directly after a letter is a compound and stays glued", () => {
      expect(join("love-", "forever")).toBe("love-forever");
    });

    it("an em dash directly after a letter is a compound and stays glued", () => {
      expect(join("love—", "forever")).toBe("love—forever");
    });

    it("a spaced em dash is a separator and gets a space after", () => {
      expect(join("love —", "forever")).toBe("love — forever");
    });

    it("a prefix ending in a hyphen stays glued (compound word)", () => {
      expect(join("co-", "writer")).toBe("co-writer");
    });

    it("a suggestion starting with an em dash stays glued (no space added)", () => {
      expect(join("love", "—forever")).toBe("love—forever");
    });

    it("a suggestion starting with a space then a dash is left untouched", () => {
      expect(join("love", " — forever")).toBe("love — forever");
    });
  });

  describe("Hebrew", () => {
    it('"חושב על כל הדברים שלא" + "נאמרו" -> adds a space', () => {
      expect(join("חושב על כל הדברים שלא", "נאמרו")).toBe(
        "חושב על כל הדברים שלא נאמרו",
      );
    });

    it('"של כל" + "הלילות" -> adds a space', () => {
      expect(join("של כל", "הלילות")).toBe("של כל הלילות");
    });

    it('"הלכתי" + "לבד" -> adds a space', () => {
      expect(join("הלכתי", "לבד")).toBe("הלכתי לבד");
    });

    it("a prefix ending in a Hebrew final-form letter still gets a space", () => {
      // ך is the final form of כ — the word is unambiguously complete,
      // consistent with (not an exception to) the Hebrew default.
      expect(join("לך", "לבד")).toBe("לך לבד");
    });

    it("a prefix ending in a maqaf (hyphen) stays glued", () => {
      expect(join("תל־", "אביב")).toBe("תל־אביב");
    });

    describe("single-letter prefixes/conjunctions glue onto the next word", () => {
      it('"ו" (and) + "אהבה" -> "ואהבה"', () => {
        expect(join("ו", "אהבה")).toBe("ואהבה");
      });

      it('"ב" (in) + "לב" -> "בלב"', () => {
        expect(join("ב", "לב")).toBe("בלב");
      });

      it('mid-sentence: "אני ו" (I and) + "את" -> "אני ואת"', () => {
        expect(join("אני ו", "את")).toBe("אני ואת");
      });
    });

    describe("mid-word heuristics", () => {
      it('suggestion starting with a final-form letter continues the word: "שָׁלוֹ" + "ם" -> "שלום"', () => {
        expect(join("שָׁלוֹ", "ם")).toBe("שָׁלוֹם");
      });

      it("prefix ending in a non-final form (of a letter with a final form), run length >= 2, is unfinished", () => {
        // "מכ" ends in כ (non-final kaf) with a 2-letter run, so the word
        // can't be finished yet (Hebrew never ends a word on that form).
        expect(join("מכ", "תב")).toBe("מכתב");
      });
    });
  });

  describe("mixed scripts", () => {
    it("Hebrew prefix + Latin suggestion gets a space", () => {
      expect(join("שלום", "world")).toBe("שלום world");
    });

    it("Latin prefix + Hebrew suggestion gets a space", () => {
      expect(join("hello", "שלום")).toBe("hello שלום");
    });
  });

  describe("edge cases", () => {
    it("empty suggestion is a no-op", () => {
      expect(smartJoinCompletion("I walk", "")).toBe("");
      expect(join("I walk", "")).toBe("I walk");
    });

    it("empty prefix (start of line/doc) never gets a leading space", () => {
      expect(smartJoinCompletion("", "walk")).toBe("walk");
    });
  });
});

describe("ghost text matches what accept inserts (#102)", () => {
  // LyricsAiOverlay renders ghost text and handleAccept's insert text by
  // calling smartJoinCompletion with the exact same (prefix, suggestion)
  // pair — asserting that invariant directly here is what guarantees the
  // ghost preview and the real insert can never disagree.
  it("produces identical text for the overlay's ghost preview and its insert path", () => {
    const draft = "I could not";
    const selectionStart = draft.length;
    const suggestion = "say hello";
    const prefix = draft.slice(0, selectionStart);

    const ghostPreview = prefix + smartJoinCompletion(prefix, suggestion);
    const insertedDraft =
      draft.slice(0, selectionStart) +
      smartJoinCompletion(prefix, suggestion) +
      draft.slice(selectionStart);

    expect(insertedDraft).toBe("I could not say hello");
    expect(ghostPreview).toBe(insertedDraft);
  });

  it("holds for a glued mid-word completion too", () => {
    const draft = "tomor";
    const selectionStart = draft.length;
    const suggestion = "row";
    const prefix = draft.slice(0, selectionStart);

    const ghostPreview = prefix + smartJoinCompletion(prefix, suggestion);
    const insertedDraft =
      draft.slice(0, selectionStart) +
      smartJoinCompletion(prefix, suggestion) +
      draft.slice(selectionStart);

    expect(insertedDraft).toBe("tomorrow");
    expect(ghostPreview).toBe(insertedDraft);
  });
});

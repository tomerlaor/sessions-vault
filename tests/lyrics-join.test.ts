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

  it("never strips whitespace that's already there on both sides", () => {
    // Rule 3 only avoids ADDING a space — it doesn't collapse one that's
    // already doubled up between the prefix and the suggestion.
    expect(smartJoinCompletion("I ", " walk")).toBe(" walk");
    expect(join("I ", " walk")).toBe("I  walk");
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

    it('"in" + "to" -> adds a space ("in" is already a word)', () => {
      expect(join("in", "to")).toBe("in to");
    });

    it('"for" + "ever" -> adds a space ("for" is already a word)', () => {
      expect(join("for", "ever")).toBe("for ever");
    });

    it('"no" + "thing" -> adds a space ("no" is already a word)', () => {
      expect(join("no", "thing")).toBe("no thing");
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

  describe("punctuation", () => {
    it("a suggestion starting with closing punctuation stays glued", () => {
      expect(join("love", ", baby")).toBe("love, baby");
    });

    it("a prefix ending in an opening bracket stays glued", () => {
      expect(join("He said (", "quietly")).toBe("He said (quietly");
    });

    it("a prefix ending in a hyphen stays glued (compound word)", () => {
      expect(join("co-", "writer")).toBe("co-writer");
    });

    it("a prefix ending in sentence punctuation gets a space", () => {
      expect(join("Hello.", "World")).toBe("Hello. World");
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

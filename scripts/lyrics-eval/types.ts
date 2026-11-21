import type { EvalExpect, EvalLang, EvalMode } from "./checks";

// A single eval fixture, loaded from tests/fixtures/lyrics-eval/*.json.
//
// `cursor` is a UTF-16/JS string index into `lyrics` (equivalent to a
// textarea's `selectionStart`). The runner derives from it:
//   - currentLine        — the line containing the cursor
//   - textBeforeCursor   — currentLine up to the cursor
//   - selectionStart      = cursor
//   - selectionEnd         = cursor, EXCEPT for mode "alternative": there,
//                            selectionEnd is the end of the line containing
//                            the cursor (selection = "the current line"),
//                            so determineSuggestionMode's selection-based
//                            branch and buildLyricsSuggestionPrompt's
//                            "rephrase this line" framing are both exercised.
export interface EvalFixture {
  id: string;
  lang: EvalLang;
  mode: EvalMode;
  lyrics: string;
  cursor: number;
  songContext?: string;
  bpm?: number;
  key?: string;
  expect: EvalExpect;
  // Free-text flag surfaced in the markdown report (see report.ts) when a
  // fixture's lyrics/expectation were rewritten for reasons unrelated to
  // the model under test — so a pass-rate delta against an older report
  // isn't mistaken for a real regression/improvement on this case.
  notes?: string;
}

export { type EvalExpect, type EvalLang, type EvalMode };

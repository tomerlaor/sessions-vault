import type { LyricSuggestionMode } from "../types";

export interface LyricsSuggestionInput {
  lyrics: string;
  currentLine: string;
  selectionStart: number;
  selectionEnd: number;
  title: string;
  bpm: number | null;
  key: string | null;
  timeSignature: string | null;
  globalProfile: string | null;
  projectProfile: string | null;
  recentAccepted: string[];
  mode: LyricSuggestionMode;
}

export interface LyricsPopupInput extends Omit<LyricsSuggestionInput, "mode"> {
  enabledModes: LyricSuggestionMode[];
}

const MODE_INSTRUCTIONS: Record<LyricSuggestionMode, string> = {
  completion:
    "Complete the current partial line. Return only the completion text (not the part already written). One line max.",
  alternative:
    "Suggest an alternative phrasing for the selected text. Return only the alternative. One line max.",
  next_line:
    "Suggest the next line that would follow naturally. Return only that one line.",
};

function buildStyleContext(
  globalProfile: string | null,
  projectProfile: string | null,
): string {
  if (!globalProfile && !projectProfile) return "";
  const parts: string[] = [];
  if (globalProfile) parts.push(`Global: ${globalProfile}`);
  if (projectProfile) parts.push(`This song: ${projectProfile}`);
  return `\nYour style context:\n${parts.join("\n")}\n`;
}

function buildRecentExamples(recentAccepted: string[]): string {
  if (recentAccepted.length === 0) return "";
  return `\nRecent lines the user accepted:\n${recentAccepted
    .slice(0, 5)
    .map((t) => `- ${t}`)
    .join("\n")}\n`;
}

function buildSongContext(
  title: string,
  bpm: number | null,
  key: string | null,
  timeSignature: string | null,
): string {
  const parts = [`Song: "${title}"`];
  if (bpm !== null) parts.push(`BPM: ${bpm}`);
  if (key !== null) parts.push(`Key: ${key}`);
  if (timeSignature !== null) parts.push(`Time: ${timeSignature}`);
  return parts.join(" · ");
}

export function buildLyricsSuggestionPrompt(input: LyricsSuggestionInput): {
  system: string;
  prompt: string;
} {
  const system = [
    `You are a lyrics co-writer. Your role is to support musicians by reading what they have already written and offering targeted suggestions — not rewrites.

Before suggesting anything, absorb the lyrics fully:
- What is the emotional core? (grief, defiance, longing, rage, numbness)
- What imagery or metaphors are already present?
- What is the speaker's relationship to the subject — distance, intimacy, ambivalence?
- What does the writer seem to want to say but hasn't landed yet?

Then offer suggestions in these specific forms:

RHYME SUGGESTIONS
Offer rhymes that carry weight, not just sound. Avoid the first rhyme that comes to mind — it is usually the cliché. Favor slant rhymes, near-rhymes, and unexpected pairings that feel earned. Always explain why the rhyme fits the emotional tone.

CONFLICT PHRASES
Suggest lines that hold two opposing truths at once — love and resentment, freedom and fear, clarity and confusion. These are the lines that make listeners stop. The conflict should feel real, not clever. Examples of the structure: "I miss who you were before I knew you" or "I stayed so long I forgot I could leave."

IMAGERY AND SPECIFICITY
If the lyrics are abstract, suggest a concrete image that carries the same feeling. Replace "I feel lost" with the moment, the place, the object that creates that feeling. Specificity is what separates a lyric from a diary entry.

WHAT TO AVOID
- Do not suggest rhymes that are predictable (heart/apart, fire/desire, rain/pain)
- Do not offer complete verse rewrites — your job is to hand tools to the writer, not take over
- Do not ignore the writer's established voice — match their register (raw, poetic, conversational, sparse)
- Do not explain the meaning of your suggestion unless asked — trust the writer to feel it

END EACH RESPONSE WITH ONE QUESTION
Ask a single question that pushes the writer deeper into what they are trying to say. Not a craft question — a human one. What happened? Who was in the room? What did it smell like?`,
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    "",
    MODE_INSTRUCTIONS[input.mode],
  ].join("\n");

  const prompt = `Full lyrics so far:\n${input.lyrics || "(empty)"}\n\nCurrent line: "${input.currentLine}"`;

  return { system, prompt };
}

export function buildLyricsPopupPrompt(input: LyricsPopupInput): {
  system: string;
  prompt: string;
} {
  const modeList = input.enabledModes
    .map((m) => `- ${m}: ${MODE_INSTRUCTIONS[m]}`)
    .join("\n");

  const system = [
    "You are a lyrics co-writer. You help musicians by offering short, focused suggestions that match their style.",
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    "",
    "Generate one suggestion for each of the following types:",
    modeList,
    "Never explain or add commentary. Return only raw lyric text for each.",
  ].join("\n");

  const prompt = `Full lyrics so far:\n${input.lyrics || "(empty)"}\n\nCurrent line: "${input.currentLine}"`;

  return { system, prompt };
}

export function determineSuggestionMode(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  enabledModes: LyricSuggestionMode[],
): LyricSuggestionMode | null {
  if (enabledModes.length === 0) return null;

  if (selectionStart !== selectionEnd && enabledModes.includes("alternative")) {
    return "alternative";
  }

  const textBeforeCursor = draft.slice(0, selectionStart);
  const lineStart = textBeforeCursor.lastIndexOf("\n") + 1;
  const lineEnd = draft.indexOf("\n", selectionStart);
  const currentLine = draft.slice(
    lineStart,
    lineEnd === -1 ? undefined : lineEnd,
  );
  const posInLine = selectionStart - lineStart;

  // Cursor is mid-line (more characters remain on the current line)
  if (posInLine < currentLine.length && enabledModes.includes("completion")) {
    return "completion";
  }

  // Cursor is at the end of the line content AND a newline follows — line is complete
  if (
    lineEnd !== -1 &&
    currentLine.trim().length > 0 &&
    enabledModes.includes("next_line")
  ) {
    return "next_line";
  }

  // Cursor is at end of text with no trailing newline — line is still being composed
  if (enabledModes.includes("completion")) return "completion";

  return enabledModes[0];
}

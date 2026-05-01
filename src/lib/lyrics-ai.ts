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
    "You are a lyrics co-writer. You help musicians by offering short, focused suggestions that match their style.",
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    "",
    MODE_INSTRUCTIONS[input.mode],
    "Never explain or add commentary. Return only the raw lyric text.",
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

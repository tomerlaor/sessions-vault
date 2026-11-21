import type { LyricSuggestionMode } from "../types";
import {
  cleanLine,
  countSyllables,
  currentSection,
  loadEnglishDict,
  nextLineTargets,
  type ProsodyLang,
} from "./prosody";

// Warms the English dictionary on first use of this module so later calls
// get dictionary-backed rhymes/syllables; every nextLineTargets() call
// below stays synchronous and falls back to a heuristic until this
// resolves.
void loadEnglishDict();

export interface LyricsSuggestionInput {
  lyrics: string;
  currentLine: string;
  textBeforeCursor: string; // text on the current line up to the cursor
  selectionStart: number;
  selectionEnd: number;
  title: string;
  bpm: number | null;
  key: string | null;
  timeSignature: string | null;
  globalProfile: string | null;
  projectProfile: string | null;
  recentAccepted: string[];
  // The writer's own short description of the song: subject, mood, meaning.
  songContext?: string | null;
  // next_word has its own multi-option flow (buildNextWordOptionsPrompt).
  mode: Exclude<LyricSuggestionMode, "next_word">;
}

export interface LyricsPopupInput extends Omit<LyricsSuggestionInput, "mode"> {
  enabledModes: LyricSuggestionMode[];
}

// eslint-disable-next-line no-misleading-character-class -- Hebrew presentation forms are intentional
const HEBREW_RE = /[א-תיִ-פֿ]/;

function isHebrew(text: string): boolean {
  return HEBREW_RE.test(text);
}

// R6: an empty draft has no lyrics/currentLine to sniff for Hebrew, so this
// falls back to songContext and then title before giving up. Without this a
// fresh Hebrew song (empty lyrics, Hebrew songContext) always picked the
// English prompt set and the model answered in English about a Hebrew brief
// it could clearly see — not a wording problem, a wrong-language-prompt bug.
function detectHebrewContext(input: {
  lyrics: string;
  currentLine: string;
  songContext?: string | null;
  title?: string;
}): boolean {
  return isHebrew(
    input.lyrics || input.currentLine || input.songContext || input.title || "",
  );
}

// Extract the last word of a line (used for rhyme context)
function lastWord(line: string): string {
  const words = line.trimEnd().split(/\s+/);
  return words[words.length - 1] ?? "";
}

// The lyrics up to (but not including) the line the cursor is currently
// composing — used so next_word's rhyme hint is judged against the last
// *finished* lyric line, never the in-progress one being typed.
function draftBeforeCurrentLine(
  lyrics: string,
  selectionStart: number,
): {
  draft: string;
  cursor: number;
} {
  const lineStart = lyrics.lastIndexOf("\n", selectionStart - 1) + 1;
  const draft = lyrics.slice(0, lineStart).replace(/\n+$/, "");
  return { draft, cursor: draft.length };
}

function stripTrailingPunct(word: string): string {
  return word.replace(/[^\p{L}\p{N}'’-]+$/u, "");
}

// The line being finished right now (next_word/completion) needs a concrete
// rhyme target, not just "whatever scheme the song has settled into so
// far". nextLineTargets() only names one once two lines have actually
// rhymed (AABB) or a third confirms the alternation (ABAB) — exactly the
// evidence a *future, unwritten* line should wait for. But the line
// currently being typed already has a real line directly above it in the
// section, which is the obvious rhyme partner regardless of whether an
// established scheme has formed yet (#79 / R6 fix — next_word and Hebrew
// completion lost this when no scheme was detected).
function impliedRhymeTarget(draft: string, cursor: number): string | undefined {
  const formal = nextLineTargets(draft, cursor).rhymeWith;
  if (formal) return formal;
  const lines = currentSection(draft, cursor);
  const line = lines[lines.length - 1];
  if (!line) return undefined;
  return stripTrailingPunct(lastWord(line)) || undefined;
}

function buildStyleContext(
  globalProfile: string | null,
  projectProfile: string | null,
): string {
  if (!globalProfile && !projectProfile) return "";
  const parts: string[] = [];
  if (globalProfile) parts.push(`Global: ${globalProfile}`);
  if (projectProfile) parts.push(`This song: ${projectProfile}`);
  return `\nStyle context:\n${parts.join("\n")}\n`;
}

// R6: a single word accepted from next_word is a poor few-shot example, so
// only lines of 3+ words qualify, capped at 5.
function buildRecentExamples(recentAccepted: string[]): string {
  const examples = recentAccepted
    .filter((t) => t.trim().split(/\s+/).filter(Boolean).length >= 3)
    .slice(0, 5);
  if (examples.length === 0) return "";
  return `\nRecent accepted lines:\n${examples.map((t) => `- ${t}`).join("\n")}\n`;
}

// Condensed songwriting craft, kept short because it rides along with every
// request.
const CRAFT_EN = [
  "Songwriting craft to apply:",
  "- Serve the song's one core idea, point of view and emotional direction; stay consistent with them.",
  "- Respect the section (see [Verse]/[Chorus]/[Bridge] headers): a verse adds new details, a chorus is simple, singable and repeatable, a bridge shifts perspective or turns honest.",
  "- Show, don't tell: prefer a concrete, sensory image (an object, place or time of day) over naming the emotion. Use at most one metaphor, consistent with the song's imagery.",
  "- Vary line length; keep natural speech stress on strong beats so the line sings, not just reads.",
  "- Prefer natural near-rhymes and slant rhymes over forced perfect ones. Use internal rhyme or repetition for momentum when it fits.",
  "- Avoid clichés (fire/desire, heart/apart), abstract vocabulary, and repeating an idea a previous line already made — every line must advance the idea or the emotion.",
].join("\n");

const CRAFT_HE = [
  "עקרונות כתיבת שירים ליישום:",
  "- שרת את הרעיון המרכזי האחד של השיר, נקודת המבט והכיוון הרגשי; הישאר עקבי איתם.",
  "- כבד את החלק בשיר (ראה כותרות [Verse]/[Chorus]/[Bridge]): בית מוסיף פרטים חדשים, פזמון פשוט, שיר וקל לחזרה, גשר משנה פרספקטיבה או הופך לכנה יותר.",
  "- הראה, אל תספר: העדף דימוי קונקרטי וחושי (חפץ, מקום, שעה ביום) על פני שמות רגש. לכל היותר מטאפורה אחת, עקבית עם דימויי השיר.",
  "- גוון את אורך השורות; ודא שהטעמה הטבעית נופלת על פעמות חזקות כך שהשורה נשמעת טוב בשירה ולא רק בקריאה.",
  "- העדף חרוזים קרובים ואלכסוניים טבעיים על פני חרוזים מושלמים מאולצים. השתמש בחריזה פנימית או בחזרה לתנופה כשזה מתאים.",
  "- הימנע מקלישאות (לֵב/אָהַב, לַיְלָה/יָלְלָה), ממילים מופשטות ומחזרה על רעיון ששורה קודמת כבר אמרה — כל שורה חייבת לקדם את הרעיון או את הרגש.",
].join("\n");

function buildCraftGuidance(hebrew: boolean): string {
  return `\n${hebrew ? CRAFT_HE : CRAFT_EN}\n`;
}

function buildWriterContext(songContext: string | null | undefined): string {
  const text = songContext?.trim();
  if (!text) return "";
  return `\nWhat the song is about (the writer's own words — let it guide meaning, mood and imagery):\n${text}\n`;
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

// ─── Cursor + section context (R6 / #79) ────────────────────────────────────

const CURSOR_MARKER = "⟨CURSOR⟩";

function clampIndex(n: number, len: number): number {
  return Math.max(0, Math.min(n, len));
}

function isHeaderLine(line: string): boolean {
  return /^\s*(?:\[[^\]]*]|#{1,6}\s+\S.*)\s*$/.test(line);
}

// The lyrics block sent to the model: a ⟨CURSOR⟩ marker dropped in at the
// cursor (so the model sees what comes before AND after it), chord tokens
// and parenthetical remarks stripped line-by-line via the R4 cleaner
// (cleanLine), and [Section] headers kept verbatim rather than stripped.
function buildCursorMarkedLyrics(lyrics: string, cursor: number): string {
  const at = clampIndex(cursor, lyrics.length);
  const marked = lyrics.slice(0, at) + CURSOR_MARKER + lyrics.slice(at);
  return marked
    .split("\n")
    .map((line) => (isHeaderLine(line) ? line.trim() : cleanLine(line)))
    .join("\n");
}

function headerName(line: string): string | null {
  const m = /^\s*\[([^\]]*)]\s*$/.exec(line.trim());
  return m ? m[1].trim() : null;
}

function lineIndexAtOffset(lines: string[], offset: number): number {
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= pos + lines[i].length) return i;
    pos += lines[i].length + 1;
  }
  return Math.max(0, lines.length - 1);
}

interface SectionPosition {
  name: string | null;
  lineNumber: number;
  isChorusRepeat: boolean;
}

// Finds the nearest preceding [Section] header and how many non-blank lyric
// lines into that section the cursor sits, so the task text can say e.g.
// "Current section: Chorus (line 3 of it)" and flag a repeated chorus so
// the model keeps it consistent with the one already written.
function sectionPositionAt(lyrics: string, cursor: number): SectionPosition {
  const rawLines = lyrics.split("\n");
  const at = clampIndex(cursor, lyrics.length);
  const cursorLine = lineIndexAtOffset(rawLines, at);

  let name: string | null = null;
  let sectionStart = 0;
  for (let i = cursorLine; i >= 0; i--) {
    const n = headerName(rawLines[i]);
    if (n !== null) {
      name = n;
      sectionStart = i + 1;
      break;
    }
  }

  let completed = 0;
  for (let i = sectionStart; i < cursorLine; i++) {
    if (cleanLine(rawLines[i] ?? "").length > 0) completed++;
  }
  let lineStartOffset = 0;
  for (let i = 0; i < cursorLine; i++)
    lineStartOffset += rawLines[i].length + 1;
  const posInLine = at - lineStartOffset;
  const cursorLineRaw = rawLines[cursorLine] ?? "";
  const cursorLineFinished =
    posInLine >= cursorLineRaw.length && cleanLine(cursorLineRaw).length > 0;
  if (cursorLineFinished) completed++;

  let isChorusRepeat = false;
  if (name && /chorus|פזמון/i.test(name)) {
    let seen = 0;
    for (let i = 0; i <= cursorLine; i++) {
      if (headerName(rawLines[i]) === name) seen++;
    }
    isChorusRepeat = seen > 1;
  }

  return { name, lineNumber: completed + 1, isChorusRepeat };
}

function sectionContextLine(
  lyrics: string,
  cursor: number,
  hebrew: boolean,
): string | null {
  const info = sectionPositionAt(lyrics, cursor);
  if (!info.name) return null;
  const base = hebrew
    ? `החלק הנוכחי: ${info.name} (שורה ${info.lineNumber} בחלק זה)`
    : `Current section: ${info.name} (line ${info.lineNumber} of it)`;
  if (!info.isChorusRepeat) return base;
  return hebrew
    ? `${base}. זהו פזמון חוזר — שמור על עקביות עם הפזמון שנכתב קודם.`
    : `${base}. This is a repeated chorus — keep it consistent with the earlier chorus.`;
}

// Completion's remaining-syllable budget: the full target line length (R4's
// nextLineTargets, based on the previous lines) minus however many
// syllables the typed prefix already used. Without this the model has no
// sense of how much room is left and keeps writing a whole new clause past
// the line (#79 / R6 — the "completions run long" cluster).
function remainingSyllableTarget(
  prefix: string,
  fullLineRange: [number, number] | undefined,
  lang: ProsodyLang,
): [number, number] | undefined {
  if (!fullLineRange) return undefined;
  const used = countSyllables(prefix, lang);
  const [min, max] = fullLineRange;
  const remMin = Math.max(0, min - used);
  const remMax = Math.max(remMin + 1, max - used);
  return [remMin, remMax];
}

// ─── Inline / streaming prompt ───────────────────────────────────────────────
// Lean, completion-focused. No chat-style sections. The model's only job is to
// continue the text naturally.

const LINE_ONLY_EN =
  "- Answer with ONLY the lyric text: no labels, no quotes, no section headers, no commentary or other notes, and never repeat an existing line. Exactly one line.";
const LINE_ONLY_HE =
  "- החזר רק את טקסט השיר: בלי תוויות, בלי מירכאות, בלי כותרות חלק, בלי הערות או פרשנות, ואל תחזור על שורה קיימת. שורה אחת בלבד.";

const EMPTY_DRAFT_EN =
  "- If there are no lyrics yet (an empty draft), write one striking opening line in English. Never ask the writer for more detail or comment on the brief — just the line.";
const EMPTY_DRAFT_HE =
  "- אם אין עדיין מילים (טיוטה ריקה), כתוב שורת פתיחה אחת חזקה בעברית. אל תבקש מהכותב פרטים נוספים ואל תתייחס לתקציר — רק השורה.";

// Role + task rules per mode, so e.g. next_line isn't told to "complete what
// the writer has started" (it's asked to write a brand-new line instead).
function inlineTaskEn(mode: LyricsSuggestionInput["mode"]): {
  role: string;
  rules: string[];
} {
  switch (mode) {
    case "next_line":
      return {
        role: "You are a lyric co-writer who writes a song one line at a time. You are given the entire lyrics; write the next line.",
        rules: [
          "- Read the whole song first: its story, imagery, rhyme scheme and line length.",
          "- Write a complete, singable line of about the same length as the previous lines — never a single word, a fragment, or a note about rhyme.",
          LINE_ONLY_EN,
          EMPTY_DRAFT_EN,
        ],
      };
    case "alternative":
      return {
        role: "You are a lyric rewriting engine. Rephrase the given line — keep its meaning.",
        rules: ["- Keep the original line's meaning.", LINE_ONLY_EN],
      };
    default:
      return {
        role: "You are an inline lyric completion engine. Complete what the writer has started — nothing more.",
        rules: [
          "- Return only the words that continue from the cursor, finishing the current line. Do not repeat the prefix and do not start a new line.",
          LINE_ONLY_EN,
        ],
      };
  }
}

function inlineTaskHe(mode: LyricsSuggestionInput["mode"]): {
  role: string;
  rules: string[];
} {
  switch (mode) {
    case "next_line":
      return {
        role: "אתה שותף לכתיבת שיר שכותב שורה אחר שורה. קיבלת את כל מילות השיר; כתוב את השורה הבאה.",
        rules: [
          "- קרא קודם את כל השיר: הסיפור, הדימויים, סכמת החריזה ואורך השורות.",
          "- כתוב שורה שלמה שאפשר לשיר, באורך דומה לשורות הקודמות — לא מילה בודדת, לא קטע ולא הערה על חריזה.",
          LINE_ONLY_HE,
          EMPTY_DRAFT_HE,
        ],
      };
    case "alternative":
      return {
        role: "אתה מנוע ניסוח מחדש של שורות שיר. נסח מחדש את השורה שניתנה — ושמור על המשמעות.",
        rules: ["- שמור על המשמעות של השורה המקורית.", LINE_ONLY_HE],
      };
    default:
      return {
        role: "אתה מנוע השלמת מילים בשורות שיר. המשך את מה שהכותב התחיל — ולא יותר מכך.",
        rules: [
          "- החזר רק את המילים שממשיכות מהסמן, ומסיימות את השורה הנוכחית. אל תחזור על מה שכבר נכתב ואל תתחיל שורה חדשה.",
          LINE_ONLY_HE,
        ],
      };
  }
}

function buildInlineSystemEn(input: LyricsSuggestionInput): string {
  const { role, rules } = inlineTaskEn(input.mode);
  return [
    role,
    "Rules:",
    ...rules,
    "- Match the rhythm, syllable weight, and emotional register of the surrounding lines.",
    "- No alternatives, no extra lines, no notes.",
    buildCraftGuidance(false),
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildWriterContext(input.songContext),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
  ].join("\n");
}

function buildInlineSystemHe(input: LyricsSuggestionInput): string {
  const { role, rules } = inlineTaskHe(input.mode);
  return [
    role,
    "כללים:",
    ...rules,
    "- התאם את המקצב, משקל ההברות, והרישום הרגשי לשורות הסביבות.",
    "- חשוב: השלמות חייבות להיות בעברית תקנית ורהוטה.",
    "- חשוב: שמור על תחביר עברי נכון — מין דקדוקי, הטיות פועל, סמיכות.",
    "- אין חלופות, אין שורות נוספות, אין הערות.",
    buildCraftGuidance(true),
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildWriterContext(input.songContext),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
  ].join("\n");
}

function buildInlineUserPrompt(
  input: LyricsSuggestionInput,
  hebrew: boolean,
): string {
  const lang: ProsodyLang = hebrew ? "he" : "en";
  const lyricsBlock = buildCursorMarkedLyrics(
    input.lyrics,
    input.selectionStart,
  );
  const lines = [
    `${input.mode === "next_line" ? "Entire lyrics" : "Lyrics so far"} (⟨CURSOR⟩ marks the cursor):\n${lyricsBlock || "(empty)"}`,
  ];

  const section = sectionContextLine(
    input.lyrics,
    input.selectionStart,
    hebrew,
  );
  if (section) lines.push(section);

  if (input.mode === "completion") {
    const { draft, cursor } = draftBeforeCurrentLine(
      input.lyrics,
      input.selectionStart,
    );
    const targets = nextLineTargets(draft, cursor);
    const remaining = remainingSyllableTarget(
      input.textBeforeCursor,
      targets.syllables,
      lang,
    );

    lines.push(
      hebrew
        ? `\nהכותב הקליד: "${input.textBeforeCursor}" ← השלם מכאן, סיים את השורה הנוכחית.`
        : `\nWriter typed: "${input.textBeforeCursor}" ← continue from here, finishing the current line.`,
    );
    if (remaining) {
      lines.push(
        hebrew
          ? `השלם בעוד ${remaining[0]}-${remaining[1]} הברות בערך כדי לסיים את השורה.`
          : `Add about ${remaining[0]}-${remaining[1]} more syllables to finish the line.`,
      );
    }
    const rhymeWith = impliedRhymeTarget(draft, cursor);
    if (rhymeWith) {
      lines.push(
        hebrew
          ? `המילה האחרונה בשורה המושלמת צריכה להתחרז עם: "${rhymeWith}"`
          : `The finished line's last word should rhyme with: "${rhymeWith}"`,
      );
    }
  } else if (input.mode === "next_line") {
    const isEmptyDraft = input.lyrics.trim().length === 0;
    if (!isEmptyDraft) {
      const lastLine = cleanLine(input.currentLine) || input.currentLine;
      lines.push(
        hebrew
          ? `\nהשורה האחרונה שנכתבה: "${lastLine}"\nכתוב את השורה הבאה שבאה מיד אחריה.`
          : `\nThe last line written: "${lastLine}"\nWrite the next line that comes right after it.`,
      );
    }
    const targets = nextLineTargets(input.lyrics, input.selectionStart);
    if (targets.syllables) {
      lines.push(
        hebrew
          ? `כוון לאורך של בערך ${targets.syllables[0]}-${targets.syllables[1]} הברות.`
          : `Aim for about ${targets.syllables[0]}-${targets.syllables[1]} syllables.`,
      );
    }
    if (targets.rhymeWith) {
      lines.push(
        hebrew
          ? `כתוב שורה שלמה שהמילה האחרונה בה מתחרזת עם: "${targets.rhymeWith}"`
          : `Write a full line whose last word rhymes with: "${targets.rhymeWith}"`,
      );
    }
  } else {
    // alternative
    const cleanedLine = cleanLine(input.currentLine) || input.currentLine;
    const count = countSyllables(cleanedLine, lang);
    lines.push(
      hebrew ? `\nנסח מחדש: "${cleanedLine}"` : `\nRephrase: "${cleanedLine}"`,
    );
    if (count > 0) {
      lines.push(
        hebrew
          ? `השורה המנוסחת מחדש צריכה להישאר באורך דומה (כ-${count} הברות).`
          : `Keep the rephrased line a similar length (about ${count} syllables).`,
      );
    }
  }

  return lines.join("\n");
}

// ─── Rich popup prompt ────────────────────────────────────────────────────────
// Full co-writer experience for the on-demand popup.

const POPUP_SYSTEM_EN = `You are a lyrics co-writer. Your role is to support musicians by reading what they have already written and offering targeted suggestions — not rewrites.

Before suggesting anything, absorb the lyrics fully:
- What is the emotional core? (grief, defiance, longing, rage, numbness)
- What imagery or metaphors are already present?
- What is the speaker's relationship to the subject — distance, intimacy, ambivalence?
- What does the writer seem to want to say but hasn't landed yet?

Then offer suggestions in these specific forms:

RHYME SUGGESTIONS
Offer rhymes that carry weight, not just sound. Avoid the first rhyme that comes to mind — it is usually the cliché. Favor slant rhymes, near-rhymes, and unexpected pairings that feel earned.

CONFLICT PHRASES
Suggest lines that hold two opposing truths at once — love and resentment, freedom and fear, clarity and confusion. These are the lines that make listeners stop. The conflict should feel real, not clever. Examples: "I miss who you were before I knew you" or "I stayed so long I forgot I could leave."

IMAGERY AND SPECIFICITY
If the lyrics are abstract, suggest a concrete image that carries the same feeling. Replace "I feel lost" with the moment, the place, the object that creates that feeling. Specificity is what separates a lyric from a diary entry.

WHAT TO AVOID
- Do not suggest rhymes that are predictable (heart/apart, fire/desire, rain/pain)
- Do not offer complete verse rewrites — your job is to hand tools to the writer, not take over
- Do not ignore the writer's established voice — match their register (raw, poetic, conversational, sparse)
- Do not comment on the meaning of your suggestion unless asked — trust the writer to feel it`;

const POPUP_SYSTEM_HE = `אתה שותף לכתיבת מילים. תפקידך לתמוך במוזיקאים על ידי קריאת מה שכבר כתבו והצעת הצעות ממוקדות — לא שכתובים.

לפני שאתה מציע כל דבר, ספוג את המילים לגמרי:
- מה הגרעין הרגשי? (אבל, מרי, כמיהה, זעם, קהות)
- אילו דימויים או מטאפורות כבר קיימים?
- מה הקשר של הדובר לנושא — ריחוק, קרבה, אמביוולנטיות?
- מה הכותב נראה רוצה לומר אך עדיין לא נחת?

לאחר מכן הצע הצעות בצורות הספציפיות הבאות:

הצעות חריזה
הצע חרוזים שנושאים משקל, לא רק צליל. הימנע מהחרוז הראשון שעולה בראש — זה בדרך כלל הקלישאה. העדף חרוזים אלכסוניים, חרוזים קרובים, וצמדים בלתי צפויים שמרגישים כבויים.
חרוז עברי חזק: חרוז על סיומות הטיה (-תי/-ת/-נו/-ים/-ות), על שורשים משותפים, על הברה מוטעמת אחרונה.
הימנע מצמדים שחוקים: לֵב/אָהַב, לַיְלָה/יָלְלָה, דְּרָכִים/חַיִּים (אלא אם יש בהם טוויסט).

משפטי קונפליקט
הצע שורות שמחזיקות שתי אמיתות מנוגדות בו-זמנית. אלו הן השורות שגורמות למאזינים לעצור.

דימויים וספציפיות
אם המילים מופשטות, הצע דימוי קונקרטי שנושא את אותה התחושה. ספציפיות היא מה שמפריד בין שיר לבין יומן אישי.
שירת עברית חזקה מעגנת רגש במקום ובזמן — רחובות העיר, ריח של חדר, שעה ספציפית. הישען על זה.

מה להימנע
- אל תציע חרוזים צפויים ושחוקים
- אל תציע שכתובים מלאים של בתים — תפקידך להגיש כלים לכותב, לא להשתלט
- אל תתעלם מהקול שהכותב כבר ביסס — התאם את הרישום שלו (גולמי, פיוטי, שיחי, דליל)
- אל תוסיף פרשנות למשמעות ההצעה שלך אלא אם התבקשת`;

const MODE_INSTRUCTIONS_EN: Record<LyricSuggestionMode, string> = {
  completion:
    "Complete the current partial line. Return only the completion text (not the part already written). One line max.",
  alternative:
    "Suggest an alternative phrasing for the selected text. Return only the alternative. One line max.",
  next_line:
    "Write one complete new lyric line that follows the last line naturally, about the same length as the lines before it. It must be an actual line of the song — never a rhyme word, a rhyme suggestion or advice.",
  next_word:
    "Give at least three different options for the next word (two words at most each), as separate next_word items. At least one option must rhyme with the end of the line above. Return only the words, no punctuation.",
};

const MODE_INSTRUCTIONS_HE: Record<LyricSuggestionMode, string> = {
  completion:
    "השלם את השורה החלקית הנוכחית בעברית. החזר רק את טקסט ההשלמה (לא את מה שכבר נכתב). שורה אחת לכל היותר.",
  alternative:
    "הצע ניסוח חלופי לטקסט הנבחר בעברית. החזר רק את האלטרנטיבה. שורה אחת לכל היותר.",
  next_line:
    "כתוב שורה שלמה וחדשה שממשיכה בצורה טבעית את השורה האחרונה, באורך דומה לשורות הקודמות, בעברית. זו חייבת להיות שורה אמיתית מהשיר — לא מילת חרוז, לא הצעת חריזה ולא עצה.",
  next_word:
    "תן לפחות שלוש אפשרויות שונות למילה הבאה (שתי מילים לכל היותר כל אחת), כפריטי next_word נפרדים, בעברית. לפחות אפשרות אחת חייבת להתחרז עם סוף השורה שמעל. החזר רק את המילים, בלי פיסוק.",
};

// Stamped on every span's promptVersion (T1, #89) so later prompt rewrites
// are comparable by version in the eval report. Bump this — and only
// this — when prompt wording changes; it is not tied to app releases.
export const PROMPT_VERSION = "2026-11-21.1";

// Stable id for a span's promptId, e.g. "lyrics.inline.next_line.he". Mirrors
// the (mode, language) pair buildLyricsSuggestionPrompt already branches on,
// without changing that function's return shape.
export function lyricsInlinePromptId(
  mode: LyricsSuggestionInput["mode"],
  hebrew: boolean,
): string {
  return `lyrics.inline.${mode}.${hebrew ? "he" : "en"}`;
}

export function lyricsPopupPromptId(hebrew: boolean): string {
  return `lyrics.popup.${hebrew ? "he" : "en"}`;
}

export function nextWordOptionsPromptId(hebrew: boolean): string {
  return `lyrics.next_word.${hebrew ? "he" : "en"}`;
}

export function buildLyricsSuggestionPrompt(input: LyricsSuggestionInput): {
  system: string;
  prompt: string;
} {
  const hebrew = detectHebrewContext(input);
  const system = hebrew
    ? buildInlineSystemHe(input)
    : buildInlineSystemEn(input);
  const prompt = buildInlineUserPrompt(input, hebrew);
  return { system, prompt };
}

export function buildLyricsPopupPrompt(input: LyricsPopupInput): {
  system: string;
  prompt: string;
} {
  const hebrew = detectHebrewContext(input);
  const modeInstructions = input.enabledModes
    .map((m) => {
      const instr = hebrew ? MODE_INSTRUCTIONS_HE[m] : MODE_INSTRUCTIONS_EN[m];
      return `- ${m}: ${instr}`;
    })
    .join("\n");

  const rhyme = input.enabledModes.includes("next_line")
    ? nextLineTargets(input.lyrics, input.selectionStart).rhymeWith
    : undefined;

  // The next_line group always gets one extra option whose last word rhymes
  // with the last line written (the one the cursor is on).
  const lastLineEnd = lastWord(input.currentLine).replace(
    /[^\p{L}\p{N}'’-]+$/u,
    "",
  );
  const rhymingAlternative =
    input.enabledModes.includes("next_line") && lastLineEnd
      ? hebrew
        ? `בנוסף, החזר תמיד הצעה אחת נוספת מסוג next_line: חלופה לשורה הבאה (שורה שלמה, שונה מההצעה הראשונה) שהמילה האחרונה בה מתחרזת עם "${lastLineEnd}" — המילה האחרונה בשורה האחרונה שנכתבה.`
        : `Also ALWAYS return one extra next_line suggestion: an alternative next line (a complete line, different from the first) whose last word rhymes with "${lastLineEnd}" — the last word of the last line written.`
      : "";

  const system = [
    hebrew ? POPUP_SYSTEM_HE : POPUP_SYSTEM_EN,
    buildCraftGuidance(hebrew),
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildWriterContext(input.songContext),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    "",
    hebrew
      ? "הפק הצעה אחת לכל אחד מהסוגים הבאים:"
      : "Generate one suggestion for each of the following types:",
    modeInstructions,
    rhyme
      ? hebrew
        ? `בשורה הבאה, המילה האחרונה צריכה להתחרז עם "${rhyme}" — אבל זו חייבת להיות שורה שלמה, לא רק חרוז.`
        : `For next_line, the last word should rhyme with "${rhyme}" — but it must still be a complete line, not just a rhyme.`
      : "",
    rhymingAlternative,
    hebrew
      ? "אל תוסיף הערות. החזר רק טקסט שיר גולמי לכל סוג — בלי רשימות חרוזים ובלי דבר שמחייב תגובה מהכותב."
      : "Never add commentary. Return only raw lyric text for each suggestion — no rhyme lists, and nothing that expects a reply from the writer.",
  ].join("\n");

  const lyricsBlock = buildCursorMarkedLyrics(
    input.lyrics,
    input.selectionStart,
  );
  const prompt = `Full lyrics so far (⟨CURSOR⟩ marks the cursor):\n${lyricsBlock || "(empty)"}\n\nCurrent line: "${input.currentLine}"`;

  return { system, prompt };
}

// Next word wins right after a finished word (cursor follows whitespace), or
// when it's the only mid-line mode enabled; otherwise line completion.
function pickInlineMode(
  enabledModes: LyricSuggestionMode[],
  endsWithSpace: boolean,
): LyricSuggestionMode | null {
  const hasWord = enabledModes.includes("next_word");
  const hasCompletion = enabledModes.includes("completion");
  if (hasWord && (!hasCompletion || endsWithSpace)) return "next_word";
  if (hasCompletion) return "completion";
  return null;
}

// Keeps at most two words from the model's reply and prefixes a space when the
// cursor sits right after a letter, so accepting it never glues words together.
export function normalizeNextWord(
  suggestion: string,
  textBeforeCursor: string,
): string {
  const words = suggestion.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return "";
  const needsSpace =
    textBeforeCursor.length > 0 && !/\s$/.test(textBeforeCursor);
  return (needsSpace ? " " : "") + words.join(" ");
}

export interface NextWordOption {
  text: string;
  kind: "rhyme" | "continuation";
}

// next_word returns several candidates: natural continuations plus at least one
// word that rhymes with the end of the line above.
export function buildNextWordOptionsPrompt(
  input: Omit<LyricsSuggestionInput, "mode">,
): { system: string; prompt: string } {
  const hebrew = detectHebrewContext(input);
  const { draft, cursor } = draftBeforeCurrentLine(
    input.lyrics,
    input.selectionStart,
  );
  const rhyme = impliedRhymeTarget(draft, cursor);

  const system = (
    hebrew
      ? [
          "אתה שותף לכתיבת שיר שמציע מהי המילה הבאה. קיבלת את כל מילות השיר; הצע כמה מועמדות למילה הבאה.",
          "כללים:",
          "- החזר 4 אפשרויות (אף פעם לא פחות מ-3). כל אפשרות היא מילה אחת, שתיים לכל היותר, בלי פיסוק.",
          rhyme
            ? `- לפחות אפשרות אחת חייבת להתחרז עם "${rhyme}" (המילה האחרונה בשורה שמעל), כדי שהכותב יוכל לסגור את השורה בחריזה. סמן אותה kind="rhyme".`
            : '- סמן kind="rhyme" רק לאפשרות שמתחרזת עם סוף שורה קודמת בשיר.',
          '- שאר האפשרויות הן המשכים טבעיים של מה שהוקלד (kind="continuation"), שונים זה מזה במשמעות או בדימוי — לא מילים נרדפות.',
          "- התאם את המקצב, משקל ההברות, והרישום הרגשי לשורות הסביבות.",
          "- חשוב: מילים בעברית תקנית, עם התאמה דקדוקית נכונה למה שהוקלד.",
          "- אין הערות ואין טקסט נוסף.",
        ]
      : [
          "You are a lyric co-writer suggesting what word comes next. You are given the entire song; offer several candidate next words.",
          "Rules:",
          "- Return 4 options (never fewer than 3). Each option is one word, two at most, with no punctuation.",
          rhyme
            ? `- At least one option must rhyme with "${rhyme}" (the last word of the line above) so the writer can land the line on a rhyme. Mark it kind="rhyme".`
            : '- Mark kind="rhyme" only for an option that rhymes with the end of an earlier line in the song.',
          '- The other options are natural continuations of what was typed (kind="continuation"), meaningfully different from each other in meaning or imagery — not synonyms.',
          "- Match the rhythm, syllable weight, and emotional register of the surrounding lines.",
          "- No commentary, no extra text.",
        ]
  )
    .concat([
      buildCraftGuidance(hebrew),
      buildStyleContext(input.globalProfile, input.projectProfile),
      buildWriterContext(input.songContext),
      buildRecentExamples(input.recentAccepted),
      buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
    ])
    .join("\n");

  const lyricsBlock = buildCursorMarkedLyrics(
    input.lyrics,
    input.selectionStart,
  );
  const section = sectionContextLine(
    input.lyrics,
    input.selectionStart,
    hebrew,
  );
  const prompt = [
    `Entire lyrics (⟨CURSOR⟩ marks the cursor):\n${lyricsBlock || "(empty)"}`,
    section ?? "",
    hebrew
      ? `\nהשורה הנוכחית עד הסמן: "${input.textBeforeCursor}" ← הצע את המילה הבאה`
      : `\nCurrent line up to the cursor: "${input.textBeforeCursor}" ← suggest the next word`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

// Cleans the model's options for display: trims to two words, fixes spacing,
// drops empties and duplicates, caps the list, and puts continuations before
// the rhyme so the first option (accepted with Tab) is the most natural one.
export function normalizeNextWordOptions(
  options: NextWordOption[],
  textBeforeCursor: string,
): NextWordOption[] {
  const seen = new Set<string>();
  const cleaned: NextWordOption[] = [];
  for (const o of options) {
    const text = normalizeNextWord(o.text, textBeforeCursor);
    const key = text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ text, kind: o.kind });
  }
  const ordered = [
    ...cleaned.filter((o) => o.kind !== "rhyme"),
    ...cleaned.filter((o) => o.kind === "rhyme"),
  ];
  return ordered.slice(0, 5);
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

  const endsWithSpace = /\s$/.test(textBeforeCursor);

  // Cursor is mid-line (more characters remain on the current line)
  if (posInLine < currentLine.length) {
    const inline = pickInlineMode(enabledModes, endsWithSpace);
    if (inline) return inline;
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
  const composing = pickInlineMode(enabledModes, endsWithSpace);
  if (composing) return composing;

  return enabledModes[0];
}

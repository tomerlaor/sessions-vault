import type { LyricSuggestionMode } from "../types";

export interface LyricsSuggestionInput {
  lyrics: string;
  currentLine: string;
  textBeforeCursor: string;  // text on the current line up to the cursor
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

const HEBREW_RE = /[א-תיִ-פֿ]/;

function isHebrew(text: string): boolean {
  return HEBREW_RE.test(text);
}

// Extract the last word of a line (used for rhyme context)
function lastWord(line: string): string {
  const words = line.trimEnd().split(/\s+/);
  return words[words.length - 1] ?? "";
}

// Extract rhyme context: find non-empty lines before the current one and
// return the word that a new line is most likely expected to rhyme with.
function extractRhymeContext(lyrics: string, currentLine: string): string | null {
  const lines = lyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== currentLine.trim());

  if (lines.length === 0) return null;

  // Look at the last 4 non-empty lines and find the one that is most likely
  // the rhyme pair (alternating scheme: A B A B → rhyme with 2 lines back;
  // couplet A A B B → rhyme with 1 line back).
  const recent = lines.slice(-4);

  // Simple heuristic: if the last line already has a rhyme partner 2 back,
  // suggest rhyming with 2 lines back (alternating); otherwise 1 line back (couplet).
  if (recent.length >= 3) {
    const last = lastWord(recent[recent.length - 1]);
    const twoBack = lastWord(recent[recent.length - 3]);
    // Very rough phonetic similarity for Hebrew: compare last 2 chars
    if (last.length >= 2 && twoBack.length >= 2 && last.slice(-2) === twoBack.slice(-2)) {
      // Alternating scheme detected — rhyme with the line immediately above current
      return lastWord(recent[recent.length - 1]);
    }
  }

  return lastWord(recent[recent.length - 1]);
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

function buildRecentExamples(recentAccepted: string[]): string {
  if (recentAccepted.length === 0) return "";
  return `\nRecent accepted lines:\n${recentAccepted
    .slice(0, 5)
    .map((t) => `- ${t}`)
    .join("\n")}\n`;
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

// ─── Inline / streaming prompt ───────────────────────────────────────────────
// Lean, completion-focused. No chat-style sections. The model's only job is to
// continue the text naturally.

// Role + task rules per mode, so e.g. next_line isn't told to "complete what
// the writer has started" (it's asked to write a brand-new line instead).
function inlineTaskEn(mode: LyricsSuggestionInput["mode"]): { role: string; rules: string[] } {
  switch (mode) {
    case "next_line":
      return {
        role: "You are a lyric co-writer who writes a song one line at a time. You are given the entire lyrics; write the next line.",
        rules: [
          "- Read the whole song first: its story, imagery, rhyme scheme and line length.",
          "- Return ONLY the next line, ready to be written on a new line after the last line given.",
          "- Write a complete, singable line of about the same length as the previous lines — never a single word, a fragment, or a note about rhyme.",
          "- Do not repeat or rewrite any existing line. One line only.",
        ],
      };
    case "alternative":
      return {
        role: "You are a lyric rewriting engine. Rephrase the given line — keep its meaning.",
        rules: [
          "- Return ONLY the rephrased line, not the original.",
          "- One line maximum.",
        ],
      };
    default:
      return {
        role: "You are an inline lyric completion engine. Complete what the writer has started — nothing more.",
        rules: [
          "- Return ONLY the completion text, not the part already written.",
          "- One line maximum.",
        ],
      };
  }
}

function inlineTaskHe(mode: LyricsSuggestionInput["mode"]): { role: string; rules: string[] } {
  switch (mode) {
    case "next_line":
      return {
        role: "אתה שותף לכתיבת שיר שכותב שורה אחר שורה. קיבלת את כל מילות השיר; כתוב את השורה הבאה.",
        rules: [
          "- קרא קודם את כל השיר: הסיפור, הדימויים, סכמת החריזה ואורך השורות.",
          "- החזר רק את השורה הבאה, מוכנה להיכתב בשורה חדשה אחרי השורה האחרונה שניתנה.",
          "- כתוב שורה שלמה שאפשר לשיר, באורך דומה לשורות הקודמות — לא מילה בודדת, לא קטע ולא הערה על חריזה.",
          "- אל תחזור על שורה קיימת ואל תנסח אותה מחדש. שורה אחת בלבד.",
        ],
      };
    case "alternative":
      return {
        role: "אתה מנוע ניסוח מחדש של שורות שיר. נסח מחדש את השורה שניתנה — ושמור על המשמעות.",
        rules: [
          "- החזר רק את השורה המנוסחת מחדש, לא את המקור.",
          "- שורה אחת לכל היותר.",
        ],
      };
    default:
      return {
        role: "אתה מנוע השלמת מילים בשורות שיר. המשך את מה שהכותב התחיל — ולא יותר מכך.",
        rules: [
          "- החזר רק את טקסט ההשלמה, לא את החלק שכבר נכתב.",
          "- שורה אחת לכל היותר.",
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
    "- No commentary, no alternatives, no explanation.",
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
    "- אין הסברים, אין חלופות, אין פרשנות.",
    buildCraftGuidance(true),
    buildStyleContext(input.globalProfile, input.projectProfile),
    buildWriterContext(input.songContext),
    buildRecentExamples(input.recentAccepted),
    buildSongContext(input.title, input.bpm, input.key, input.timeSignature),
  ].join("\n");
}

function buildInlineUserPrompt(input: LyricsSuggestionInput, hebrew: boolean): string {
  const lines = [
    `${input.mode === "next_line" ? "Entire lyrics" : "Lyrics so far"}:\n${input.lyrics || "(empty)"}`,
  ];

  if (input.mode === "completion") {
    lines.push(
      hebrew
        ? `\nהכותב הקליד: "${input.textBeforeCursor}" ← המשך מכאן`
        : `\nWriter typed: "${input.textBeforeCursor}" ← continue from here`,
    );
  } else if (input.mode === "next_line") {
    const rhyme = extractRhymeContext(input.lyrics, input.currentLine);
    lines.push(
      hebrew
        ? `\nהשורה האחרונה שנכתבה: "${input.currentLine}"\nכתוב את השורה הבאה שבאה מיד אחריה.`
        : `\nThe last line written: "${input.currentLine}"\nWrite the next line that comes right after it.`,
    );
    if (rhyme) {
      lines.push(
        hebrew
          ? `כתוב שורה שלמה שהמילה האחרונה בה מתחרזת עם: "${rhyme}"`
          : `Write a full line whose last word rhymes with: "${rhyme}"`,
      );
    }
  } else {
    // alternative
    lines.push(
      hebrew
        ? `\nנסח מחדש: "${input.currentLine}"`
        : `\nRephrase: "${input.currentLine}"`,
    );
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
Offer rhymes that carry weight, not just sound. Avoid the first rhyme that comes to mind — it is usually the cliché. Favor slant rhymes, near-rhymes, and unexpected pairings that feel earned. Always explain why the rhyme fits the emotional tone.

CONFLICT PHRASES
Suggest lines that hold two opposing truths at once — love and resentment, freedom and fear, clarity and confusion. These are the lines that make listeners stop. The conflict should feel real, not clever. Examples: "I miss who you were before I knew you" or "I stayed so long I forgot I could leave."

IMAGERY AND SPECIFICITY
If the lyrics are abstract, suggest a concrete image that carries the same feeling. Replace "I feel lost" with the moment, the place, the object that creates that feeling. Specificity is what separates a lyric from a diary entry.

WHAT TO AVOID
- Do not suggest rhymes that are predictable (heart/apart, fire/desire, rain/pain)
- Do not offer complete verse rewrites — your job is to hand tools to the writer, not take over
- Do not ignore the writer's established voice — match their register (raw, poetic, conversational, sparse)
- Do not explain the meaning of your suggestion unless asked — trust the writer to feel it

END EACH RESPONSE WITH ONE QUESTION
Ask a single question that pushes the writer deeper into what they are trying to say. Not a craft question — a human one. What happened? Who was in the room? What did it smell like?`;

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
- אל תסביר את משמעות ההצעה שלך אלא אם התבקשת

סיים כל תגובה בשאלה אחת
שאל שאלה אחת שדוחפת את הכותב עמוק יותר לתוך מה שהוא מנסה לומר. לא שאלת מלאכה — שאלה אנושית. מה קרה? מי היה בחדר? מה ריחו?`;

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

export function buildLyricsSuggestionPrompt(input: LyricsSuggestionInput): {
  system: string;
  prompt: string;
} {
  const hebrew = isHebrew(input.lyrics || input.currentLine);
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
  const hebrew = isHebrew(input.lyrics || input.currentLine);
  const modeInstructions = input.enabledModes
    .map((m) => {
      const instr = hebrew ? MODE_INSTRUCTIONS_HE[m] : MODE_INSTRUCTIONS_EN[m];
      return `- ${m}: ${instr}`;
    })
    .join("\n");

  const rhyme = input.enabledModes.includes("next_line")
    ? extractRhymeContext(input.lyrics, input.currentLine)
    : null;

  // The next_line group always gets one extra option whose last word rhymes
  // with the last line written (the one the cursor is on).
  const lastLineEnd = lastWord(input.currentLine).replace(/[^\p{L}\p{N}'’-]+$/u, "");
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
    hebrew ? "הפק הצעה אחת לכל אחד מהסוגים הבאים:" : "Generate one suggestion for each of the following types:",
    modeInstructions,
    rhyme
      ? (hebrew ? `בשורה הבאה, המילה האחרונה צריכה להתחרז עם "${rhyme}" — אבל זו חייבת להיות שורה שלמה, לא רק חרוז.` : `For next_line, the last word should rhyme with "${rhyme}" — but it must still be a complete line, not just a rhyme.`)
      : "",
    rhymingAlternative,
    hebrew
      ? "אל תסביר ואל תוסיף הערות. החזר רק טקסט שיר גולמי לכל סוג. במשימה הזו דלג על שאלת הסיום ועל רשימות חרוזים — כל הצעה היא טקסט שהכותב יכול להדביק בשיר."
      : "Never explain or add commentary. Return only raw lyric text for each. For this task, skip the closing question and any rhyme lists — each suggestion is text the writer can paste into the song.",
  ].join("\n");

  const prompt = `Full lyrics so far:\n${input.lyrics || "(empty)"}\n\nCurrent line: "${input.currentLine}"`;

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
  const hebrew = isHebrew(input.lyrics || input.currentLine);
  const rhyme = extractRhymeContext(input.lyrics, input.currentLine);

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
          "- אין הסברים ואין פרשנות.",
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
          "- No commentary and no explanation.",
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

  const prompt = [
    `Entire lyrics:\n${input.lyrics || "(empty)"}`,
    hebrew
      ? `\nהשורה הנוכחית עד הסמן: "${input.textBeforeCursor}" ← הצע את המילה הבאה`
      : `\nCurrent line up to the cursor: "${input.textBeforeCursor}" ← suggest the next word`,
  ].join("\n");

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

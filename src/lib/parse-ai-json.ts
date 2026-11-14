// Lenient extraction of a JSON value from a model response. Used when
// generateObject cannot parse the raw text (markdown fences, a short
// preamble, or trailing commentary) — common through OpenRouter, where
// structured-output support varies by model.

export function sliceBalancedJson(text: string): string | null {
  const startCurly = text.indexOf("{");
  const startSquare = text.indexOf("[");
  let start = -1;
  if (startCurly === -1) start = startSquare;
  else if (startSquare === -1) start = startCurly;
  else start = Math.min(startCurly, startSquare);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Returns a JSON string that JSON.parse can read, or null if nothing
// usable is found. Does not validate against a schema.
export function extractJsonText(text: string): string | null {
  if (!text) return null;
  let s = text.trim();
  if (!s) return null;

  const fenced = s.match(/^```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();

  const sliced = sliceBalancedJson(s);
  if (!sliced) return null;
  try {
    JSON.parse(sliced);
    return sliced;
  } catch {
    return null;
  }
}

// Hook for generateObject's experimental_repairText. Returns the repaired
// text or null if the output cannot be salvaged without another model call.
export async function repairAiJsonText({
  text,
}: {
  text: string;
  error?: unknown;
}): Promise<string | null> {
  return extractJsonText(text);
}

export function rawTextFromObjectError(error: unknown): string {
  if (error && typeof error === "object" && "text" in error) {
    const text = (error as { text?: unknown }).text;
    if (typeof text === "string" && text.length > 0) return text;
  }
  return "";
}

// next_word structured output is specified as `{ options: [{ text, kind }] }`,
// but models often emit `candidates` for the array and `word` for the text
// field, and may wrap or truncate the JSON. These helpers accept those
// aliases and salvage any complete option objects from a cut-off reply.

export type NextWordOptionsObject = {
  options: { text: string; kind: "rhyme" | "continuation" }[];
};

function isNextWordKind(value: unknown): value is "rhyme" | "continuation" {
  return value === "rhyme" || value === "continuation";
}

export function normalizeNextWordOptionItem(
  item: unknown,
): NextWordOptionsObject["options"][number] | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const rec = item as Record<string, unknown>;
  const text =
    typeof rec.text === "string"
      ? rec.text
      : typeof rec.word === "string"
        ? rec.word
        : null;
  if (text === null || !isNextWordKind(rec.kind)) return null;
  return { text, kind: rec.kind };
}

export function normalizeNextWordOptionsValue(
  value: unknown,
): NextWordOptionsObject | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? ((value as Record<string, unknown>).options ??
        (value as Record<string, unknown>).candidates)
      : undefined;
  if (!Array.isArray(list)) return null;
  const options = list
    .map(normalizeNextWordOptionItem)
    .filter((o): o is NextWordOptionsObject["options"][number] => o !== null);
  return options.length > 0 ? { options } : null;
}

// Strips a leading markdown fence even when the closing fence is missing
// (typical of a truncated reply).
function stripLooseMarkdownFence(text: string): string {
  let s = text.trim();
  const opened = s.match(/^```(?:json|javascript|js)?\s*/i);
  if (!opened) return s;
  s = s.slice(opened[0].length);
  if (s.trimEnd().endsWith("```")) {
    s = s.trimEnd().slice(0, -3);
  }
  return s.trim();
}

// Walks a truncated `{ "options"|"candidates": [ {...}, {...}, {` reply
// (or a bare array) and keeps every complete option object that was
// emitted before the cut-off.
export function salvageTruncatedNextWordOptions(
  text: string,
): NextWordOptionsObject | null {
  const s = stripLooseMarkdownFence(text);
  const bracket = s.indexOf("[");
  const rest = bracket === -1 ? s : s.slice(bracket + 1);
  const options: NextWordOptionsObject["options"] = [];
  let cursor = rest;
  while (cursor.length > 0) {
    const obj = sliceBalancedJson(cursor);
    if (!obj) break;
    try {
      const item = normalizeNextWordOptionItem(JSON.parse(obj));
      if (item) options.push(item);
    } catch {
      // skip a balanced object that isn't an option
    }
    const at = cursor.indexOf(obj);
    cursor = cursor.slice(at + obj.length);
  }
  // A cut-off last item like `{ "text": "שחוזרת", "kind": "rhyme"` is
  // missing only its closing braces. Try to close it so the already-
  // complete fields are not thrown away.
  const dangling = cursor.replace(/^[\s,]*/, "");
  if (dangling.startsWith("{")) {
    for (const suffix of ["}", "]}", "}]}"] as const) {
      try {
        const item = normalizeNextWordOptionItem(JSON.parse(dangling + suffix));
        if (item) {
          options.push(item);
          break;
        }
      } catch {
        // try the next suffix
      }
    }
  }
  return options.length > 0 ? { options } : null;
}

// Lenient parse used by generateObject recovery (and tests). Accepts fenced
// or preamble-wrapped JSON, the word/candidates aliases, and truncated
// replies that still contain at least one complete option.
export function parseNextWordOptions(
  text: string,
): NextWordOptionsObject | null {
  const extracted = extractJsonText(text);
  if (extracted) {
    try {
      const normalized = normalizeNextWordOptionsValue(JSON.parse(extracted));
      if (normalized) return normalized;
    } catch {
      // fall through to salvage
    }
  }
  return salvageTruncatedNextWordOptions(text);
}

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

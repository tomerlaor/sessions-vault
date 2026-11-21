// Error scrubbing for traces (plan §3.4.4): provider error messages can echo
// request content (headers, keys, long quoted fragments, or — worst case —
// a model's raw output), so every message stored on a span goes through
// here first.
//
// ALLOWLIST, not a blocklist (L4, #118): free text is only ever kept for
// errorType values that are inherently about transport/HTTP, never about
// what the model said — abort, network, cors, and http_*. Every other
// error (schema/parse failures, anything unclassified) gets a fixed string
// per error name instead of its message, because those are exactly the
// error families (JSONParseError, TypeValidationError, a lenient-parse
// recovery path, or anything unrecognized) that can embed arbitrary model
// output in `.message`. The message is never even inspected for those —
// only the allowlisted types' text gets redacted+truncated.

export interface ScrubbedError {
  errorType: string;
  errorMessage: string;
}

// Cap for the free text kept on allowlisted (transport-only) error types —
// deliberately short since this is diagnostic text, not user content (L4,
// #118).
const MAX_MESSAGE_CHARS = 80;
const MIN_REDACTED_QUOTE_LEN = 40;

// Order matters: the provider-specific prefixes must be redacted before the
// generic `sk-...` pattern would otherwise match (and swallow) them.
const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sk-or-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9_-]+/g,
];

// These AI SDK errors build their own `.message` directly from the model's
// raw output — JSONParseError embeds the unparsed text, TypeValidationError
// embeds the parsed value, and ai.ts's own generateObjectLenient recovery
// path (a plain Error, no `.name` override) can carry a "Raw text: …"
// suffix. A recognized error name is replaced outright with a fixed,
// per-type string — the message is never even inspected.
const FIXED_MESSAGE_BY_ERROR_NAME: Record<string, string> = {
  AI_NoObjectGeneratedError: "no object generated",
  AI_JSONParseError: "JSON parse error",
  AI_TypeValidationError: "type validation error",
};

// Fallback fixed string for an error name not in the map above — still
// never inspects the message (L4, #118). Plain `Error` (the default name
// when nothing overrides it) and "no name at all" both collapse to the
// generic "error"; a distinctive custom name becomes "<Name>" so it's at
// least possible to tell error families apart without ever showing text.
function fixedMessageFor(name: string): string {
  if (FIXED_MESSAGE_BY_ERROR_NAME[name])
    return FIXED_MESSAGE_BY_ERROR_NAME[name];
  if (!name || name === "Error") return "error";
  return `<${name}>`;
}

// Defense in depth for any caller that builds a message like
// `${base} Raw text: ${modelOutput}` (or "Text:"/"Value:"/"Response:"/
// "output:") — cut before the marker so arbitrary model output can never
// survive truncation as a trailing fragment. Case-insensitive, and applied
// even to allowlisted types (L4, #118): an allowlisted http_* message can
// still legitimately quote a provider response body containing one of
// these markers.
const RAW_TEXT_MARKER = /\b(?:Raw text|Text|Value|Response|output):/i;

function cutAtRawTextMarker(message: string): string {
  const match = RAW_TEXT_MARKER.exec(message);
  return match ? message.slice(0, match.index).trimEnd() : message;
}

function redact(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  out = out.replace(
    new RegExp(`"([^"]{${MIN_REDACTED_QUOTE_LEN + 1},})"`, "g"),
    '"[redacted]"',
  );
  out = out.replace(
    new RegExp(`'([^']{${MIN_REDACTED_QUOTE_LEN + 1},})'`, "g"),
    "'[redacted]'",
  );
  return out;
}

function truncate(message: string, max = MAX_MESSAGE_CHARS): string {
  return message.length > max ? message.slice(0, max) + "…" : message;
}

function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate = err as {
    statusCode?: number;
    status?: number;
    response?: { status?: number };
  };
  return candidate.statusCode ?? candidate.status ?? candidate.response?.status;
}

function classifyErrorType(err: unknown, message: string): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "abort";
  if (name in FIXED_MESSAGE_BY_ERROR_NAME) return "schema_parse";

  const httpStatus = extractHttpStatus(err);
  if (httpStatus) return `http_${httpStatus}`;

  if (/cors/i.test(message)) return "cors";
  if (/network|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return "network";
  }
  if (/schema|parse|JSON/i.test(message)) return "schema_parse";

  return "unknown";
}

// The only errorType values allowed to keep (redacted, truncated) free
// text — everything else is transport-agnostic and may be carrying model
// output, so it gets a fixed string instead (L4, #118).
function isAllowlistedErrorType(errorType: string): boolean {
  return (
    errorType === "abort" ||
    errorType === "network" ||
    errorType === "cors" ||
    errorType.startsWith("http_")
  );
}

export function scrubError(err: unknown): ScrubbedError {
  const name = err instanceof Error ? err.name : "";
  const rawMessage = err instanceof Error ? err.message : String(err);
  const cut = cutAtRawTextMarker(rawMessage);
  const errorType = classifyErrorType(err, cut);
  if (isAllowlistedErrorType(errorType)) {
    return { errorType, errorMessage: truncate(redact(cut)) };
  }
  return { errorType, errorMessage: fixedMessageFor(name) };
}

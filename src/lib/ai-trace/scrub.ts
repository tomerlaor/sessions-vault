// Error scrubbing for traces (plan §3.4.4): provider error messages can echo
// request content (headers, keys, long quoted fragments), so every message
// stored on a span goes through here first. Secrets are redacted before the
// message is truncated, so a key can never survive as a cut-off fragment.

export interface ScrubbedError {
  errorType: string;
  errorMessage: string;
}

const MAX_MESSAGE_CHARS = 200;
const MIN_REDACTED_QUOTE_LEN = 40;

// Order matters: the provider-specific prefixes must be redacted before the
// generic `sk-...` pattern would otherwise match (and swallow) them.
const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sk-or-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9_-]+/g,
];

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

  const httpStatus = extractHttpStatus(err);
  if (httpStatus) return `http_${httpStatus}`;

  if (/cors/i.test(message)) return "cors";
  if (/network|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    return "network";
  }
  if (/schema|parse|JSON/i.test(message)) return "schema_parse";

  return "unknown";
}

export function scrubError(err: unknown): ScrubbedError {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const errorType = classifyErrorType(err, rawMessage);
  const errorMessage = truncate(redact(rawMessage));
  return { errorType, errorMessage };
}

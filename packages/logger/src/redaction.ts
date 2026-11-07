const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "cookie",
  "cookies",
  "authorization",
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "hiddenValue",
]);

const SENSITIVE_PATTERNS = [
  /password/i,
  /authorization/i,
  /bearer\s+[a-z0-9._-]+/i,
  /api[_-]?key/i,
];

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key) || SENSITIVE_PATTERNS.some((p) => p.test(key))) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(value)) {
        return "[REDACTED]";
      }
    }
  }
  return value;
}

export function redactRecord(
  details: Record<string, unknown> | undefined,
  redactContent: boolean
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (redactContent && (key === "draft" || key === "visibleText" || key === "content")) {
      out[`${key}Length`] =
        typeof value === "string" ? value.length : Array.isArray(value) ? value.length : 0;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactRecord(value as Record<string, unknown>, redactContent) ?? {};
    } else {
      out[key] = redactValue(key, value);
    }
  }
  return out;
}

/**
 * Structured Server Logger with automatic secret/credential redaction.
 * Ensures every 5xx error, background worker exception, and fallback is traceable
 * via JSON logs without leaking API keys, tokens, cookies, or passwords.
 */

const SENSITIVE_KEY_PATTERN =
  /api[-_]?key|secret|password|passwd|token|authorization|cookie|credential|private[-_]?key/i;

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack.split('\n').slice(0, 5).join('\n') } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeLogValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function summarizeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      errName: err.name,
      errMessage: err.message,
      ...(err.stack ? { errStack: err.stack.split('\n').slice(0, 4).join('\n') } : {}),
    };
  }
  return { errMessage: String(err) };
}

export function formatStructuredLogEntry(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context ? (sanitizeLogValue(context) as Record<string, unknown>) : {}),
  };
}

export function logServerEvent(
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  // Keep unit test stdout clean unless explicitly logging an unhandled error outside test fixtures
  if (process.env.NODE_TEST_CONTEXT && level !== 'error') {
    return;
  }
  const entry = formatStructuredLogEntry(level, scope, message, context);
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_BASE_MS = 750;
const MAX_ATTEMPTS = 10;
const MAX_DELAY_MS = 5_000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function isRetryableRegistryReadError(error) {
  if (!error) return false;
  const code = String(error.code || "").trim().toUpperCase();
  const status = Number(error.status || error.statusCode || 0);
  const message = String(error.message || error.cause?.message || error || "");

  // PostgREST PGRST000-PGRST003 are connection / pool / schema-cache startup
  // failures, not table-contract failures. PGRST002 is the exact transient
  // Production condition observed on 2026-08-07.
  if (["PGRST000", "PGRST001", "PGRST002", "PGRST003"].includes(code)) return true;
  if ([408, 425, 429, 502, 503, 504].includes(status)) return true;

  return /(?:fetch failed|network error|timed? out|timeout|connection (?:reset|closed|refused)|gateway timeout|service unavailable|could not query the database for the schema cache)/i.test(message);
}

export async function runRegistryReadWithRetry(read, options = {}) {
  if (typeof read !== "function") throw new TypeError("Registry read callback is required.");

  const attempts = boundedInteger(options.attempts, DEFAULT_ATTEMPTS, 1, MAX_ATTEMPTS);
  const baseMs = boundedInteger(options.baseMs, DEFAULT_BASE_MS, 0, MAX_DELAY_MS);
  const sleep = typeof options.sleep === "function"
    ? options.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let lastResult = { data: null, error: new Error("Registry read did not execute.") };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResult = await read();
    } catch (error) {
      lastResult = { data: null, error };
    }

    const error = lastResult?.error || null;
    if (!error) return { ...lastResult, attemptsUsed: attempt, retried: attempt > 1 };

    const retryable = isRetryableRegistryReadError(error);
    if (!retryable || attempt === attempts) {
      return {
        ...lastResult,
        attemptsUsed: attempt,
        retried: attempt > 1,
        retryable,
        exhausted: retryable && attempt === attempts,
      };
    }

    const delayMs = Math.min(MAX_DELAY_MS, baseMs * (2 ** (attempt - 1)));
    if (delayMs > 0) await sleep(delayMs);
  }

  return { ...lastResult, attemptsUsed: attempts, retried: attempts > 1, exhausted: true };
}

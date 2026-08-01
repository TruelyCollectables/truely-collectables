const nativeFetch = globalThis.fetch;

if (typeof nativeFetch !== "function") {
  throw new Error("Native fetch is unavailable for the Supabase retry preload.");
}

const MIN_REQUEST_INTERVAL_MS = 850;
const MAX_ATTEMPTS = 10;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
let lastManagementRequestAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isSupabaseDatabaseQuery(input) {
  const url =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : String(input?.url || "");
  return (
    url.startsWith("https://api.supabase.com/v1/projects/") &&
    url.endsWith("/database/query")
  );
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(120_000, retryAfter * 1000);
  }
  return Math.min(120_000, 5_000 * 2 ** (attempt - 1));
}

async function waitForPacingWindow() {
  const elapsed = Date.now() - lastManagementRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastManagementRequestAt = Date.now();
}

globalThis.fetch = async function resilientFetch(input, init) {
  if (!isSupabaseDatabaseQuery(input)) {
    return nativeFetch(input, init);
  }

  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitForPacingWindow();
    try {
      const response = await nativeFetch(input, init);
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) {
        return response;
      }

      lastResponse = response;
      const delay = retryDelay(response, attempt);
      await response.text().catch(() => "");
      console.warn(
        `Supabase management query returned HTTP ${response.status}; retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS}).`,
      );
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
      const delay = Math.min(120_000, 5_000 * 2 ** (attempt - 1));
      console.warn(
        `Supabase management query failed before a response; retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS}).`,
      );
      await sleep(delay);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("Supabase management query retries were exhausted.");
};

const previousFetch = globalThis.fetch.bind(globalThis);
const MAX_ATTEMPTS = Math.max(2, Math.min(10, Number(process.env.SENTINEL_READ_RETRY_ATTEMPTS || 8)));
const BASE_DELAY_MS = Math.max(1, Math.min(10_000, Number(process.env.SENTINEL_READ_RETRY_BASE_MS || 750)));

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function urlString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || "";
}

function methodOf(input, init) {
  return String(init?.method || input?.method || "GET").toUpperCase();
}

function isSentinelRead(input, init) {
  try {
    const url = new URL(urlString(input));
    const method = methodOf(input, init);
    const path = url.pathname;
    const isList = method === "POST" && path.includes("/storage/v1/object/list/instacomp-checklist-sentinel");
    const isDownload = method === "GET" && path.includes("/storage/v1/object/authenticated/instacomp-checklist-sentinel/");
    return isList || isDownload;
  } catch {
    return false;
  }
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504, 520, 522, 524, 544].includes(Number(status));
}

function retryInput(input) {
  if (typeof Request !== "undefined" && input instanceof Request) return input.clone();
  return input;
}

globalThis.fetch = async function sentinelReadRetryFetch(input, init) {
  if (!isSentinelRead(input, init)) return previousFetch(input, init);

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await previousFetch(retryInput(input), init);
      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) return response;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
    }
    await sleep(Math.min(15_000, BASE_DELAY_MS * 2 ** (attempt - 1)));
  }

  throw lastError || new Error("Sentinel read request exhausted retries.");
};

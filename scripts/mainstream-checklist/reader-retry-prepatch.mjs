const nativeFetch = globalThis.fetch.bind(globalThis);

const READER_HOST = "r.jina.ai";
const MAX_ATTEMPTS = 5;
const MIN_REQUEST_GAP_MS = 350;
let lastRequestStartedAt = 0;
let gate = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

function isReaderRequest(input) {
  try {
    return new URL(requestUrl(input)).hostname.toLowerCase() === READER_HOST;
  } catch {
    return false;
  }
}

async function enterReaderGate() {
  let release;
  const previous = gate;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const wait = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestStartedAt));
  if (wait) await sleep(wait);
  lastRequestStartedAt = Date.now();
  release();
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(20_000, retryAfter * 1000);
  }
  return Math.min(12_000, 900 * 2 ** (attempt - 1));
}

globalThis.fetch = async function readerRetryFetch(input, init = {}) {
  if (!isReaderRequest(input)) return nativeFetch(input, init);

  let lastResponse = null;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await enterReaderGate();
    try {
      const response = await nativeFetch(input, init);
      lastResponse = response;
      if (response.ok || ![429, 502, 503, 504].includes(response.status)) return response;
      if (attempt < MAX_ATTEMPTS) await sleep(retryDelay(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(Math.min(12_000, 900 * 2 ** (attempt - 1)));
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error(`Reader request failed after ${MAX_ATTEMPTS} attempts`);
};

export { MAX_ATTEMPTS, MIN_REQUEST_GAP_MS, isReaderRequest };

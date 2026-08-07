const nativeFetch = globalThis.fetch.bind(globalThis);

const READER_FIRST_RULES = [
  { host: /^(?:www\.)?beckett\.com$/i, path: /^\/news\//i },
  { host: /^(?:www\.)?cardboardconnection\.com$/i, path: /^\// },
  { host: /^(?:www\.)?gogts\.net$/i, path: /^\// },
  { host: /^(?:www\.)?topps\.com$/i, path: /^\/pages\//i },
  { host: /^ripped\.topps\.com$/i, path: /^\// },
];

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

function shouldPreferReader(urlValue) {
  try {
    const url = new URL(urlValue);
    return READER_FIRST_RULES.some(
      (rule) => rule.host.test(url.hostname) && rule.path.test(url.pathname),
    );
  } catch {
    return false;
  }
}

function readerUrl(urlValue) {
  return `https://r.jina.ai/${String(urlValue)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchReader(urlValue, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "text/plain,text/markdown;q=0.9,*/*;q=0.1");
  headers.set(
    "User-Agent",
    "TCOS-Mainstream-Checklist-Ingest/1.4 (+private Registry automation; contact sales@truelycollectables.com)",
  );

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await nativeFetch(readerUrl(urlValue), {
        ...init,
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
      });
      if (response.ok) return response;
      if (![429, 502, 503, 504].includes(response.status)) return response;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(15_000, retryAfter * 1000)
        : Math.min(8_000, 600 * 2 ** (attempt - 1));
      lastError = new Error(`Reader ${response.status} ${response.statusText}: ${urlValue}`);
      await sleep(delay);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await sleep(Math.min(8_000, 600 * 2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error(`Reader fetch failed: ${urlValue}`);
}

globalThis.fetch = async function preferCompleteReaderFetch(input, init = {}) {
  const urlValue = requestUrl(input);
  if (!shouldPreferReader(urlValue)) return nativeFetch(input, init);

  try {
    const reader = await fetchReader(urlValue, init);
    if (reader.ok) return reader;
  } catch {
    // Fall through to the original public page. The downstream parser remains
    // fail-closed if that direct representation is incomplete or unusable.
  }
  return nativeFetch(input, init);
};

export { READER_FIRST_RULES, shouldPreferReader };

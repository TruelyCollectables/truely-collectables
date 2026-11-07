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

function declaredCardFloor(body) {
  const counts = [];
  const patterns = [
    /(?:^|\n)\s*(?:[-*+]\s*)?([0-9][0-9,]{0,5})\s+cards?\.?(?=\s|$)/gim,
    /\bset size\s*:?\s*([0-9][0-9,]{0,5})\s+cards?\b/gi,
    /\bbase set\s+(?:has|contains|is)\s+([0-9][0-9,]{0,5})\s+cards?\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of String(body || "").matchAll(pattern)) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isInteger(value) && value >= 3 && value <= 10_000) counts.push(value);
    }
  }
  return counts.length ? Math.max(...counts) : null;
}

function looksLikeObservedCardNumber(value) {
  const number = String(value || "").trim().toUpperCase();
  if (!number || /^(?:19|20)\d{2}$/.test(number)) return false;
  if (/^(?:NNO|NO#)$/.test(number)) return true;
  if (/^\d{1,5}[A-Z]?$/.test(number)) return true;
  return /^[A-Z]{1,12}-?[A-Z0-9]{1,18}$/.test(number) && /\d/.test(number);
}

function observedCardLines(body) {
  const seen = new Set();
  for (const rawLine of String(body || "").split(/\r?\n/)) {
    const line = rawLine
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const match = line.match(
      /^#?\s*((?:\d{1,5}[A-Za-z]?)|(?:[A-Z]{1,12}-?[A-Z0-9]{1,18})|(?:NNO|NO#))\s+(?:[-:–—]\s*)?(.{2,220})$/i,
    );
    if (!match || !looksLikeObservedCardNumber(match[1])) continue;
    const number = match[1].toUpperCase();
    const subject = match[2].toLowerCase();
    if (
      /^cards?\.?$/i.test(subject) ||
      /(?:cards per pack|packs per box|boxes per case|release date|product configuration|insertion ratio|estimated odds|parallel cards?)/i.test(subject)
    ) continue;
    seen.add(`${number}\u0001${subject}`);
  }
  return seen.size;
}

function directPageHasChecklistDownload(body) {
  const html = String(body || "");
  const fileLink = /href\s*=\s*["'][^"']+\.(?:xlsx?|csv|tsv|pdf)(?:[?#][^"']*)?["']/i.test(html);
  const checklistLink = /href\s*=\s*["'][^"']+["'][^>]*>[\s\S]{0,220}?(?:download|spreadsheet|excel|xlsx|xls|csv|pdf|checklist)/i.test(html);
  return fileLink || checklistLink;
}

function rebuiltResponse(response, body, contentType = null) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (contentType) headers.set("content-type", contentType);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function validatedReaderResponse(response, urlValue) {
  if (!response.ok) return response;
  const body = await response.text();
  const floor = declaredCardFloor(body);
  const observed = observedCardLines(body);
  if (floor && observed < floor) {
    throw new Error(
      `Editorial reader completeness failed for ${urlValue}: observed ${observed} card-like rows, below declared section floor ${floor}.`,
    );
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/plain; charset=utf-8");
  if (floor) headers.set("x-tcos-declared-card-floor", String(floor));
  headers.set("x-tcos-observed-card-lines", String(observed));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
      if (response.ok) return validatedReaderResponse(response, urlValue);
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

async function verifiedDirectFallback(input, init, urlValue, readerError) {
  const response = await nativeFetch(input, init);
  if (!response.ok) return response;
  const mime = String(response.headers.get("content-type") || "").toLowerCase();
  if (!mime.includes("text/html") && !mime.includes("application/xhtml+xml")) {
    return response;
  }
  const body = await response.text();
  if (!directPageHasChecklistDownload(body)) {
    throw new Error(
      `Editorial checklist reader failed and direct page has no verifiable checklist download: ${urlValue}. Reader error: ${readerError instanceof Error ? readerError.message : String(readerError || "unknown")}`,
    );
  }
  return rebuiltResponse(response, body, "text/html; charset=utf-8");
}

globalThis.fetch = async function preferCompleteReaderFetch(input, init = {}) {
  const urlValue = requestUrl(input);
  if (!shouldPreferReader(urlValue)) return nativeFetch(input, init);

  let readerError = null;
  try {
    const reader = await fetchReader(urlValue, init);
    if (reader.ok) return reader;
    readerError = new Error(`Reader returned HTTP ${reader.status}`);
  } catch (error) {
    readerError = error;
  }
  return verifiedDirectFallback(input, init, urlValue, readerError);
};

export {
  READER_FIRST_RULES,
  declaredCardFloor,
  directPageHasChecklistDownload,
  observedCardLines,
  shouldPreferReader,
};

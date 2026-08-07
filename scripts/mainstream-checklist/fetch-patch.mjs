const nativeFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isSectionLabel(value) {
  const text = stripTags(value);
  if (!text || text.length > 180 || /^#?\s*[A-Z]{0,10}-?\d{1,4}\b/.test(text)) {
    return false;
  }
  return /(?:checklist|base set|base cards|autographs?|signatures?|relics?|memorabilia|patches?|inserts?|parallels?|variations?|short prints?|rookies?|prospects?)/i.test(text);
}

function headingRow(level, body) {
  return `<tr data-tcos-heading="${level}"><td>## ${body}</td></tr>`;
}

export function transformChecklistHtml(html) {
  let value = String(html || "");

  value = value.replace(
    /<(?:p|div|section)\b[^>]*>\s*<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>\s*<\/(?:p|div|section)>/gi,
    (whole, body) => (isSectionLabel(body) ? headingRow(3, body) : whole),
  );

  value = value.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (whole, level, body) => headingRow(level, body),
  );

  value = value.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi, (whole, attributes, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cells.length !== 1 || !isSectionLabel(cells[0][1])) return whole;
    const text = stripTags(cells[0][1]);
    if (text.startsWith("## ")) return whole;
    return headingRow(4, cells[0][1]);
  });

  return value;
}

export function transformReaderText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const normalized = line.replace(/^\s*#{1,6}\s+/, "## ");
      if (normalized.startsWith("## ")) return normalized;
      return isSectionLabel(normalized) && !normalized.includes("|")
        ? `## ${normalized.trim()}`
        : normalized;
    })
    .join("\n");
}

function proxyUrl(originalUrl) {
  try {
    const parsed = new URL(originalUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (parsed.hostname === "r.jina.ai") return null;
    return `https://r.jina.ai/${parsed.toString()}`;
  } catch {
    return null;
  }
}

async function transformedResponse(response, { reader = false } = {}) {
  const mime = String(response.headers.get("content-type") || "").toLowerCase();
  const isHtml = mime.includes("text/html") || mime.includes("application/xhtml+xml");
  const isText = reader || mime.includes("text/plain") || mime.includes("text/markdown");
  if (!response.ok || (!isHtml && !isText)) return response;

  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (isHtml && !reader) {
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(transformChecklistHtml(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(transformReaderText(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function proxyInit(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "text/plain,text/markdown;q=0.9,*/*;q=0.1");
  return {
    ...init,
    headers,
    signal: AbortSignal.timeout(90_000),
  };
}

globalThis.fetch = async function patchedChecklistFetch(input, init = {}) {
  const originalUrl = requestUrl(input);
  let directResponse = null;
  let directError = null;

  try {
    directResponse = await nativeFetch(input, init);
    if (directResponse.ok) {
      return transformedResponse(directResponse);
    }
  } catch (error) {
    directError = error;
  }

  const readerUrl = proxyUrl(originalUrl);
  if (readerUrl) {
    try {
      const readerResponse = await nativeFetch(readerUrl, proxyInit(init));
      if (readerResponse.ok) {
        return transformedResponse(readerResponse, { reader: true });
      }
    } catch {
      // Preserve the original source failure below.
    }
  }

  if (directResponse) return directResponse;
  throw directError || new Error(`Checklist source fetch failed: ${originalUrl}`);
};

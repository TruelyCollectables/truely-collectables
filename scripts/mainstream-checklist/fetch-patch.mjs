const nativeFetch = globalThis.fetch.bind(globalThis);

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

function requestInit(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("User-Agent", BROWSER_USER_AGENT);
  headers.set("Accept-Language", "en-US,en;q=0.9");
  return { ...init, headers };
}

export function transformChecklistHtml(html) {
  return String(html || "").replace(
    /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (whole, level, attributes, body) =>
      `<tr data-tcos-heading="${level}"><td>## ${body}</td></tr>`,
  );
}

export function transformReaderText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#{1,6}\s+/, "## "))
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

globalThis.fetch = async function patchedChecklistFetch(input, init = {}) {
  const originalUrl = requestUrl(input);
  const options = requestInit(init);
  let directResponse = null;
  let directError = null;

  try {
    directResponse = await nativeFetch(input, options);
    if (directResponse.ok) {
      return transformedResponse(directResponse);
    }
  } catch (error) {
    directError = error;
  }

  const readerUrl = proxyUrl(originalUrl);
  if (readerUrl) {
    try {
      const readerResponse = await nativeFetch(readerUrl, options);
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

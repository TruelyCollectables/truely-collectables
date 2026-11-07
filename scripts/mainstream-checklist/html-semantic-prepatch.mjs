const nativeFetch = globalThis.fetch.bind(globalThis);

const TARGET_HOSTS = new Set([
  "baseballcardpedia.com",
  "www.baseballcardpedia.com",
  "cardboardconnection.com",
  "www.cardboardconnection.com",
]);
const READER_HOST = "r.jina.ai";

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity) => {
    if (/^#x/i.test(entity)) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

function isGenericChild(value) {
  return /^(?:series|wave|part|group|tier)\s+(?:one|two|three|four|five|six|1|2|3|4|5|6)$/i.test(value);
}

function isChecklistParent(value) {
  return /^(?:base(?: set| cards)?|autographs?|signatures?|inserts?|parallels?|relics?|memorabilia|variations?|short prints?|sps?|rookies?|prospects?|gimmicks?)(?:\s+checklist)?$/i.test(value) ||
    /\b(?:checklists?|autographs?|signatures?|inserts?|relics?|memorabilia|parallels?|variations?|short prints?|rookies?|prospects?|gimmicks?)\b/i.test(value);
}

function isReaderCardLike(value) {
  return /^(?:#?\d{1,5}[A-Za-z]?|[A-Z]{1,12}-?[A-Z0-9]{1,18}|NNO|NO#)\s+/i.test(value);
}

function rewriteHeadingHierarchy(html) {
  let parent = "Base Set";
  return String(html || "").replace(
    /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (whole, level, attributes, body) => {
      const heading = stripTags(body);
      if (!heading) return whole;
      if (isGenericChild(heading)) {
        const rewritten = `${parent} - ${heading}`;
        return `<h${level}${attributes}>${rewritten}</h${level}>`;
      }
      if (isChecklistParent(heading)) parent = heading.replace(/\s+checklist$/i, "").trim();
      return whole;
    },
  );
}

function rewriteNumericProse(html) {
  return String(html || "").replace(
    /<(p|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (whole, tag, attributes, body) => {
      const plain = stripTags(body);
      if (!/^\d{1,5}\s+(?:cards?|copies?)\b/i.test(plain)) return whole;
      return `<${tag}${attributes}>NOTE: ${body}</${tag}>`;
    },
  );
}

export function transformSemanticChecklistHtml(html) {
  return rewriteNumericProse(rewriteHeadingHierarchy(html));
}

export function transformReaderSemanticText(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => {
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      if (!bullet) return line;
      const body = bullet[1].trim();
      if (isReaderCardLike(body) || isChecklistParent(body) || isGenericChild(body)) return body;
      return line;
    })
    .join("\n");
}

async function transformHtmlResponse(response) {
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(transformSemanticChecklistHtml(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function transformReaderResponse(response) {
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(transformReaderSemanticText(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

globalThis.fetch = async function semanticChecklistFetch(input, init = {}) {
  const urlValue = requestUrl(input);
  let host = null;
  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return nativeFetch(input, init);
  }

  const response = await nativeFetch(input, init);
  if (!response.ok) return response;
  const mime = String(response.headers.get("content-type") || "").toLowerCase();

  if (host === READER_HOST && (mime.includes("text/plain") || mime.includes("text/markdown"))) {
    return transformReaderResponse(response);
  }
  if (
    TARGET_HOSTS.has(host) &&
    (mime.includes("text/html") || mime.includes("application/xhtml+xml"))
  ) {
    return transformHtmlResponse(response);
  }
  return response;
};

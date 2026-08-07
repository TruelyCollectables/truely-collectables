const nativeFetch = globalThis.fetch.bind(globalThis);

const TARGET_HOSTS = new Set([
  "baseballcardpedia.com",
  "www.baseballcardpedia.com",
  "cardboardconnection.com",
  "www.cardboardconnection.com",
]);

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
    /\b(?:checklist|autograph|signature|insert|relic|memorabilia|parallel|variation|short print|rookie|prospect|gimmick)\b/i.test(value);
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

async function transformResponse(response) {
  const mime = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok || (!mime.includes("text/html") && !mime.includes("application/xhtml+xml"))) {
    return response;
  }
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

globalThis.fetch = async function semanticChecklistFetch(input, init = {}) {
  const urlValue = requestUrl(input);
  let host = null;
  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return nativeFetch(input, init);
  }
  const response = await nativeFetch(input, init);
  if (!TARGET_HOSTS.has(host)) return response;
  return transformResponse(response);
};

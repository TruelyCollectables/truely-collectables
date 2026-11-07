const nativeFetch = globalThis.fetch.bind(globalThis);

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

function cleanText(value) {
  return decodeEntities(
    String(value || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[*_`]+/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function isChecklistAnchor(value) {
  return /^(?:full |complete |master )?(?:card )?checklist(?:s)?$/i.test(cleanText(value));
}

function isMetadataHeading(value) {
  const text = cleanText(value);
  return /^(?:description|distribution|reviews?|insertion ratios?(?: matrix)?|odds|product details?|product configuration|configuration|release information|release date|important links?|forum|forums|shop|shopping|box break|box breaks|at a glance|quick summary|key cards?|sales|pricing|price guide|references?|external links?|notes?|gallery|videos?|related products?|set links?)$/i.test(text) ||
    /(?:insertion ratios?|odds table|product configuration|important links|shop this set|where to buy)/i.test(text);
}

function isMajorChecklistHeading(value) {
  const text = cleanText(value);
  return /^(?:base(?: set| cards)?|autographs?|signatures?|inserts?|parallels?|relics?|memorabilia|variations?|short prints?|sps?|rookies?|prospects?|gimmicks?)(?:\s+checklist)?$/i.test(text) ||
    /\b(?:autographs?|signatures?|inserts?|parallels?|relics?|memorabilia|variations?|short prints?|rookies?|prospects?|gimmicks?)\b/i.test(text);
}

function canonicalPiece(value) {
  return cleanText(value)
    .replace(/\s+checklist$/i, "")
    .trim();
}

function joinPath(path) {
  const result = [];
  for (const piece of path.map(canonicalPiece).filter(Boolean)) {
    if (result.at(-1)?.toLowerCase() === piece.toLowerCase()) continue;
    result.push(piece);
  }
  return result.join(" - ");
}

function contextualize(level, heading, paths) {
  const text = cleanText(heading);
  const parent = level > 1 ? paths[level - 1] || [] : [];
  for (let i = level; i < paths.length; i += 1) paths[i] = undefined;

  if (!text || isMetadataHeading(text) || isChecklistAnchor(text)) {
    paths[level] = [];
    return text;
  }

  let path = [];
  if (parent.length) {
    const alreadyPrefixed = joinPath(parent);
    if (alreadyPrefixed && text.toLowerCase().startsWith(`${alreadyPrefixed.toLowerCase()} - `)) {
      path = text.split(/\s+-\s+/).map(canonicalPiece).filter(Boolean);
    } else {
      path = [...parent, text];
    }
  } else if (isMajorChecklistHeading(text)) {
    path = [text];
  }

  paths[level] = path;
  return path.length > 1 ? joinPath(path) : text;
}

export function rewriteHtmlHeadingHierarchy(html) {
  const paths = [];
  return String(html || "").replace(
    /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (whole, levelValue, attributes, body) => {
      const level = Number(levelValue);
      const rewritten = contextualize(level, body, paths);
      if (!rewritten || rewritten === cleanText(body)) return whole;
      return `<h${level}${attributes}>${rewritten}</h${level}>`;
    },
  );
}

export function rewriteReaderHeadingHierarchy(value) {
  const paths = [];
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
      if (!match) return line;
      const level = match[1].length;
      const rewritten = contextualize(level, match[2], paths);
      return `${match[1]} ${rewritten}`;
    })
    .join("\n");
}

async function transformResponse(response) {
  if (!response?.ok) return response;
  const mime = String(response.headers.get("content-type") || "").toLowerCase();
  const isHtml = mime.includes("text/html") || mime.includes("application/xhtml+xml");
  const isReader = mime.includes("text/plain") || mime.includes("text/markdown");
  if (!isHtml && !isReader) return response;

  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (isHtml) {
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(rewriteHtmlHeadingHierarchy(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(rewriteReaderHeadingHierarchy(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

globalThis.fetch = async function checklistHierarchyFetch(input, init = {}) {
  const response = await nativeFetch(input, init);
  return transformResponse(response);
};

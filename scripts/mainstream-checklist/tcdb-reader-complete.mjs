const nativeFetch = globalThis.fetch.bind(globalThis);

const USER_AGENT =
  "TCOS-Mainstream-Checklist-Ingest/1.2 (+private Registry automation; contact sales@truelycollectables.com)";
const TCDB_PAGE_SIZE = 100;
const MAX_CHILD_SETS = 250;

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

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

function plainText(value) {
  return decodeEntities(
    String(value || "")
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[*_`]+/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isCardNumber(value) {
  const card = String(value || "").trim().replace(/^#\s*/, "");
  if (!card || card.length > 28 || /^(?:19|20)\d{2}$/.test(card)) return false;
  return /^(?:\d{1,5}[A-Za-z]?|[A-Z]{1,12}-?[A-Z0-9]{1,18}|NNO|NO#|NO NUMBER)$/i.test(card) &&
    /\d|NNO|NO#/i.test(card);
}

function tcdbInfo(urlValue) {
  try {
    const url = new URL(urlValue);
    if (!/(?:^|\.)tcdb\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(
      /\/(?:ViewSet|ViewAllSet|Checklist)\.cfm\/sid\/(\d+)(?:\/([^?#]+))?/i,
    );
    if (!match) return null;
    const sid = match[1];
    const slug = match[2] || "set";
    return {
      sid,
      slug,
      origin: url.origin,
      checklistUrl: `${url.origin}/Checklist.cfm/sid/${sid}/${slug}`,
      insertsUrl: `${url.origin}/Inserts.cfm/sid/${sid}/${slug}`,
    };
  } catch {
    return null;
  }
}

function readerUrl(url) {
  return `https://r.jina.ai/${String(url)}`;
}

async function fetchReaderText(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("User-Agent", USER_AGENT);
  headers.set("Accept", "text/plain,text/markdown;q=0.9,*/*;q=0.1");
  const response = await nativeFetch(readerUrl(url), {
    ...init,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    throw new Error(`TCDB reader ${response.status} ${response.statusText}: ${url}`);
  }
  const body = await response.text();
  if (!body || !/tcdb\.com/i.test(body)) {
    throw new Error(`TCDB reader returned an invalid body: ${url}`);
  }
  return body;
}

function extractTotalCards(value) {
  const plain = plainText(value);
  const match = plain.match(/\bTotal Cards\s*:?\s*([0-9][0-9,]*)\b/i);
  if (!match) throw new Error("TCDB reader did not expose a Total Cards count.");
  const total = Number(match[1].replace(/,/g, ""));
  if (!Number.isInteger(total) || total < 1 || total > 50_000) {
    throw new Error(`Invalid TCDB Total Cards count: ${match[1]}`);
  }
  return total;
}

function declaredRelatedSetCount(value) {
  const plain = plainText(value);
  let total = 0;
  for (const match of plain.matchAll(/\b(?:Insert|Parallel) Sets\s*\(([0-9][0-9,]*)\)/gi)) {
    total += Number(match[1].replace(/,/g, ""));
  }
  if (!Number.isInteger(total) || total < 0 || total > MAX_CHILD_SETS) {
    throw new Error(`Invalid TCDB related-set count: ${total}`);
  }
  return total;
}

function cardAnnotation(subjectValue, extraValue = "") {
  let subject = String(subjectValue || "").replace(/\s+/g, " ").trim();
  const markerText = `${subject} ${plainText(extraValue)}`;
  let serialRun = null;
  let autograph = false;
  let memorabilia = false;
  let variation = null;
  let rookie = false;

  const serial = markerText.match(/(?:^|[ ,])SN(\d{1,7})(?=$|[ ,])/i);
  if (serial) serialRun = Number(serial[1]);
  autograph = /(?:^|[ ,])(?:AU|AUTO)(?=$|[ ,])/i.test(markerText);
  memorabilia = /(?:^|[ ,])MEM(?=$|[ ,])/i.test(markerText);
  rookie = /(?:^|[ ,])RC(?=$|[ ,])/i.test(markerText);
  if (/(?:^|[ ,])SSP(?=$|[ ,])/i.test(markerText)) variation = "SSP";
  else if (/(?:^|[ ,])SP(?=$|[ ,])/i.test(markerText)) variation = "SP";
  else if (/(?:^|[ ,])VAR(?=$|[ ,])/i.test(markerText)) variation = "variation";

  if (rookie && !/\bRC\b/i.test(subject)) subject = `${subject} RC`;
  if (variation) subject = `${subject} (${variation})`;
  return { subject, serialRun, autograph, memorabilia };
}

function extractReaderCardRows(markdown) {
  const rows = [];
  const linePattern = /\[([^\]]+)\]\((https?:\/\/(?:www\.)?tcdb\.com\/ViewCard\.cfm[^)]*)\)/gi;
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/(?:www\.)?tcdb\.com\/[^)]*)\)/gi;

  for (const line of String(markdown || "").split(/\r?\n/)) {
    linePattern.lastIndex = 0;
    let numberMatch = null;
    for (const match of line.matchAll(linePattern)) {
      if (isCardNumber(match[1])) {
        numberMatch = match;
        break;
      }
    }
    if (!numberMatch) continue;

    const cardNumber = String(numberMatch[1]).trim().replace(/^#\s*/, "");
    const rest = line.slice((numberMatch.index || 0) + numberMatch[0].length);
    const links = [...rest.matchAll(linkPattern)]
      .map((match) => ({ label: plainText(match[1]), url: match[2] }))
      .filter((link) => link.label && !/^image\b/i.test(link.label));

    const people = links.filter((link) => /\/Person\.cfm/i.test(link.url)).map((link) => link.label);
    const teamLink = links.find((link) => /\/Team\.cfm/i.test(link.url));
    const firstUseful = links.find((link) => !/\/(?:Checklist|ViewCard)\.cfm/i.test(link.url));
    const subject = people.length ? [...new Set(people)].join(" / ") : firstUseful?.label;
    if (!subject) continue;

    const annotation = cardAnnotation(subject, rest);
    rows.push({
      cardNumber,
      team: teamLink?.label || null,
      ...annotation,
    });
  }
  return rows;
}

function sectionLabel(baseName, row) {
  const suffix = [];
  if (row.autograph && !/autograph|signature/i.test(baseName)) suffix.push("Autograph");
  if (row.memorabilia && !/relic|memorabilia|jersey|patch|material/i.test(baseName)) suffix.push("Memorabilia");
  if (row.serialRun && !new RegExp(`(?:/|SN)${row.serialRun}\\b`, "i").test(baseName)) {
    suffix.push(`/${row.serialRun}`);
  }
  return [baseName, ...suffix].join(" ").trim();
}

function dedupeRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = [row.cardNumber, row.subject, row.team || "", row.serialRun || "", row.autograph, row.memorabilia].join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

async function fetchCompleteReaderChecklist(checklistUrl, baseName, init) {
  const firstText = await fetchReaderText(checklistUrl, init);
  const totalCards = extractTotalCards(firstText);
  const pageCount = Math.ceil(totalCards / TCDB_PAGE_SIZE);
  const pageText = [firstText];
  for (let page = 2; page <= pageCount; page += 1) {
    const pageUrl = new URL(checklistUrl);
    pageUrl.searchParams.set("PageIndex", String(page));
    pageText.push(await fetchReaderText(pageUrl.toString(), init));
  }

  const rows = dedupeRows(pageText.flatMap(extractReaderCardRows));
  if (rows.length !== totalCards) {
    throw new Error(
      `TCDB reader completeness check failed for ${checklistUrl}: parsed ${rows.length} of declared ${totalCards} cards.`,
    );
  }

  const groups = new Map();
  for (const row of rows) {
    const label = sectionLabel(baseName, row);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }

  return [...groups.entries()].map(([label, groupRows]) => {
    const tableRows = groupRows
      .map((row) => `<tr><td>${escapeHtml(row.cardNumber)}</td><td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.team || "")}</td></tr>`)
      .join("\n");
    return `<h3>${escapeHtml(label)} Checklist</h3>\n<table>${tableRows}</table>`;
  }).join("\n");
}

function extractChildChecklistLinks(markdown, baseUrl, parentSid) {
  const children = new Map();
  for (const match of String(markdown || "").matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const label = plainText(match[1]);
    if (!label || label.length > 180) continue;
    try {
      const candidate = new URL(decodeEntities(match[2]), baseUrl);
      const child = tcdbInfo(candidate.toString());
      if (!child || child.sid === parentSid) continue;
      if (!children.has(child.sid)) {
        children.set(child.sid, { label, checklistUrl: child.checklistUrl });
      }
    } catch {
      // Ignore malformed child links.
    }
  }
  if (children.size > MAX_CHILD_SETS) {
    throw new Error(`TCDB reader insert expansion found ${children.size} child sets; manual review is required.`);
  }
  return [...children.values()];
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchCompleteReaderProduct(info, init) {
  const baseSection = await fetchCompleteReaderChecklist(info.checklistUrl, "Base Set", init);
  let childSections = [];
  try {
    const insertsText = await fetchReaderText(info.insertsUrl, init);
    const declaredChildren = declaredRelatedSetCount(insertsText);
    const children = extractChildChecklistLinks(insertsText, info.insertsUrl, info.sid);
    if (children.length !== declaredChildren) {
      throw new Error(
        `TCDB reader related-set completeness check failed for ${info.insertsUrl}: enumerated ${children.length} of declared ${declaredChildren} child sets.`,
      );
    }
    childSections = await mapLimit(children, 2, (child) =>
      fetchCompleteReaderChecklist(child.checklistUrl, child.label, init),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/TCDB reader (?:404|410)/i.test(message)) throw error;
  }

  const body = ["<html><body>", "<h2>Checklist</h2>", baseSection, ...childSections, "</body></html>"].join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-tcos-tcdb-complete": "reader",
      "x-tcos-tcdb-parent-sid": info.sid,
    },
  });
}

globalThis.fetch = async function completeTcdbReaderFetch(input, init = {}) {
  const info = tcdbInfo(requestUrl(input));
  if (!info) return nativeFetch(input, init);

  // Prefer the direct complete TCDB layer when it works. GitHub-hosted runners
  // currently receive Cloudflare 403s, so fall back to the public reader mirror
  // and independently enforce total-card and related-set completeness.
  try {
    const direct = await nativeFetch(input, init);
    if (direct?.ok && direct.headers?.get("x-tcos-tcdb-complete")) return direct;
  } catch {
    // Continue to the reader path.
  }
  return fetchCompleteReaderProduct(info, init);
};

export {
  declaredRelatedSetCount,
  extractChildChecklistLinks,
  extractReaderCardRows,
  extractTotalCards,
  plainText,
  tcdbInfo,
};

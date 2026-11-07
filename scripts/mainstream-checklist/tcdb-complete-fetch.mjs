const nativeFetch = globalThis.fetch.bind(globalThis);

const USER_AGENT =
  "TCOS-Mainstream-Checklist-Ingest/1.1 (+private Registry automation; contact sales@truelycollectables.com)";
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

function text(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
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
  if (!card || card.length > 28) return false;
  if (/^(?:19|20)\d{2}$/.test(card)) return false;
  return /^(?:\d{1,5}[A-Za-z]?|[A-Z]{1,12}-?[A-Z0-9]{1,18}|NNO|NO#|NO NUMBER)$/i.test(card) && /\d|NNO|NO#/i.test(card);
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

async function fetchHtml(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("User-Agent", USER_AGENT);
  headers.set("Accept", "text/html,application/xhtml+xml,*/*;q=0.1");
  const response = await nativeFetch(url, {
    ...init,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`TCDB ${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

function extractTotalCards(html) {
  const plain = text(html);
  const match = plain.match(/\bTotal Cards:\s*([0-9][0-9,]*)\b/i);
  if (!match) throw new Error("TCDB checklist did not expose a Total Cards count.");
  const total = Number(match[1].replace(/,/g, ""));
  if (!Number.isInteger(total) || total < 1 || total > 50_000) {
    throw new Error(`Invalid TCDB Total Cards count: ${match[1]}`);
  }
  return total;
}

function declaredRelatedSetCount(html) {
  const plain = text(html);
  let total = 0;
  for (const match of plain.matchAll(/\b(?:Insert|Parallel) Sets\s*\(([0-9][0-9,]*)\)/gi)) {
    total += Number(match[1].replace(/,/g, ""));
  }
  if (!Number.isInteger(total) || total < 0 || total > MAX_CHILD_SETS) {
    throw new Error(`Invalid TCDB related-set count: ${total}`);
  }
  return total;
}

function cardAnnotation(subjectValue) {
  let subject = String(subjectValue || "").replace(/\s+/g, " ").trim();
  let serialRun = null;
  let autograph = false;
  let memorabilia = false;
  let variation = null;
  let rookie = false;

  const serial = subject.match(/(?:^|[ ,])SN(\d{1,7})(?=$|[ ,])/i);
  if (serial) {
    serialRun = Number(serial[1]);
    subject = subject.replace(serial[0], " ");
  }
  if (/(?:^|[ ,])(?:AU|AUTO)(?=$|[ ,])/i.test(subject)) {
    autograph = true;
    subject = subject.replace(/(?:^|[ ,])(?:AU|AUTO)(?=$|[ ,])/gi, " ");
  }
  if (/(?:^|[ ,])MEM(?=$|[ ,])/i.test(subject)) {
    memorabilia = true;
    subject = subject.replace(/(?:^|[ ,])MEM(?=$|[ ,])/gi, " ");
  }
  if (/(?:^|[ ,])RC(?=$|[ ,])/i.test(subject)) {
    rookie = true;
    subject = subject.replace(/(?:^|[ ,])RC(?=$|[ ,])/gi, " ");
  }
  if (/(?:^|[ ,])(?:SP|SSP)(?=$|[ ,])/i.test(subject)) {
    const marker = subject.match(/(?:^|[ ,])(SSP|SP)(?=$|[ ,])/i)?.[1]?.toUpperCase() || "SP";
    variation = marker;
    subject = subject.replace(/(?:^|[ ,])(?:SP|SSP)(?=$|[ ,])/gi, " ");
  } else if (/(?:^|[ ,])VAR(?=$|[ ,])/i.test(subject)) {
    variation = "variation";
    subject = subject.replace(/(?:^|[ ,])VAR(?=$|[ ,])/gi, " ");
  }

  subject = subject
    .replace(/(?:^|[ ,])(?:UER|ERR|PR\d+)(?=$|[ ,])/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^,|,$/g, "")
    .trim();

  if (rookie) subject = `${subject} RC`;
  if (variation) subject = `${subject} (${variation})`;
  return { subject, serialRun, autograph, memorabilia };
}

function extractCardRows(html) {
  const rows = [];
  for (const match of String(html || "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => text(cell[1]))
      .filter(Boolean);
    const numberIndex = cells.findIndex(isCardNumber);
    if (numberIndex < 0 || numberIndex + 1 >= cells.length) continue;
    const cardNumber = cells[numberIndex].replace(/^#\s*/, "");
    const rawSubject = cells[numberIndex + 1];
    if (!rawSubject || /^(?:options?|card|player|name|team)$/i.test(rawSubject)) continue;
    const annotation = cardAnnotation(rawSubject);
    if (!annotation.subject) continue;
    const team = cells.slice(numberIndex + 2).find((value) =>
      value.length > 1 &&
      value.length <= 100 &&
      !/^(?:add|edit|view|image|options?|pricing|collection|want|have)$/i.test(value) &&
      !/^\$?\d+(?:\.\d+)?$/.test(value),
    ) || null;
    rows.push({ cardNumber, team, ...annotation });
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

async function fetchCompleteChecklist(checklistUrl, baseName, init) {
  const firstHtml = await fetchHtml(checklistUrl, init);
  const totalCards = extractTotalCards(firstHtml);
  const pageCount = Math.ceil(totalCards / TCDB_PAGE_SIZE);
  const pageHtml = [firstHtml];
  for (let page = 2; page <= pageCount; page += 1) {
    const pageUrl = new URL(checklistUrl);
    pageUrl.searchParams.set("PageIndex", String(page));
    pageHtml.push(await fetchHtml(pageUrl.toString(), init));
  }

  const rows = dedupeRows(pageHtml.flatMap(extractCardRows));
  if (rows.length !== totalCards) {
    throw new Error(
      `TCDB completeness check failed for ${checklistUrl}: parsed ${rows.length} of declared ${totalCards} cards.`,
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

function extractChildChecklistLinks(html, baseUrl, parentSid) {
  const children = new Map();
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    if (!label || label.length > 180) continue;
    try {
      const candidate = new URL(decodeEntities(match[1]), baseUrl);
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
    throw new Error(`TCDB insert expansion found ${children.size} child sets; manual review is required.`);
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

async function fetchCompleteTcdbProduct(info, init) {
  const baseSection = await fetchCompleteChecklist(info.checklistUrl, "Base Set", init);
  let childSections = [];
  try {
    const insertsHtml = await fetchHtml(info.insertsUrl, init);
    const declaredChildren = declaredRelatedSetCount(insertsHtml);
    const children = extractChildChecklistLinks(insertsHtml, info.insertsUrl, info.sid);
    if (children.length !== declaredChildren) {
      throw new Error(
        `TCDB related-set completeness check failed for ${info.insertsUrl}: enumerated ${children.length} of declared ${declaredChildren} child sets.`,
      );
    }
    childSections = await mapLimit(children, 3, (child) =>
      fetchCompleteChecklist(child.checklistUrl, child.label, init),
    );
  } catch (error) {
    // A product with no Inserts page is a valid base-only release. If the page
    // exists, any incomplete child enumeration is a hard failure.
    const message = error instanceof Error ? error.message : String(error);
    if (!/TCDB 404|TCDB 410/i.test(message)) throw error;
  }

  const body = [
    "<html><body>",
    "<h2>Checklist</h2>",
    baseSection,
    ...childSections,
    "</body></html>",
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-tcos-tcdb-complete": "true",
      "x-tcos-tcdb-parent-sid": info.sid,
    },
  });
}

globalThis.fetch = async function completeTcdbFetch(input, init = {}) {
  const info = tcdbInfo(requestUrl(input));
  if (!info) return nativeFetch(input, init);
  return fetchCompleteTcdbProduct(info, init);
};

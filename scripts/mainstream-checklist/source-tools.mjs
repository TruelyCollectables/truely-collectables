import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/mainstream-backlog-tmp");
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const USER_AGENT =
  "TCOS-Mainstream-Checklist-Ingest/1.1 (+private Registry automation; contact sales@truelycollectables.com)";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function slug(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", hellip: "…", ldquo: '"', lsquo: "'",
    lt: "<", nbsp: " ", ndash: "-", mdash: "-", quot: '"', rdquo: '"',
    reg: "®", rsquo: "'", trade: "™",
  };
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

function stripFragment(value) {
  return normalized(
    decodeEntities(
      String(value || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

// Preserve source order. The fetch shim turns source headings and strong checklist
// labels into synthetic one-cell table rows, so extracting rows in place keeps the
// heading immediately before the checklist rows it governs.
function htmlToSemanticText(html) {
  let value = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  value = value.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (whole, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => stripFragment(match[1]))
      .filter(Boolean);
    return cells.length ? `\n${cells.join(" | ")}\n` : "\n";
  });

  value = value
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (whole, heading) => {
      const text = stripFragment(heading);
      return text ? `\n## ${text}\n` : "\n";
    })
    .replace(/<(?:li|p|div|section|article|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(value)
    .split(/\r?\n/)
    .map(normalized)
    .filter(Boolean);
  return lines.filter((line, index) => line !== lines[index - 1]).join("\n");
}

function normalizedMimeType(url, header) {
  const type = String(header || "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".csv") return "text/csv";
  if (extension === ".tsv") return "text/tab-separated-values";
  if (extension === ".txt") return "text/plain";
  if (extension === ".html" || extension === ".htm" || extension === ".cfm") return "text/html";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".json") return "application/json";
  return type || "application/octet-stream";
}

function cleanFilename(url, fallback) {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    if (name) return decodeURIComponent(name).replace(/[^A-Za-z0-9._-]+/g, "-");
  } catch {
    // Use fallback.
  }
  return `${slug(fallback) || "checklist"}.html`;
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/pdf,text/plain,text/csv,text/tab-separated-values,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Downloaded source was empty.");
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Downloaded source exceeded ${MAX_SOURCE_BYTES} bytes.`);
  }
  const finalUrl = response.url || url;
  return {
    bytes,
    finalUrl,
    mimeType: normalizedMimeType(finalUrl, response.headers.get("content-type")),
  };
}

function linkedChecklistCandidates(html, baseUrl) {
  const candidates = [];
  for (const match of String(html || "").matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const label = stripFragment(match[2]);
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl);
      const href = url.toString();
      const strongFile = /\.(?:pdf|csv|tsv|txt|xls|xlsx)(?:$|[?#])/i.test(href);
      const strongLabel = /(?:download|full|complete)?\s*(?:card\s*)?checklist|spreadsheet|excel|xlsx|xls|csv/i.test(label);
      if (strongFile || strongLabel) {
        url.hash = "";
        candidates.push(url.toString());
      }
    } catch {
      // Ignore malformed links.
    }
  }
  return [...new Set(candidates)].slice(0, 8);
}

function workbookToText(bytes, mime, filename) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const inputPath = resolve(
    TEMP_ROOT,
    `${sha256(bytes).slice(0, 12)}-${filename.replace(/[^A-Za-z0-9._-]+/g, "-") || "source.xlsx"}`,
  );
  writeFileSync(inputPath, bytes);
  const python = String.raw`
import sys
path, mime = sys.argv[1], sys.argv[2]
rows = []
if path.lower().endswith('.xlsx') or 'openxmlformats' in mime:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows.append('## ' + ws.title)
        for row in ws.iter_rows(values_only=True):
            vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
            if vals: rows.append(' | '.join(vals))
else:
    import xlrd
    wb = xlrd.open_workbook(path)
    for ws in wb.sheets():
        rows.append('## ' + ws.name)
        for r in range(ws.nrows):
            vals = [str(ws.cell_value(r, c)).strip() for c in range(ws.ncols) if str(ws.cell_value(r, c)).strip()]
            if vals: rows.append(' | '.join(vals))
print('\n'.join(rows))
`;
  try {
    return execFileSync("python3", ["-c", python, inputPath, mime], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    }).trim();
  } finally {
    rmSync(inputPath, { force: true });
  }
}

function extractText(downloaded, filename) {
  const mime = downloaded.mimeType.toLowerCase();
  if (mime === "application/pdf") {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const inputPath = resolve(TEMP_ROOT, `${sha256(downloaded.bytes).slice(0, 12)}.pdf`);
    writeFileSync(inputPath, downloaded.bytes);
    try {
      return execFileSync("pdftotext", ["-layout", "-nopgbrk", inputPath, "-"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
      }).trim();
    } finally {
      rmSync(inputPath, { force: true });
    }
  }
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    return htmlToSemanticText(Buffer.from(downloaded.bytes).toString("utf8"));
  }
  if (["text/plain", "text/csv", "text/tab-separated-values", "application/json"].includes(mime)) {
    return Buffer.from(downloaded.bytes).toString("utf8").trim();
  }
  if (
    [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(mime)
  ) {
    return workbookToText(downloaded.bytes, mime, filename);
  }
  throw new Error(`Unsupported checklist extraction format: ${mime}`);
}

function inferSetType(name) {
  const value = normalized(name).toLowerCase();
  if (!value || /^(base|base set|base cards)$/.test(value)) return "base";
  if (/autograph|signature|signed/.test(value)) return "autograph";
  if (/relic|memorabilia|patch|swatch|jersey/.test(value)) return "memorabilia";
  if (/insert|subset|rookie|prospect|variation|short print|sp\b/.test(value)) return "insert";
  return "other";
}

function normalizeSetName(value) {
  const name = normalized(value)
    .replace(/^#+\s*/, "")
    .replace(/\s+(?:card )?checklist$/i, "")
    .replace(/^checklist\s*[-:]?\s*/i, "")
    .trim();
  if (!name || /^(checklist|base|base cards|base set)$/i.test(name) || name.length > 160) {
    return "Base Set";
  }
  return name;
}

function headingText(line) {
  return normalized(String(line || "").replace(/^#+\s*/, ""));
}

function isHeading(line) {
  if (line.startsWith("## ")) return true;
  if (line.length > 140 || line.includes(" | ")) return false;
  return /^(?:BASE|BASE SET|BASE CARDS|INSERTS?|AUTOGRAPHS?|MEMORABILIA|RELICS?|PARALLELS?|VARIATIONS?|SHORT PRINTS?|SP|ROOKIES?|PROSPECTS?|GIMMICKS?)(?:\s+CHECKLIST)?$/i.test(line) ||
    (/^[A-Z0-9][A-Z0-9 &'®™./()+:#-]{3,}$/.test(line) &&
      /(?:CHECKLIST|AUTOGRAPH|RELIC|MEMORABILIA|INSERT|PARALLEL|BASE|ROOKIE|PROSPECT|VARIATION|SHORT PRINT)/i.test(line));
}

function isChecklistAnchor(value) {
  return /^(?:full |complete |master )?(?:card )?checklist(?:s)?$/i.test(headingText(value));
}

function isMetadataHeading(value) {
  const text = headingText(value);
  return /^(?:description|distribution|reviews?|insertion ratios?(?: matrix)?|odds|product details?|product configuration|configuration|release information|release date|important links?|forum|forums|shop|shopping|box break|box breaks|at a glance|quick summary|key cards?|sales|pricing|price guide|references?|external links?|notes?|gallery|videos?|related products?)$/i.test(text) ||
    /(?:insertion ratios?|odds table|product configuration|important links|shop this set|where to buy)/i.test(text);
}

function isTeamChecklistHeading(value) {
  return /(?:team set|team checklist|team card checklist|by team)/i.test(headingText(value));
}

function isMajorSection(value) {
  return /^(?:base(?: set| cards)?|autographs?|signatures?|inserts?|parallels?|relics?|memorabilia|variations?|short prints?|sps?|rookies?|prospects?|gimmicks?)(?:\s+checklist)?$/i.test(headingText(value));
}

function isGenericChildSection(value) {
  return /^(?:series|wave|part|group|tier)\s+(?:one|two|three|four|1|2|3|4)$/i.test(headingText(value));
}

function looksLikeCardNumber(value) {
  const card = normalized(value).replace(/^#\s*/, "");
  if (!card || card.length > 24 || /^(?:19|20)\d{2}$/.test(card)) return false;
  return /^\d{1,4}[A-Za-z]?$/.test(card) ||
    (/^[A-Z]{1,10}-?[A-Z0-9]{1,16}$/i.test(card) && /\d/.test(card)) ||
    /^(?:NNO|NO#|NO NUMBER)$/i.test(card);
}

function excludedSubject(value) {
  const text = normalized(value);
  return (
    !text ||
    text.length < 2 ||
    text.length > 220 ||
    /^[-+]?\d+(?:\.\d+)?(?:\s*[:/]\s*\d+(?:\.\d+)?)?$/.test(text) ||
    /^(?:1|one)\s*:\s*\d+/i.test(text) ||
    /(?:cards per pack|packs per box|boxes per case|release date|product configuration|estimated odds|insertion ratio|parallel cards?|checklist subject to change|copyright|all rights reserved|suggested retail|msrp|hobby box|blaster box|mega box|fat pack|retail box|https?:\/\/|www\.)/i.test(text)
  );
}

function splitPlayers(subject) {
  const cleaned = normalized(subject)
    .replace(/\s+(?:RC|ROOKIE CARD|ROOKIE)$/i, "")
    .replace(/\s+\(RC\)$/i, "")
    .replace(/\s+\*+$/g, "")
    .trim();
  const pieces = cleaned
    .split(/\s+(?:\/|;|\+|&amp;)\s+/i)
    .map(normalized)
    .filter((value) => value.length >= 2 && value.length <= 160);
  return pieces.length ? [...new Set(pieces)] : cleaned ? [cleaned] : [];
}

function parseCardFromCells(cells) {
  const values = cells.map(normalized).filter(Boolean);
  const index = values.findIndex(
    (value, position) => position < 4 && looksLikeCardNumber(value),
  );
  if (index < 0 || index >= values.length - 1 || excludedSubject(values[index + 1])) {
    return null;
  }
  return {
    cardNumber: values[index].replace(/^#\s*/, ""),
    subject: values[index + 1],
    team:
      values[index + 2] &&
      values[index + 2].length <= 80 &&
      !/^\d+(?:\.\d+)?$/.test(values[index + 2])
        ? values[index + 2]
        : null,
  };
}

function parseCardLine(line) {
  if (line.includes(" | ")) return parseCardFromCells(line.split(" | "));
  const match = normalized(line).match(
    /^#?\s*((?:\d{1,4}[A-Za-z]?)|(?:[A-Z]{1,10}-?[A-Z0-9]{1,16})|(?:NNO|NO#))\s+(?:[-:–—]\s*)?(.+)$/i,
  );
  if (!match || !looksLikeCardNumber(match[1]) || excludedSubject(match[2])) return null;
  return {
    cardNumber: match[1].replace(/^#\s*/, ""),
    subject: normalized(match[2]),
    team: null,
  };
}

function parseSerialRun(value) {
  const slash = normalized(value).match(/(?:#?\s*)?\/(\d{1,7})\b/);
  if (slash) return Number(slash[1]);
  const numbered = normalized(value).match(
    /(?:numbered|serial(?:ly)? numbered|limited)\s+(?:to|#?\s*)\s*(\d{1,7})\b/i,
  );
  return numbered ? Number(numbered[1]) : null;
}

function parseParallelLine(line, setName) {
  const text = normalized(line).replace(/^[-•*]+\s*/, "");
  if (!text || text.length > 160 || looksLikeCardNumber(text.split(/\s+/)[0])) return null;
  if (!/(?:refractor|prizm|parallel|foil|wave|velocity|ice|scope|disco|mosaic|shimmer|cracked|sapphire|gold|silver|bronze|red|blue|green|orange|purple|black|white|pink|aqua|superfractor|printing plate)/i.test(text)) {
    return null;
  }
  const serialRun = parseSerialRun(text);
  const name = normalized(
    text
      .replace(/\s*[-–—:(]*\s*(?:#?\s*)?\/\d{1,7}\)?\s*$/i, "")
      .replace(
        /\s*[-–—:(]*\s*(?:numbered|serial(?:ly)? numbered|limited)\s+(?:to|#?\s*)\s*\d{1,7}\)?\s*$/i,
        "",
      ),
  );
  if (!name || name.length < 2) return null;
  const configuration =
    text.match(
      /\b(hobby|retail|blaster|mega|hanger|fanatics|walmart|target|international|online exclusive)\b/i,
    )?.[1] || null;
  return {
    setName,
    name,
    serialRun,
    configurationExclusivity: configuration,
    appliesToAllCards: /base/i.test(setName),
  };
}

export function parseChecklist(entry, text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(normalized)
    .filter(Boolean);
  const cards = [];
  const parallels = [];
  const warnings = [];
  const errors = [];
  const headings = lines.filter(isHeading);
  const hasChecklistAnchor = headings.some(isChecklistAnchor);
  const hasCardSections = headings.some(
    (line) => isMajorSection(line) || /\b(?:autograph|insert|relic|memorabilia|parallel|variation|short print|rookie|prospect)\b/i.test(headingText(line)),
  );

  let inChecklist = !hasChecklistAnchor && !hasCardSections;
  let setName = "Base Set";
  let majorParent = "Base Set";
  let nnoCounter = 0;
  let observedChecklistRows = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isHeading(line)) {
      const heading = headingText(line);

      if (isMetadataHeading(heading)) {
        inChecklist = false;
        continue;
      }
      if (isChecklistAnchor(heading)) {
        // Master-card/team views duplicate the structured checklist on many public
        // pages. Once a structured checklist has already produced rows, do not
        // parse a repeated master list as another Base Set.
        if (/^master /i.test(heading) && observedChecklistRows > 0) {
          inChecklist = false;
          continue;
        }
        inChecklist = true;
        setName = "Base Set";
        majorParent = "Base Set";
        continue;
      }
      if (isTeamChecklistHeading(heading) && observedChecklistRows > 0) {
        inChecklist = false;
        continue;
      }

      const checklistish =
        isMajorSection(heading) ||
        /\b(?:checklist|autograph|signature|insert|relic|memorabilia|parallel|variation|short print|rookie|prospect|gimmick)\b/i.test(heading);
      if (checklistish || inChecklist) {
        inChecklist = true;
        if (isGenericChildSection(heading) && majorParent) {
          setName = normalizeSetName(`${majorParent} — ${heading}`);
        } else {
          setName = normalizeSetName(heading);
          if (isMajorSection(heading)) majorParent = setName;
        }
      }
      continue;
    }

    if (!inChecklist) continue;

    const card = parseCardLine(line);
    if (card) {
      let cardNumber = normalized(card.cardNumber);
      if (/^(?:NNO|NO#)$/i.test(cardNumber)) cardNumber = `NNO-${++nnoCounter}`;
      const variationMatch = card.subject.match(
        /\((SP|SSP|variation|image variation|photo variation)[^)]*\)/i,
      );
      const players = splitPlayers(
        card.subject.replace(
          /\((?:SP|SSP|variation|image variation|photo variation)[^)]*\)/gi,
          "",
        ),
      );
      if (!players.length) continue;
      const setType = inferSetType(setName);
      cards.push({
        setName,
        cardNumber,
        players,
        teams: card.team ? [card.team] : [],
        rookieDesignation: /(?:\bRC\b|\brookie\b)/i.test(card.subject),
        firstBowmanDesignation: /first bowman/i.test(`${setName} ${card.subject}`),
        autographStatus: setType === "autograph" ? "autograph" : "non-auto",
        memorabiliaStatus:
          setType === "memorabilia" ? "memorabilia" : "non-memorabilia",
        variation: variationMatch
          ? normalized(variationMatch[0].replace(/[()]/g, ""))
          : null,
        sourceNotes: `Source line ${index + 1}`,
      });
      observedChecklistRows += 1;
      continue;
    }

    if (/parallel/i.test(setName) || /parallels?\s*[-:]/i.test(line)) {
      const parallel = parseParallelLine(
        line,
        setName.replace(/\s+parallels?.*$/i, "") || "Base Set",
      );
      if (parallel) parallels.push(parallel);
    }
  }

  const deduped = [];
  const exact = new Set();
  const byNumber = new Map();
  for (const card of cards) {
    const subject = card.players
      .map((value) => value.toLowerCase())
      .sort()
      .join("+");
    const numberKey = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const exactKey = `${numberKey}::${subject}`;
    if (exact.has(exactKey)) continue;
    exact.add(exactKey);
    const prior = byNumber.get(numberKey);
    if (prior && prior !== subject) {
      errors.push({
        code: "reference_card_number_subject_conflict",
        severity: "error",
        message: `${card.setName} #${card.cardNumber} maps to conflicting subjects.`,
      });
      continue;
    }
    byNumber.set(numberKey, subject);
    deduped.push(card);
  }

  const minimum = Math.max(1, Number(entry.minimumCardRows || 3));
  if (deduped.length < minimum) {
    errors.push({
      code: "reference_checklist_insufficient_rows",
      severity: "error",
      message: `Only ${deduped.length} deterministic card rows were parsed; ${minimum} are required.`,
    });
  }
  if (deduped.length > 10_000) {
    errors.push({
      code: "reference_checklist_excessive_rows",
      severity: "error",
      message: `Parsed ${deduped.length} rows from one source; split or review the source before import.`,
    });
  }
  if (!parallels.length) {
    warnings.push({
      code: "reference_parallel_rows_not_deterministic",
      severity: "warning",
      message: "No deterministic parallel rows were parsed from this source.",
    });
  }

  const uniqueParallels = [];
  const parallelKeys = new Set();
  for (const parallel of parallels) {
    const key = `${parallel.setName.toLowerCase()}::${parallel.name.toLowerCase()}::${parallel.serialRun || ""}`;
    if (!parallelKeys.has(key)) {
      parallelKeys.add(key);
      uniqueParallels.push(parallel);
    }
  }
  return { cards: deduped, parallels: uniqueParallels, warnings, errors };
}

function errorCount(parsed) {
  return parsed.errors.filter((issue) => issue.severity === "error").length;
}

function structuredPriority(mimeType) {
  if (/spreadsheetml|ms-excel|text\/csv|tab-separated/.test(mimeType)) return 0;
  if (/application\/pdf/.test(mimeType)) return 1;
  if (/text\/html|xhtml/.test(mimeType)) return 2;
  return 3;
}

function betterCandidate(next, current, minimum) {
  if (!current) return true;
  const nextPasses = next.parsed.cards.length >= minimum && errorCount(next.parsed) === 0;
  const currentPasses =
    current.parsed.cards.length >= minimum && errorCount(current.parsed) === 0;
  if (nextPasses !== currentPasses) return nextPasses;
  const nextErrors = errorCount(next.parsed);
  const currentErrors = errorCount(current.parsed);
  if (nextErrors !== currentErrors) return nextErrors < currentErrors;
  if (nextPasses && currentPasses) {
    const nextPriority = structuredPriority(next.source.mimeType);
    const currentPriority = structuredPriority(current.source.mimeType);
    if (nextPriority !== currentPriority) return nextPriority < currentPriority;
  }
  return next.parsed.cards.length > current.parsed.cards.length;
}

async function parsedDownload(entry, url) {
  const downloaded = await fetchBytes(url);
  const filename = cleanFilename(downloaded.finalUrl, entry.release.canonicalName);
  const source = { ...downloaded, filename, selectedUrl: url };
  const text = extractText(downloaded, filename);
  const parsed = parseChecklist(entry, text);
  return { source, text, parsed, landingPage: null };
}

export async function downloadAndParse(entry) {
  const failures = [];
  const minimum = Math.max(1, Number(entry.minimumCardRows || 3));

  for (const url of [entry.sourceUrl, ...(entry.fallbackUrls || [])]) {
    try {
      const primary = await parsedDownload(entry, url);
      let best = primary;

      if (primary.source.mimeType.includes("html")) {
        const html = Buffer.from(primary.source.bytes).toString("utf8");
        const linkedUrls = linkedChecklistCandidates(html, primary.source.finalUrl);
        for (const linkedUrl of linkedUrls) {
          try {
            const linked = await parsedDownload(entry, linkedUrl);
            linked.landingPage = primary.source;
            if (betterCandidate(linked, best, minimum)) best = linked;
          } catch (error) {
            failures.push(
              `${linkedUrl}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      return best;
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `All source URLs failed: ${failures.join(" | ").slice(0, 2_000)}`,
  );
}

export function runParserSelfTest() {
  const entry = { minimumCardRows: 3 };
  const text = htmlToSemanticText(
    [
      "<h2>Insertion Ratios</h2>",
      "<table><tr><td>Changing Faces Red</td><td>300</td><td>150</td><td>1:9</td></tr></table>",
      "<h2>Checklist</h2>",
      "<h3>Base Set</h3>",
      "<table>",
      "<tr><th>No.</th><th>Player</th><th>Team</th></tr>",
      "<tr><td>1</td><td>Alpha Player RC</td><td>Colorado Rockies</td></tr>",
      "<tr><td>2</td><td>Beta Player</td><td>Boston Red Sox</td></tr>",
      "<tr><td>3</td><td>Gamma Player</td><td>Seattle Mariners</td></tr>",
      "</table>",
    ].join(""),
  );
  const parsed = parseChecklist(entry, text);
  if (
    parsed.cards.length !== 3 ||
    parsed.cards[0].cardNumber !== "1" ||
    !parsed.cards[0].rookieDesignation ||
    parsed.errors.length !== 0
  ) {
    throw new Error(`Parser self-test failed: ${JSON.stringify(parsed)}`);
  }

  const nested = parseChecklist(
    { minimumCardRows: 4 },
    [
      "## Checklist",
      "## Base Set",
      "## Series One",
      "1 | Alpha Player",
      "2 | Beta Player",
      "## Autographs",
      "## Series One",
      "1 | Gamma Player",
      "2 | Delta Player",
    ].join("\n"),
  );
  const names = new Set(nested.cards.map((card) => card.setName));
  if (
    nested.errors.length ||
    !names.has("Base Set — Series One") ||
    !names.has("Autographs — Series One")
  ) {
    throw new Error(`Nested-section parser self-test failed: ${JSON.stringify(nested)}`);
  }

  return {
    status: "passed",
    cards: parsed.cards.length,
    parallels: parsed.parallels.length,
    metadataRowsIgnored: true,
    nestedSectionsPreserved: true,
  };
}

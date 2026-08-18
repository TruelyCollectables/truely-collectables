import type {
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { parseUpperDeckHtmlChecklist } from "./upper-deck-html";

export const UPPER_DECK_2025_26_NORMALIZED_ADAPTER_ID =
  "upper-deck-2025-26-normalized-html" as const;
export const UPPER_DECK_2025_26_NORMALIZED_ADAPTER_VERSION = "1.1.0" as const;

const KNOWN_PARALLEL_SUFFIXES = [
  "Printing Plates",
  "Black and White",
  "Golden Treasures",
  "Gold Glitter Bomb",
  "Outburst Silver",
  "Outburst Red",
  "Outburst Gold",
  "Speckled Rainbow",
  "Black Rainbow",
  "Orange Slice",
  "Blue Spectrum",
  "Purple Diamond",
  "Pink Lemonade",
  "Silver Foil",
  "High Gloss",
  "Exclusives",
  "Clear Cut",
  "Deluxe",
  "Doubloons",
  "Auto",
].sort((left, right) => right.length - left.length);

const MODERN_HOCKEY_PRODUCT =
  /(?:black-diamond|credentials|artifacts|o-pee-chee|opc|mvp|skybox-metal-universe|sp-game-used|sp-authentic|spx|synergy|upper-deck-(?:series|extended)|ud-(?:series|extended)|the-cup|ultimate|stature|trilogy|allure|parkhurst|ice|premier|clear-cut|team-canada|tim-hortons|ahl|chl|pwhl)/i;

type Cell = {
  full: string;
  tag: string;
  attrs: string;
  inner: string;
  text: string;
};

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function text(value: string) {
  return decode(value.replace(/<[^>]+>/g, " "))
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function header(value: string) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function comparable(value: string) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalSetName(value: string) {
  const normalized = text(value).replace(/^Base Set\s*-\s*/i, "");
  return normalized || "Base Set";
}

function parsedSetKey(rawSetName: string) {
  const value = text(rawSetName);
  const match = value.match(/^(.*?)\s+Parallel(?:\s*-\s*(.+))?$/i);
  if (!match) return comparable(canonicalSetName(value));

  const beforeParallel = text(match[1]);
  const explicitSetSuffix = text(match[2] || "");
  let basePrefix = "";
  for (const suffix of KNOWN_PARALLEL_SUFFIXES) {
    if (beforeParallel.toLowerCase().endsWith(suffix.toLowerCase())) {
      basePrefix = text(beforeParallel.slice(0, -suffix.length));
      break;
    }
  }
  const setPieces = [basePrefix, explicitSetSuffix].filter(Boolean);
  return comparable(
    setPieces.length ? canonicalSetName(setPieces.join(" - ")) : "Base Set",
  );
}

function cells(row: string): Cell[] {
  return [...row.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(
    (match) => ({
      full: match[0],
      tag: match[1],
      attrs: match[2] || "",
      inner: match[3],
      text: text(match[3]),
    }),
  );
}

function replaceCells(row: string, replacements: Map<number, string>) {
  let index = -1;
  return row.replace(
    /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string) => {
      index += 1;
      const replacement = replacements.get(index);
      return replacement === undefined
        ? full
        : `<${tag}${attrs}>${replacement}</${tag}>`;
    },
  );
}

function serialValue(value: string) {
  const normalized = text(value);
  const oneOf = normalized.match(/^1\s+of\s+(\d{1,7})$/i);
  if (oneOf) return oneOf[1];
  const per = normalized.match(/^(\d{1,7})\s+per(?:\s+.*)?$/i);
  if (per) return per[1];
  return value;
}

function ultimateCollectionSource(artifact: ChecklistSourceArtifact) {
  return /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-26-nhl-ultimate-collection-checklist\/?$/i.test(
    artifact.sourceUrl,
  );
}

function normalizeUltimateSetName(value: string) {
  let normalized = text(value);
  const update = normalized.match(/^(20(?:22|23|24))\s+Update\s*-\s*(.+)$/i);
  if (update) normalized = `${update[2].trim()} - Update ${update[1]}`;

  normalized = normalized
    .replace(/^Ultimate Access Auto Patch Parallel$/i, "Auto Parallel - Ultimate Access Patch")
    .replace(
      /^Ultimate Access 4 Nations Face-Off Auto Patch Parallel$/i,
      "Auto Parallel - Ultimate Access 4 Nations Face-Off Patch",
    )
    .replace(/^Ultimate Apparel Auto Parallel$/i, "Auto Parallel - Ultimate Apparel")
    .replace(/^Ultimate Apparel Auto Black Parallel$/i, "Auto Black Parallel - Ultimate Apparel");

  return normalized;
}

function normalizeUltimateCollectionHtml(
  html: string,
  artifact: ChecklistSourceArtifact,
) {
  if (!ultimateCollectionSource(artifact)) return html;
  return html.replace(
    /<(td)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string, inner: string) => {
      const before = text(inner);
      const after = normalizeUltimateSetName(before);
      return after === before ? full : `<${tag}${attrs}>${after}</${tag}>`;
    },
  );
}

function normalizeChecklistTable(table: string) {
  const rowMatches = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  const rows = rowMatches.map((match) => match[0]);
  const parsed = rows.map(cells);
  const headerIndex = parsed.findIndex((row) => {
    const names = row.map((cell) => header(cell.text));
    return names.includes("setname") &&
      (names.includes("card") || names.includes("cardnumber"));
  });
  if (headerIndex < 0) return table;

  const names = parsed[headerIndex].map((cell) => header(cell.text));
  const setIndex = names.indexOf("setname");
  const cardIndex = names.findIndex((name) => name === "card" || name === "cardnumber");
  const subjectIndex = names.findIndex((name) =>
    ["description", "playername", "player"].includes(name),
  );
  const serialIndex = names.findIndex((name) =>
    ["seriald", "d", "serialdnumber", "serialnumberd"].includes(name),
  );
  let spIndex = names.findIndex((name) => ["sps", "sp"].includes(name));

  if (setIndex < 0 || cardIndex < 0 || subjectIndex < 0) return table;

  const owners = new Map<string, Set<string>>();
  for (let index = headerIndex + 1; index < parsed.length; index += 1) {
    const row = parsed[index];
    const setName = row[setIndex]?.text || "";
    const cardNumber = row[cardIndex]?.text || "";
    const subject = row[subjectIndex]?.text || "";
    if (!setName || !cardNumber || !subject) continue;
    const key = `${parsedSetKey(setName)}:${comparable(cardNumber)}`;
    const signatures = owners.get(key) || new Set<string>();
    signatures.add(comparable(subject));
    owners.set(key, signatures);
  }

  const conflicts = new Set(
    [...owners.entries()]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([key]) => key),
  );
  const addSpColumn = conflicts.size > 0 && spIndex < 0;
  if (addSpColumn) spIndex = parsed[headerIndex].length;

  const normalizedRows = rows.map((row, rowIndex) => {
    const rowCells = parsed[rowIndex];
    const replacements = new Map<number, string>();

    if (rowIndex === headerIndex) {
      if (names[cardIndex] === "cardnumber") replacements.set(cardIndex, "Card");
      if (["player", "playername"].includes(names[subjectIndex])) {
        replacements.set(subjectIndex, "Description");
      }
    } else if (rowIndex > headerIndex) {
      if (serialIndex >= 0 && rowCells[serialIndex]) {
        replacements.set(serialIndex, serialValue(rowCells[serialIndex].inner));
      }
      const setName = rowCells[setIndex]?.text || "";
      const cardNumber = rowCells[cardIndex]?.text || "";
      const subject = rowCells[subjectIndex]?.text || "";
      const key = `${parsedSetKey(setName)}:${comparable(cardNumber)}`;
      if (conflicts.has(key) && subject) {
        const prior = spIndex < rowCells.length ? rowCells[spIndex]?.text || "" : "";
        const variation = [prior, `Subject: ${subject}`].filter(Boolean).join("; ");
        if (spIndex < rowCells.length) replacements.set(spIndex, variation);
      }
    }

    let output = replaceCells(row, replacements);
    if (addSpColumn) {
      const value = rowIndex === headerIndex
        ? "SPs"
        : rowIndex > headerIndex
          ? (() => {
              const setName = rowCells[setIndex]?.text || "";
              const cardNumber = rowCells[cardIndex]?.text || "";
              const subject = rowCells[subjectIndex]?.text || "";
              return conflicts.has(`${parsedSetKey(setName)}:${comparable(cardNumber)}`) && subject
                ? `Subject: ${subject}`
                : "";
            })()
          : "";
      const cellTag = rowIndex === headerIndex ? "th" : "td";
      output = output.replace(/<\/tr>$/i, `<${cellTag}>${value}</${cellTag}></tr>`);
    }
    return output;
  });

  let cursor = 0;
  let output = "";
  rowMatches.forEach((match, index) => {
    output += table.slice(cursor, match.index) + normalizedRows[index];
    cursor = (match.index || 0) + match[0].length;
  });
  return output + table.slice(cursor);
}

function normalizeTitle(html: string, artifact: ChecklistSourceArtifact) {
  const context = `${artifact.originalFilename} ${artifact.sourceUrl}`;
  const season = context.match(/\b(20\d{2})[-_](\d{2,4})\b/);
  if (!season) return html;
  const ending = season[2].length === 4 ? season[2].slice(-2) : season[2];
  const period = `${season[1]}-${ending}`;
  return html.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/i, (full, attrs: string, inner: string) => {
    let title = text(inner);
    if (!/\b20\d{2}\s*-\s*\d{2,4}\b/.test(title)) title = `${period} ${title}`;
    if (!/\b(hockey|ahl|pwhl)\b/i.test(title)) title = `${title} Hockey`;
    return `<h1${attrs}>${title}</h1>`;
  });
}

function normalizeOfficialHtml(artifact: ChecklistSourceArtifact) {
  const original = typeof artifact.content === "string"
    ? artifact.content
    : Buffer.from(artifact.content).toString("utf8");
  const ultimateNormalized = normalizeUltimateCollectionHtml(original, artifact);
  const titled = normalizeTitle(ultimateNormalized, artifact);
  return titled.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, normalizeChecklistTable);
}

function modernHockeySource(artifact: ChecklistSourceArtifact) {
  const context = `${artifact.originalFilename} ${artifact.sourceUrl}`;
  const season = context.match(/\b(20\d{2})[-_](?:\d{2}|20\d{2})\b/);
  if (!season || Number(season[1]) < 2021) return false;
  return MODERN_HOCKEY_PRODUCT.test(context);
}

export const upperDeck2025_26NormalizedHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_2025_26_NORMALIZED_ADAPTER_ID,
  version: UPPER_DECK_2025_26_NORMALIZED_ADAPTER_VERSION,
  supports(artifact) {
    return artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\//i.test(artifact.sourceUrl) &&
      modernHockeySource(artifact);
  },
  parse(artifact) {
    return parseUpperDeckHtmlChecklist({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeOfficialHtml(artifact),
    });
  },
};

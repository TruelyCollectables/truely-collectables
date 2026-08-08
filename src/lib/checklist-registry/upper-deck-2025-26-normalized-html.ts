import type {
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { parseUpperDeckHtmlChecklist } from "./upper-deck-html";

export const UPPER_DECK_2025_26_NORMALIZED_ADAPTER_ID =
  "upper-deck-2025-26-normalized-html" as const;
export const UPPER_DECK_2025_26_NORMALIZED_ADAPTER_VERSION = "1.0.2" as const;

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
  const announced = normalized.match(/^Ann\.?\s*(\d{1,7})$/i);
  if (announced) return announced[1];
  return value;
}

function normalizeParallelSetName(value: string, parentSetNames: string[]) {
  const normalized = text(value);
  const match = normalized.match(/^(.*?)\s+Parallel$/i);
  if (!match) return normalized;
  const beforeParallel = text(match[1]);
  const beforeComparable = comparable(beforeParallel);
  const parent = parentSetNames
    .filter((candidate) => {
      const key = comparable(candidate);
      return beforeComparable === key || beforeComparable.startsWith(`${key}-`);
    })
    .sort((left, right) => comparable(right).length - comparable(left).length)[0];
  if (!parent) return normalized;
  const parentKey = comparable(parent);
  if (beforeComparable === parentKey) return normalized;
  const parallelName = text(beforeParallel.slice(parent.length)).replace(/^[-\s]+/, "");
  if (!parallelName) return normalized;
  return `${parallelName} Parallel - ${parent}`;
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

  const parentSetNames = [...new Set(
    parsed
      .slice(headerIndex + 1)
      .map((row) => row[setIndex]?.text || "")
      .filter((value) => value && !/\s+Parallel$/i.test(value)),
  )];

  const normalizedSetNames = parsed.map((row, index) =>
    index > headerIndex && row[setIndex]
      ? normalizeParallelSetName(row[setIndex].text, parentSetNames)
      : row[setIndex]?.text || "",
  );

  const owners = new Map<string, Set<string>>();
  for (let index = headerIndex + 1; index < parsed.length; index += 1) {
    const row = parsed[index];
    const setName = normalizedSetNames[index] || "";
    const cardNumber = row[cardIndex]?.text || "";
    const subject = row[subjectIndex]?.text || "";
    if (!setName || !cardNumber || !subject) continue;
    const key = `${comparable(setName)}:${comparable(cardNumber)}`;
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
      const normalizedSetName = normalizedSetNames[rowIndex] || "";
      if (normalizedSetName && normalizedSetName !== rowCells[setIndex]?.text) {
        replacements.set(setIndex, normalizedSetName);
      }
      const cardNumber = rowCells[cardIndex]?.text || "";
      const subject = rowCells[subjectIndex]?.text || "";
      const key = `${comparable(normalizedSetName)}:${comparable(cardNumber)}`;
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
              const setName = normalizedSetNames[rowIndex] || "";
              const cardNumber = rowCells[cardIndex]?.text || "";
              const subject = rowCells[subjectIndex]?.text || "";
              return conflicts.has(`${comparable(setName)}:${comparable(cardNumber)}`) && subject
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
  const titled = normalizeTitle(original, artifact);
  return titled.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, normalizeChecklistTable);
}

export const upperDeck2025_26NormalizedHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_2025_26_NORMALIZED_ADAPTER_ID,
  version: UPPER_DECK_2025_26_NORMALIZED_ADAPTER_VERSION,
  supports(artifact) {
    return artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\//i.test(artifact.sourceUrl) &&
      /2025[-_](?:26|2026)/i.test(`${artifact.originalFilename} ${artifact.sourceUrl}`);
  },
  parse(artifact) {
    return parseUpperDeckHtmlChecklist({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeOfficialHtml(artifact),
    });
  },
};

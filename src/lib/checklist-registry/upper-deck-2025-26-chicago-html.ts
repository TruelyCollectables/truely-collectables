import { normalizeInscribedSubjects } from "./inscriptions";
import type {
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { upperDeck2025_26NormalizedHtmlChecklistAdapter } from "./upper-deck-2025-26-normalized-html";

export const UPPER_DECK_2025_26_CHICAGO_ADAPTER_ID =
  "upper-deck-2025-26-chicago-html" as const;
export const UPPER_DECK_2025_26_CHICAGO_ADAPTER_VERSION = "1.1.0" as const;

type Cell = { text: string };

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
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

function cells(row: string): Cell[] {
  return [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
    (match) => ({ text: text(match[1]) }),
  );
}

function replaceCell(row: string, targetIndex: number, replacement: string) {
  let index = -1;
  return row.replace(
    /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string) => {
      index += 1;
      return index === targetIndex
        ? `<${tag}${attrs}>${replacement}</${tag}>`
        : full;
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeChicagoChecklist(html: string) {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
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
    const descriptionIndex = names.findIndex((name) =>
      ["description", "player", "playername"].includes(name),
    );
    const shortPrintIndex = names.indexOf("sps");
    if (setIndex < 0 || descriptionIndex < 0) return table;

    const officialSetNames = [
      ...new Set(
        parsed
          .slice(headerIndex + 1)
          .map((row) => row[setIndex]?.text || "")
          .filter(Boolean),
      ),
    ];
    const baseCandidates = officialSetNames
      .filter((name) => !/\s+Parallel$/i.test(name))
      .sort((left, right) => right.length - left.length);

    const normalizedRows = rows.map((row, rowIndex) => {
      if (rowIndex <= headerIndex) return row;
      const rawSetName = parsed[rowIndex][setIndex]?.text || "";
      let normalizedRow = row;

      if (/\s+Parallel$/i.test(rawSetName)) {
        const baseSetName = baseCandidates.find((candidate) =>
          rawSetName.toLowerCase().startsWith(`${candidate.toLowerCase()} `),
        );
        if (baseSetName) {
          const parallelName = rawSetName
            .slice(baseSetName.length)
            .replace(/\s+Parallel$/i, "")
            .trim();
          if (parallelName) {
            normalizedRow = replaceCell(
              normalizedRow,
              setIndex,
              escapeHtml(`${parallelName} Parallel - ${baseSetName}`),
            );
          }
        }
      }

      if (/\bInscriptions Parallel$/i.test(rawSetName)) {
        const description = parsed[rowIndex][descriptionIndex]?.text || "";
        const normalized = normalizeInscribedSubjects({
          subjects: [description],
          variation:
            shortPrintIndex >= 0
              ? parsed[rowIndex][shortPrintIndex]?.text || null
              : null,
          context: [rawSetName],
        });
        if (normalized.changed && normalized.subjects[0] && shortPrintIndex >= 0) {
          normalizedRow = replaceCell(
            normalizedRow,
            descriptionIndex,
            escapeHtml(normalized.subjects[0]),
          );
          normalizedRow = replaceCell(
            normalizedRow,
            shortPrintIndex,
            escapeHtml(normalized.variation || ""),
          );
        }
      }

      return normalizedRow;
    });

    let cursor = 0;
    let output = "";
    rowMatches.forEach((match, index) => {
      output += table.slice(cursor, match.index) + normalizedRows[index];
      cursor = (match.index || 0) + match[0].length;
    });
    return output + table.slice(cursor);
  });
}

export const upperDeck2025_26ChicagoHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_2025_26_CHICAGO_ADAPTER_ID,
  version: UPPER_DECK_2025_26_CHICAGO_ADAPTER_VERSION,
  supports(artifact) {
    return artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/chicago-blackhawks-100th-anniversary-set-checklist-hobby\/?$/i.test(
        artifact.sourceUrl,
      );
  },
  parse(artifact: ChecklistSourceArtifact) {
    const original = typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
    return upperDeck2025_26NormalizedHtmlChecklistAdapter.parse({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeChicagoChecklist(original),
    });
  },
};

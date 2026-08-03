import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-mvp-official-html-checklist" as const;
export const UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.2" as const;

type CanonicalBaseRow = {
  description: string;
  teamCity: string;
  teamName: string;
};

function text(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanSpreadsheetLeak(value: string) {
  return value.replace(/\+[A-Z]+\d+:[A-Z]+\d+\s*$/i, "").trim();
}

function isCanonicalMvpBaseSet(setName: string, cardNumber: string) {
  const number = Number(cardNumber);
  if (!Number.isInteger(number)) return false;
  if (/^Base Set$/i.test(setName)) return number >= 1 && number <= 200;
  if (/^Base Set\s*-\s*SP'?s$/i.test(setName)) return number >= 201 && number <= 220;
  if (/^Base Set\s*-\s*Rookie SP'?s$/i.test(setName)) {
    return number >= 221 && number <= 250;
  }
  return false;
}

function cellsForRow(rowHtml: string) {
  return [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(
    (match) => ({ full: match[0], attributes: match[1], inner: match[2] }),
  );
}

function replaceCell(rowHtml: string, oldCell: string, attributes: string, value: string) {
  return rowHtml.replace(oldCell, `<td${attributes}>${escapeHtml(value)}</td>`);
}

function sanitizeMvpSource(html: string) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(
    (match) => match[0],
  );
  const canonical = new Map<string, CanonicalBaseRow>();
  let spreadsheetLeakRepairs = 0;
  let duplicateBaseOwnerRepairs = 0;
  let parallelOwnerRepairs = 0;

  for (const row of rows) {
    const cells = cellsForRow(row);
    if (cells.length < 5) continue;
    const setName = text(cells[0].inner);
    const cardNumber = text(cells[1].inner).replace(/^#\s*/, "");
    if (!isCanonicalMvpBaseSet(setName, cardNumber)) continue;
    const rawDescription = text(cells[2].inner);
    const description = cleanSpreadsheetLeak(rawDescription);
    if (description !== rawDescription) spreadsheetLeakRepairs += 1;
    const key = cardNumber.toLowerCase();
    if (!canonical.has(key)) {
      canonical.set(key, {
        description,
        teamCity: text(cells[3].inner),
        teamName: text(cells[4].inner),
      });
    }
  }

  const repaired = html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (rowHtml) => {
    const cells = cellsForRow(rowHtml);
    if (cells.length < 5) return rowHtml;
    const setName = text(cells[0].inner);
    const rawCardNumber = text(cells[1].inner).replace(/^#\s*/, "");
    const cardNumber = rawCardNumber.toLowerCase();
    const base = canonical.get(cardNumber);
    if (!base) return rowHtml;

    let output = rowHtml;
    const currentDescription = cleanSpreadsheetLeak(text(cells[2].inner));
    const currentCity = text(cells[3].inner);
    const currentTeam = text(cells[4].inner);

    if (isCanonicalMvpBaseSet(setName, rawCardNumber)) {
      if (
        currentDescription === base.description &&
        currentCity === base.teamCity &&
        currentTeam === base.teamName
      ) {
        if (currentDescription !== text(cells[2].inner)) {
          output = replaceCell(output, cells[2].full, cells[2].attributes, currentDescription);
        }
        return output;
      }
      output = replaceCell(output, cells[2].full, cells[2].attributes, base.description);
      output = replaceCell(output, cells[3].full, cells[3].attributes, base.teamCity);
      output = replaceCell(output, cells[4].full, cells[4].attributes, base.teamName);
      duplicateBaseOwnerRepairs += 1;
      return output;
    }

    if (!/\bParallel\b/i.test(setName)) return output;
    if (
      currentDescription === base.description &&
      currentCity === base.teamCity &&
      currentTeam === base.teamName
    ) {
      return output;
    }

    output = replaceCell(output, cells[2].full, cells[2].attributes, base.description);
    output = replaceCell(output, cells[3].full, cells[3].attributes, base.teamCity);
    output = replaceCell(output, cells[4].full, cells[4].attributes, base.teamName);
    parallelOwnerRepairs += 1;
    return output;
  });

  return {
    html: repaired,
    spreadsheetLeakRepairs,
    duplicateBaseOwnerRepairs,
    parallelOwnerRepairs,
  };
}

export function parseUpperDeckMvpOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent =
    typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
  const repaired = sanitizeMvpSource(originalContent);
  const normalizedArtifact: ChecklistSourceArtifact = {
    ...artifact,
    content: repaired.html,
  };
  const plan = parseUpperDeckOfficialHtmlChecklist(normalizedArtifact);
  const originalStorage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: plan.release.manufacturer,
    releaseSlug: plan.release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  return {
    ...plan,
    adapterId: UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_VERSION,
    source: {
      ...plan.source,
      storage: originalStorage,
    },
    validation: {
      ...plan.validation,
      issues: [
        ...plan.validation.issues,
        ...(repaired.spreadsheetLeakRepairs
          ? [{
              code: "official_source_spreadsheet_leak_repaired",
              severity: "warning" as const,
              message: `Removed ${repaired.spreadsheetLeakRepairs} trailing spreadsheet range artifact(s) from MVP subject text while retaining the original source archive.`,
              rowReference: null,
            }]
          : []),
        ...(repaired.duplicateBaseOwnerRepairs
          ? [{
              code: "official_source_duplicate_base_owner_reconciled",
              severity: "warning" as const,
              message: `Reconciled ${repaired.duplicateBaseOwnerRepairs} duplicate MVP Base Set row(s) to the first official same-number owner while retaining the original source archive.`,
              rowReference: null,
            }]
          : []),
        ...(repaired.parallelOwnerRepairs
          ? [{
              code: "official_source_parallel_owner_reconciled",
              severity: "warning" as const,
              message: `Reconciled ${repaired.parallelOwnerRepairs} MVP parallel row(s) to the same-number official Base Set subject/team while retaining the original source archive.`,
              rowReference: null,
            }]
          : []),
      ],
    },
  };
}

export const upperDeckMvpOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-26-mvp-hockey-checklist\/?$/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseUpperDeckMvpOfficialHtmlChecklist,
};

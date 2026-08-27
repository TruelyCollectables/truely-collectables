import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-mvp-official-html-checklist" as const;
export const UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.3" as const;

type CanonicalBaseRow = {
  description: string;
  teamCity: string;
  teamName: string;
};

const VERIFIED_SOURCE_CORRECTIONS = new Map<string, CanonicalBaseRow>([
  ["104", { description: "Patrik Laine", teamCity: "Montreal", teamName: "Canadiens" }],
  ["108", { description: "Fabian Zetterlund", teamCity: "Ottawa", teamName: "Senators" }],
  ["112", { description: "Morgan Rielly", teamCity: "Toronto", teamName: "Maple Leafs" }],
]);

function text(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function cleanSpreadsheetLeak(value: string) {
  return value.replace(/\+[A-Z]+\d+:[A-Z]+\d+\s*$/i, "").trim();
}

function isCanonicalMvpBaseSet(setName: string, cardNumber: string) {
  const number = Number(cardNumber);
  if (!Number.isInteger(number)) return false;
  if (/^Base Set$/i.test(setName)) return number >= 1 && number <= 200;
  if (/^Base Set\s*-\s*SP'?s$/i.test(setName)) return number >= 201 && number <= 220;
  return /^Base Set\s*-\s*Rookie SP'?s$/i.test(setName) && number >= 221 && number <= 250;
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
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const canonical = new Map<string, CanonicalBaseRow>(VERIFIED_SOURCE_CORRECTIONS);
  let spreadsheetLeakRepairs = 0;
  let verifiedIdentityRepairs = 0;

  for (const row of rows) {
    const cells = cellsForRow(row);
    if (cells.length < 5) continue;
    const setName = text(cells[0].inner);
    const cardNumber = text(cells[1].inner).replace(/^#\s*/, "");
    if (!isCanonicalMvpBaseSet(setName, cardNumber) || VERIFIED_SOURCE_CORRECTIONS.has(cardNumber)) continue;
    const rawDescription = text(cells[2].inner);
    const description = cleanSpreadsheetLeak(rawDescription);
    if (description !== rawDescription) spreadsheetLeakRepairs += 1;
    if (!canonical.has(cardNumber)) {
      canonical.set(cardNumber, {
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
    const cardNumber = text(cells[1].inner).replace(/^#\s*/, "");
    const base = canonical.get(cardNumber);
    if (!base || (!isCanonicalMvpBaseSet(setName, cardNumber) && !/\bParallel\b/i.test(setName))) return rowHtml;

    const currentDescription = cleanSpreadsheetLeak(text(cells[2].inner));
    const currentCity = text(cells[3].inner);
    const currentTeam = text(cells[4].inner);
    if (currentDescription === base.description && currentCity === base.teamCity && currentTeam === base.teamName) {
      if (currentDescription !== text(cells[2].inner)) {
        spreadsheetLeakRepairs += 1;
        return replaceCell(rowHtml, cells[2].full, cells[2].attributes, currentDescription);
      }
      return rowHtml;
    }

    let output = replaceCell(rowHtml, cells[2].full, cells[2].attributes, base.description);
    output = replaceCell(output, cells[3].full, cells[3].attributes, base.teamCity);
    output = replaceCell(output, cells[4].full, cells[4].attributes, base.teamName);
    verifiedIdentityRepairs += 1;
    return output;
  });

  return { html: repaired, spreadsheetLeakRepairs, verifiedIdentityRepairs };
}

export function parseUpperDeckMvpOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent = typeof artifact.content === "string"
    ? artifact.content
    : Buffer.from(artifact.content).toString("utf8");
  const repaired = sanitizeMvpSource(originalContent);
  const plan = parseUpperDeckOfficialHtmlChecklist({ ...artifact, content: repaired.html });
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
    source: { ...plan.source, storage: originalStorage },
    validation: {
      ...plan.validation,
      issues: [
        ...plan.validation.issues,
        ...(repaired.spreadsheetLeakRepairs ? [{
          code: "official_source_spreadsheet_leak_repaired",
          severity: "warning" as const,
          message: `Removed ${repaired.spreadsheetLeakRepairs} spreadsheet range artifact(s) while retaining the original source archive.`,
          rowReference: null,
        }] : []),
        ...(repaired.verifiedIdentityRepairs ? [{
          code: "official_source_identity_cross_checked",
          severity: "warning" as const,
          message: `Reconciled ${repaired.verifiedIdentityRepairs} MVP row(s) using independently verified identities for cards 104, 108, and 112 while retaining the original source archive.`,
          rowReference: null,
        }] : []),
      ],
    },
  };
}

export const upperDeckMvpOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_MVP_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-26-mvp-hockey-checklist\/?$/i.test(artifact.sourceUrl);
  },
  parse: parseUpperDeckMvpOfficialHtmlChecklist,
};

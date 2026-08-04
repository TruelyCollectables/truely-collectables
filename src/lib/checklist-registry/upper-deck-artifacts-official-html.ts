import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_ARTIFACTS_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-artifacts-official-html-checklist" as const;
export const UPPER_DECK_ARTIFACTS_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.0" as const;

type CanonicalRow = {
  description: string;
  teamCity: string;
  teamName: string;
};

const KNOWN_BASE_PARALLEL_PREFIXES = [
  "Aqua",
  "Autofacts",
  "Black",
  "Blue",
  "Bronze",
  "Clear Cut",
  "Emerald",
  "Gold",
  "Light Blue",
  "Orange",
  "Pink",
  "Purple",
  "Red",
  "Ruby",
  "Silver",
  "Spectrum",
  "Steel",
  "Yellow",
];

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

function cellsForRow(rowHtml: string) {
  return [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(
    (match) => ({ full: match[0], attributes: match[1], inner: match[2] }),
  );
}

function replaceCell(rowHtml: string, oldCell: string, attributes: string, value: string) {
  return rowHtml.replace(oldCell, `<td${attributes}>${escapeHtml(value)}</td>`);
}

function canonicalCategory(setName: string) {
  const match = setName.match(/^Base Set(?:\s*-\s*(.+))?$/i);
  if (!match) return null;
  return (match[1] || "Base Set").trim();
}

function parallelCategory(setName: string) {
  const match = setName.match(/\bParallel(?:\s*-\s*(.+))?$/i);
  if (!match) return null;
  const suffix = (match[1] || "").trim();
  if (suffix) return suffix;
  if (/\bRookies(?:\s+Auto)?$/i.test(setName)) return "Rookies";
  if (/\bStars(?:\s+Auto)?$/i.test(setName)) return "Stars";
  if (/\bGoalies(?:\s+Auto)?$/i.test(setName)) return "Goalies";
  if (/\bGreats(?:\s+Auto)?$/i.test(setName)) return "Greats";
  return "Base Set";
}

function standaloneParallelFamily(setName: string) {
  const match = setName.match(/^(.+?)\s+Parallel$/i);
  if (!match) return null;
  const family = match[1].trim();
  if (KNOWN_BASE_PARALLEL_PREFIXES.some((prefix) => family.toLowerCase() === prefix.toLowerCase())) {
    return null;
  }
  return family;
}

function sanitizeArtifactsSource(html: string) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(
    (match) => match[0],
  );
  const canonical = new Map<string, CanonicalRow>();
  let standaloneFamiliesSeparated = 0;
  let rookieOwnerRepairs = 0;

  for (const row of rows) {
    const cells = cellsForRow(row);
    if (cells.length < 5) continue;
    const category = canonicalCategory(text(cells[0].inner));
    const cardNumber = text(cells[1].inner).replace(/^#\s*/, "");
    if (!category || !cardNumber) continue;
    canonical.set(`${category.toLowerCase()}:${cardNumber.toLowerCase()}`, {
      description: text(cells[2].inner),
      teamCity: text(cells[3].inner),
      teamName: text(cells[4].inner),
    });
  }

  const repaired = html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (rowHtml) => {
    const cells = cellsForRow(rowHtml);
    if (cells.length < 5) return rowHtml;
    const setName = text(cells[0].inner);
    const family = standaloneParallelFamily(setName);
    let output = rowHtml;

    if (family) {
      output = replaceCell(
        output,
        cells[0].full,
        cells[0].attributes,
        `Custom Parallel - ${family}`,
      );
      standaloneFamiliesSeparated += 1;
      return output;
    }

    const category = parallelCategory(setName);
    const cardNumber = text(cells[1].inner).replace(/^#\s*/, "");
    if (!category || !cardNumber) return output;
    const base = canonical.get(`${category.toLowerCase()}:${cardNumber.toLowerCase()}`);
    if (!base) return output;

    const currentDescription = text(cells[2].inner);
    const currentCity = text(cells[3].inner);
    const currentTeam = text(cells[4].inner);
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
    rookieOwnerRepairs += 1;
    return output;
  });

  return { html: repaired, standaloneFamiliesSeparated, rookieOwnerRepairs };
}

export function parseUpperDeckArtifactsOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent =
    typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
  const repaired = sanitizeArtifactsSource(originalContent);
  const plan = parseUpperDeckOfficialHtmlChecklist({
    ...artifact,
    content: repaired.html,
  });
  const originalStorage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: plan.release.manufacturer,
    releaseSlug: plan.release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  return {
    ...plan,
    adapterId: UPPER_DECK_ARTIFACTS_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_ARTIFACTS_OFFICIAL_HTML_ADAPTER_VERSION,
    source: { ...plan.source, storage: originalStorage },
    validation: {
      ...plan.validation,
      issues: [
        ...plan.validation.issues,
        ...(repaired.standaloneFamiliesSeparated
          ? [{
              code: "artifacts_standalone_parallel_family_separated",
              severity: "warning" as const,
              message: `Separated ${repaired.standaloneFamiliesSeparated} standalone Artifacts parallel-family row(s) from Base Set numbering while retaining the original source archive.`,
              rowReference: null,
            }]
          : []),
        ...(repaired.rookieOwnerRepairs
          ? [{
              code: "artifacts_parallel_owner_reconciled",
              severity: "warning" as const,
              message: `Reconciled ${repaired.rookieOwnerRepairs} Artifacts parallel row(s) to the official same-number base category owner while retaining the original source archive.`,
              rowReference: null,
            }]
          : []),
      ],
    },
  };
}

export const upperDeckArtifactsOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_ARTIFACTS_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_ARTIFACTS_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-2026-artifacts-checklist\/?$/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseUpperDeckArtifactsOfficialHtmlChecklist,
};

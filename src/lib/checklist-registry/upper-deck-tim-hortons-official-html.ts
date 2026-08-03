import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_TIM_HORTONS_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-tim-hortons-official-html-checklist" as const;
export const UPPER_DECK_TIM_HORTONS_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.2" as const;

function text(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOfficialHeader(content: string) {
  return content.replace(
    /(<th\b[^>]*>)\s*Decription\s*(<\/th>)/i,
    "$1Description$2",
  );
}

function removeNonCardPrizeRows(content: string) {
  let removed = 0;
  const html = content.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const cells = [
      ...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
    ].map((match) => text(match[1]));
    if (!cells.length) return row;

    const setName = cells[0] || "";
    const cardNumber = cells[1] || "";
    const isNonCardPrize = /^Prize Card\b/i.test(setName) && !cardNumber;

    if (!isNonCardPrize) return row;
    removed += 1;
    return "";
  });
  return { html, removed };
}

export function parseUpperDeckTimHortonsOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent =
    typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
  const normalizedHeader = normalizeOfficialHeader(originalContent);
  const filtered = removeNonCardPrizeRows(normalizedHeader);
  const plan = parseUpperDeckOfficialHtmlChecklist({
    ...artifact,
    content: filtered.html,
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
    adapterId: UPPER_DECK_TIM_HORTONS_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_TIM_HORTONS_OFFICIAL_HTML_ADAPTER_VERSION,
    source: {
      ...plan.source,
      storage: originalStorage,
    },
    validation: {
      ...plan.validation,
      issues: [
        ...plan.validation.issues,
        {
          code: "official_source_description_header_typo_normalized",
          severity: "warning",
          message:
            "Normalized the official Tim Hortons 'Decription' header to 'Description' for parsing while retaining the original source archive unchanged.",
          rowReference: "table.header.Decription",
        },
        ...(filtered.removed
          ? [
              {
                code: "non_card_prize_rows_excluded",
                severity: "warning" as const,
                message: `Excluded ${filtered.removed} promotional prize/redemption row(s) with no card number from Checklist Registry identities while retaining them in the original source archive.`,
                rowReference: "Prize Card",
              },
            ]
          : []),
      ],
    },
  };
}

export const upperDeckTimHortonsOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_TIM_HORTONS_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_TIM_HORTONS_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-2026-tim-hortons-checklist\/?$/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseUpperDeckTimHortonsOfficialHtmlChecklist,
};

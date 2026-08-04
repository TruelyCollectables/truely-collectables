import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_BLACK_DIAMOND_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-black-diamond-official-html-checklist" as const;
export const UPPER_DECK_BLACK_DIAMOND_OFFICIAL_HTML_ADAPTER_VERSION =
  "1.0.0" as const;

function normalizeRookieGemsEliasPettersson(content: string) {
  let normalized = 0;
  const html = content.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const plain = row
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!/\bRG-EP\b/i.test(plain) || !/Elias Pettersson\s*\(2025\)/i.test(plain)) {
      return row;
    }
    normalized += 1;
    return row.replace(/Elias Pettersson\s*\(2025\)/gi, "Elias Pettersson");
  });
  return { html, normalized };
}

export function parseUpperDeckBlackDiamondOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent =
    typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
  const repaired = normalizeRookieGemsEliasPettersson(originalContent);
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
    adapterId: UPPER_DECK_BLACK_DIAMOND_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_BLACK_DIAMOND_OFFICIAL_HTML_ADAPTER_VERSION,
    source: { ...plan.source, storage: originalStorage },
    validation: {
      ...plan.validation,
      issues: [
        ...plan.validation.issues,
        ...(repaired.normalized
          ? [
              {
                code: "official_source_subject_suffix_normalized",
                severity: "warning" as const,
                message: `Normalized ${repaired.normalized} Black Diamond RG-EP row(s) from 'Elias Pettersson (2025)' to 'Elias Pettersson' so all Rookie Gems parallels resolve to the same player while retaining the original source archive unchanged.`,
                rowReference: "Rookie Gems RG-EP",
              },
            ]
          : []),
      ],
    },
  };
}

export const upperDeckBlackDiamondOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_BLACK_DIAMOND_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_BLACK_DIAMOND_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-2026-black-diamond-checklist\/?$/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseUpperDeckBlackDiamondOfficialHtmlChecklist,
};

import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_2024_25_SERIES_2_ERRATA_ADAPTER_ID =
  "upper-deck-2024-25-series-2-errata-html-checklist" as const;
export const UPPER_DECK_2024_25_SERIES_2_ERRATA_ADAPTER_VERSION = "1.0.0" as const;

const SERIES_2_SOURCE =
  "https://upperdeck.com/checklist/2024-25-upper-deck-series-2-checklist/";

function contentText(content: string | Uint8Array) {
  return typeof content === "string"
    ? content
    : Buffer.from(content).toString("utf8");
}

function rowPlainText(rowHtml: string) {
  return rowHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Upper Deck's published 2024-25 Series 2 HTML has one known numbering typo:
 * Roman Josi is printed/listed on the physical card as UD Canvas C145, but the
 * official web table currently says C190 in the base Canvas row and repeats
 * the same typo for its Black & White and Printing Plates parallels. The same
 * table separately and correctly assigns C190 to Elvis Merzlikins.
 *
 * Apply only this exact source/player/set-family correction before generic
 * parsing. The unmodified official HTML is still what gets privately archived.
 */
function correctRomanJosiCanvasErratum(html: string) {
  return html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (rowHtml) => {
    const text = rowPlainText(rowHtml);
    if (!/\bUD Canvas\b/i.test(text)) return rowHtml;
    if (!/\bRoman Josi\b/i.test(text)) return rowHtml;
    if (!/\bC190\b/i.test(text)) return rowHtml;

    return rowHtml.replace(
      /(<(?:td|th)\b[^>]*>\s*)C190(\s*<\/(?:td|th)>)/i,
      "$1C145$2",
    );
  });
}

function addErratumEvidence(plan: ChecklistImportPlan) {
  return plan.cards.map((card) => {
    if (
      card.cardNumber.toUpperCase() !== "C145" ||
      !card.players.some((player) => player.toLowerCase() === "roman josi")
    ) {
      return card;
    }

    let notes: Record<string, unknown> = {};
    try {
      notes = card.sourceNotes
        ? (JSON.parse(card.sourceNotes) as Record<string, unknown>)
        : {};
    } catch {
      notes = { originalSourceNotes: card.sourceNotes };
    }

    return {
      ...card,
      sourceNotes: JSON.stringify({
        ...notes,
        sourceErrata: [
          {
            code: "upper_deck_official_card_number_typo",
            sourceUrl: SERIES_2_SOURCE,
            player: "Roman Josi",
            officialPublishedValue: "C190",
            correctedValue: "C145",
            scope: "UD Canvas family",
            correctionBasis:
              "official sequence gap plus independently verified physical/checklist identity",
          },
        ],
      }),
    };
  });
}

export function parseUpperDeck2024_25Series2ErrataHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const transformedArtifact: ChecklistSourceArtifact = {
    ...artifact,
    content: correctRomanJosiCanvasErratum(contentText(artifact.content)),
  };
  const plan = parseUpperDeckOfficialHtmlChecklist(transformedArtifact);
  const cards = addErratumEvidence(plan);
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: plan.release.manufacturer,
    releaseSlug: plan.release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  return {
    ...plan,
    adapterId: UPPER_DECK_2024_25_SERIES_2_ERRATA_ADAPTER_ID,
    adapterVersion: UPPER_DECK_2024_25_SERIES_2_ERRATA_ADAPTER_VERSION,
    source: {
      ...plan.source,
      storage,
    },
    cards,
  };
}

export const upperDeck2024_25Series2ErrataHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_2024_25_SERIES_2_ERRATA_ADAPTER_ID,
  version: UPPER_DECK_2024_25_SERIES_2_ERRATA_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      artifact.sourceUrl === SERIES_2_SOURCE
    );
  },
  parse: parseUpperDeck2024_25Series2ErrataHtmlChecklist,
};

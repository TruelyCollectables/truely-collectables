import { buildChecklistIdentityFingerprint } from "./identity";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_CLEAR_CUT_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-clear-cut-official-html-checklist" as const;
export const UPPER_DECK_CLEAR_CUT_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.0" as const;

function contentText(content: string | Uint8Array) {
  return typeof content === "string"
    ? content
    : Buffer.from(content).toString("utf8");
}

/**
 * Clear Cut checklists contain update-year lanes whose card numbers can be
 * reused by a different player in the current release. Move the update-year
 * qualifier to the end of the official set-cell text while parsing so the
 * generic parallel splitter cannot collapse those lanes onto the current
 * Base Set/Rookies bucket. The archived source remains byte-for-byte original.
 */
function markUpdateYearLanes(html: string) {
  return html.replace(
    /(20\d{2}-\d{2})\s+Update\s*-\s*([^<\r\n]+)/gi,
    (_match, season: string, remainder: string) =>
      `${remainder.trim()} - Update ${season}`,
  );
}

function restoreUpdateYearLane(value: string) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(.*?)\s*-\s*Update\s+(20\d{2}-\d{2})$/i);
  if (match) {
    const lane = match[1].trim();
    const season = match[2];
    return lane ? `${season} Update - ${lane}` : `${season} Update`;
  }
  const bare = normalized.match(/^Update\s+(20\d{2}-\d{2})$/i);
  return bare ? `${bare[1]} Update` : normalized;
}

function restoreSourceNotes(value: string | null) {
  if (!value) return value;
  try {
    const parsed = JSON.parse(value) as {
      rows?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    if (Array.isArray(parsed.rows)) {
      parsed.rows = parsed.rows.map((row) => ({
        ...row,
        officialSetName:
          typeof row.officialSetName === "string"
            ? restoreUpdateYearLane(row.officialSetName)
            : row.officialSetName,
      }));
    }
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

function rebuildIdentitySetNames(plan: ChecklistImportPlan) {
  return plan.identities.map((entry) => {
    const current = entry.fingerprint.normalized;
    const restoredSetName = restoreUpdateYearLane(current.setName);
    if (restoredSetName === current.setName) return entry;
    return {
      ...entry,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear: current.releaseYear,
        season: current.season,
        manufacturer: current.manufacturer,
        brand: current.brand,
        product: current.product,
        sport: current.sport,
        league: current.league,
        setName: restoredSetName,
        subset: current.subset,
        cardNumber: current.cardNumber,
        players: current.players,
        teams: current.teams,
        parallel: current.parallel,
        variation: current.variation,
        serialRun: current.serialRun,
        autographStatus: current.autographStatus,
        memorabiliaStatus: current.memorabiliaStatus,
        configurationExclusivity: current.configurationExclusivity,
      }),
    };
  });
}

export function parseUpperDeckClearCutOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent = contentText(artifact.content);
  const transformedArtifact: ChecklistSourceArtifact = {
    ...artifact,
    content: markUpdateYearLanes(originalContent),
  };
  const plan = parseUpperDeckOfficialHtmlChecklist(transformedArtifact);
  const sets = plan.sets.map((set) => {
    const name = restoreUpdateYearLane(set.name);
    return {
      ...set,
      name,
      normalizedName: restoreUpdateYearLane(set.normalizedName),
    };
  });
  const cards = plan.cards.map((card) => ({
    ...card,
    sourceNotes: restoreSourceNotes(card.sourceNotes),
  }));
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: plan.release.manufacturer,
    releaseSlug: plan.release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  return {
    ...plan,
    adapterId: UPPER_DECK_CLEAR_CUT_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_CLEAR_CUT_OFFICIAL_HTML_ADAPTER_VERSION,
    source: {
      ...plan.source,
      storage,
    },
    sets,
    cards,
    identities: rebuildIdentitySetNames({ ...plan, sets, cards }),
  };
}

export const upperDeckClearCutOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_CLEAR_CUT_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_CLEAR_CUT_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/.*clear-cut.*checklist\/?$/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseUpperDeckClearCutOfficialHtmlChecklist,
};

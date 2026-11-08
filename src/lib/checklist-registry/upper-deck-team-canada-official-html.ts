import { buildChecklistIdentityFingerprint } from "./identity";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseUpperDeckOfficialHtmlChecklist } from "./upper-deck-official-html";

export const UPPER_DECK_TEAM_CANADA_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-team-canada-official-html-checklist" as const;
export const UPPER_DECK_TEAM_CANADA_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.0" as const;

function withParserSeason(content: string) {
  return content.replace(
    /(<h1\b[^>]*>\s*)2025(\s+Team Canada Juniors(?:\s+Checklist)?\s*<\/h1>)/i,
    "$12025-25$2",
  );
}

function rebuildCalendarYear(plan: ChecklistImportPlan) {
  const releaseYear = "2025";
  const season = null;
  const identities = plan.identities.map((entry) => {
    const current = entry.fingerprint.normalized;
    return {
      ...entry,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear,
        season,
        manufacturer: current.manufacturer,
        brand: current.brand,
        product: current.product,
        sport: current.sport,
        league: current.league,
        setName: current.setName,
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

  return {
    ...plan,
    release: {
      ...plan.release,
      releaseYear,
      season,
    },
    identities,
  };
}

export function parseUpperDeckTeamCanadaOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const originalContent =
    typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
  const normalizedArtifact: ChecklistSourceArtifact = {
    ...artifact,
    content: withParserSeason(originalContent),
  };
  const parsed = rebuildCalendarYear(
    parseUpperDeckOfficialHtmlChecklist(normalizedArtifact),
  );
  const originalStorage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: parsed.release.manufacturer,
    releaseSlug: parsed.release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  return {
    ...parsed,
    adapterId: UPPER_DECK_TEAM_CANADA_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_TEAM_CANADA_OFFICIAL_HTML_ADAPTER_VERSION,
    source: {
      ...parsed.source,
      storage: originalStorage,
    },
    validation: {
      ...parsed.validation,
      issues: [
        ...parsed.validation.issues,
        {
          code: "calendar_year_release_normalized",
          severity: "warning",
          message:
            "Stored 2025 Team Canada Juniors as calendar releaseYear 2025 rather than inventing a seasonal year. Original official source remains archived unchanged.",
          rowReference: null,
        },
      ],
    },
  };
}

export const upperDeckTeamCanadaOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_TEAM_CANADA_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_TEAM_CANADA_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/2025-team-canada-juniors-checklist\/?$/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseUpperDeckTeamCanadaOfficialHtmlChecklist,
};

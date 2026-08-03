import { buildChecklistIdentityFingerprint } from "./identity";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { parseUpperDeckHtmlChecklist } from "./upper-deck-html";

export const UPPER_DECK_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-official-html-checklist" as const;
export const UPPER_DECK_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.0" as const;

function inferredSportFromSource(artifact: ChecklistSourceArtifact) {
  const context = `${artifact.sourceUrl} ${artifact.originalFilename}`.toLowerCase();
  if (context.includes("pwhl")) return { sport: "Hockey", league: "PWHL" };
  if (context.includes("ahl")) return { sport: "Hockey", league: "AHL" };
  if (context.includes("hockey")) return { sport: "Hockey", league: "NHL" };
  if (context.includes("golf")) return { sport: "Golf", league: null };
  if (context.includes("aew")) return { sport: "Wrestling", league: "AEW" };
  return null;
}

function rebuildIdentitySport(
  plan: ChecklistImportPlan,
  sport: string,
  league: string | null,
) {
  return plan.identities.map((entry) => {
    const current = entry.fingerprint.normalized;
    return {
      ...entry,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear: current.releaseYear,
        season: current.season,
        manufacturer: current.manufacturer,
        brand: current.brand,
        product: current.product,
        sport,
        league,
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
}

export function parseUpperDeckOfficialHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const plan = parseUpperDeckHtmlChecklist(artifact);
  const inferred =
    plan.release.sport === "Other" ? inferredSportFromSource(artifact) : null;
  if (!inferred) {
    return {
      ...plan,
      adapterId: UPPER_DECK_OFFICIAL_HTML_ADAPTER_ID,
      adapterVersion: UPPER_DECK_OFFICIAL_HTML_ADAPTER_VERSION,
    };
  }

  return {
    ...plan,
    adapterId: UPPER_DECK_OFFICIAL_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_OFFICIAL_HTML_ADAPTER_VERSION,
    release: {
      ...plan.release,
      sport: inferred.sport,
      league: inferred.league,
    },
    identities: rebuildIdentitySport(
      plan,
      inferred.sport,
      inferred.league,
    ),
  };
}

export const upperDeckOfficialHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_OFFICIAL_HTML_ADAPTER_ID,
  version: UPPER_DECK_OFFICIAL_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\//i.test(artifact.sourceUrl)
    );
  },
  parse: parseUpperDeckOfficialHtmlChecklist,
};

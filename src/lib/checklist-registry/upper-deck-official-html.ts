import { buildChecklistIdentityFingerprint } from "./identity";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { parseUpperDeckHtmlChecklist } from "./upper-deck-html";

export const UPPER_DECK_OFFICIAL_HTML_ADAPTER_ID =
  "upper-deck-official-html-checklist" as const;
export const UPPER_DECK_OFFICIAL_HTML_ADAPTER_VERSION = "1.0.1" as const;

function sourceStartYear(context: string) {
  const season = context.match(/(?:^|[^0-9])(20\d{2})[-_](?:20)?\d{2}(?:[^0-9]|$)/);
  if (season) return Number(season[1]);
  const year = context.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
  return year ? Number(year[1]) : null;
}

function inferredSportFromSource(artifact: ChecklistSourceArtifact) {
  const context = `${artifact.sourceUrl} ${artifact.originalFilename}`.toLowerCase();
  if (context.includes("pwhl")) return { sport: "Hockey", league: "PWHL" };
  if (context.includes("ahl")) return { sport: "Hockey", league: "AHL" };
  if (/(?:^|[^a-z])chl(?:[^a-z]|$)/i.test(context)) return { sport: "Hockey", league: "CHL" };
  if (context.includes("team-canada")) return { sport: "Hockey", league: "Team Canada" };
  if (context.includes("hockey")) return { sport: "Hockey", league: "NHL" };
  if (context.includes("golf")) return { sport: "Golf", league: null };
  if (context.includes("aew")) return { sport: "Wrestling", league: "AEW" };
  if (context.includes("baseball")) return { sport: "Baseball", league: "MLB" };
  if (context.includes("basketball")) return { sport: "Basketball", league: "NBA" };
  if (context.includes("football")) return { sport: "Football", league: "NFL" };

  // Upper Deck's modern hockey archive frequently omits the word "Hockey"
  // from both the checklist H1 and source slug (for example SP Authentic,
  // Extended Series and MVP). From the 2021 boundary forward these product
  // families are hockey programs unless the URL already declared another
  // sport above. This keeps authoritative hockey rows out of sport="Other".
  const year = sourceStartYear(context);
  const modernHockeyProduct = /(?:^|[-_/])(mvp|sp-authentic|sp-hockey|the-cup|ultimate-collection|stature|credentials|o-pee-chee|opc|ice|black-diamond|ud-extended-series|upper-deck-series|ud-series|parkhurst|trilogy|skybox-metal-universe|spx|premier|clear-cut|sp-game-used)(?:[-_/]|$)/i;
  if ((year ?? 0) >= 2021 && modernHockeyProduct.test(context)) {
    return { sport: "Hockey", league: "NHL" };
  }
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

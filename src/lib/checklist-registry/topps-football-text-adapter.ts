import { buildChecklistIdentityFingerprint } from "./identity";
import type { ChecklistImportPlan, ChecklistSourceAdapter, ChecklistSourceArtifact } from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseToppsFootballChecklistText } from "./topps-football-text";

export const TOPPS_FOOTBALL_TEXT_ADAPTER_ID = "topps-football-text-checklist" as const;
export const TOPPS_FOOTBALL_TEXT_ADAPTER_VERSION = "1.0.0" as const;

function slug(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function normalizedSetName(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function inferSetType(name: string) {
  const normalized = normalizedSetName(name);
  if (normalized === "base" || normalized === "base set") return "base" as const;
  if (/autograph|signature/.test(normalized)) return "autograph" as const;
  if (/relic|memorabilia|patch|swatch/.test(normalized)) return "memorabilia" as const;
  return "insert" as const;
}
function inferBrand(product: string) {
  return /bowman/i.test(product) ? "Bowman" : "Topps";
}
function sourceTitle(artifact: ChecklistSourceArtifact) {
  const title = artifact.originalFilename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return /checklist$/i.test(title) ? title : `${title} Checklist`;
}
function inferLeague(product: string) {
  return /university|college|bowman u|chrome u/i.test(product) ? "NCAA" : "NFL";
}

export function parseToppsFootballTextChecklist(artifact: ChecklistSourceArtifact): ChecklistImportPlan {
  const parsed = parseToppsFootballChecklistText({
    title: sourceTitle(artifact),
    text: typeof artifact.content === "string" ? artifact.content : Buffer.from(artifact.content).toString("utf8"),
  });
  const league = inferLeague(parsed.product);
  const releaseSlug = slug(`${parsed.releaseYear}-${parsed.product}-football`);
  const archiveContent = artifact.archiveContent ?? artifact.content;
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "Topps",
    releaseSlug,
    originalFilename: artifact.archiveFilename ?? artifact.originalFilename,
    mimeType: artifact.archiveMimeType ?? artifact.mimeType,
    content: archiveContent,
  });

  const setNames = [...new Set(parsed.cards.map((card) => card.setName))];
  const sets = setNames.map((name, index) => ({
    sourceKey: `set-${index + 1}-${slug(name)}`,
    name,
    normalizedName: normalizedSetName(name),
    setType: inferSetType(name),
  }));
  const setByName = new Map(sets.map((set) => [set.name, set]));
  const cards = parsed.cards.map((card, index) => {
    const set = setByName.get(card.setName);
    if (!set) throw new Error(`Missing normalized football set for ${card.setName}`);
    const setType = inferSetType(card.setName);
    return {
      sourceKey: `card-${index + 1}-${slug(card.setName)}-${slug(card.cardNumber)}`,
      setSourceKey: set.sourceKey,
      cardNumber: card.cardNumber,
      players: [card.player],
      teams: card.team ? [card.team] : [],
      rookieDesignation: card.rookie,
      firstBowmanDesignation: null,
      autographStatus: setType === "autograph" ? "autograph" : "non-auto",
      memorabiliaStatus: setType === "memorabilia" ? "memorabilia" : "non-memorabilia",
      variation: null,
      sourceNotes: `Topps football source line ${card.sourceLine}`,
    };
  });
  const identities = cards.map((card) => {
    const set = sets.find((entry) => entry.sourceKey === card.setSourceKey);
    if (!set) throw new Error(`Missing football set for card ${card.sourceKey}`);
    return {
      cardSourceKey: card.sourceKey,
      parallelSourceKey: null,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear: parsed.releaseYear,
        season: parsed.releaseYear,
        manufacturer: "Topps",
        brand: inferBrand(parsed.product),
        product: parsed.product,
        sport: "Football",
        league,
        setName: set.name,
        cardNumber: card.cardNumber,
        players: card.players,
        teams: card.teams,
        parallel: null,
        variation: card.variation,
        serialRun: null,
        autographStatus: card.autographStatus,
        memorabiliaStatus: card.memorabiliaStatus,
        configurationExclusivity: null,
      }),
    };
  });
  const issues = parsed.issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    rowReference: issue.sourceLine ? `line ${issue.sourceLine}` : null,
  }));
  if (artifact.authority === "official_manufacturer" && !/^https:\/\/(?:www\.)?(?:topps\.com|cdn\.shopify\.com)\//i.test(artifact.sourceUrl)) {
    issues.push({ code: "official_source_domain_mismatch", severity: "error" as const, message: "Official Topps football checklist artifacts must originate from topps.com or its official Shopify CDN", rowReference: null });
  }
  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: TOPPS_FOOTBALL_TEXT_ADAPTER_ID,
    adapterVersion: TOPPS_FOOTBALL_TEXT_ADAPTER_VERSION,
    source: {
      sourceUrl: artifact.sourceUrl,
      retrievedAt: artifact.retrievedAt,
      authority: artifact.authority,
      redistributionAllowed: artifact.redistributionAllowed,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
    },
    release: {
      manufacturer: "Topps",
      brand: inferBrand(parsed.product),
      product: parsed.product,
      releaseYear: parsed.releaseYear,
      season: parsed.releaseYear,
      sport: "Football",
      league,
      releaseSlug,
    },
    sets,
    cards,
    parallels: [],
    identities,
    validation: {
      status: hasErrors ? "validation_required" : "passed",
      issues,
      counts: { sets: sets.length, cards: cards.length, parallels: 0, identities: identities.length },
    },
  };
}

export const toppsFootballTextChecklistAdapter: ChecklistSourceAdapter = {
  id: TOPPS_FOOTBALL_TEXT_ADAPTER_ID,
  version: TOPPS_FOOTBALL_TEXT_ADAPTER_VERSION,
  supports(artifact) {
    if (artifact.mimeType.toLowerCase() !== "text/plain") return false;
    if (!/^https:\/\/(?:www\.)?(?:topps\.com|cdn\.shopify\.com)\//i.test(artifact.sourceUrl)) return false;
    const title = sourceTitle(artifact);
    return /football|nfl|bowman u|chrome u|university/i.test(title) && !/baseball|mlb|hockey|basketball|soccer/i.test(title);
  },
  parse: parseToppsFootballTextChecklist,
};

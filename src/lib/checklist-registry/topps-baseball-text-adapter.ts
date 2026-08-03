import { buildChecklistIdentityFingerprint } from "./identity";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import { parseToppsBaseballChecklistText } from "./topps-baseball-text";

export const TOPPS_BASEBALL_TEXT_ADAPTER_ID =
  "topps-baseball-text-checklist" as const;
export const TOPPS_BASEBALL_TEXT_ADAPTER_VERSION = "1.0.0" as const;

function slug(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizedSetName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  const title = artifact.originalFilename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /checklist$/i.test(title) ? title : `${title} Checklist`;
}

export function parseToppsBaseballTextChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const parsed = parseToppsBaseballChecklistText({
    title: sourceTitle(artifact),
    text:
      typeof artifact.content === "string"
        ? artifact.content
        : Buffer.from(artifact.content).toString("utf8"),
  });

  const releaseSlug = slug(`${parsed.releaseYear}-${parsed.product}-baseball`);
  const archiveContent = artifact.archiveContent ?? artifact.content;
  const archiveFilename = artifact.archiveFilename ?? artifact.originalFilename;
  const archiveMimeType = artifact.archiveMimeType ?? artifact.mimeType;
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "Topps",
    releaseSlug,
    originalFilename: archiveFilename,
    mimeType: archiveMimeType,
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
    if (!set) throw new Error(`Missing normalized set for ${card.setName}`);
    const setType = inferSetType(card.setName);
    return {
      sourceKey: `card-${index + 1}-${slug(card.setName)}-${slug(card.cardNumber)}`,
      setSourceKey: set.sourceKey,
      cardNumber: card.cardNumber,
      players: [card.player],
      teams: card.team ? [card.team] : [],
      rookieDesignation: card.rookie,
      firstBowmanDesignation: /bowman/i.test(parsed.product)
        ? /first bowman/i.test(card.setName)
        : null,
      autographStatus: setType === "autograph" ? "autograph" : "non-auto",
      memorabiliaStatus:
        setType === "memorabilia" ? "memorabilia" : "non-memorabilia",
      variation: null,
      sourceNotes: `Topps source line ${card.sourceLine}`,
    };
  });

  const identities = cards.map((card) => {
    const set = sets.find((entry) => entry.sourceKey === card.setSourceKey);
    if (!set) throw new Error(`Missing set for card ${card.sourceKey}`);
    return {
      cardSourceKey: card.sourceKey,
      parallelSourceKey: null,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear: parsed.releaseYear,
        season: null,
        manufacturer: "Topps",
        brand: inferBrand(parsed.product),
        product: parsed.product,
        sport: "Baseball",
        league: "MLB",
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

  if (
    artifact.authority === "official_manufacturer" &&
    !/^https:\/\/(?:www\.)?(?:topps\.com|cdn\.shopify\.com)\//i.test(
      artifact.sourceUrl,
    )
  ) {
    issues.push({
      code: "official_source_domain_mismatch",
      severity: "error",
      message: "Official Topps checklist artifacts must originate from topps.com or its official Shopify CDN",
      rowReference: null,
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: TOPPS_BASEBALL_TEXT_ADAPTER_ID,
    adapterVersion: TOPPS_BASEBALL_TEXT_ADAPTER_VERSION,
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
      season: null,
      sport: "Baseball",
      league: "MLB",
      releaseSlug,
    },
    sets,
    cards,
    parallels: [],
    identities,
    validation: {
      status: hasErrors ? "validation_required" : "passed",
      issues,
      counts: {
        sets: sets.length,
        cards: cards.length,
        parallels: 0,
        identities: identities.length,
      },
    },
  };
}

export const toppsBaseballTextChecklistAdapter: ChecklistSourceAdapter = {
  id: TOPPS_BASEBALL_TEXT_ADAPTER_ID,
  version: TOPPS_BASEBALL_TEXT_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/plain" &&
      /^https:\/\/(?:www\.)?(?:topps\.com|cdn\.shopify\.com)\//i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parseToppsBaseballTextChecklist,
};

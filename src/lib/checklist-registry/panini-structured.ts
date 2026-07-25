import {
  buildChecklistIdentityFingerprint,
  type ChecklistIdentityInput,
} from "./identity";
import {
  type ChecklistImportCard,
  type ChecklistImportParallel,
  type ChecklistImportPlan,
  type ChecklistImportSet,
  type ChecklistImportValidationIssue,
  type ChecklistSourceAdapter,
  type ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";

export const PANINI_STRUCTURED_CHECKLIST_SCHEMA =
  "tcos.panini.structuredChecklist.v1" as const;
export const PANINI_STRUCTURED_ADAPTER_ID =
  "panini-structured-checklist" as const;
export const PANINI_STRUCTURED_ADAPTER_VERSION = "1.0.0" as const;

export type PaniniStructuredParallel = {
  name: string;
  serialRun?: number | null;
  configurationExclusivity?: string | null;
};

export type PaniniStructuredCard = {
  cardNumber: string;
  players: string[];
  teams?: string[];
  rookieDesignation?: boolean | null;
  firstBowmanDesignation?: boolean | null;
  variation?: string | null;
  notes?: string | null;
  excludedParallelNames?: string[];
};

export type PaniniStructuredCardset = {
  name: string;
  setType?: ChecklistImportSet["setType"];
  autographStatus?: string;
  memorabiliaStatus?: string;
  cards: PaniniStructuredCard[];
  parallels?: PaniniStructuredParallel[];
};

export type PaniniStructuredChecklistSnapshot = {
  schema: typeof PANINI_STRUCTURED_CHECKLIST_SCHEMA;
  scope: "test_batch" | "full_checklist";
  release: {
    manufacturer: "Panini";
    brand?: string | null;
    product: string;
    releaseYear?: string | null;
    season?: string | null;
    sport: string;
    league?: string | null;
    releaseSlug: string;
  };
  cardsets: PaniniStructuredCardset[];
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function requireText(value: string | null | undefined, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function inferSetType(cardset: PaniniStructuredCardset): ChecklistImportSet["setType"] {
  if (cardset.setType) return cardset.setType;
  const name = comparable(cardset.name);
  if (name.includes("signature") || name.includes("autograph")) return "autograph";
  if (name.includes("swatch") || name.includes("memorabilia")) return "memorabilia";
  if (name.startsWith("base-set") || name.startsWith("base-")) return "base";
  return "insert";
}

function defaultAutographStatus(cardset: PaniniStructuredCardset) {
  if (cardset.autographStatus) return cardset.autographStatus;
  return inferSetType(cardset) === "autograph" ? "autograph" : "non-auto";
}

function defaultMemorabiliaStatus(cardset: PaniniStructuredCardset) {
  if (cardset.memorabiliaStatus) return cardset.memorabiliaStatus;
  return inferSetType(cardset) === "memorabilia"
    ? "memorabilia"
    : "non-memorabilia";
}

function parseSnapshot(content: string | Uint8Array): PaniniStructuredChecklistSnapshot {
  const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Panini structured checklist is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Panini structured checklist must be an object");
  }
  const snapshot = parsed as Partial<PaniniStructuredChecklistSnapshot>;
  if (snapshot.schema !== PANINI_STRUCTURED_CHECKLIST_SCHEMA) {
    throw new Error(`Unsupported Panini checklist schema: ${String(snapshot.schema)}`);
  }
  if (!snapshot.release || !Array.isArray(snapshot.cardsets)) {
    throw new Error("Panini structured checklist is missing release or cardsets");
  }
  return snapshot as PaniniStructuredChecklistSnapshot;
}

function issue(
  issues: ChecklistImportValidationIssue[],
  code: string,
  severity: "warning" | "error",
  message: string,
  rowReference?: string,
) {
  issues.push({ code, severity, message, rowReference: rowReference || null });
}

function buildBaseIdentity(
  snapshot: PaniniStructuredChecklistSnapshot,
  cardset: PaniniStructuredCardset,
  card: PaniniStructuredCard,
  parallel?: PaniniStructuredParallel,
): ChecklistIdentityInput {
  const autographStatus = defaultAutographStatus(cardset);
  const memorabiliaStatus = defaultMemorabiliaStatus(cardset);
  return {
    releaseYear: snapshot.release.releaseYear,
    season: snapshot.release.season,
    manufacturer: snapshot.release.manufacturer,
    brand: snapshot.release.brand,
    product: snapshot.release.product,
    sport: snapshot.release.sport,
    league: snapshot.release.league,
    setName: cardset.name,
    cardNumber: card.cardNumber,
    players: card.players,
    teams: card.teams,
    parallel: parallel?.name || null,
    variation: card.variation,
    serialRun: parallel?.serialRun,
    autographStatus,
    memorabiliaStatus,
    configurationExclusivity: parallel?.configurationExclusivity,
  };
}

export function parsePaniniStructuredChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const snapshot = parseSnapshot(artifact.content);
  const issues: ChecklistImportValidationIssue[] = [];

  const release = {
    manufacturer: requireText(snapshot.release.manufacturer, "release.manufacturer"),
    brand: clean(snapshot.release.brand) || null,
    product: requireText(snapshot.release.product, "release.product"),
    releaseYear: clean(snapshot.release.releaseYear) || null,
    season: clean(snapshot.release.season) || null,
    sport: requireText(snapshot.release.sport, "release.sport"),
    league: clean(snapshot.release.league) || null,
    releaseSlug: comparable(
      requireText(snapshot.release.releaseSlug, "release.releaseSlug"),
    ),
  };

  if (!release.releaseYear && !release.season) {
    issue(issues, "release_period_missing", "error", "Release year or season is required");
  }
  if (
    artifact.authority === "official_manufacturer" &&
    !/^https:\/\/(www\.)?paniniamerica\.net\//i.test(artifact.sourceUrl)
  ) {
    issue(
      issues,
      "official_source_domain_mismatch",
      "error",
      "Official Panini artifacts must originate from paniniamerica.net",
    );
  }
  if (artifact.redistributionAllowed) {
    issue(
      issues,
      "unexpected_redistribution_permission",
      "warning",
      "Manufacturer source files should remain private unless redistribution permission is documented",
    );
  }

  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: release.manufacturer,
    releaseSlug: release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  const sets: ChecklistImportSet[] = [];
  const cards: ChecklistImportCard[] = [];
  const parallels: ChecklistImportParallel[] = [];
  const identities: ChecklistImportPlan["identities"] = [];
  const setKeys = new Set<string>();
  const cardKeys = new Set<string>();
  const parallelKeys = new Set<string>();
  const fingerprints = new Set<string>();

  for (const [setIndex, rawCardset] of snapshot.cardsets.entries()) {
    const setName = clean(rawCardset.name);
    const setSourceKey = comparable(setName);
    const rowReference = `cardsets[${setIndex}]`;
    if (!setName || !setSourceKey) {
      issue(issues, "set_name_missing", "error", "Cardset name is required", rowReference);
      continue;
    }
    if (setKeys.has(setSourceKey)) {
      issue(issues, "duplicate_set", "error", `Duplicate cardset ${setName}`, rowReference);
      continue;
    }
    setKeys.add(setSourceKey);
    sets.push({
      sourceKey: setSourceKey,
      name: setName,
      normalizedName: comparable(setName),
      setType: inferSetType(rawCardset),
    });

    const cardsetParallels = rawCardset.parallels || [];
    for (const [parallelIndex, rawParallel] of cardsetParallels.entries()) {
      const parallelName = clean(rawParallel.name);
      const parallelSourceKey = `${setSourceKey}:${comparable(parallelName)}:${
        rawParallel.serialRun || 0
      }:${comparable(rawParallel.configurationExclusivity)}`;
      if (!parallelName) {
        issue(
          issues,
          "parallel_name_missing",
          "error",
          "Parallel name is required",
          `${rowReference}.parallels[${parallelIndex}]`,
        );
        continue;
      }
      if (
        rawParallel.serialRun != null &&
        (!Number.isInteger(rawParallel.serialRun) || rawParallel.serialRun <= 0)
      ) {
        issue(
          issues,
          "parallel_serial_invalid",
          "error",
          `${parallelName} has invalid serial run ${rawParallel.serialRun}`,
          `${rowReference}.parallels[${parallelIndex}]`,
        );
      }
      if (parallelKeys.has(parallelSourceKey)) {
        issue(
          issues,
          "duplicate_parallel",
          "error",
          `Duplicate parallel ${parallelName} in ${setName}`,
          `${rowReference}.parallels[${parallelIndex}]`,
        );
        continue;
      }
      parallelKeys.add(parallelSourceKey);
      parallels.push({
        sourceKey: parallelSourceKey,
        setSourceKey,
        name: parallelName,
        serialRun: rawParallel.serialRun || null,
        configurationExclusivity:
          clean(rawParallel.configurationExclusivity) || null,
      });
    }

    for (const [cardIndex, rawCard] of rawCardset.cards.entries()) {
      const cardNumber = clean(rawCard.cardNumber).replace(/^#\s*/, "");
      const players = (rawCard.players || []).map(clean).filter(Boolean);
      const teams = (rawCard.teams || []).map(clean).filter(Boolean);
      const cardSourceKey = `${setSourceKey}:${comparable(cardNumber)}:${players
        .map(comparable)
        .sort()
        .join("+")}`;
      const cardReference = `${rowReference}.cards[${cardIndex}]`;

      if (!cardNumber || !players.length) {
        issue(
          issues,
          "card_identity_incomplete",
          "error",
          `Card in ${setName} requires card number and at least one player`,
          cardReference,
        );
        continue;
      }
      if (cardKeys.has(cardSourceKey)) {
        issue(
          issues,
          "duplicate_card",
          "error",
          `Duplicate card ${setName} #${cardNumber} ${players.join(" / ")}`,
          cardReference,
        );
        continue;
      }
      cardKeys.add(cardSourceKey);
      cards.push({
        sourceKey: cardSourceKey,
        setSourceKey,
        cardNumber,
        players,
        teams,
        rookieDesignation: rawCard.rookieDesignation ?? null,
        firstBowmanDesignation: rawCard.firstBowmanDesignation ?? null,
        autographStatus: defaultAutographStatus(rawCardset),
        memorabiliaStatus: defaultMemorabiliaStatus(rawCardset),
        variation: clean(rawCard.variation) || null,
        sourceNotes: clean(rawCard.notes) || null,
      });

      const baseFingerprint = buildChecklistIdentityFingerprint(
        buildBaseIdentity(snapshot, rawCardset, rawCard),
      );
      if (fingerprints.has(baseFingerprint.fingerprintSha256)) {
        issue(
          issues,
          "duplicate_identity",
          "error",
          `Duplicate base identity for ${setName} #${cardNumber}`,
          cardReference,
        );
      } else {
        fingerprints.add(baseFingerprint.fingerprintSha256);
        identities.push({
          cardSourceKey,
          parallelSourceKey: null,
          fingerprint: baseFingerprint,
        });
      }

      const excluded = new Set(
        (rawCard.excludedParallelNames || []).map(comparable),
      );
      for (const rawParallel of cardsetParallels) {
        if (excluded.has(comparable(rawParallel.name))) continue;
        const parallelSourceKey = `${setSourceKey}:${comparable(
          rawParallel.name,
        )}:${rawParallel.serialRun || 0}:${comparable(
          rawParallel.configurationExclusivity,
        )}`;
        if (!parallelKeys.has(parallelSourceKey)) continue;
        const fingerprint = buildChecklistIdentityFingerprint(
          buildBaseIdentity(snapshot, rawCardset, rawCard, rawParallel),
        );
        if (fingerprints.has(fingerprint.fingerprintSha256)) {
          issue(
            issues,
            "duplicate_identity",
            "error",
            `Duplicate identity for ${setName} #${cardNumber} ${rawParallel.name}`,
            cardReference,
          );
          continue;
        }
        fingerprints.add(fingerprint.fingerprintSha256);
        identities.push({ cardSourceKey, parallelSourceKey, fingerprint });
      }
    }
  }

  if (!sets.length) issue(issues, "no_sets", "error", "No cardsets were imported");
  if (!cards.length) issue(issues, "no_cards", "error", "No cards were imported");
  if (snapshot.scope === "test_batch") {
    issue(
      issues,
      "test_batch_only",
      "warning",
      "This source snapshot proves the adapter workflow but is not a complete checklist",
    );
  }

  const hasErrors = issues.some((entry) => entry.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: PANINI_STRUCTURED_ADAPTER_ID,
    adapterVersion: PANINI_STRUCTURED_ADAPTER_VERSION,
    source: {
      sourceUrl: artifact.sourceUrl,
      retrievedAt: artifact.retrievedAt,
      authority: artifact.authority,
      redistributionAllowed: artifact.redistributionAllowed,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
    },
    release,
    sets,
    cards,
    parallels,
    identities,
    validation: {
      status: hasErrors ? "validation_required" : "passed",
      issues,
      counts: {
        sets: sets.length,
        cards: cards.length,
        parallels: parallels.length,
        identities: identities.length,
      },
    },
  };
}

export const paniniStructuredChecklistAdapter: ChecklistSourceAdapter = {
  id: PANINI_STRUCTURED_ADAPTER_ID,
  version: PANINI_STRUCTURED_ADAPTER_VERSION,
  supports(artifact) {
    return artifact.mimeType.toLowerCase() === "application/json";
  },
  parse: parsePaniniStructuredChecklist,
};

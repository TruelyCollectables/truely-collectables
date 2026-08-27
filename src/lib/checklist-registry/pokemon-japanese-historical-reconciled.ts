import { createHash } from "node:crypto";

import {
  buildChecklistIdentityFingerprint,
  type ChecklistIdentityFingerprint,
  type ChecklistIdentityInput,
} from "./identity";
import {
  POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA,
  parsePokemonJapaneseIncompleteReconciledBundle,
  type PokemonJapaneseIncompleteCardEvidence,
  type PokemonJapaneseIncompleteReconciledBundle,
} from "./pokemon-japanese-incomplete-reconciled";
import type {
  ChecklistImportPlan,
  ChecklistImportValidationIssue,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import type { TcgdexJapaneseVariantEvidence } from "./tcgdex-japanese";

export const POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA =
  "tcos.pokemonJapaneseHistoricalReconciledSetBundle.v1" as const;
export const POKEMON_JAPANESE_HISTORICAL_RECONCILED_ADAPTER_ID =
  "pokemon-japanese-official-historical-reconciled" as const;
export const POKEMON_JAPANESE_HISTORICAL_RECONCILED_ADAPTER_VERSION =
  "1.0.0" as const;

export type PokemonJapaneseHistoricalEvidenceOrigin =
  | "source_number_crosswalk"
  | "source_energy_alias"
  | "official_numbered_addition"
  | "official_unnumbered_energy_addition";

type ReconciledCard = {
  id: string;
  localId: string;
  name: string;
  category?: string | null;
  rarity?: string | null;
  illustrator?: string | null;
  regulationMark?: string | null;
  dexId?: number[];
  variants?: TcgdexJapaneseVariantEvidence[];
  sourcePath?: string | null;
};

export type PokemonJapaneseHistoricalCardEvidence = {
  bundleCardId: string;
  cardID: string;
  name: string;
  setCode: string;
  numerator: string | null;
  denominator: string | null;
  detailUrl: string;
  origin: PokemonJapaneseHistoricalEvidenceOrigin;
  sourcePath: string | null;
  sourceLocalId: string | null;
  variation: string | null;
};

export type PokemonJapaneseHistoricalReconciledBundle = {
  schema: typeof POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA;
  phase: "official_historical_backfill";
  language: "ja";
  generatedAt: string;
  baseSource: {
    repository: "https://github.com/tcgdex/cards-database";
    commit: string;
    setSourcePath: string;
    sourceCardCount: number;
  };
  official: {
    resolutionGeneratedAt: string;
    resolutionSchema: string;
    product: {
      value: string;
      label: string;
      url: string;
    };
    officialCardCount: number;
    sourceNumberCrosswalkCount: number;
    sourceEnergyAliasCount: number;
    numberedAddedCardCount: number;
    unnumberedAddedCardCount: number;
    cards: PokemonJapaneseHistoricalCardEvidence[];
  };
  series: {
    id: string;
    name: string;
  };
  set: {
    id: string;
    name: string;
    officialCardCount: number;
    releaseDate: string;
    sourcePath: string;
  };
  cards: ReconciledCard[];
};

const ENERGY_NAME_BY_SOURCE_ID: Record<string, string> = {
  GRA: "基本草エネルギー",
  FIR: "基本炎エネルギー",
  WAT: "基本水エネルギー",
  LIG: "基本雷エネルギー",
  PSY: "基本超エネルギー",
  FIG: "基本闘エネルギー",
  DAR: "基本悪エネルギー",
  MET: "基本鋼エネルギー",
};

const HELD_VARIANT_SETS = new Set(["s10a", "s11a"]);

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedLocalId(value: unknown) {
  const text = clean(value).toUpperCase().replace(/\s+/g, "");
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

function sourceToken(value: string) {
  return encodeURIComponent(clean(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseJson(content: string | Uint8Array): unknown {
  const text =
    typeof content === "string"
      ? content
      : Buffer.from(content).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Historical Japanese reconciliation bundle is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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

function officialSourceUrl(value: unknown) {
  return /^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(
    clean(value),
  );
}

function officialVariation(cardID: string) {
  return `Official Card ${clean(cardID)}`;
}

function buildJapaneseFingerprint(
  input: ChecklistIdentityInput,
): ChecklistIdentityFingerprint {
  const base = buildChecklistIdentityFingerprint(input);
  const canonicalKey = `${base.canonicalKey}|language_code=ja`;
  return {
    ...base,
    normalized: {
      ...base.normalized,
      languageCode: "ja",
    } as typeof base.normalized,
    canonicalKey,
    fingerprintSha256: sha256(canonicalKey),
  };
}

function rebuildJapaneseFingerprint(
  fingerprint: ChecklistIdentityFingerprint,
  variation: string,
) {
  const normalized = fingerprint.normalized;
  return buildJapaneseFingerprint({
    releaseYear: normalized.releaseYear || null,
    season: normalized.season || null,
    manufacturer: normalized.manufacturer,
    brand: normalized.brand || null,
    product: normalized.product,
    sport: normalized.sport || null,
    league: normalized.league || null,
    setName: normalized.setName,
    subset: normalized.subset || null,
    cardNumber: normalized.cardNumber,
    players: normalized.players,
    teams: normalized.teams,
    parallel: normalized.parallel,
    variation,
    serialRun: normalized.serialRun || null,
    autographStatus: normalized.autographStatus,
    memorabiliaStatus: normalized.memorabiliaStatus,
    configurationExclusivity:
      normalized.configurationExclusivity || null,
  });
}

function extractBundle(
  parsed: unknown,
): PokemonJapaneseHistoricalReconciledBundle {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Historical Japanese reconciliation imports require a bundle object.",
    );
  }
  const candidate =
    parsed as Partial<PokemonJapaneseHistoricalReconciledBundle>;
  if (candidate.schema !== POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported historical Japanese reconciliation schema: ${String(candidate.schema)}.`,
    );
  }
  if (
    !candidate.baseSource ||
    !candidate.official ||
    !candidate.series ||
    !candidate.set ||
    !Array.isArray(candidate.cards) ||
    !Array.isArray(candidate.official.cards)
  ) {
    throw new Error(
      "Historical Japanese reconciliation bundle is missing base, official, series, set, or card evidence.",
    );
  }
  return candidate as PokemonJapaneseHistoricalReconciledBundle;
}

function sourceNotesObject(sourceNotes: string | null) {
  try {
    const parsed = JSON.parse(sourceNotes || "{}") as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function bundleCardIdFromNotes(sourceNotes: string | null) {
  const notes = sourceNotesObject(sourceNotes);
  return clean(notes.officialBundleCardId || notes.sourceCardId);
}

function evidenceSha256(evidence: PokemonJapaneseHistoricalCardEvidence) {
  return sha256(
    [
      evidence.cardID,
      evidence.name,
      evidence.setCode,
      evidence.numerator || "",
      evidence.denominator || "",
      evidence.detailUrl,
      evidence.origin,
      evidence.sourcePath || "",
      evidence.sourceLocalId || "",
      evidence.variation || "",
    ].join("|"),
  );
}

function toIncompleteBundle(
  bundle: PokemonJapaneseHistoricalReconciledBundle,
): PokemonJapaneseIncompleteReconciledBundle {
  const sourceCardCount = bundle.baseSource.sourceCardCount;
  const addedCardCount =
    bundle.official.numberedAddedCardCount +
    bundle.official.unnumberedAddedCardCount;
  const evidence: PokemonJapaneseIncompleteCardEvidence[] =
    bundle.official.cards.map((row) => {
      const sourceBacked =
        row.origin === "source_number_crosswalk" ||
        row.origin === "source_energy_alias";
      return {
        bundleCardId: row.bundleCardId,
        cardID: row.cardID,
        name: row.name,
        setCode: row.setCode,
        numerator:
          row.numerator ||
          (sourceBacked ? clean(row.sourceLocalId) : "UNNUMBERED"),
        denominator: row.denominator,
        detailUrl: row.detailUrl,
        origin: sourceBacked
          ? "source_name_backfill"
          : "official_only_addition",
        sourcePath: sourceBacked ? row.sourcePath : null,
      };
    });
  return {
    schema: POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA,
    phase: "official_incomplete_backfill",
    language: "ja",
    generatedAt: bundle.generatedAt,
    baseSource: {
      repository: bundle.baseSource.repository,
      commit: bundle.baseSource.commit,
      setSourcePath: bundle.baseSource.setSourcePath,
      sourceCardCount,
    },
    official: {
      inventoryGeneratedAt: bundle.official.resolutionGeneratedAt,
      product: bundle.official.product,
      comparableCardCount: bundle.official.officialCardCount,
      sourceCardCount,
      preservedNamedCardCount: 0,
      nameBackfilledCardCount: sourceCardCount,
      addedCardCount,
      cards: evidence,
    },
    series: bundle.series,
    set: bundle.set,
    cards: bundle.cards,
  };
}

function validateBundle(
  bundle: PokemonJapaneseHistoricalReconciledBundle,
  artifact: ChecklistSourceArtifact,
  issues: ChecklistImportValidationIssue[],
) {
  const setId = clean(bundle.set.id);
  const setKey = setId.toLowerCase();
  const cardsById = new Map(bundle.cards.map((card) => [clean(card.id), card]));
  const evidence = bundle.official.cards;

  if (bundle.phase !== "official_historical_backfill") {
    issue(
      issues,
      "phase_invalid",
      "error",
      "Historical Japanese bundles must use official_historical_backfill.",
    );
  }
  if (bundle.language !== "ja") {
    issue(
      issues,
      "language_invalid",
      "error",
      "Historical Japanese bundles must use language ja.",
    );
  }
  if (HELD_VARIANT_SETS.has(setKey)) {
    issue(
      issues,
      "variant_review_set_blocked",
      "error",
      `${setId} is held for duplicate printed-number physical-variant evidence.`,
    );
  }
  if (artifact.authority !== "official_manufacturer") {
    issue(
      issues,
      "official_authority_required",
      "error",
      "Historical Japanese imports require official_manufacturer authority.",
    );
  }
  if (
    !officialSourceUrl(artifact.sourceUrl) ||
    clean(bundle.official.product.url) !== clean(artifact.sourceUrl)
  ) {
    issue(
      issues,
      "official_source_url_mismatch",
      "error",
      "The archived source must match the official Pokémon product URL.",
    );
  }
  if (artifact.redistributionAllowed) {
    issue(
      issues,
      "redistribution_review_required",
      "warning",
      "Keep historical Japanese reconciliation bundles private and do not redistribute official images.",
    );
  }

  const counts = {
    sourceNumber: evidence.filter(
      (row) => row.origin === "source_number_crosswalk",
    ).length,
    sourceEnergy: evidence.filter(
      (row) => row.origin === "source_energy_alias",
    ).length,
    numberedAdded: evidence.filter(
      (row) => row.origin === "official_numbered_addition",
    ).length,
    unnumberedAdded: evidence.filter(
      (row) => row.origin === "official_unnumbered_energy_addition",
    ).length,
  };
  const sourceCount = counts.sourceNumber + counts.sourceEnergy;
  const additionCount = counts.numberedAdded + counts.unnumberedAdded;
  if (
    sourceCount !== bundle.baseSource.sourceCardCount ||
    sourceCount + additionCount !== bundle.official.officialCardCount ||
    counts.sourceNumber !== bundle.official.sourceNumberCrosswalkCount ||
    counts.sourceEnergy !== bundle.official.sourceEnergyAliasCount ||
    counts.numberedAdded !== bundle.official.numberedAddedCardCount ||
    counts.unnumberedAdded !== bundle.official.unnumberedAddedCardCount ||
    bundle.cards.length !== bundle.official.officialCardCount ||
    evidence.length !== bundle.official.officialCardCount ||
    bundle.set.officialCardCount !== bundle.official.officialCardCount
  ) {
    issue(
      issues,
      "historical_population_invalid",
      "error",
      "Historical source, alias, addition, card, and official evidence counts do not reconcile.",
    );
  }

  const bundleCardIds = new Set<string>();
  const officialCardIds = new Set<string>();
  const sourceLocalIds = new Set<string>();
  for (const [index, row] of evidence.entries()) {
    const reference = `official.cards[${index}]`;
    const bundleCardId = clean(row.bundleCardId);
    const officialCardId = clean(row.cardID);
    const card = cardsById.get(bundleCardId);
    if (!bundleCardId || !officialCardId || !card) {
      issue(
        issues,
        "official_card_evidence_incomplete",
        "error",
        "Every historical evidence row must reference a reconciled card and official card ID.",
        reference,
      );
      continue;
    }
    if (bundleCardIds.has(bundleCardId) || officialCardIds.has(officialCardId)) {
      issue(
        issues,
        "official_card_evidence_duplicate",
        "error",
        "Historical bundle-card IDs and official card IDs must be unique.",
        reference,
      );
    }
    bundleCardIds.add(bundleCardId);
    officialCardIds.add(officialCardId);
    if (
      clean(row.setCode).toLowerCase() !== setKey ||
      clean(row.name) !== clean(card.name) ||
      !officialSourceUrl(row.detailUrl)
    ) {
      issue(
        issues,
        "official_card_identity_mismatch",
        "error",
        `Official card ${officialCardId} does not match its set, Japanese name, or detail URL.`,
        reference,
      );
    }

    const sourceBacked =
      row.origin === "source_number_crosswalk" ||
      row.origin === "source_energy_alias";
    if (sourceBacked) {
      const sourceLocalId = clean(row.sourceLocalId);
      if (
        !sourceLocalId ||
        sourceLocalIds.has(normalizedLocalId(sourceLocalId)) ||
        clean(card.localId) !== sourceLocalId ||
        !clean(row.sourcePath) ||
        clean(card.sourcePath) !== clean(row.sourcePath) ||
        clean(row.variation)
      ) {
        issue(
          issues,
          "source_crosswalk_invalid",
          "error",
          `Source-backed official card ${officialCardId} does not retain a unique TCGdex local ID and source path.`,
          reference,
        );
      }
      sourceLocalIds.add(normalizedLocalId(sourceLocalId));
      if (row.origin === "source_number_crosswalk") {
        if (
          !clean(row.numerator) ||
          normalizedLocalId(row.numerator) !== normalizedLocalId(sourceLocalId)
        ) {
          issue(
            issues,
            "source_number_crosswalk_invalid",
            "error",
            `Official card ${officialCardId} does not match source printed number ${sourceLocalId}.`,
            reference,
          );
        }
      } else {
        const expectedName = ENERGY_NAME_BY_SOURCE_ID[
          normalizedLocalId(sourceLocalId)
        ];
        if (
          row.numerator !== null ||
          !expectedName ||
          clean(row.name) !== expectedName
        ) {
          issue(
            issues,
            "source_energy_alias_invalid",
            "error",
            `Official card ${officialCardId} is not the exact unnumbered basic-energy alias for ${sourceLocalId}.`,
            reference,
          );
        }
      }
      continue;
    }

    if (
      clean(row.sourcePath) ||
      clean(row.sourceLocalId) ||
      (Array.isArray(card.variants) && card.variants.length)
    ) {
      issue(
        issues,
        "official_addition_source_invalid",
        "error",
        `Official-only card ${officialCardId} cannot claim TCGdex source or variant evidence.`,
        reference,
      );
    }
    if (row.origin === "official_numbered_addition") {
      if (
        !clean(row.numerator) ||
        clean(card.localId) !== clean(row.numerator) ||
        clean(row.variation)
      ) {
        issue(
          issues,
          "official_numbered_addition_invalid",
          "error",
          `Official numbered addition ${officialCardId} does not match its printed number.`,
          reference,
        );
      }
    } else {
      const variation = officialVariation(officialCardId);
      if (
        row.numerator !== null ||
        clean(card.localId) !== "UNNUMBERED" ||
        clean(row.variation) !== variation
      ) {
        issue(
          issues,
          "official_unnumbered_addition_invalid",
          "error",
          `Official unnumbered addition ${officialCardId} must use UNNUMBERED and variation ${variation}.`,
          reference,
        );
      }
    }
  }
  if (bundleCardIds.size !== bundle.cards.length) {
    issue(
      issues,
      "official_population_not_fully_evidenced",
      "error",
      `Historical evidence covers ${bundleCardIds.size}/${bundle.cards.length} reconciled cards.`,
    );
  }
}

export function parsePokemonJapaneseHistoricalReconciledBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const compatible = toIncompleteBundle(bundle);
  const plan = parsePokemonJapaneseIncompleteReconciledBundle({
    ...artifact,
    content: JSON.stringify(compatible),
    originalFilename: `${clean(bundle.series.id)}-${clean(bundle.set.id)}.pokemon-ja-incomplete-reconciled.bundle.json`,
  });
  const issues = plan.validation.issues;
  validateBundle(bundle, artifact, issues);

  const evidenceByBundleCardId = new Map(
    bundle.official.cards.map((row) => [clean(row.bundleCardId), row]),
  );
  const materialized: Record<PokemonJapaneseHistoricalEvidenceOrigin, number> = {
    source_number_crosswalk: 0,
    source_energy_alias: 0,
    official_numbered_addition: 0,
    official_unnumbered_energy_addition: 0,
  };

  for (const card of plan.cards) {
    const bundleCardId = bundleCardIdFromNotes(card.sourceNotes);
    const evidence = evidenceByBundleCardId.get(bundleCardId);
    if (!evidence) continue;
    const existing = sourceNotesObject(card.sourceNotes);
    const variation =
      evidence.origin === "official_unnumbered_energy_addition"
        ? officialVariation(evidence.cardID)
        : null;
    card.sourceNotes = JSON.stringify({
      ...existing,
      source:
        evidence.origin.startsWith("source_")
          ? "pokemon-card.com+tcgdex/cards-database"
          : "pokemon-card.com",
      sourceAuthority: "official_manufacturer",
      nameSource: "pokemon-card.com",
      metadataSource: evidence.origin.startsWith("source_")
        ? "tcgdex/cards-database"
        : "pokemon-card.com",
      languageCode: "ja",
      seriesId: clean(bundle.series.id),
      seriesName: clean(bundle.series.name),
      sourceSetId: clean(bundle.set.id),
      sourceSetName: clean(bundle.set.name),
      sourceCardId: clean(evidence.cardID),
      officialCardId: clean(evidence.cardID),
      officialEvidenceSha256: evidenceSha256(evidence),
      officialBundleCardId: clean(evidence.bundleCardId),
      officialProductValue: clean(bundle.official.product.value),
      officialProductLabel: clean(bundle.official.product.label),
      officialProductUrl: clean(bundle.official.product.url),
      officialDetailUrl: clean(evidence.detailUrl),
      officialSetCode: clean(evidence.setCode),
      officialPrintedNumber: clean(evidence.numerator) || null,
      officialDenominator: clean(evidence.denominator) || null,
      officialEvidenceOrigin: evidence.origin,
      tcgdexSourcePath: clean(evidence.sourcePath) || null,
      tcgdexSourceLocalId: clean(evidence.sourceLocalId) || null,
      officialUnnumbered: evidence.numerator === null,
      officialVariation: variation,
      materializedPhysicalPrintings: evidence.origin.startsWith("official_")
        ? ["Base"]
        : Array.isArray(existing.materializedPhysicalPrintings)
          ? existing.materializedPhysicalPrintings
          : [],
      phase: "official_historical_backfill",
    });
    if (variation) {
      card.variation = variation;
      for (const identity of plan.identities) {
        if (identity.cardSourceKey === card.sourceKey) {
          identity.fingerprint = rebuildJapaneseFingerprint(
            identity.fingerprint,
            variation,
          );
        }
      }
    }
    materialized[evidence.origin] += 1;
  }

  const expected = {
    source_number_crosswalk: bundle.official.sourceNumberCrosswalkCount,
    source_energy_alias: bundle.official.sourceEnergyAliasCount,
    official_numbered_addition: bundle.official.numberedAddedCardCount,
    official_unnumbered_energy_addition:
      bundle.official.unnumberedAddedCardCount,
  };
  for (const origin of Object.keys(expected) as Array<
    keyof typeof expected
  >) {
    if (materialized[origin] !== expected[origin]) {
      issue(
        issues,
        "historical_cards_not_materialized",
        "error",
        `Materialized ${materialized[origin]} ${origin} cards; expected ${expected[origin]}.`,
      );
    }
  }
  if (!issues.some((entry) => entry.severity === "error")) {
    issue(
      issues,
      "official_historical_population_reconciled",
      "warning",
      `Reconciled ${bundle.official.officialCardCount} official Japanese cards from ${bundle.baseSource.sourceCardCount} TCGdex source cards, ${bundle.official.sourceEnergyAliasCount} exact energy aliases, ${bundle.official.numberedAddedCardCount} numbered additions, and ${bundle.official.unnumberedAddedCardCount} unnumbered additions.`,
    );
  }

  plan.adapterId = POKEMON_JAPANESE_HISTORICAL_RECONCILED_ADAPTER_ID;
  plan.adapterVersion =
    POKEMON_JAPANESE_HISTORICAL_RECONCILED_ADAPTER_VERSION;
  plan.source = {
    sourceUrl: artifact.sourceUrl,
    retrievedAt: artifact.retrievedAt,
    authority: artifact.authority,
    redistributionAllowed: artifact.redistributionAllowed,
    privateArchiveRequired: true,
    normalizedFactsInternalOnly: true,
    storage: buildChecklistSourceStorageReceipt({
      manufacturerSlug: "pokemon",
      releaseSlug: plan.release.releaseSlug,
      originalFilename: artifact.originalFilename,
      mimeType: artifact.mimeType,
      content: artifact.content,
    }),
  };
  plan.validation.status = issues.some((entry) => entry.severity === "error")
    ? "validation_required"
    : "passed";
  plan.validation.counts = {
    sets: plan.sets.length,
    cards: plan.cards.length,
    parallels: plan.parallels.length,
    identities: plan.identities.length,
  };
  return plan;
}

function supportsHistoricalBundle(artifact: ChecklistSourceArtifact) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content) as { schema?: unknown };
    return parsed?.schema === POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA;
  } catch {
    return false;
  }
}

export const pokemonJapaneseHistoricalReconciledAdapter: ChecklistSourceAdapter = {
  id: POKEMON_JAPANESE_HISTORICAL_RECONCILED_ADAPTER_ID,
  version: POKEMON_JAPANESE_HISTORICAL_RECONCILED_ADAPTER_VERSION,
  supports: supportsHistoricalBundle,
  parse: parsePokemonJapaneseHistoricalReconciledBundle,
};

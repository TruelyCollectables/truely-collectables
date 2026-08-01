import { createHash } from "node:crypto";

import {
  POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
  parsePokemonJapaneseOfficialReconciledBundle,
  type PokemonJapaneseOfficialCardEvidence,
  type PokemonJapaneseOfficialReconciledBundle,
} from "./pokemon-japanese-official-reconciled";
import type {
  ChecklistImportPlan,
  ChecklistImportValidationIssue,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import type { TcgdexJapaneseVariantEvidence } from "./tcgdex-japanese";

export const POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA =
  "tcos.pokemonJapaneseIncompleteReconciledSetBundle.v1" as const;
export const POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_ID =
  "pokemon-japanese-official-incomplete-reconciled" as const;
export const POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_VERSION =
  "1.0.0" as const;

export type PokemonJapaneseIncompleteEvidenceOrigin =
  | "source_preserved_name"
  | "source_name_backfill"
  | "official_only_addition";

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

export type PokemonJapaneseIncompleteCardEvidence =
  PokemonJapaneseOfficialCardEvidence & {
    origin: PokemonJapaneseIncompleteEvidenceOrigin;
    sourcePath: string | null;
  };

export type PokemonJapaneseIncompleteReconciledBundle = {
  schema: typeof POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA;
  phase: "official_incomplete_backfill";
  language: "ja";
  generatedAt: string;
  baseSource: {
    repository: "https://github.com/tcgdex/cards-database";
    commit: string;
    setSourcePath: string;
    sourceCardCount: number;
  };
  official: {
    inventoryGeneratedAt: string;
    product: {
      value: string;
      label: string;
      url: string;
    };
    comparableCardCount: number;
    sourceCardCount: number;
    preservedNamedCardCount: number;
    nameBackfilledCardCount: number;
    addedCardCount: number;
    cards: PokemonJapaneseIncompleteCardEvidence[];
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

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
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
      `Incomplete Japanese reconciliation bundle is not valid JSON: ${
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

function extractBundle(
  parsed: unknown,
): PokemonJapaneseIncompleteReconciledBundle {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Incomplete Japanese reconciliation imports require a bundle object.",
    );
  }
  const candidate =
    parsed as Partial<PokemonJapaneseIncompleteReconciledBundle>;
  if (candidate.schema !== POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported incomplete Japanese reconciliation schema: ${String(candidate.schema)}.`,
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
      "Incomplete Japanese reconciliation bundle is missing base, official, series, set, or card evidence.",
    );
  }
  return candidate as PokemonJapaneseIncompleteReconciledBundle;
}

function sourceCardId(sourceNotes: string | null) {
  try {
    const parsed = JSON.parse(sourceNotes || "{}") as {
      sourceCardId?: unknown;
    };
    return clean(parsed.sourceCardId);
  } catch {
    return "";
  }
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

function evidenceSha256(evidence: PokemonJapaneseIncompleteCardEvidence) {
  return sha256(
    [
      evidence.cardID,
      evidence.name,
      evidence.setCode,
      evidence.numerator,
      evidence.denominator || "",
      evidence.detailUrl,
      evidence.origin,
      evidence.sourcePath || "",
    ].join("|"),
  );
}

function officialIncompleteSourceNotes(params: {
  bundle: PokemonJapaneseIncompleteReconciledBundle;
  evidence: PokemonJapaneseIncompleteCardEvidence;
  existing: Record<string, unknown>;
}) {
  return JSON.stringify({
    ...params.existing,
    source:
      params.evidence.origin === "official_only_addition"
        ? "pokemon-card.com"
        : "pokemon-card.com+tcgdex/cards-database",
    sourceAuthority: "official_manufacturer",
    nameSource: "pokemon-card.com",
    metadataSource:
      params.evidence.origin === "official_only_addition"
        ? "pokemon-card.com"
        : "tcgdex/cards-database",
    languageCode: "ja",
    seriesId: clean(params.bundle.series.id),
    seriesName: clean(params.bundle.series.name),
    sourceSetId: clean(params.bundle.set.id),
    sourceSetName: clean(params.bundle.set.name),
    sourceCardId: clean(params.evidence.cardID),
    officialCardId: clean(params.evidence.cardID),
    officialEvidenceSha256: evidenceSha256(params.evidence),
    officialBundleCardId: clean(params.evidence.bundleCardId),
    officialProductValue: clean(params.bundle.official.product.value),
    officialProductLabel: clean(params.bundle.official.product.label),
    officialProductUrl: clean(params.bundle.official.product.url),
    officialDetailUrl: clean(params.evidence.detailUrl),
    officialSetCode: clean(params.evidence.setCode),
    localId: clean(params.evidence.numerator),
    officialDenominator: clean(params.evidence.denominator) || null,
    officialEvidenceOrigin: params.evidence.origin,
    tcgdexSourcePath: clean(params.evidence.sourcePath) || null,
    materializedPhysicalPrintings:
      params.evidence.origin === "official_only_addition"
        ? ["Base"]
        : Array.isArray(params.existing.materializedPhysicalPrintings)
          ? params.existing.materializedPhysicalPrintings
          : [],
    phase: "official_incomplete_backfill",
  });
}

function toLegacyBundle(
  bundle: PokemonJapaneseIncompleteReconciledBundle,
): PokemonJapaneseOfficialReconciledBundle {
  const additions = bundle.official.cards.filter(
    (evidence) => evidence.origin === "official_only_addition",
  );
  return {
    schema: POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
    phase: "official_gap_backfill",
    language: "ja",
    generatedAt: bundle.generatedAt,
    baseSource: {
      repository: bundle.baseSource.repository,
      commit: bundle.baseSource.commit,
      setSourcePath: bundle.baseSource.setSourcePath,
      baseCardCount: bundle.baseSource.sourceCardCount,
    },
    official: {
      auditGeneratedAt: bundle.official.inventoryGeneratedAt,
      product: bundle.official.product,
      comparableCardCount: bundle.official.comparableCardCount,
      addedCardCount: bundle.official.addedCardCount,
      cards: additions.map(({ origin: _origin, sourcePath: _path, ...row }) =>
        row,
      ),
    },
    series: bundle.series,
    set: bundle.set,
    cards: bundle.cards,
  };
}

function validateBundle(
  bundle: PokemonJapaneseIncompleteReconciledBundle,
  artifact: ChecklistSourceArtifact,
  issues: ChecklistImportValidationIssue[],
) {
  const setId = clean(bundle.set.id);
  const evidence = bundle.official.cards;
  const cardById = new Map(bundle.cards.map((card) => [clean(card.id), card]));

  if (bundle.phase !== "official_incomplete_backfill") {
    issue(
      issues,
      "phase_invalid",
      "error",
      "Incomplete Japanese reconciliation bundles must use official_incomplete_backfill.",
    );
  }
  if (bundle.language !== "ja") {
    issue(
      issues,
      "language_invalid",
      "error",
      "Incomplete Japanese reconciliation bundles must use language ja.",
    );
  }
  if (artifact.authority !== "official_manufacturer") {
    issue(
      issues,
      "official_authority_required",
      "error",
      "Incomplete Japanese reconciliation imports require official_manufacturer authority.",
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
      "Keep generated Japanese reconciliation bundles private and do not redistribute official images.",
    );
  }

  const expectedCounts = {
    source: bundle.official.sourceCardCount,
    preserved: bundle.official.preservedNamedCardCount,
    backfilled: bundle.official.nameBackfilledCardCount,
    added: bundle.official.addedCardCount,
    total: bundle.official.comparableCardCount,
  };
  const actualCounts = {
    source: evidence.filter(
      (row) => row.origin !== "official_only_addition",
    ).length,
    preserved: evidence.filter(
      (row) => row.origin === "source_preserved_name",
    ).length,
    backfilled: evidence.filter(
      (row) => row.origin === "source_name_backfill",
    ).length,
    added: evidence.filter(
      (row) => row.origin === "official_only_addition",
    ).length,
    total: evidence.length,
  };

  if (
    bundle.cards.length !== expectedCounts.total ||
    bundle.set.officialCardCount !== expectedCounts.total ||
    actualCounts.total !== expectedCounts.total
  ) {
    issue(
      issues,
      "official_population_incomplete",
      "error",
      `Reconciled ${setId || "set"} must contain and evidence ${expectedCounts.total} official cards.`,
    );
  }
  if (
    bundle.baseSource.sourceCardCount !== expectedCounts.source ||
    expectedCounts.preserved + expectedCounts.backfilled !==
      expectedCounts.source ||
    expectedCounts.source + expectedCounts.added !== expectedCounts.total
  ) {
    issue(
      issues,
      "reconciliation_count_invalid",
      "error",
      "Source, name-backfill, addition, and official population counts do not reconcile.",
    );
  }
  for (const key of Object.keys(expectedCounts) as Array<
    keyof typeof expectedCounts
  >) {
    if (expectedCounts[key] !== actualCounts[key]) {
      issue(
        issues,
        "evidence_origin_count_invalid",
        "error",
        `Official ${key} evidence count is ${actualCounts[key]}; expected ${expectedCounts[key]}.`,
      );
    }
  }

  const bundleCardIds = new Set<string>();
  const officialCardIds = new Set<string>();
  for (const [index, row] of evidence.entries()) {
    const reference = `official.cards[${index}]`;
    const bundleCardId = clean(row.bundleCardId);
    const officialCardId = clean(row.cardID);
    const card = cardById.get(bundleCardId);
    if (!bundleCardId || !officialCardId || !card) {
      issue(
        issues,
        "official_card_evidence_incomplete",
        "error",
        "Every official evidence row must reference a reconciled card and official card ID.",
        reference,
      );
      continue;
    }
    if (bundleCardIds.has(bundleCardId) || officialCardIds.has(officialCardId)) {
      issue(
        issues,
        "official_card_evidence_duplicate",
        "error",
        "Bundle card IDs and official card IDs must be unique.",
        reference,
      );
    }
    bundleCardIds.add(bundleCardId);
    officialCardIds.add(officialCardId);

    if (
      clean(row.setCode).toLowerCase() !== setId.toLowerCase() ||
      clean(row.numerator) !== clean(card.localId) ||
      clean(row.name) !== clean(card.name)
    ) {
      issue(
        issues,
        "official_card_identity_mismatch",
        "error",
        `Official card ${officialCardId} does not match its set, printed number, and Japanese name.`,
        reference,
      );
    }
    if (!officialSourceUrl(row.detailUrl)) {
      issue(
        issues,
        "official_detail_url_invalid",
        "error",
        `Official card ${officialCardId} has an invalid detail URL.`,
        reference,
      );
    }

    if (row.origin === "official_only_addition") {
      if (clean(row.sourcePath)) {
        issue(
          issues,
          "official_addition_has_tcgdex_path",
          "error",
          `Official-only card ${officialCardId} cannot claim a TCGdex source path.`,
          reference,
        );
      }
      if (Array.isArray(card.variants) && card.variants.length) {
        issue(
          issues,
          "unverified_official_variant_evidence",
          "error",
          `Official-only card ${officialCardId} cannot materialize variants without separate physical-printing evidence.`,
          reference,
        );
      }
    } else if (
      !clean(row.sourcePath) ||
      clean(row.sourcePath) !== clean(card.sourcePath)
    ) {
      issue(
        issues,
        "source_card_path_mismatch",
        "error",
        `Source-backed card ${officialCardId} must retain its exact TCGdex path.`,
        reference,
      );
    }
  }

  if (bundleCardIds.size !== bundle.cards.length) {
    issue(
      issues,
      "official_population_not_fully_evidenced",
      "error",
      `Official evidence covers ${bundleCardIds.size}/${bundle.cards.length} reconciled cards.`,
    );
  }
}

export function parsePokemonJapaneseIncompleteReconciledBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const legacyBundle = toLegacyBundle(bundle);
  const basePlan = parsePokemonJapaneseOfficialReconciledBundle({
    ...artifact,
    content: JSON.stringify(legacyBundle),
  });
  const issues = basePlan.validation.issues;
  validateBundle(bundle, artifact, issues);

  const evidenceByBundleCardId = new Map(
    bundle.official.cards.map((row) => [clean(row.bundleCardId), row]),
  );
  let nameBackfilledCards = 0;
  let officialAdditions = 0;
  let preservedOfficialMatches = 0;

  for (const card of basePlan.cards) {
    const bundleCardId = sourceCardId(card.sourceNotes);
    const evidence = evidenceByBundleCardId.get(bundleCardId);
    if (!evidence) continue;
    const existing = sourceNotesObject(card.sourceNotes);

    if (evidence.origin === "source_preserved_name") {
      card.sourceNotes = JSON.stringify({
        ...existing,
        officialIdentityVerified: true,
        officialCardId: clean(evidence.cardID),
        officialEvidenceSha256: evidenceSha256(evidence),
        officialDetailUrl: clean(evidence.detailUrl),
        officialSetCode: clean(evidence.setCode),
        officialDenominator: clean(evidence.denominator) || null,
        officialEvidenceOrigin: evidence.origin,
        phase: "official_incomplete_backfill",
      });
      preservedOfficialMatches += 1;
      continue;
    }

    const oldSourceKey = card.sourceKey;
    const newSourceKey =
      `pokemon-ja-official-card:${sourceToken(bundle.set.id)}:` +
      sourceToken(evidence.cardID);
    card.sourceKey = newSourceKey;
    card.sourceNotes = officialIncompleteSourceNotes({
      bundle,
      evidence,
      existing,
    });
    for (const identity of basePlan.identities) {
      if (identity.cardSourceKey === oldSourceKey) {
        identity.cardSourceKey = newSourceKey;
      }
    }
    if (evidence.origin === "source_name_backfill") {
      nameBackfilledCards += 1;
    } else {
      officialAdditions += 1;
    }
  }

  if (
    preservedOfficialMatches !== bundle.official.preservedNamedCardCount ||
    nameBackfilledCards !== bundle.official.nameBackfilledCardCount ||
    officialAdditions !== bundle.official.addedCardCount
  ) {
    issue(
      issues,
      "official_cards_not_materialized",
      "error",
      `Materialized ${preservedOfficialMatches} preserved, ${nameBackfilledCards} name-backfilled, and ${officialAdditions} added cards; expected ${bundle.official.preservedNamedCardCount}, ${bundle.official.nameBackfilledCardCount}, and ${bundle.official.addedCardCount}.`,
    );
  } else {
    issue(
      issues,
      "official_incomplete_population_reconciled",
      "warning",
      `Verified ${preservedOfficialMatches} existing Japanese names, backfilled ${nameBackfilledCards} missing names, and added ${officialAdditions} official cards while retaining TCGdex physical-printing evidence.`,
    );
  }

  basePlan.adapterId = POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_ID;
  basePlan.adapterVersion =
    POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_VERSION;
  basePlan.source = {
    sourceUrl: artifact.sourceUrl,
    retrievedAt: artifact.retrievedAt,
    authority: artifact.authority,
    redistributionAllowed: artifact.redistributionAllowed,
    privateArchiveRequired: true,
    normalizedFactsInternalOnly: true,
    storage: buildChecklistSourceStorageReceipt({
      manufacturerSlug: "pokemon",
      releaseSlug: basePlan.release.releaseSlug,
      originalFilename: artifact.originalFilename,
      mimeType: artifact.mimeType,
      content: artifact.content,
    }),
  };
  basePlan.validation.status = issues.some(
    (entry) => entry.severity === "error",
  )
    ? "validation_required"
    : "passed";
  basePlan.validation.counts = {
    sets: basePlan.sets.length,
    cards: basePlan.cards.length,
    parallels: basePlan.parallels.length,
    identities: basePlan.identities.length,
  };
  return basePlan;
}

function supportsIncompleteBundle(artifact: ChecklistSourceArtifact) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content) as { schema?: unknown };
    return parsed?.schema === POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA;
  } catch {
    return false;
  }
}

export const pokemonJapaneseIncompleteReconciledAdapter: ChecklistSourceAdapter = {
  id: POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_ID,
  version: POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_VERSION,
  supports: supportsIncompleteBundle,
  parse: parsePokemonJapaneseIncompleteReconciledBundle,
};

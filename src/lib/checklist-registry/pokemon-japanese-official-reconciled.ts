import { createHash } from "node:crypto";

import type {
  ChecklistImportPlan,
  ChecklistImportValidationIssue,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";
import {
  parseTcgdexJapaneseSetBundle,
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
  type TcgdexJapaneseVariantEvidence,
} from "./tcgdex-japanese";

export const POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA =
  "tcos.pokemonJapaneseOfficialReconciledSetBundle.v1" as const;
export const POKEMON_JAPANESE_OFFICIAL_RECONCILED_ADAPTER_ID =
  "pokemon-japanese-official-reconciled" as const;
export const POKEMON_JAPANESE_OFFICIAL_RECONCILED_ADAPTER_VERSION =
  "1.0.0" as const;

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

export type PokemonJapaneseOfficialCardEvidence = {
  bundleCardId: string;
  cardID: string;
  name: string;
  setCode: string;
  numerator: string;
  denominator: string | null;
  detailUrl: string;
};

export type PokemonJapaneseOfficialReconciledBundle = {
  schema: typeof POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA;
  phase: "official_gap_backfill";
  language: "ja";
  generatedAt: string;
  baseSource: {
    repository: "https://github.com/tcgdex/cards-database";
    commit: string;
    setSourcePath: string;
    baseCardCount: number;
  };
  official: {
    auditGeneratedAt: string;
    product: {
      value: string;
      label: string;
      url: string;
    };
    comparableCardCount: number;
    addedCardCount: number;
    cards: PokemonJapaneseOfficialCardEvidence[];
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

function parseJson(content: string | Uint8Array): unknown {
  const text =
    typeof content === "string"
      ? content
      : Buffer.from(content).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Official Japanese reconciliation bundle is not valid JSON: ${
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

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function officialSourceUrl(value: unknown) {
  const url = clean(value);
  return /^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(url);
}

function tcgdexSourceUrl(bundle: PokemonJapaneseOfficialReconciledBundle) {
  const commit = clean(bundle.baseSource.commit);
  const path = clean(bundle.baseSource.setSourcePath);
  if (!/^[a-f0-9]{40}$/i.test(commit) && commit !== "master") {
    throw new Error(`Invalid TCGdex source commit: ${commit}`);
  }
  if (!path.startsWith("data-asia/") || path.includes("..")) {
    throw new Error(`Invalid TCGdex source path: ${path}`);
  }
  return `${bundle.baseSource.repository}/blob/${commit}/${path}`;
}

function extractBundle(
  parsed: unknown,
): PokemonJapaneseOfficialReconciledBundle {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Official Japanese reconciliation imports require a bundle object.",
    );
  }
  const candidate = parsed as Partial<PokemonJapaneseOfficialReconciledBundle>;
  if (candidate.schema !== POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported official Japanese reconciliation schema: ${String(candidate.schema)}.`,
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
      "Official Japanese reconciliation bundle is missing base, official, series, set, or card evidence.",
    );
  }
  return candidate as PokemonJapaneseOfficialReconciledBundle;
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

function officialSourceNotes(params: {
  bundle: PokemonJapaneseOfficialReconciledBundle;
  evidence: PokemonJapaneseOfficialCardEvidence;
}) {
  return JSON.stringify({
    source: "pokemon-card.com",
    sourceAuthority: "official_manufacturer",
    languageCode: "ja",
    seriesId: clean(params.bundle.series.id),
    seriesName: clean(params.bundle.series.name),
    sourceSetId: clean(params.bundle.set.id),
    sourceSetName: clean(params.bundle.set.name),
    sourceCardId: clean(params.evidence.cardID),
    officialBundleCardId: clean(params.evidence.bundleCardId),
    officialProductValue: clean(params.bundle.official.product.value),
    officialProductLabel: clean(params.bundle.official.product.label),
    officialProductUrl: clean(params.bundle.official.product.url),
    officialDetailUrl: clean(params.evidence.detailUrl),
    officialSetCode: clean(params.evidence.setCode),
    localId: clean(params.evidence.numerator),
    officialDenominator: clean(params.evidence.denominator) || null,
    materializedPhysicalPrintings: ["Base"],
    phase: "official_gap_backfill",
  });
}

function buildCompatibleTcgdexBundle(
  bundle: PokemonJapaneseOfficialReconciledBundle,
): TcgdexJapaneseSetBundle {
  return {
    schema: TCGDEX_JAPANESE_BUNDLE_SCHEMA,
    phase: "base_cards",
    language: "ja",
    source: {
      repository: bundle.baseSource.repository,
      commit: clean(bundle.baseSource.commit),
    },
    series: {
      id: clean(bundle.series.id),
      name: clean(bundle.series.name),
    },
    set: {
      id: clean(bundle.set.id),
      name: clean(bundle.set.name),
      officialCardCount: bundle.set.officialCardCount,
      releaseDate: clean(bundle.set.releaseDate),
      sourcePath: clean(bundle.set.sourcePath),
    },
    cards: bundle.cards.map((card) => ({
      id: clean(card.id),
      localId: clean(card.localId),
      name: clean(card.name),
      category: clean(card.category) || null,
      rarity: clean(card.rarity) || null,
      illustrator: clean(card.illustrator) || null,
      regulationMark: clean(card.regulationMark) || null,
      dexId: Array.isArray(card.dexId)
        ? card.dexId.filter(Number.isInteger)
        : [],
      variants: Array.isArray(card.variants) ? card.variants : [],
      sourcePath: clean(card.sourcePath) || null,
    })),
  };
}

function validateBundle(
  bundle: PokemonJapaneseOfficialReconciledBundle,
  artifact: ChecklistSourceArtifact,
  issues: ChecklistImportValidationIssue[],
) {
  const setId = clean(bundle.set.id);
  const officialCards = bundle.official.cards;
  const cardById = new Map(bundle.cards.map((card) => [clean(card.id), card]));

  if (bundle.phase !== "official_gap_backfill") {
    issue(
      issues,
      "phase_invalid",
      "error",
      "Official Japanese reconciliation bundles must use official_gap_backfill.",
    );
  }
  if (bundle.language !== "ja") {
    issue(
      issues,
      "language_invalid",
      "error",
      "Official Japanese reconciliation bundles must use language ja.",
    );
  }
  if (artifact.authority !== "official_manufacturer") {
    issue(
      issues,
      "official_authority_required",
      "error",
      "Official Japanese reconciliation imports require official_manufacturer authority.",
    );
  }
  if (!officialSourceUrl(artifact.sourceUrl)) {
    issue(
      issues,
      "official_source_domain_mismatch",
      "error",
      "Official Japanese reconciliation sources must originate from pokemon-card.com/card-search.",
    );
  }
  if (clean(bundle.official.product.url) !== clean(artifact.sourceUrl)) {
    issue(
      issues,
      "official_source_url_mismatch",
      "error",
      "The archived artifact source URL must match official.product.url.",
    );
  }
  if (artifact.redistributionAllowed) {
    issue(
      issues,
      "redistribution_review_required",
      "warning",
      "Keep generated official reconciliation bundles private and do not redistribute official images.",
    );
  }
  if (!setId || !clean(bundle.set.name) || !clean(bundle.set.releaseDate)) {
    issue(
      issues,
      "set_identity_incomplete",
      "error",
      "Official reconciliation set id, name, and release date are required.",
    );
  }
  if (
    bundle.cards.length !== bundle.official.comparableCardCount ||
    bundle.cards.length !== bundle.set.officialCardCount
  ) {
    issue(
      issues,
      "official_population_incomplete",
      "error",
      `Reconciled ${setId || "set"} contains ${bundle.cards.length} cards but official evidence expects ${bundle.official.comparableCardCount}.`,
    );
  }
  if (
    bundle.baseSource.baseCardCount + bundle.official.addedCardCount !==
    bundle.cards.length
  ) {
    issue(
      issues,
      "reconciliation_count_invalid",
      "error",
      "Base-card count plus official additions must equal the complete reconciled population.",
    );
  }
  if (officialCards.length !== bundle.official.addedCardCount) {
    issue(
      issues,
      "official_addition_count_invalid",
      "error",
      "Official evidence rows must equal official.addedCardCount.",
    );
  }

  const evidenceIds = new Set<string>();
  const officialCardIds = new Set<string>();
  for (const [index, evidence] of officialCards.entries()) {
    const rowReference = `official.cards[${index}]`;
    const bundleCardId = clean(evidence.bundleCardId);
    const officialCardId = clean(evidence.cardID);
    const card = cardById.get(bundleCardId);
    if (!bundleCardId || !officialCardId || !card) {
      issue(
        issues,
        "official_card_evidence_incomplete",
        "error",
        "Official card evidence must reference a reconciled bundle card and official card ID.",
        rowReference,
      );
      continue;
    }
    if (evidenceIds.has(bundleCardId) || officialCardIds.has(officialCardId)) {
      issue(
        issues,
        "official_card_evidence_duplicate",
        "error",
        "Official bundle-card IDs and official card IDs must be unique.",
        rowReference,
      );
    }
    evidenceIds.add(bundleCardId);
    officialCardIds.add(officialCardId);

    if (clean(evidence.setCode).toLowerCase() !== setId.toLowerCase()) {
      issue(
        issues,
        "official_set_code_mismatch",
        "error",
        `Official card ${officialCardId} reports set ${clean(evidence.setCode)} instead of ${setId}.`,
        rowReference,
      );
    }
    if (
      clean(evidence.numerator) !== clean(card.localId) ||
      clean(evidence.name) !== clean(card.name)
    ) {
      issue(
        issues,
        "official_card_identity_mismatch",
        "error",
        `Official card ${officialCardId} does not match its reconciled number and Japanese name.`,
        rowReference,
      );
    }
    if (!officialSourceUrl(evidence.detailUrl)) {
      issue(
        issues,
        "official_detail_url_invalid",
        "error",
        `Official card ${officialCardId} has an invalid detail URL.`,
        rowReference,
      );
    }
    if (Array.isArray(card.variants) && card.variants.length) {
      issue(
        issues,
        "unverified_official_variant_evidence",
        "error",
        `Official-only card ${officialCardId} cannot materialize variants without separate physical-printing evidence.`,
        rowReference,
      );
    }
  }
}

export function parsePokemonJapaneseOfficialReconciledBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const compatibleBundle = buildCompatibleTcgdexBundle(bundle);
  const basePlan = parseTcgdexJapaneseSetBundle({
    sourceUrl: tcgdexSourceUrl(bundle),
    originalFilename: `${clean(bundle.series.id)}-${clean(bundle.set.id)}.tcgdex-ja.bundle.json`,
    mimeType: "application/json",
    content: JSON.stringify(compatibleBundle),
    retrievedAt: artifact.retrievedAt,
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
  });
  const issues = basePlan.validation.issues;
  validateBundle(bundle, artifact, issues);

  const evidenceByBundleCardId = new Map(
    bundle.official.cards.map((card) => [clean(card.bundleCardId), card]),
  );
  let materializedOfficialCards = 0;
  for (const card of basePlan.cards) {
    const bundleCardId = sourceCardId(card.sourceNotes);
    const evidence = evidenceByBundleCardId.get(bundleCardId);
    if (!evidence) continue;

    const oldSourceKey = card.sourceKey;
    const newSourceKey =
      `pokemon-ja-official-card:${sourceToken(bundle.set.id)}:` +
      sourceToken(evidence.cardID);
    card.sourceKey = newSourceKey;
    card.sourceNotes = officialSourceNotes({ bundle, evidence });
    for (const identity of basePlan.identities) {
      if (identity.cardSourceKey === oldSourceKey) {
        identity.cardSourceKey = newSourceKey;
      }
    }
    materializedOfficialCards += 1;
  }

  if (materializedOfficialCards !== bundle.official.addedCardCount) {
    issue(
      issues,
      "official_cards_not_materialized",
      "error",
      `Materialized ${materializedOfficialCards} official cards but expected ${bundle.official.addedCardCount}.`,
    );
  } else if (materializedOfficialCards) {
    issue(
      issues,
      "official_source_gap_backfilled",
      "warning",
      `Added ${materializedOfficialCards} official Japanese base-card identities while preserving ${bundle.baseSource.baseCardCount} TCGdex cards and their physical-printing evidence.`,
    );
  }

  const releaseSlug = basePlan.release.releaseSlug;
  basePlan.adapterId = POKEMON_JAPANESE_OFFICIAL_RECONCILED_ADAPTER_ID;
  basePlan.adapterVersion =
    POKEMON_JAPANESE_OFFICIAL_RECONCILED_ADAPTER_VERSION;
  basePlan.source = {
    sourceUrl: artifact.sourceUrl,
    retrievedAt: artifact.retrievedAt,
    authority: artifact.authority,
    redistributionAllowed: artifact.redistributionAllowed,
    privateArchiveRequired: true,
    normalizedFactsInternalOnly: true,
    storage: buildChecklistSourceStorageReceipt({
      manufacturerSlug: "pokemon",
      releaseSlug,
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

function looksLikeOfficialReconciledBundle(
  artifact: ChecklistSourceArtifact,
) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content) as { schema?: unknown };
    return parsed?.schema === POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA;
  } catch {
    return false;
  }
}

export const pokemonJapaneseOfficialReconciledAdapter: ChecklistSourceAdapter = {
  id: POKEMON_JAPANESE_OFFICIAL_RECONCILED_ADAPTER_ID,
  version: POKEMON_JAPANESE_OFFICIAL_RECONCILED_ADAPTER_VERSION,
  supports: looksLikeOfficialReconciledBundle,
  parse: parsePokemonJapaneseOfficialReconciledBundle,
};

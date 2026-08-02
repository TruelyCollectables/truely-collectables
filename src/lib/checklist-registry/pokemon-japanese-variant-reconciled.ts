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

export const POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA =
  "tcos.pokemonJapaneseVariantReconciledSetBundle.v1" as const;
export const POKEMON_JAPANESE_VARIANT_RECONCILED_ADAPTER_ID =
  "pokemon-japanese-official-variant-reconciled" as const;
export const POKEMON_JAPANESE_VARIANT_RECONCILED_ADAPTER_VERSION =
  "1.0.0" as const;

export const POKEMON_JAPANESE_POKEBALL_REVERSE_NAME =
  "Reverse Holo — Poké Ball" as const;

export type PokemonJapaneseVariantEvidenceOrigin =
  | "source_base_printing"
  | "source_reverse_pokeball_printing"
  | "official_numbered_addition";

export type PokemonJapaneseVariantReconciledCard = {
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

export type PokemonJapaneseVariantPrintingEvidence = {
  bundleCardId: string;
  cardID: string;
  name: string;
  setCode: string;
  numerator: string;
  denominator: string | null;
  detailUrl: string;
  origin: PokemonJapaneseVariantEvidenceOrigin;
  sourcePath: string | null;
  sourceLocalId: string | null;
  parallelName: string | null;
};

export type PokemonJapaneseVariantReconciledBundle = {
  schema: typeof POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA;
  phase: "official_variant_backfill";
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
    baseCardCount: number;
    officialPrintingCount: number;
    sourceBasePrintingCount: number;
    sourceReversePokeballPrintingCount: number;
    numberedAddedCardCount: number;
    printings: PokemonJapaneseVariantPrintingEvidence[];
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
  cards: PokemonJapaneseVariantReconciledCard[];
};

const SUPPORTED_SETS = new Set(["s10a", "s11a"]);

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

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

function parseJson(content: string | Uint8Array): unknown {
  const text =
    typeof content === "string"
      ? content
      : Buffer.from(content).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Variant-reconciled Japanese bundle is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function extractBundle(
  value: unknown,
): PokemonJapaneseVariantReconciledBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Variant-reconciled Japanese imports require a bundle object.");
  }
  const candidate = value as Partial<PokemonJapaneseVariantReconciledBundle>;
  if (candidate.schema !== POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported variant-reconciled Japanese schema: ${String(candidate.schema)}.`,
    );
  }
  if (
    !candidate.baseSource ||
    !candidate.official ||
    !candidate.series ||
    !candidate.set ||
    !Array.isArray(candidate.cards) ||
    !Array.isArray(candidate.official.printings)
  ) {
    throw new Error(
      "Variant-reconciled Japanese bundle is missing base, official, series, set, card, or printing evidence.",
    );
  }
  return candidate as PokemonJapaneseVariantReconciledBundle;
}

function officialSourceUrl(value: unknown) {
  return /^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(
    clean(value),
  );
}

function isPokeballReverseVariants(
  variants: TcgdexJapaneseVariantEvidence[] | undefined,
) {
  if (!Array.isArray(variants) || variants.length !== 2) return false;
  const signatures = variants.map((variant) => ({
    type: clean(variant.type).toLowerCase(),
    subtype: clean(variant.subtype).toLowerCase(),
    size: clean(variant.size),
    foil: clean(variant.foil),
    stamps: Array.isArray(variant.stamps)
      ? variant.stamps.map((entry) => clean(entry)).filter(Boolean)
      : [],
    languages: Array.isArray(variant.languages)
      ? variant.languages.map((entry) => clean(entry)).filter(Boolean)
      : [],
  }));
  const base = signatures.find((entry) => entry.type === "normal");
  const reverse = signatures.find((entry) => entry.type === "reverse");
  return Boolean(
    base &&
      reverse &&
      !base.subtype &&
      !base.size &&
      !base.foil &&
      base.stamps.length === 0 &&
      (!base.languages.length || base.languages.includes("ja")) &&
      reverse.subtype === "pokeball" &&
      !reverse.size &&
      !reverse.foil &&
      reverse.stamps.length === 0 &&
      (!reverse.languages.length || reverse.languages.includes("ja")),
  );
}

function evidenceSha256(evidence: PokemonJapaneseVariantPrintingEvidence) {
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
      evidence.sourceLocalId || "",
      evidence.parallelName || "",
    ].join("|"),
  );
}

function validateBundle(
  bundle: PokemonJapaneseVariantReconciledBundle,
  artifact: ChecklistSourceArtifact,
  issues: ChecklistImportValidationIssue[],
) {
  const setId = clean(bundle.set.id);
  const setKey = setId.toLowerCase();
  const cardsById = new Map<string, PokemonJapaneseVariantReconciledCard>();
  for (const [index, card] of bundle.cards.entries()) {
    const id = clean(card.id);
    if (!id || cardsById.has(id)) {
      issue(
        issues,
        "variant_bundle_card_duplicate",
        "error",
        `Variant bundle card ID ${id || "(blank)"} must be unique.`,
        `cards[${index}]`,
      );
      continue;
    }
    cardsById.set(id, card);
  }

  if (bundle.phase !== "official_variant_backfill") {
    issue(
      issues,
      "phase_invalid",
      "error",
      "Variant-reconciled Japanese bundles must use official_variant_backfill.",
    );
  }
  if (bundle.language !== "ja") {
    issue(
      issues,
      "language_invalid",
      "error",
      "Variant-reconciled Japanese bundles must use language ja.",
    );
  }
  if (!SUPPORTED_SETS.has(setKey)) {
    issue(
      issues,
      "variant_set_not_supported",
      "error",
      `${setId || "Set"} is not an approved duplicate-printing reconciliation target.`,
    );
  }
  if (artifact.authority !== "official_manufacturer") {
    issue(
      issues,
      "official_authority_required",
      "error",
      "Variant-reconciled Japanese imports require official_manufacturer authority.",
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
      "Keep variant reconciliation bundles private and do not redistribute official images.",
    );
  }

  const counts = {
    sourceBase: bundle.official.printings.filter(
      (row) => row.origin === "source_base_printing",
    ).length,
    sourceReverse: bundle.official.printings.filter(
      (row) => row.origin === "source_reverse_pokeball_printing",
    ).length,
    additions: bundle.official.printings.filter(
      (row) => row.origin === "official_numbered_addition",
    ).length,
  };
  if (
    cardsById.size !== bundle.cards.length ||
    bundle.cards.length !== bundle.official.baseCardCount ||
    bundle.cards.length !== bundle.set.officialCardCount ||
    bundle.official.printings.length !== bundle.official.officialPrintingCount ||
    counts.sourceBase !== bundle.baseSource.sourceCardCount ||
    counts.sourceBase !== bundle.official.sourceBasePrintingCount ||
    counts.sourceReverse !==
      bundle.official.sourceReversePokeballPrintingCount ||
    counts.additions !== bundle.official.numberedAddedCardCount ||
    counts.sourceBase + counts.additions !== bundle.official.baseCardCount ||
    counts.sourceBase + counts.sourceReverse + counts.additions !==
      bundle.official.officialPrintingCount
  ) {
    issue(
      issues,
      "variant_population_invalid",
      "error",
      "Source bases, Poké Ball reverse printings, official additions, base cards, and official printing counts do not reconcile.",
    );
  }

  const officialCardIds = new Set<string>();
  const printingByBundleCardId = new Map<
    string,
    PokemonJapaneseVariantPrintingEvidence[]
  >();
  for (const [index, row] of bundle.official.printings.entries()) {
    const reference = `official.printings[${index}]`;
    const bundleCardId = clean(row.bundleCardId);
    const officialCardId = clean(row.cardID);
    const card = cardsById.get(bundleCardId);
    if (!bundleCardId || !officialCardId || !card) {
      issue(
        issues,
        "variant_printing_evidence_incomplete",
        "error",
        "Every official printing must reference a reconciled bundle card and official card ID.",
        reference,
      );
      continue;
    }
    if (officialCardIds.has(officialCardId)) {
      issue(
        issues,
        "variant_official_card_duplicate",
        "error",
        `Official card ID ${officialCardId} is repeated.`,
        reference,
      );
    }
    officialCardIds.add(officialCardId);
    const rows = printingByBundleCardId.get(bundleCardId) || [];
    rows.push(row);
    printingByBundleCardId.set(bundleCardId, rows);

    if (
      clean(row.setCode).toLowerCase() !== setKey ||
      normalizedLocalId(row.numerator) !== normalizedLocalId(card.localId) ||
      clean(row.name) !== clean(card.name) ||
      !officialSourceUrl(row.detailUrl)
    ) {
      issue(
        issues,
        "variant_official_identity_mismatch",
        "error",
        `Official card ${officialCardId} does not match its set, printed number, Japanese name, or detail URL.`,
        reference,
      );
    }
  }

  for (const [index, card] of bundle.cards.entries()) {
    const reference = `cards[${index}]`;
    const rows = printingByBundleCardId.get(clean(card.id)) || [];
    const sourceBacked = Boolean(clean(card.sourcePath));
    if (!rows.length) {
      issue(
        issues,
        "variant_card_not_evidenced",
        "error",
        `Card ${clean(card.id)} has no official printing evidence.`,
        reference,
      );
      continue;
    }

    if (!sourceBacked) {
      if (
        rows.length !== 1 ||
        rows[0].origin !== "official_numbered_addition" ||
        clean(rows[0].sourcePath) ||
        clean(rows[0].sourceLocalId) ||
        clean(rows[0].parallelName) ||
        (Array.isArray(card.variants) && card.variants.length)
      ) {
        issue(
          issues,
          "variant_official_addition_invalid",
          "error",
          `Official-only card ${clean(card.id)} must have one base printing and no TCGdex variant claim.`,
          reference,
        );
      }
      continue;
    }

    const bases = rows.filter((row) => row.origin === "source_base_printing");
    const reverses = rows.filter(
      (row) => row.origin === "source_reverse_pokeball_printing",
    );
    const additions = rows.filter(
      (row) => row.origin === "official_numbered_addition",
    );
    const exactSource = rows.every(
      (row) =>
        clean(row.sourcePath) === clean(card.sourcePath) &&
        normalizedLocalId(row.sourceLocalId) === normalizedLocalId(card.localId),
    );
    if (
      bases.length !== 1 ||
      reverses.length > 1 ||
      additions.length !== 0 ||
      !exactSource ||
      clean(bases[0]?.parallelName)
    ) {
      issue(
        issues,
        "variant_source_printing_invalid",
        "error",
        `Source-backed card ${clean(card.id)} must have exactly one base and at most one exact source-backed Poké Ball reverse printing.`,
        reference,
      );
      continue;
    }

    if (reverses.length === 1) {
      const reverse = reverses[0];
      const baseId = Number(bases[0].cardID);
      const reverseId = Number(reverse.cardID);
      if (
        clean(reverse.parallelName) !==
          POKEMON_JAPANESE_POKEBALL_REVERSE_NAME ||
        !Number.isSafeInteger(baseId) ||
        !Number.isSafeInteger(reverseId) ||
        reverseId <= baseId ||
        !isPokeballReverseVariants(card.variants)
      ) {
        issue(
          issues,
          "variant_pokeball_reverse_invalid",
          "error",
          `Source-backed card ${clean(card.id)} lacks the proved base-before-reverse Poké Ball printing pair.`,
          reference,
        );
      }
    } else if (Array.isArray(card.variants) && card.variants.length) {
      issue(
        issues,
        "variant_unpaired_evidence",
        "error",
        `Source-backed card ${clean(card.id)} has variant metadata without a second official printing.`,
        reference,
      );
    }
  }
}

function buildTcgdexCompatibleBundle(
  bundle: PokemonJapaneseVariantReconciledBundle,
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
      officialCardCount: bundle.official.baseCardCount,
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

function sourceCardIdFromNotes(sourceNotes: string | null) {
  try {
    const parsed = JSON.parse(sourceNotes || "{}") as {
      sourceCardId?: unknown;
    };
    return clean(parsed.sourceCardId);
  } catch {
    return "";
  }
}

export function parsePokemonJapaneseVariantReconciledBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const compatible = buildTcgdexCompatibleBundle(bundle);
  const plan = parseTcgdexJapaneseSetBundle({
    ...artifact,
    content: JSON.stringify(compatible),
    authority: "approved_reference_dataset",
    sourceUrl:
      `${bundle.baseSource.repository}/blob/${clean(bundle.baseSource.commit)}/` +
      clean(bundle.baseSource.setSourcePath),
  });
  const issues = plan.validation.issues;
  validateBundle(bundle, artifact, issues);

  const printingsByBundleCardId = new Map<
    string,
    PokemonJapaneseVariantPrintingEvidence[]
  >();
  for (const printing of bundle.official.printings) {
    const rows = printingsByBundleCardId.get(clean(printing.bundleCardId)) || [];
    rows.push(printing);
    printingsByBundleCardId.set(clean(printing.bundleCardId), rows);
  }

  let attachedPrintings = 0;
  for (const card of plan.cards) {
    const bundleCardId = sourceCardIdFromNotes(card.sourceNotes);
    const printings = printingsByBundleCardId.get(bundleCardId) || [];
    if (!printings.length) continue;
    const existing = JSON.parse(card.sourceNotes || "{}") as Record<
      string,
      unknown
    >;
    card.sourceNotes = JSON.stringify({
      ...existing,
      source: clean(bundle.cards.find((row) => clean(row.id) === bundleCardId)?.sourcePath)
        ? "pokemon-card.com+tcgdex/cards-database"
        : "pokemon-card.com",
      sourceAuthority: "official_manufacturer",
      officialProductValue: clean(bundle.official.product.value),
      officialProductLabel: clean(bundle.official.product.label),
      officialProductUrl: clean(bundle.official.product.url),
      officialPrintingEvidence: printings.map((printing) => ({
        cardID: clean(printing.cardID),
        name: clean(printing.name),
        setCode: clean(printing.setCode),
        numerator: clean(printing.numerator),
        denominator: clean(printing.denominator) || null,
        detailUrl: clean(printing.detailUrl),
        origin: printing.origin,
        parallelName: clean(printing.parallelName) || null,
        evidenceSha256: evidenceSha256(printing),
      })),
      phase: "official_variant_backfill",
    });
    attachedPrintings += printings.length;
  }

  if (attachedPrintings !== bundle.official.officialPrintingCount) {
    issue(
      issues,
      "variant_printings_not_materialized",
      "error",
      `Attached ${attachedPrintings}/${bundle.official.officialPrintingCount} official printing evidence rows.`,
    );
  }
  if (
    plan.cards.length !== bundle.official.baseCardCount ||
    plan.identities.length !== bundle.official.officialPrintingCount ||
    plan.parallels.length !==
      (bundle.official.sourceReversePokeballPrintingCount > 0 ? 1 : 0)
  ) {
    issue(
      issues,
      "variant_identity_population_invalid",
      "error",
      `Materialized ${plan.cards.length} base cards, ${plan.parallels.length} parallel definitions, and ${plan.identities.length} physical-printing identities; bundle expects ${bundle.official.baseCardCount}, ${bundle.official.sourceReversePokeballPrintingCount > 0 ? 1 : 0}, and ${bundle.official.officialPrintingCount}.`,
    );
  }

  if (!issues.some((entry) => entry.severity === "error")) {
    issue(
      issues,
      "official_variant_population_reconciled",
      "warning",
      `Reconciled ${bundle.official.officialPrintingCount} official Japanese physical printings into ${bundle.official.baseCardCount} base cards and ${bundle.official.sourceReversePokeballPrintingCount} Poké Ball reverse identities.`,
    );
  }

  plan.adapterId = POKEMON_JAPANESE_VARIANT_RECONCILED_ADAPTER_ID;
  plan.adapterVersion = POKEMON_JAPANESE_VARIANT_RECONCILED_ADAPTER_VERSION;
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

function supportsVariantBundle(artifact: ChecklistSourceArtifact) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content) as { schema?: unknown };
    return parsed?.schema === POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA;
  } catch {
    return false;
  }
}

export const pokemonJapaneseVariantReconciledAdapter: ChecklistSourceAdapter = {
  id: POKEMON_JAPANESE_VARIANT_RECONCILED_ADAPTER_ID,
  version: POKEMON_JAPANESE_VARIANT_RECONCILED_ADAPTER_VERSION,
  supports: supportsVariantBundle,
  parse: parsePokemonJapaneseVariantReconciledBundle,
};

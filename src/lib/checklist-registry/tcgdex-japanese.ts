import { createHash } from "node:crypto";

import {
  buildChecklistIdentityFingerprint,
  type ChecklistIdentityFingerprint,
  type ChecklistIdentityInput,
} from "./identity";
import type {
  ChecklistImportCard,
  ChecklistImportParallel,
  ChecklistImportPlan,
  ChecklistImportSet,
  ChecklistImportValidationIssue,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";

export const TCGDEX_JAPANESE_BUNDLE_SCHEMA =
  "tcos.tcgdex.japaneseSetBundle.v1" as const;
export const TCGDEX_JAPANESE_ADAPTER_ID =
  "tcgdex-japanese-physical-printings" as const;
export const TCGDEX_JAPANESE_ADAPTER_VERSION = "2.0.0" as const;

export type TcgdexJapaneseVariantEvidence = {
  type: string;
  subtype?: string | null;
  size?: string | null;
  stamps?: string[];
  foil?: string | null;
  languages?: string[];
};

type TcgdexJapaneseBundleCard = {
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

export type TcgdexJapaneseSetBundle = {
  schema: typeof TCGDEX_JAPANESE_BUNDLE_SCHEMA;
  phase: "base_cards";
  language: "ja";
  source: {
    repository: "https://github.com/tcgdex/cards-database";
    commit: string;
  };
  series: {
    id: string;
    name: string;
  };
  set: {
    id: string;
    name: string;
    officialCardCount: number | null;
    releaseDate: string;
    sourcePath: string;
  };
  cards: TcgdexJapaneseBundleCard[];
};

type MaterializedVariant = {
  signature: string;
  isBase: boolean;
  parallelName: string | null;
};

const SUPPORTED_VARIANT_TYPES = new Set([
  "normal",
  "holo",
  "reverse",
  "metal",
  "lenticular",
]);

const TOKEN_LABELS: Record<string, string> = {
  pokeball: "Poké Ball",
  greatball: "Great Ball",
  ultraball: "Ultra Ball",
  masterball: "Master Ball",
  loveball: "Love Ball",
  friendball: "Friend Ball",
  quickball: "Quick Ball",
  duskball: "Dusk Ball",
  wotc: "WotC",
  "1st-edition": "1st Edition",
  "w-promo": "W Promo",
  "pre-release": "Prerelease",
  "pokemon-center": "Pokémon Center",
  "pokemon-center-ny": "Pokémon Center NY",
  "set-logo": "Set Logo",
  "no-rarity": "No Rarity",
  "japanese-back": "Japanese Back",
  "1999-2000-copyright": "1999–2000 Copyright",
  "1999-copyright": "1999 Copyright",
  "1995-1998-copyright": "1995–1998 Copyright",
  "nintedo-error": "Nintendo Error",
  "d-edition-error": "D Edition Error",
  "1st-edition-scratch-error": "1st Edition Scratch Error",
  "1st-edition-error": "1st Edition Error",
  "1st-movie": "1st Movie",
  "1st-movie-inverted": "1st Movie Inverted",
  "pokemon-4-ever": "Pokémon 4Ever",
  "25th-celebration": "25th Celebration",
  "poke-ball-league": "Poké Ball League",
  "master-ball-league": "Master Ball League",
  "ultra-ball-league": "Ultra Ball League",
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedToken(value: unknown) {
  return clean(String(value ?? "")).toLowerCase();
}

function comparable(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function sourceToken(value: string) {
  return encodeURIComponent(clean(value));
}

function requireText(value: string | null | undefined, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function parseJson(content: string | Uint8Array): unknown {
  const text =
    typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `TCGdex Japanese bundle is not valid JSON: ${
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

function releaseYearFromDate(value: string) {
  return clean(value).match(/^(\d{4})-/)?.[1] || null;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function humanizeToken(value: string) {
  const normalized = normalizedToken(value);
  if (!normalized) return "";
  if (TOKEN_LABELS[normalized]) return TOKEN_LABELS[normalized];
  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) =>
      /^\d/.test(part)
        ? part.toUpperCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

function stampLabel(value: string) {
  const normalized = normalizedToken(value);
  const label = humanizeToken(normalized);
  if (!label) return "";
  if (normalized === "1st-edition") return label;
  return `${label} Stamp`;
}

function materializeVariant(
  value: TcgdexJapaneseVariantEvidence,
  issues: ChecklistImportValidationIssue[],
  rowReference: string,
): MaterializedVariant | null {
  const type = normalizedToken(value.type);
  if (!SUPPORTED_VARIANT_TYPES.has(type)) {
    issue(
      issues,
      "physical_variant_type_unsupported",
      "error",
      `Unsupported TCGdex Japanese physical variant type: ${type || "(blank)"}.`,
      rowReference,
    );
    return null;
  }

  const languages = Array.isArray(value.languages)
    ? [...new Set(value.languages.map(normalizedToken).filter(Boolean))].sort()
    : [];
  if (languages.length && !languages.includes("ja")) {
    issue(
      issues,
      "physical_variant_not_japanese",
      "warning",
      `Skipped a TCGdex physical variant restricted to ${languages.join(", ")}.`,
      rowReference,
    );
    return null;
  }

  const subtype = normalizedToken(value.subtype);
  const size = normalizedToken(value.size);
  const foil = normalizedToken(value.foil);
  const stamps = Array.isArray(value.stamps)
    ? [...new Set(value.stamps.map(normalizedToken).filter(Boolean))].sort()
    : [];

  const signature = [
    `type=${type}`,
    `subtype=${subtype}`,
    `size=${size}`,
    `foil=${foil}`,
    `stamps=${stamps.join(",")}`,
  ].join("|");

  const modifiers: string[] = [];
  if (subtype) modifiers.push(humanizeToken(subtype));
  if (size && size !== "standard") modifiers.push(humanizeToken(size));
  for (const stamp of stamps) {
    const label = stampLabel(stamp);
    if (label) modifiers.push(label);
  }

  if (type === "normal") {
    if (foil) modifiers.unshift(`${humanizeToken(foil)} Foil`);
    if (!modifiers.length) {
      return { signature, isBase: true, parallelName: null };
    }
    return {
      signature,
      isBase: false,
      parallelName: modifiers.join(" — "),
    };
  }

  let primary =
    type === "holo"
      ? "Holo"
      : type === "reverse"
        ? "Reverse Holo"
        : type === "metal"
          ? "Metal"
          : "Lenticular";

  if (foil && (type === "holo" || type === "reverse")) {
    primary = `${humanizeToken(foil)} ${primary}`;
  } else if (foil) {
    modifiers.unshift(`${humanizeToken(foil)} Foil`);
  }

  return {
    signature,
    isBase: false,
    parallelName: [primary, ...modifiers].filter(Boolean).join(" — "),
  };
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

function databaseNormalizedCardNumber(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/]+/gu, "");
}

function databaseNormalizedVariation(value: string | null) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceIdFromNotes(sourceNotes: string | null) {
  try {
    const notes = JSON.parse(sourceNotes || "{}") as { sourceCardId?: unknown };
    return clean(String(notes.sourceCardId || ""));
  } catch {
    return "";
  }
}

function sourceBackedVariation(sourceId: string) {
  return `TCGdex Source Variant ${sha256(sourceId).slice(0, 24)}`;
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

function disambiguateDatabaseCardKeys(
  cards: ChecklistImportCard[],
  identities: ChecklistImportPlan["identities"],
  issues: ChecklistImportValidationIssue[],
) {
  const groups = new Map<string, ChecklistImportCard[]>();
  for (const card of cards) {
    const key = [
      card.setSourceKey,
      databaseNormalizedCardNumber(card.cardNumber),
      databaseNormalizedVariation(card.variation),
    ].join("\u0000");
    const group = groups.get(key) || [];
    group.push(card);
    groups.set(key, group);
  }

  const variationBySourceKey = new Map<string, string>();
  let collisionGroups = 0;
  let disambiguatedCards = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    collisionGroups += 1;
    for (const card of group) {
      const sourceId = sourceIdFromNotes(card.sourceNotes) || card.sourceKey;
      const variation = sourceBackedVariation(sourceId);
      card.variation = variation;
      variationBySourceKey.set(card.sourceKey, variation);
      disambiguatedCards += 1;
    }
  }

  if (!disambiguatedCards) return;
  for (const identity of identities) {
    const variation = variationBySourceKey.get(identity.cardSourceKey);
    if (variation) {
      identity.fingerprint = rebuildJapaneseFingerprint(
        identity.fingerprint,
        variation,
      );
    }
  }

  issue(
    issues,
    "database_card_key_disambiguated",
    "warning",
    `Added source-backed variations to ${disambiguatedCards} Japanese cards across ${collisionGroups} normalized card-number collision group${collisionGroups === 1 ? "" : "s"}.`,
  );
}

function buildSourceNotes(
  bundle: TcgdexJapaneseSetBundle,
  card: TcgdexJapaneseBundleCard,
  materializedPhysicalPrintings: string[],
) {
  return JSON.stringify({
    source: "tcgdex/cards-database",
    sourceCommit: clean(bundle.source.commit),
    languageCode: "ja",
    seriesId: clean(bundle.series.id),
    seriesName: clean(bundle.series.name),
    sourceSetId: clean(bundle.set.id),
    sourceSetName: clean(bundle.set.name),
    sourceCardId: clean(card.id),
    localId: clean(card.localId),
    category: clean(card.category) || null,
    rarity: clean(card.rarity) || null,
    illustrator: clean(card.illustrator) || null,
    regulationMark: clean(card.regulationMark) || null,
    dexId: Array.isArray(card.dexId) ? card.dexId : [],
    variantEvidence: Array.isArray(card.variants) ? card.variants : [],
    materializedPhysicalPrintings,
    sourcePath: clean(card.sourcePath) || null,
    phase: "physical_printings",
  });
}

function extractBundle(parsed: unknown): TcgdexJapaneseSetBundle {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TCGdex Japanese imports require a set-bundle object.");
  }
  const candidate = parsed as Partial<TcgdexJapaneseSetBundle>;
  if (candidate.schema !== TCGDEX_JAPANESE_BUNDLE_SCHEMA) {
    throw new Error(
      `Unsupported TCGdex Japanese schema: ${String(candidate.schema)}`,
    );
  }
  if (
    !candidate.set ||
    !candidate.series ||
    !candidate.source ||
    !Array.isArray(candidate.cards)
  ) {
    throw new Error(
      "TCGdex Japanese bundle is missing source, series, set, or cards.",
    );
  }
  return candidate as TcgdexJapaneseSetBundle;
}

export function parseTcgdexJapaneseSetBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const issues: ChecklistImportValidationIssue[] = [];

  if (bundle.phase !== "base_cards") {
    issue(
      issues,
      "phase_invalid",
      "error",
      "Phase 2 accepts the audited base_cards bundle schema with preserved physical-variant evidence.",
    );
  }
  if (bundle.language !== "ja") {
    issue(
      issues,
      "language_invalid",
      "error",
      "TCGdex Japanese bundles must use language ja.",
    );
  }
  if (
    artifact.authority === "approved_reference_dataset" &&
    !/^https:\/\/github\.com\/tcgdex\/cards-database\b/i.test(
      artifact.sourceUrl,
    )
  ) {
    issue(
      issues,
      "approved_source_domain_mismatch",
      "error",
      "Approved TCGdex sources must originate from tcgdex/cards-database on GitHub.",
    );
  }
  if (artifact.redistributionAllowed) {
    issue(
      issues,
      "redistribution_review_required",
      "warning",
      "Keep original TCGdex source bundles private while image and upstream attribution rules are reviewed.",
    );
  }

  const seriesId = requireText(bundle.series.id, "series.id");
  requireText(bundle.series.name, "series.name");
  const setId = requireText(bundle.set.id, "set.id");
  const setName = requireText(bundle.set.name, "set.name");
  const releaseDate = requireText(bundle.set.releaseDate, "set.releaseDate");
  const releaseYear = releaseYearFromDate(releaseDate);
  if (!releaseYear) {
    issue(
      issues,
      "release_year_invalid",
      "error",
      `Japanese set releaseDate must begin with a four-digit year: ${releaseDate}`,
    );
  }

  const releaseSlug = comparable(`tcgdex-ja-${seriesId}-${setId}`);
  const setSourceKey =
    `tcgdex-ja-set:${sourceToken(seriesId)}:${sourceToken(setId)}`;
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "pokemon",
    releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  const sets: ChecklistImportSet[] = [
    {
      sourceKey: setSourceKey,
      name: setName,
      normalizedName: comparable(setName),
      setType: "base",
    },
  ];
  const cards: ChecklistImportCard[] = [];
  const parallels: ChecklistImportParallel[] = [];
  const identities: ChecklistImportPlan["identities"] = [];
  const sourceKeys = new Set<string>();
  const parallelBySignature = new Map<
    string,
    { sourceKey: string; name: string }
  >();
  const signatureByNormalizedParallelName = new Map<string, string>();
  let variantEvidenceCount = 0;
  let physicalVariantIdentityCount = 0;
  let baseIdentityCount = 0;
  let deduplicatedVariantEvidenceCount = 0;

  for (const [index, rawCard] of bundle.cards.entries()) {
    const cardId = clean(rawCard.id);
    const localId = clean(rawCard.localId).replace(/^#\s*/, "");
    const cardName = clean(rawCard.name);
    const rowReference = `cards[${index}]`;
    if (!cardId || !localId || !cardName) {
      issue(
        issues,
        "card_identity_incomplete",
        "error",
        "Japanese cards require id, localId, and Japanese name.",
        rowReference,
      );
      continue;
    }

    const cardSourceKey =
      `tcgdex-ja-card:${sourceToken(setId)}:${sourceToken(cardId)}`;
    if (sourceKeys.has(cardSourceKey)) {
      issue(
        issues,
        "duplicate_card",
        "error",
        `Duplicate TCGdex Japanese source card ${cardId}`,
        rowReference,
      );
      continue;
    }
    sourceKeys.add(cardSourceKey);

    const rawVariants = Array.isArray(rawCard.variants) ? rawCard.variants : [];
    variantEvidenceCount += rawVariants.length;
    const materializedVariants: MaterializedVariant[] = [];
    const cardVariantSignatures = new Set<string>();

    for (const [variantIndex, rawVariant] of rawVariants.entries()) {
      const materialized = materializeVariant(
        rawVariant,
        issues,
        `${rowReference}.variants[${variantIndex}]`,
      );
      if (!materialized) continue;
      if (cardVariantSignatures.has(materialized.signature)) {
        deduplicatedVariantEvidenceCount += 1;
        continue;
      }
      cardVariantSignatures.add(materialized.signature);
      materializedVariants.push(materialized);
    }

    if (!rawVariants.length) {
      materializedVariants.push({
        signature: "implicit-base",
        isBase: true,
        parallelName: null,
      });
    } else if (!materializedVariants.length) {
      issue(
        issues,
        "no_japanese_physical_printing",
        "error",
        `No usable Japanese physical printing remained for ${cardId}.`,
        rowReference,
      );
    }

    const cardRecord: ChecklistImportCard = {
      sourceKey: cardSourceKey,
      setSourceKey,
      cardNumber: localId,
      players: [cardName],
      teams: [],
      rookieDesignation: null,
      firstBowmanDesignation: null,
      autographStatus: "non-auto",
      memorabiliaStatus: "non-memorabilia",
      variation: null,
      sourceNotes: null,
    };
    cards.push(cardRecord);

    const materializedPhysicalPrintings: string[] = [];
    for (const materialized of materializedVariants) {
      let parallelSourceKey: string | null = null;
      let parallelName: string | null = null;

      if (!materialized.isBase && materialized.parallelName) {
        let parallel = parallelBySignature.get(materialized.signature);
        if (!parallel) {
          let name = materialized.parallelName;
          const normalizedName = databaseNormalizedVariation(name);
          const existingSignature =
            signatureByNormalizedParallelName.get(normalizedName);
          if (
            existingSignature &&
            existingSignature !== materialized.signature
          ) {
            name =
              `${name} — TCGdex Variant ` +
              sha256(materialized.signature).slice(0, 8);
            issue(
              issues,
              "parallel_name_disambiguated",
              "warning",
              `Added a source-backed suffix to distinguish two TCGdex physical-printing signatures named ${materialized.parallelName}.`,
              rowReference,
            );
          }

          parallel = {
            sourceKey:
              `tcgdex-ja-parallel:${sourceToken(setId)}:` +
              sha256(materialized.signature).slice(0, 24),
            name,
          };
          parallelBySignature.set(materialized.signature, parallel);
          signatureByNormalizedParallelName.set(
            databaseNormalizedVariation(name),
            materialized.signature,
          );
          parallels.push({
            sourceKey: parallel.sourceKey,
            setSourceKey,
            name: parallel.name,
            serialRun: null,
            configurationExclusivity: null,
          });
        }
        parallelSourceKey = parallel.sourceKey;
        parallelName = parallel.name;
        physicalVariantIdentityCount += 1;
      } else {
        baseIdentityCount += 1;
      }

      materializedPhysicalPrintings.push(parallelName || "Base");
      identities.push({
        cardSourceKey,
        parallelSourceKey,
        fingerprint: buildJapaneseFingerprint({
          releaseYear,
          manufacturer: "The Pokémon Company",
          brand: "Pokémon TCG",
          product: setName,
          sport: "Trading Card Game",
          league: "Pokémon TCG",
          setName,
          cardNumber: localId,
          players: [cardName],
          parallel: parallelName,
          autographStatus: "non-auto",
          memorabiliaStatus: "non-memorabilia",
        }),
      });
    }

    cardRecord.sourceNotes = buildSourceNotes(
      bundle,
      rawCard,
      materializedPhysicalPrintings,
    );
  }

  disambiguateDatabaseCardKeys(cards, identities, issues);
  const fingerprints = new Set<string>();
  for (const identity of identities) {
    if (fingerprints.has(identity.fingerprint.fingerprintSha256)) {
      issue(
        issues,
        "duplicate_identity",
        "error",
        `Duplicate Japanese exact identity after database-key normalization: ${identity.cardSourceKey}`,
      );
      continue;
    }
    fingerprints.add(identity.fingerprint.fingerprintSha256);
  }

  if (!bundle.cards.length) {
    issue(
      issues,
      "no_source_cards",
      "error",
      "Japanese set bundle contains no cards.",
    );
  }
  if (!cards.length) {
    issue(
      issues,
      "no_cards",
      "error",
      "No valid Japanese cards were imported.",
    );
  }
  if (
    Number.isInteger(bundle.set.officialCardCount) &&
    Number(bundle.set.officialCardCount) > cards.length
  ) {
    issue(
      issues,
      "official_count_exceeds_source",
      "warning",
      `TCGdex lists ${bundle.set.officialCardCount} official cards but the bundle contains ${cards.length} Japanese card files.`,
    );
  }
  if (deduplicatedVariantEvidenceCount) {
    issue(
      issues,
      "duplicate_variant_evidence_deduplicated",
      "warning",
      `Deduplicated ${deduplicatedVariantEvidenceCount} repeated TCGdex physical-variant evidence row${deduplicatedVariantEvidenceCount === 1 ? "" : "s"}.`,
    );
  }
  if (variantEvidenceCount) {
    issue(
      issues,
      "physical_variants_materialized",
      "warning",
      `Materialized ${physicalVariantIdentityCount} non-base Japanese physical-printing identities and ${baseIdentityCount} base identities from ${variantEvidenceCount} TCGdex variant evidence rows across ${parallels.length} named parallel definitions.`,
    );
  }

  const hasErrors = issues.some((entry) => entry.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: TCGDEX_JAPANESE_ADAPTER_ID,
    adapterVersion: TCGDEX_JAPANESE_ADAPTER_VERSION,
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
      manufacturer: "The Pokémon Company",
      brand: "Pokémon TCG",
      product: setName,
      releaseYear,
      season: null,
      sport: "Trading Card Game",
      league: "Pokémon TCG",
      releaseSlug,
    },
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

function looksLikeTcgdexJapaneseBundle(artifact: ChecklistSourceArtifact) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content) as { schema?: unknown };
    return parsed?.schema === TCGDEX_JAPANESE_BUNDLE_SCHEMA;
  } catch {
    return false;
  }
}

export const tcgdexJapaneseSetBundleAdapter: ChecklistSourceAdapter = {
  id: TCGDEX_JAPANESE_ADAPTER_ID,
  version: TCGDEX_JAPANESE_ADAPTER_VERSION,
  supports: looksLikeTcgdexJapaneseBundle,
  parse: parseTcgdexJapaneseSetBundle,
};

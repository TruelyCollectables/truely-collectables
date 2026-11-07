import { createHash } from "node:crypto";

import {
  buildChecklistIdentityFingerprint,
  type ChecklistIdentityFingerprint,
  type ChecklistIdentityInput,
} from "./identity";
import {
  POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
  parsePokemonJapaneseOfficialReconciledBundle,
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

export const POKEMON_JAPANESE_MP_RECONCILED_SCHEMA =
  "tcos.pokemonJapaneseOfficialMPReconciledSetBundle.v1" as const;
export const POKEMON_JAPANESE_MP_RECONCILED_ADAPTER_ID =
  "pokemon-japanese-official-mp-reconciled" as const;
export const POKEMON_JAPANESE_MP_RECONCILED_ADAPTER_VERSION =
  "1.0.0" as const;

const TARGET_SET_ID = "M-P";
const EXPECTED_BASE_CARDS = 83;
const EXPECTED_NUMBERED_ADDITIONS = 16;
const EXPECTED_UNNUMBERED_ADDITIONS = 15;
const EXPECTED_ADDITIONS = 31;
const EXPECTED_FINAL_CARDS = 114;

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

export type PokemonJapaneseMPCardEvidence = {
  bundleCardId: string;
  cardID: string;
  name: string;
  setCode: "M-P";
  numerator: string | null;
  denominator: string | null;
  detailUrl: string;
  unnumbered: boolean;
};

export type PokemonJapaneseMPReconciledBundle = {
  schema: typeof POKEMON_JAPANESE_MP_RECONCILED_SCHEMA;
  phase: "official_mp_reconciliation";
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
    evidenceGeneratedAt: string;
    product: {
      value: string;
      label: string;
      url: string;
    };
    officialCardCount: number;
    addedCardCount: number;
    numberedAddedCardCount: number;
    unnumberedAddedCardCount: number;
    cards: PokemonJapaneseMPCardEvidence[];
  };
  series: {
    id: string;
    name: string;
  };
  set: {
    id: "M-P";
    name: string;
    officialCardCount: 114;
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
      `Official Japanese M-P bundle is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function extractBundle(parsed: unknown): PokemonJapaneseMPReconciledBundle {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Official Japanese M-P imports require a bundle object.");
  }
  const candidate = parsed as Partial<PokemonJapaneseMPReconciledBundle>;
  if (candidate.schema !== POKEMON_JAPANESE_MP_RECONCILED_SCHEMA) {
    throw new Error(
      `Unsupported official Japanese M-P schema: ${String(candidate.schema)}.`,
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
      "Official Japanese M-P bundle is missing base, official, series, set, or card evidence.",
    );
  }
  return candidate as PokemonJapaneseMPReconciledBundle;
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

function sourceNotes(value: string | null) {
  try {
    return JSON.parse(value || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function validateBundle(
  bundle: PokemonJapaneseMPReconciledBundle,
  artifact: ChecklistSourceArtifact,
  issues: ChecklistImportValidationIssue[],
) {
  const setId = clean(bundle.set.id);
  const evidenceByCardId = new Map<string, PokemonJapaneseMPCardEvidence>();
  const cardById = new Map(bundle.cards.map((card) => [clean(card.id), card]));

  if (bundle.phase !== "official_mp_reconciliation") {
    issue(issues, "phase_invalid", "error", "M-P bundles must use official_mp_reconciliation.");
  }
  if (bundle.language !== "ja") {
    issue(issues, "language_invalid", "error", "M-P bundles must use language ja.");
  }
  if (setId !== TARGET_SET_ID) {
    issue(issues, "set_invalid", "error", `M-P adapter cannot import set ${setId || "(blank)"}.`);
  }
  if (artifact.authority !== "official_manufacturer") {
    issue(issues, "official_authority_required", "error", "M-P imports require official_manufacturer authority.");
  }
  if (!/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(clean(artifact.sourceUrl))) {
    issue(issues, "official_source_domain_mismatch", "error", "M-P sources must originate from pokemon-card.com/card-search.");
  }
  if (clean(bundle.official.product.url) !== clean(artifact.sourceUrl)) {
    issue(issues, "official_source_url_mismatch", "error", "Archived source URL must match official.product.url.");
  }
  if (artifact.redistributionAllowed) {
    issue(issues, "redistribution_review_required", "warning", "Keep M-P reconciliation bundles private and do not redistribute official images.");
  }
  if (
    bundle.baseSource.baseCardCount !== EXPECTED_BASE_CARDS ||
    bundle.official.officialCardCount !== EXPECTED_FINAL_CARDS ||
    bundle.official.addedCardCount !== EXPECTED_ADDITIONS ||
    bundle.official.numberedAddedCardCount !== EXPECTED_NUMBERED_ADDITIONS ||
    bundle.official.unnumberedAddedCardCount !== EXPECTED_UNNUMBERED_ADDITIONS ||
    bundle.set.officialCardCount !== EXPECTED_FINAL_CARDS ||
    bundle.cards.length !== EXPECTED_FINAL_CARDS ||
    bundle.official.cards.length !== EXPECTED_ADDITIONS
  ) {
    issue(issues, "mp_population_invalid", "error", "M-P reconciliation must preserve 83 cards and add 16 numbered plus 15 unnumbered cards for a complete 114-card population.");
  }

  let numbered = 0;
  let unnumbered = 0;
  for (const [index, evidence] of bundle.official.cards.entries()) {
    const rowReference = `official.cards[${index}]`;
    const cardID = clean(evidence.cardID);
    const bundleCardId = clean(evidence.bundleCardId);
    const card = cardById.get(bundleCardId);
    if (!cardID || !bundleCardId || !card) {
      issue(issues, "official_card_evidence_incomplete", "error", "M-P evidence must reference a reconciled card and official card ID.", rowReference);
      continue;
    }
    if (evidenceByCardId.has(cardID)) {
      issue(issues, "official_card_evidence_duplicate", "error", `Duplicate official M-P card ID ${cardID}.`, rowReference);
    }
    evidenceByCardId.set(cardID, evidence);
    if (clean(evidence.setCode) !== TARGET_SET_ID || clean(evidence.name) !== clean(card.name)) {
      issue(issues, "official_card_identity_mismatch", "error", `Official M-P card ${cardID} has mismatched set code or Japanese name.`, rowReference);
    }
    if (!/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(clean(evidence.detailUrl))) {
      issue(issues, "official_detail_url_invalid", "error", `Official M-P card ${cardID} has an invalid detail URL.`, rowReference);
    }
    if (Array.isArray(card.variants) && card.variants.length) {
      issue(issues, "unverified_official_variant_evidence", "error", `Official-only M-P card ${cardID} cannot materialize variants without separate printing evidence.`, rowReference);
    }
    if (evidence.unnumbered) {
      unnumbered += 1;
      if (evidence.numerator !== null || evidence.denominator !== null || clean(card.localId) !== "UNNUMBERED") {
        issue(issues, "official_unnumbered_identity_invalid", "error", `Official M-P card ${cardID} must be represented as UNNUMBERED with null printed-number evidence.`, rowReference);
      }
    } else {
      numbered += 1;
      if (!clean(evidence.numerator) || clean(evidence.numerator) !== clean(card.localId)) {
        issue(issues, "official_numbered_identity_invalid", "error", `Official M-P card ${cardID} does not match its printed number.`, rowReference);
      }
    }
  }
  if (numbered !== EXPECTED_NUMBERED_ADDITIONS || unnumbered !== EXPECTED_UNNUMBERED_ADDITIONS) {
    issue(issues, "mp_addition_breakdown_invalid", "error", `M-P evidence contains ${numbered} numbered and ${unnumbered} unnumbered additions.`);
  }
}

function compatibleBundle(
  bundle: PokemonJapaneseMPReconciledBundle,
): PokemonJapaneseOfficialReconciledBundle {
  return {
    schema: POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
    phase: "official_gap_backfill",
    language: "ja",
    generatedAt: bundle.generatedAt,
    baseSource: bundle.baseSource,
    official: {
      auditGeneratedAt: bundle.official.auditGeneratedAt,
      product: bundle.official.product,
      comparableCardCount: bundle.official.officialCardCount,
      addedCardCount: bundle.official.addedCardCount,
      cards: bundle.official.cards.map((card) => ({
        bundleCardId: card.bundleCardId,
        cardID: card.cardID,
        name: card.name,
        setCode: card.setCode,
        numerator: card.numerator ?? "UNNUMBERED",
        denominator: card.denominator,
        detailUrl: card.detailUrl,
      })),
    },
    series: bundle.series,
    set: bundle.set,
    cards: bundle.cards,
  };
}

export function parsePokemonJapaneseMPReconciledBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const transformed = compatibleBundle(bundle);
  const plan = parsePokemonJapaneseOfficialReconciledBundle({
    ...artifact,
    content: JSON.stringify(transformed),
    originalFilename: `${clean(bundle.series.id)}-${TARGET_SET_ID}.pokemon-ja-official-reconciled.bundle.json`,
  });
  const issues = plan.validation.issues;
  validateBundle(bundle, artifact, issues);

  const unnumberedIds = new Set(
    bundle.official.cards
      .filter((card) => card.unnumbered)
      .map((card) => clean(card.cardID)),
  );
  let materializedUnnumbered = 0;
  for (const card of plan.cards) {
    const notes = sourceNotes(card.sourceNotes);
    const officialCardId = clean(notes.officialCardId);
    if (!unnumberedIds.has(officialCardId)) continue;
    const variation = officialVariation(officialCardId);
    card.variation = variation;
    card.sourceNotes = JSON.stringify({
      ...notes,
      officialPrintedNumber: null,
      officialUnnumbered: true,
      officialVariation: variation,
      phase: "official_mp_reconciliation",
    });
    for (const identity of plan.identities) {
      if (identity.cardSourceKey === card.sourceKey) {
        identity.fingerprint = rebuildJapaneseFingerprint(identity.fingerprint, variation);
      }
    }
    materializedUnnumbered += 1;
  }
  if (materializedUnnumbered !== EXPECTED_UNNUMBERED_ADDITIONS) {
    issue(issues, "official_unnumbered_not_materialized", "error", `Materialized ${materializedUnnumbered} unnumbered M-P cards; expected ${EXPECTED_UNNUMBERED_ADDITIONS}.`);
  } else {
    issue(issues, "official_mp_reconciled", "warning", "Preserved 83 official-matched M-P cards and added 16 numbered plus 15 source-disambiguated unnumbered official cards.");
  }

  plan.adapterId = POKEMON_JAPANESE_MP_RECONCILED_ADAPTER_ID;
  plan.adapterVersion = POKEMON_JAPANESE_MP_RECONCILED_ADAPTER_VERSION;
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

function looksLikeMPBundle(artifact: ChecklistSourceArtifact) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content) as { schema?: unknown };
    return parsed?.schema === POKEMON_JAPANESE_MP_RECONCILED_SCHEMA;
  } catch {
    return false;
  }
}

export const pokemonJapaneseMPReconciledAdapter: ChecklistSourceAdapter = {
  id: POKEMON_JAPANESE_MP_RECONCILED_ADAPTER_ID,
  version: POKEMON_JAPANESE_MP_RECONCILED_ADAPTER_VERSION,
  supports: looksLikeMPBundle,
  parse: parsePokemonJapaneseMPReconciledBundle,
};

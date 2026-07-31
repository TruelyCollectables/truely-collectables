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

export const POKEMON_TCG_REPOSITORY_SCHEMA =
  "tcos.pokemonTcg.repositorySnapshot.v1" as const;
export const POKEMON_TCG_REPOSITORY_ADAPTER_ID =
  "pokemon-tcg-repository-snapshot" as const;
export const POKEMON_TCG_REPOSITORY_ADAPTER_VERSION = "1.0.0" as const;

export type PokemonTcgRepositorySet = {
  id: string;
  name: string;
  series?: string | null;
  printedTotal?: number | null;
  total?: number | null;
  releaseDate?: string | null;
  updatedAt?: string | null;
  ptcgoCode?: string | null;
  legalities?: Record<string, string>;
  images?: {
    symbol?: string | null;
    logo?: string | null;
  };
};

export type PokemonTcgRepositoryCard = {
  id: string;
  name: string;
  supertype?: string | null;
  subtypes?: string[];
  level?: string | null;
  hp?: string | null;
  types?: string[];
  evolvesFrom?: string | null;
  evolvesTo?: string[];
  number: string;
  artist?: string | null;
  rarity?: string | null;
  flavorText?: string | null;
  nationalPokedexNumbers?: number[];
  regulationMark?: string | null;
  legalities?: Record<string, string>;
  images?: {
    small?: string | null;
    large?: string | null;
  };
  set?: {
    id?: string | null;
    name?: string | null;
  };
  tcgplayer?: {
    url?: string | null;
    updatedAt?: string | null;
    prices?: Record<string, unknown>;
  };
  cardmarket?: {
    url?: string | null;
    updatedAt?: string | null;
  };
};

export type PokemonTcgRepositorySnapshot = {
  schema: typeof POKEMON_TCG_REPOSITORY_SCHEMA;
  scope: "full_set";
  repository: {
    owner: "PokemonTCG";
    name: "pokemon-tcg-data";
    ref?: string | null;
    setFile: string;
    cardFile: string;
  };
  set: PokemonTcgRepositorySet;
  cards: PokemonTcgRepositoryCard[];
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

function readJson(content: string | Uint8Array): unknown {
  const text =
    typeof content === "string"
      ? content
      : Buffer.from(content).toString("utf8");
  return JSON.parse(text);
}

function parseSnapshot(
  content: string | Uint8Array,
): PokemonTcgRepositorySnapshot {
  let parsed: unknown;
  try {
    parsed = readJson(content);
  } catch (error) {
    throw new Error(
      `Pokémon TCG repository snapshot is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Pokémon TCG repository snapshot must be an object");
  }

  const snapshot = parsed as Partial<PokemonTcgRepositorySnapshot>;
  if (snapshot.schema !== POKEMON_TCG_REPOSITORY_SCHEMA) {
    throw new Error(
      `Unsupported Pokémon TCG repository schema: ${String(snapshot.schema)}`,
    );
  }
  if (
    snapshot.scope !== "full_set" ||
    !snapshot.repository ||
    !snapshot.set ||
    !Array.isArray(snapshot.cards)
  ) {
    throw new Error(
      "Pokémon TCG repository snapshot requires repository, set, and full cards array",
    );
  }

  return snapshot as PokemonTcgRepositorySnapshot;
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

function releaseYear(releaseDate: string | null | undefined) {
  const match = clean(releaseDate).match(/^(\d{4})[/-]/);
  return match?.[1] || null;
}

function finishLabel(key: string) {
  const known: Record<string, string> = {
    normal: "Normal",
    holofoil: "Holofoil",
    reverseHolofoil: "Reverse Holofoil",
    firstEditionNormal: "1st Edition Normal",
    firstEditionHolofoil: "1st Edition Holofoil",
    unlimitedNormal: "Unlimited Normal",
    unlimitedHolofoil: "Unlimited Holofoil",
  };
  if (known[key]) return known[key];

  return clean(
    key
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " "),
  )
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function extractFinishes(card: PokemonTcgRepositoryCard) {
  return Object.keys(card.tcgplayer?.prices || {})
    .map(finishLabel)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function buildIdentity(params: {
  snapshot: PokemonTcgRepositorySnapshot;
  card: PokemonTcgRepositoryCard;
  variation: string | null;
  parallel?: string | null;
}): ChecklistIdentityInput {
  const setName = requireText(params.snapshot.set.name, "set.name");
  return {
    releaseYear: releaseYear(params.snapshot.set.releaseDate),
    manufacturer: "The Pokémon Company International",
    brand: "Pokémon TCG",
    product: setName,
    sport: "Trading Card Game",
    league: null,
    setName,
    cardNumber: params.card.number,
    players: [params.card.name],
    teams: [],
    parallel: params.parallel || null,
    variation: params.variation,
    autographStatus: "non-auto",
    memorabiliaStatus: "non-memorabilia",
  };
}

function isApprovedPokemonRepositoryUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const path = url.pathname.toLowerCase();
    return (
      (url.hostname === "github.com" ||
        url.hostname === "raw.githubusercontent.com") &&
      path.includes("/pokemontcg/pokemon-tcg-data")
    );
  } catch {
    return false;
  }
}

export function parsePokemonTcgRepositorySnapshot(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const snapshot = parseSnapshot(artifact.content);
  const issues: ChecklistImportValidationIssue[] = [];
  const setId = requireText(snapshot.set.id, "set.id");
  const setName = requireText(snapshot.set.name, "set.name");
  const year = releaseYear(snapshot.set.releaseDate);

  if (!year) {
    issue(
      issues,
      "release_year_missing",
      "error",
      `Set ${setName} does not have a parseable releaseDate`,
    );
  }

  if (
    artifact.authority === "approved_dataset" &&
    !isApprovedPokemonRepositoryUrl(artifact.sourceUrl)
  ) {
    issue(
      issues,
      "approved_dataset_domain_mismatch",
      "error",
      "Approved Pokémon TCG repository artifacts must originate from PokemonTCG/pokemon-tcg-data",
    );
  }

  if (
    snapshot.repository.owner !== "PokemonTCG" ||
    snapshot.repository.name !== "pokemon-tcg-data"
  ) {
    issue(
      issues,
      "repository_identity_mismatch",
      "error",
      "Snapshot repository identity must be PokemonTCG/pokemon-tcg-data",
    );
  }

  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: "pokemon-tcg",
    releaseSlug: `${setId}-${comparable(setName)}`,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  const setSourceKey = setId;
  const sets: ChecklistImportSet[] = [
    {
      sourceKey: setSourceKey,
      name: setName,
      normalizedName: comparable(setName),
      setType: "base",
      metadata: {
        pokemonTcgSetId: setId,
        series: clean(snapshot.set.series) || null,
        printedTotal: snapshot.set.printedTotal ?? null,
        total: snapshot.set.total ?? null,
        releaseDate: clean(snapshot.set.releaseDate) || null,
        updatedAt: clean(snapshot.set.updatedAt) || null,
        ptcgoCode: clean(snapshot.set.ptcgoCode) || null,
        legalities: snapshot.set.legalities || {},
        symbolImageUrl: clean(snapshot.set.images?.symbol) || null,
        logoImageUrl: clean(snapshot.set.images?.logo) || null,
      },
    },
  ];

  const numberCounts = new Map<string, number>();
  for (const card of snapshot.cards) {
    const number = comparable(card.number);
    if (!number) continue;
    numberCounts.set(number, (numberCounts.get(number) || 0) + 1);
  }

  const cards: ChecklistImportCard[] = [];
  const parallels: ChecklistImportParallel[] = [];
  const identities: ChecklistImportPlan["identities"] = [];
  const cardKeys = new Set<string>();
  const parallelKeys = new Set<string>();
  const fingerprints = new Set<string>();

  for (const [cardIndex, rawCard] of snapshot.cards.entries()) {
    const rowReference = `cards[${cardIndex}]`;
    const cardId = clean(rawCard.id);
    const name = clean(rawCard.name);
    const cardNumber = clean(rawCard.number).replace(/^#\s*/, "");

    if (!cardId || !name || !cardNumber) {
      issue(
        issues,
        "card_identity_incomplete",
        "error",
        "Every Pokémon card requires id, name, and number",
        rowReference,
      );
      continue;
    }

    if (cardKeys.has(cardId)) {
      issue(
        issues,
        "duplicate_card_id",
        "error",
        `Duplicate Pokémon TCG card id ${cardId}`,
        rowReference,
      );
      continue;
    }
    cardKeys.add(cardId);

    if (rawCard.set?.id && clean(rawCard.set.id) !== setId) {
      issue(
        issues,
        "embedded_set_mismatch",
        "error",
        `${cardId} references set ${rawCard.set.id}, expected ${setId}`,
        rowReference,
      );
    }

    const duplicateNumber = (numberCounts.get(comparable(cardNumber)) || 0) > 1;
    const variation = duplicateNumber ? `Dataset ID ${cardId}` : null;
    if (duplicateNumber) {
      issue(
        issues,
        "duplicate_card_number_disambiguated",
        "warning",
        `${setName} #${cardNumber} appears more than once; dataset id is preserved as the variation`,
        rowReference,
      );
    }

    const finishes = extractFinishes(rawCard);
    cards.push({
      sourceKey: cardId,
      setSourceKey,
      cardNumber,
      players: [name],
      teams: [],
      rookieDesignation: null,
      firstBowmanDesignation: null,
      autographStatus: "non-auto",
      memorabiliaStatus: "non-memorabilia",
      variation,
      sourceNotes: clean(rawCard.flavorText) || null,
      metadata: {
        pokemonTcgCardId: cardId,
        pokemonTcgSetId: setId,
        supertype: clean(rawCard.supertype) || null,
        subtypes: rawCard.subtypes || [],
        level: clean(rawCard.level) || null,
        hp: clean(rawCard.hp) || null,
        types: rawCard.types || [],
        evolvesFrom: clean(rawCard.evolvesFrom) || null,
        evolvesTo: rawCard.evolvesTo || [],
        artist: clean(rawCard.artist) || null,
        rarity: clean(rawCard.rarity) || null,
        nationalPokedexNumbers: rawCard.nationalPokedexNumbers || [],
        regulationMark: clean(rawCard.regulationMark) || null,
        legalities: rawCard.legalities || {},
        imageSmallUrl: clean(rawCard.images?.small) || null,
        imageLargeUrl: clean(rawCard.images?.large) || null,
        knownFinishes: finishes,
        tcgplayerUrl: clean(rawCard.tcgplayer?.url) || null,
        cardmarketUrl: clean(rawCard.cardmarket?.url) || null,
      },
    });

    const baseFingerprint = buildChecklistIdentityFingerprint(
      buildIdentity({ snapshot, card: rawCard, variation }),
    );
    if (fingerprints.has(baseFingerprint.fingerprintSha256)) {
      issue(
        issues,
        "duplicate_identity",
        "error",
        `Duplicate base identity for ${setName} #${cardNumber} ${name}`,
        rowReference,
      );
    } else {
      fingerprints.add(baseFingerprint.fingerprintSha256);
      identities.push({
        cardSourceKey: cardId,
        parallelSourceKey: null,
        fingerprint: baseFingerprint,
      });
    }

    for (const finish of finishes) {
      const parallelSourceKey = `${setSourceKey}:finish:${comparable(finish)}`;
      if (!parallelKeys.has(parallelSourceKey)) {
        parallelKeys.add(parallelSourceKey);
        parallels.push({
          sourceKey: parallelSourceKey,
          setSourceKey,
          name: finish,
          serialRun: null,
          configurationExclusivity: null,
          metadata: { source: "tcgplayer-price-key", pricingImported: false },
        });
      }

      const finishFingerprint = buildChecklistIdentityFingerprint(
        buildIdentity({ snapshot, card: rawCard, variation, parallel: finish }),
      );
      if (fingerprints.has(finishFingerprint.fingerprintSha256)) {
        issue(
          issues,
          "duplicate_identity",
          "error",
          `Duplicate ${finish} identity for ${setName} #${cardNumber} ${name}`,
          rowReference,
        );
        continue;
      }
      fingerprints.add(finishFingerprint.fingerprintSha256);
      identities.push({
        cardSourceKey: cardId,
        parallelSourceKey,
        fingerprint: finishFingerprint,
      });
    }
  }

  if (!cards.length) {
    issue(issues, "no_cards", "error", "No Pokémon cards were imported");
  }
  if (
    snapshot.set.total != null &&
    snapshot.set.total > 0 &&
    cards.length !== snapshot.set.total
  ) {
    issue(
      issues,
      "set_total_mismatch",
      "warning",
      `${setName} declares ${snapshot.set.total} cards but the snapshot contains ${cards.length}`,
    );
  }

  const hasErrors = issues.some((entry) => entry.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: POKEMON_TCG_REPOSITORY_ADAPTER_ID,
    adapterVersion: POKEMON_TCG_REPOSITORY_ADAPTER_VERSION,
    source: {
      sourceUrl: artifact.sourceUrl,
      retrievedAt: artifact.retrievedAt,
      authority: artifact.authority,
      redistributionAllowed: artifact.redistributionAllowed,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
      metadata: {
        repositoryOwner: snapshot.repository.owner,
        repositoryName: snapshot.repository.name,
        repositoryRef: clean(snapshot.repository.ref) || null,
        setFile: snapshot.repository.setFile,
        cardFile: snapshot.repository.cardFile,
      },
    },
    release: {
      manufacturer: "The Pokémon Company International",
      brand: "Pokémon TCG",
      product: setName,
      releaseYear: year,
      season: null,
      sport: "Trading Card Game",
      league: null,
      releaseSlug: `pokemon-tcg-${setId}-${comparable(setName)}`,
      metadata: {
        pokemonTcgSetId: setId,
        series: clean(snapshot.set.series) || null,
        printedTotal: snapshot.set.printedTotal ?? null,
        total: snapshot.set.total ?? null,
        releaseDate: clean(snapshot.set.releaseDate) || null,
        updatedAt: clean(snapshot.set.updatedAt) || null,
        setSymbolImageUrl: clean(snapshot.set.images?.symbol) || null,
        setLogoImageUrl: clean(snapshot.set.images?.logo) || null,
      },
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

export const pokemonTcgRepositorySnapshotAdapter: ChecklistSourceAdapter = {
  id: POKEMON_TCG_REPOSITORY_ADAPTER_ID,
  version: POKEMON_TCG_REPOSITORY_ADAPTER_VERSION,
  supports(artifact) {
    if (artifact.mimeType.toLowerCase() !== "application/json") return false;
    try {
      const parsed = readJson(artifact.content) as { schema?: unknown };
      return parsed?.schema === POKEMON_TCG_REPOSITORY_SCHEMA;
    } catch {
      return false;
    }
  },
  parse: parsePokemonTcgRepositorySnapshot,
};

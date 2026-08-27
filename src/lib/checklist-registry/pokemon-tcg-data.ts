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

export const POKEMON_TCG_DATA_BUNDLE_SCHEMA =
  "tcos.pokemonTcgData.setBundle.v1" as const;
export const POKEMON_TCG_DATA_ADAPTER_ID =
  "pokemon-tcg-data-set-bundle" as const;
export const POKEMON_TCG_DATA_ADAPTER_VERSION = "1.0.0" as const;

type PokemonTcgSet = {
  id: string;
  name: string;
  series: string;
  printedTotal?: number | null;
  total?: number | null;
  releaseDate: string;
  updatedAt?: string | null;
  ptcgoCode?: string | null;
  images?: { symbol?: string | null; logo?: string | null } | null;
};

type PokemonTcgCard = {
  id: string;
  name: string;
  supertype?: string | null;
  subtypes?: string[] | null;
  number: string;
  artist?: string | null;
  rarity?: string | null;
  legalities?: Record<string, string> | null;
  images?: { small?: string | null; large?: string | null } | null;
  set?: PokemonTcgSet | null;
  tcgplayer?: {
    prices?: Record<string, unknown> | null;
  } | null;
};

export type PokemonTcgDataSetBundle = {
  schema: typeof POKEMON_TCG_DATA_BUNDLE_SCHEMA;
  scope: "test_batch" | "full_set";
  language?: string | null;
  set: PokemonTcgSet;
  cards: PokemonTcgCard[];
};

const FINISH_LABELS: Record<string, string> = {
  normal: "Base",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  "1stEdition": "1st Edition",
  unlimited: "Unlimited",
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

function titleFromKey(value: string) {
  if (FINISH_LABELS[value]) return FINISH_LABELS[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function parseJson(content: string | Uint8Array): unknown {
  const text =
    typeof content === "string" ? content : Buffer.from(content).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Pokémon TCG Data bundle is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function extractBundle(parsed: unknown): PokemonTcgDataSetBundle {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Pokémon TCG Data imports require a set bundle built from sets/en.json and cards/en/<set-id>.json.",
    );
  }

  const candidate = parsed as Partial<PokemonTcgDataSetBundle>;
  if (candidate.schema === POKEMON_TCG_DATA_BUNDLE_SCHEMA) {
    if (!candidate.set || !Array.isArray(candidate.cards)) {
      throw new Error("Pokémon TCG Data bundle is missing set or cards");
    }
    return candidate as PokemonTcgDataSetBundle;
  }

  const apiResponse = parsed as {
    data?: PokemonTcgCard[];
  };
  if (Array.isArray(apiResponse.data) && apiResponse.data.length) {
    const embeddedSet = apiResponse.data.find((card) => card.set)?.set;
    if (!embeddedSet) {
      throw new Error(
        "Pokémon TCG API response does not contain embedded set metadata.",
      );
    }
    return {
      schema: POKEMON_TCG_DATA_BUNDLE_SCHEMA,
      scope: "full_set",
      language: "en",
      set: embeddedSet,
      cards: apiResponse.data,
    };
  }

  throw new Error(
    `Unsupported Pokémon TCG Data schema: ${String(candidate.schema)}`,
  );
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

function finishKeys(card: PokemonTcgCard) {
  const prices = card.tcgplayer?.prices;
  if (!prices || typeof prices !== "object") return [];
  return Object.keys(prices).filter(Boolean);
}

function releaseYearFromDate(value: string) {
  const match = clean(value).match(/^(\d{4})[/-]/);
  return match?.[1] || null;
}

function buildSourceNotes(
  bundle: PokemonTcgDataSetBundle,
  card: PokemonTcgCard,
  finishes: string[],
) {
  return JSON.stringify({
    source: "PokemonTCG/pokemon-tcg-data",
    sourceCardId: clean(card.id),
    sourceSetId: clean(bundle.set.id),
    series: clean(bundle.set.series),
    printedTotal: bundle.set.printedTotal ?? null,
    total: bundle.set.total ?? null,
    supertype: clean(card.supertype) || null,
    subtypes: (card.subtypes || []).map(clean).filter(Boolean),
    rarity: clean(card.rarity) || null,
    artist: clean(card.artist) || null,
    finishes,
    images: {
      small: clean(card.images?.small) || null,
      large: clean(card.images?.large) || null,
    },
    setImages: {
      symbol: clean(bundle.set.images?.symbol) || null,
      logo: clean(bundle.set.images?.logo) || null,
    },
    legalities: card.legalities || {},
  });
}

function buildIdentity(
  bundle: PokemonTcgDataSetBundle,
  card: PokemonTcgCard,
  finishKey: string | null,
): ChecklistIdentityInput {
  return {
    releaseYear: releaseYearFromDate(bundle.set.releaseDate),
    manufacturer: "The Pokémon Company International",
    brand: "Pokémon TCG",
    product: bundle.set.name,
    sport: "Trading Card Game",
    league: "Pokémon TCG",
    setName: bundle.set.name,
    cardNumber: card.number,
    players: [card.name],
    parallel:
      finishKey && finishKey !== "normal" ? titleFromKey(finishKey) : null,
    autographStatus: "non-auto",
    memorabiliaStatus: "non-memorabilia",
  };
}

export function parsePokemonTcgDataSetBundle(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const bundle = extractBundle(parseJson(artifact.content));
  const issues: ChecklistImportValidationIssue[] = [];

  const setId = requireText(bundle.set.id, "set.id");
  const setName = requireText(bundle.set.name, "set.name");
  requireText(bundle.set.series, "set.series");
  const releaseDate = requireText(bundle.set.releaseDate, "set.releaseDate");
  const releaseYear = releaseYearFromDate(releaseDate);
  const setSourceKey = `pokemon-set:${comparable(setId)}`;
  const releaseSlug = comparable(`pokemon-tcg-${setId}-${setName}`);

  if (!releaseYear) {
    issue(
      issues,
      "release_year_invalid",
      "error",
      `Pokémon set releaseDate must begin with a four-digit year: ${releaseDate}`,
    );
  }
  if (
    artifact.authority === "approved_distributor" &&
    !/^https:\/\/(github\.com|raw\.githubusercontent\.com)\/PokemonTCG\/pokemon-tcg-data\b/i.test(
      artifact.sourceUrl,
    )
  ) {
    issue(
      issues,
      "approved_source_domain_mismatch",
      "error",
      "Approved Pokémon TCG Data sources must originate from PokemonTCG/pokemon-tcg-data on GitHub.",
    );
  }
  if (artifact.redistributionAllowed) {
    issue(
      issues,
      "redistribution_review_required",
      "warning",
      "Keep original source files private until the repository license and image-use terms are recorded.",
    );
  }

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
  const parallelMap = new Map<string, ChecklistImportParallel>();
  const identities: ChecklistImportPlan["identities"] = [];
  const cardKeys = new Set<string>();
  const fingerprints = new Set<string>();

  for (const [cardIndex, rawCard] of bundle.cards.entries()) {
    const cardId = clean(rawCard.id);
    const cardName = clean(rawCard.name);
    const cardNumber = clean(rawCard.number).replace(/^#\s*/, "");
    const cardReference = `cards[${cardIndex}]`;

    if (!cardId || !cardName || !cardNumber) {
      issue(
        issues,
        "card_identity_incomplete",
        "error",
        "Pokémon cards require id, name, and number.",
        cardReference,
      );
      continue;
    }

    const cardSourceKey = `pokemon-card:${comparable(cardId)}`;
    if (cardKeys.has(cardSourceKey)) {
      issue(
        issues,
        "duplicate_card",
        "error",
        `Duplicate Pokémon source card ${cardId}`,
        cardReference,
      );
      continue;
    }
    cardKeys.add(cardSourceKey);

    const finishes = [...new Set(finishKeys(rawCard))];
    cards.push({
      sourceKey: cardSourceKey,
      setSourceKey,
      cardNumber,
      players: [cardName],
      teams: [],
      rookieDesignation: null,
      firstBowmanDesignation: null,
      autographStatus: "non-auto",
      memorabiliaStatus: "non-memorabilia",
      variation: null,
      sourceNotes: buildSourceNotes(bundle, rawCard, finishes),
    });

    for (const finishKey of finishes) {
      if (finishKey === "normal") continue;
      const name = titleFromKey(finishKey);
      const sourceKey = `${setSourceKey}:finish:${comparable(finishKey)}`;
      if (!parallelMap.has(sourceKey)) {
        parallelMap.set(sourceKey, {
          sourceKey,
          setSourceKey,
          name,
          serialRun: null,
          configurationExclusivity: null,
        });
      }
    }

    const identityFinishes = finishes.length ? finishes : [null];
    for (const finishKey of identityFinishes) {
      const fingerprint = buildChecklistIdentityFingerprint(
        buildIdentity(bundle, rawCard, finishKey),
      );
      if (fingerprints.has(fingerprint.fingerprintSha256)) {
        issue(
          issues,
          "duplicate_identity",
          "error",
          `Duplicate Pokémon identity for ${setName} #${cardNumber} ${cardName}`,
          cardReference,
        );
        continue;
      }
      fingerprints.add(fingerprint.fingerprintSha256);
      identities.push({
        cardSourceKey,
        parallelSourceKey:
          finishKey && finishKey !== "normal"
            ? `${setSourceKey}:finish:${comparable(finishKey)}`
            : null,
        fingerprint,
      });
    }
  }

  if (!bundle.cards.length) {
    issue(issues, "no_source_cards", "error", "Pokémon set bundle contains no cards");
  }
  if (!cards.length) {
    issue(issues, "no_cards", "error", "No valid Pokémon cards were imported");
  }
  if (
    Number.isInteger(bundle.set.total) &&
    bundle.scope === "full_set" &&
    Number(bundle.set.total) !== cards.length
  ) {
    issue(
      issues,
      "set_total_mismatch",
      "warning",
      `Source set total is ${bundle.set.total}, but the bundle contains ${cards.length} valid cards.`,
    );
  }
  if (bundle.scope === "test_batch") {
    issue(
      issues,
      "test_batch_only",
      "warning",
      "This Pokémon bundle proves the adapter workflow but is not a complete set.",
    );
  }

  const hasErrors = issues.some((entry) => entry.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: POKEMON_TCG_DATA_ADAPTER_ID,
    adapterVersion: POKEMON_TCG_DATA_ADAPTER_VERSION,
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
      manufacturer: "The Pokémon Company International",
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
    parallels: [...parallelMap.values()],
    identities,
    validation: {
      status: hasErrors ? "validation_required" : "passed",
      issues,
      counts: {
        sets: sets.length,
        cards: cards.length,
        parallels: parallelMap.size,
        identities: identities.length,
      },
    },
  };
}

function looksLikePokemonBundle(artifact: ChecklistSourceArtifact) {
  if (artifact.mimeType.toLowerCase() !== "application/json") return false;
  try {
    const parsed = parseJson(artifact.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const candidate = parsed as {
      schema?: unknown;
      data?: Array<{ set?: unknown }>;
    };
    return (
      candidate.schema === POKEMON_TCG_DATA_BUNDLE_SCHEMA ||
      Boolean(candidate.data?.some((card) => card?.set))
    );
  } catch {
    return false;
  }
}

export const pokemonTcgDataSetBundleAdapter: ChecklistSourceAdapter = {
  id: POKEMON_TCG_DATA_ADAPTER_ID,
  version: POKEMON_TCG_DATA_ADAPTER_VERSION,
  supports: looksLikePokemonBundle,
  parse: parsePokemonTcgDataSetBundle,
};

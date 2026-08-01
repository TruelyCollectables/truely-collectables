import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA,
  type PokemonJapaneseHistoricalCardEvidence,
  type PokemonJapaneseHistoricalReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-historical-reconciled";
import type { TcgdexJapaneseVariantEvidence } from "../src/lib/checklist-registry/tcgdex-japanese";

const SOURCE_REPOSITORY = "https://github.com/tcgdex/cards-database" as const;
const OUTPUT_SUFFIX = ".pokemon-ja-historical-reconciled.bundle.json";
const HISTORICAL_SCHEMA =
  "tcos.checklist.pokemonJapaneseHistoricalProductResolution.v1";
const ENERGY_SCHEMA =
  "tcos.checklist.pokemonJapaneseUnnumberedEnergyResolution.v1";
const HELD_VARIANT_SETS = new Set(["s10a", "s11a"]);

const DEFAULT_TARGETS = [
  "S4",
  "S4a",
  "S5I",
  "S5R",
  "S5a",
  "S6H",
  "S6K",
  "S6a",
  "S7D",
  "S7R",
  "S8",
  "S8a",
  "S8b",
  "S10D",
  "S10P",
  "S10b",
  "S11",
];

type Languages<T = string> = Partial<Record<string, T>>;
type TcgdexSet = {
  id?: string;
  name?: Languages;
  serie?: { id?: string; name?: Languages };
  cardCount?: { official?: number };
  releaseDate?: string | Languages;
};
type DetailedVariant = {
  type?: string;
  subtype?: string;
  size?: string;
  stamp?: string[];
  stamps?: string[];
  foil?: string;
  languages?: string[];
};
type LegacyVariants = {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
  jumbo?: boolean;
  preRelease?: boolean;
  wPromo?: boolean;
};
type TcgdexCard = {
  name?: Languages;
  category?: string;
  rarity?: string;
  illustrator?: string;
  regulationMark?: string;
  dexId?: number[];
  variants?: DetailedVariant[] | LegacyVariants;
};
type BuildReceiptRow = {
  setId: string | null;
  setName: string | null;
  seriesId: string | null;
  sourceSetPath: string;
  status: string;
  missingJapaneseCardNames: number;
};
type BuildReceipt = {
  schema: string;
  sourceCommit: string;
  rows: BuildReceiptRow[];
};
type SourceCard = {
  id: string;
  localId: string;
  normalizedLocalId: string;
  sourcePath: string;
  name: string | null;
  category: string | null;
  rarity: string | null;
  illustrator: string | null;
  regulationMark: string | null;
  dexId: number[];
  variants: TcgdexJapaneseVariantEvidence[];
};
type SourceSet = {
  setId: string;
  setName: string;
  seriesId: string;
  seriesName: string;
  releaseDate: string;
  sourceSetPath: string;
  sourceCards: SourceCard[];
};
type OfficialDetail = {
  cardID: string;
  url: string;
  name: string | null;
  setCode: string | null;
  numerator: string | null;
  denominator: string | null;
  normalizedLocalId: string | null;
  error?: string | null;
};
type HistoricalEvaluation = {
  valid: boolean;
  officialComparableCards: number;
  sourceMatchedCards: number;
  resolvedMissingNames: number;
  sourceOnlyLocalIds: string[];
  officialOnlyCards: OfficialDetail[];
  duplicateOfficialLocalIds: unknown[];
  unnumberedOfficialCards: OfficialDetail[];
  knownNameMismatches: unknown[];
  unresolvedMissingNames: unknown[];
  comparableOfficialCards: OfficialDetail[];
  detailFetchFailures: number;
};
type HistoricalRow = {
  setId: string;
  setName: string;
  status: string;
  sourceCardCount: number;
  missingJapaneseCardNames: number;
  selectedProducts: Array<{ value: string; label: string }>;
  selectedEvaluation: HistoricalEvaluation | null;
  error: string | null;
};
type HistoricalReceipt = {
  schema: typeof HISTORICAL_SCHEMA;
  generatedAt: string;
  sourceCommit: string;
  rows: HistoricalRow[];
};
type EnergyCrosswalk = {
  sourceLocalId: string;
  sourcePath: string;
  origin: "source_number_crosswalk" | "source_energy_alias";
  officialCardID: string;
  officialName: string;
  officialSetCode: string;
  officialNumerator: string | null;
  officialDenominator: string | null;
  officialUrl: string;
};
type EnergyAddition = {
  origin:
    | "official_numbered_addition"
    | "official_unnumbered_energy_addition";
  officialCardID: string;
  name: string;
  setCode: string;
  numerator: string | null;
  denominator: string | null;
  localId: string;
  variation: string | null;
  officialUrl: string;
};
type EnergyRow = {
  setId: string;
  setName: string;
  status: string;
  sourceCards: number;
  missingJapaneseCardNames: number;
  officialCards: number;
  sourceNumberMatches: number;
  sourceEnergyAliasMatches: number;
  numberedOfficialAdditions: number;
  unnumberedEnergyAdditions: number;
  product: { value: string; label: string; url?: string };
  sourceCrosswalk: EnergyCrosswalk[];
  officialAdditions: EnergyAddition[];
  detailFetchFailures: number;
  error: string | null;
};
type EnergyReceipt = {
  schema: typeof ENERGY_SCHEMA;
  generatedAt: string;
  sourceCommit: string;
  rows: EnergyRow[];
};
type NormalizedResolution = {
  schema: string;
  generatedAt: string;
  sourceCommit: string;
  setId: string;
  setName: string;
  product: { value: string; label: string; url: string };
  sourceCardCount: number;
  officialCardCount: number;
  sourceNumberCrosswalkCount: number;
  sourceEnergyAliasCount: number;
  numberedAddedCardCount: number;
  unnumberedAddedCardCount: number;
  evidence: Array<{
    origin:
      | "source_number_crosswalk"
      | "source_energy_alias"
      | "official_numbered_addition"
      | "official_unnumbered_energy_addition";
    sourceLocalId: string | null;
    sourcePath: string | null;
    cardID: string;
    name: string;
    setCode: string;
    numerator: string | null;
    denominator: string | null;
    detailUrl: string;
    localId: string;
    variation: string | null;
  }>;
};
type OutputRow = {
  setId: string;
  setName: string | null;
  status: "built" | "failed";
  resolutionSchema: string | null;
  sourceCards: number;
  sourceNumberCrosswalks: number;
  sourceEnergyAliases: number;
  numberedOfficialAdditions: number;
  unnumberedOfficialAdditions: number;
  officialCards: number;
  variantEvidence: number;
  outputFile: string | null;
  error: string | null;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/build-pokemon-japanese-historical-safe-bundles.ts <tcgdex-cards-database-directory> [output-directory] [options]",
      "",
      "Options:",
      "  --build-receipt <path>         Pinned TCGdex Japanese build receipt",
      "  --resolution-receipt <path>    Historical or energy receipt; repeatable; directories are recursive",
      "  --receipt <path>               Build receipt",
      "  --set <set-id>                 Build one safe set; repeatable",
      "  --continue-on-error            Continue after a failed set",
      "",
      "This command writes private local bundles and receipts only. It never writes to Registry or Production and never downloads official images.",
    ].join("\n"),
  );
}

function argumentValues(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}
function argumentValue(flag: string) {
  return argumentValues(flag)[0] || null;
}
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
function posixPath(value: string) {
  return value.split(sep).join("/");
}
function sourceCommit(repositoryRoot: string) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}
async function importDefault<T>(filePath: string): Promise<T> {
  const loaded = (await import(pathToFileURL(filePath).href)) as {
    default?: T;
  };
  if (!loaded.default) {
    throw new Error(`${filePath} does not export a default object.`);
  }
  return loaded.default;
}
function releaseDateJa(value: TcgdexSet["releaseDate"]) {
  if (typeof value === "string") return clean(value);
  return clean(value?.ja);
}
function normalizeDetailedVariant(
  value: DetailedVariant,
): TcgdexJapaneseVariantEvidence | null {
  const type = clean(value.type);
  if (!type) return null;
  const languages = Array.isArray(value.languages)
    ? value.languages.map(clean).filter(Boolean)
    : [];
  if (languages.length && !languages.includes("ja")) return null;
  return {
    type,
    subtype: clean(value.subtype) || null,
    size: clean(value.size) || null,
    stamps: [
      ...new Set(
        [...(value.stamp || []), ...(value.stamps || [])]
          .map(clean)
          .filter(Boolean),
      ),
    ],
    foil: clean(value.foil) || null,
    languages,
  };
}
function normalizeVariants(value: TcgdexCard["variants"]) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeDetailedVariant)
      .filter(
        (entry): entry is TcgdexJapaneseVariantEvidence => Boolean(entry),
      );
  }
  if (!value || typeof value !== "object") return [];
  const legacy = value as LegacyVariants;
  const variants: TcgdexJapaneseVariantEvidence[] = [];
  const add = (
    type: string,
    values: Partial<TcgdexJapaneseVariantEvidence> = {},
  ) => {
    variants.push({
      type,
      subtype: values.subtype || null,
      size: values.size || null,
      stamps: values.stamps || [],
      foil: values.foil || null,
      languages: values.languages || [],
    });
  };
  if (legacy.normal) add("normal");
  if (legacy.holo) add("holo");
  if (legacy.reverse) add("reverse");
  if (legacy.firstEdition) add("normal", { stamps: ["1st-edition"] });
  if (legacy.jumbo) add("normal", { size: "jumbo" });
  if (legacy.preRelease) add("normal", { stamps: ["pre-release"] });
  if (legacy.wPromo) add("normal", { stamps: ["w-promo"] });
  return variants;
}

async function loadSourceSet(params: {
  sourceDirectory: string;
  row: BuildReceiptRow;
}): Promise<SourceSet> {
  if (!params.row.setId || !params.row.setName || !params.row.seriesId) {
    throw new Error(`${params.row.sourceSetPath} lacks Japanese set identity.`);
  }
  const setFile = resolve(params.sourceDirectory, params.row.sourceSetPath);
  const cardDirectory = setFile.replace(/\.ts$/i, "");
  const set = await importDefault<TcgdexSet>(setFile);
  const setId = clean(set.id);
  const setName = clean(set.name?.ja);
  const seriesId = clean(set.serie?.id);
  const seriesName = clean(set.serie?.name?.ja);
  const releaseDate = releaseDateJa(set.releaseDate);
  if (!setId || !setName || !seriesId || !seriesName || !releaseDate) {
    throw new Error(
      `${params.row.sourceSetPath} lacks complete Japanese set metadata.`,
    );
  }
  const cardFiles = (await readdir(cardDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(cardDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const sourceCards: SourceCard[] = [];
  for (const cardFile of cardFiles) {
    const card = await importDefault<TcgdexCard>(cardFile);
    const localId = basename(cardFile, ".ts");
    sourceCards.push({
      id: `${setId}-${localId}`,
      localId,
      normalizedLocalId: normalizedLocalId(localId),
      sourcePath: posixPath(cardFile.slice(params.sourceDirectory.length + 1)),
      name: clean(card.name?.ja) || null,
      category: clean(card.category) || null,
      rarity: clean(card.rarity) || null,
      illustrator: clean(card.illustrator) || null,
      regulationMark: clean(card.regulationMark) || null,
      dexId: Array.isArray(card.dexId)
        ? card.dexId.filter(Number.isInteger)
        : [],
      variants: normalizeVariants(card.variants),
    });
  }
  if (!sourceCards.length) {
    throw new Error(`${setId} has no source card files.`);
  }
  return {
    setId,
    setName,
    seriesId,
    seriesName,
    releaseDate,
    sourceSetPath: params.row.sourceSetPath,
    sourceCards,
  };
}

function productUrl(product: { value: string }) {
  return (
    "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=" +
    encodeURIComponent(clean(product.value))
  );
}
function officialVariation(cardID: string) {
  return `Official Card ${clean(cardID)}`;
}
function cardSortKey(card: { localId: string; id?: string }) {
  const normalized = normalizedLocalId(card.localId);
  if (/^\d+$/.test(normalized)) {
    return `0:${String(Number(normalized)).padStart(8, "0")}`;
  }
  if (normalized === "UNNUMBERED") return `2:${clean(card.id)}`;
  return `1:${normalized}`;
}
function completeOfficialDetail(
  detail: OfficialDetail,
  setId: string,
): asserts detail is OfficialDetail & {
  name: string;
  setCode: string;
} {
  if (
    !clean(detail.cardID) ||
    !clean(detail.name) ||
    !clean(detail.setCode) ||
    !/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(
      clean(detail.url),
    ) ||
    detail.error
  ) {
    throw new Error(`${setId} contains incomplete official detail evidence.`);
  }
  if (clean(detail.setCode).toLowerCase() !== setId.toLowerCase()) {
    throw new Error(
      `${setId} official card ${detail.cardID} reports set ${detail.setCode}.`,
    );
  }
}

function normalizeHistoricalReceipt(receipt: HistoricalReceipt) {
  const resolutions: NormalizedResolution[] = [];
  for (const row of receipt.rows) {
    if (row.status !== "resolved_single_product") continue;
    if (
      row.error ||
      !row.selectedEvaluation ||
      !row.selectedEvaluation.valid ||
      row.selectedProducts.length !== 1 ||
      row.selectedEvaluation.detailFetchFailures !== 0 ||
      row.selectedEvaluation.sourceOnlyLocalIds.length !== 0 ||
      row.selectedEvaluation.duplicateOfficialLocalIds.length !== 0 ||
      row.selectedEvaluation.unnumberedOfficialCards.length !== 0 ||
      row.selectedEvaluation.knownNameMismatches.length !== 0 ||
      row.selectedEvaluation.unresolvedMissingNames.length !== 0 ||
      row.selectedEvaluation.sourceMatchedCards !== row.sourceCardCount ||
      row.selectedEvaluation.resolvedMissingNames !==
        row.missingJapaneseCardNames
    ) {
      throw new Error(`${row.setId} historical resolution is not bundle-safe.`);
    }
    const product = row.selectedProducts[0];
    resolutions.push({
      schema: receipt.schema,
      generatedAt: receipt.generatedAt,
      sourceCommit: receipt.sourceCommit,
      setId: row.setId,
      setName: row.setName,
      product: {
        value: clean(product.value),
        label: clean(product.label),
        url: productUrl(product),
      },
      sourceCardCount: row.sourceCardCount,
      officialCardCount: row.selectedEvaluation.officialComparableCards,
      sourceNumberCrosswalkCount: row.sourceCardCount,
      sourceEnergyAliasCount: 0,
      numberedAddedCardCount:
        row.selectedEvaluation.officialOnlyCards.length,
      unnumberedAddedCardCount: 0,
      evidence: row.selectedEvaluation.comparableOfficialCards.map(
        (detail) => {
          completeOfficialDetail(detail, row.setId);
          return {
            origin: "official_numbered_addition" as const,
            sourceLocalId: null,
            sourcePath: null,
            cardID: clean(detail.cardID),
            name: clean(detail.name),
            setCode: clean(detail.setCode),
            numerator: clean(detail.numerator) || null,
            denominator: clean(detail.denominator) || null,
            detailUrl: clean(detail.url),
            localId: clean(detail.numerator),
            variation: null,
          };
        },
      ),
    });
  }
  return resolutions;
}

function normalizeEnergyReceipt(receipt: EnergyReceipt) {
  const resolutions: NormalizedResolution[] = [];
  for (const row of receipt.rows) {
    if (row.status !== "resolved") continue;
    if (
      row.error ||
      row.detailFetchFailures !== 0 ||
      row.sourceCrosswalk.length !== row.sourceCards ||
      row.sourceNumberMatches + row.sourceEnergyAliasMatches !==
        row.sourceCards ||
      row.officialAdditions.length !==
        row.numberedOfficialAdditions + row.unnumberedEnergyAdditions
    ) {
      throw new Error(`${row.setId} energy resolution is not bundle-safe.`);
    }
    const evidence: NormalizedResolution["evidence"] = [
      ...row.sourceCrosswalk.map((entry) => ({
        origin: entry.origin,
        sourceLocalId: clean(entry.sourceLocalId),
        sourcePath: clean(entry.sourcePath),
        cardID: clean(entry.officialCardID),
        name: clean(entry.officialName),
        setCode: clean(entry.officialSetCode),
        numerator: clean(entry.officialNumerator) || null,
        denominator: clean(entry.officialDenominator) || null,
        detailUrl: clean(entry.officialUrl),
        localId: clean(entry.sourceLocalId),
        variation: null,
      })),
      ...row.officialAdditions.map((entry) => ({
        origin: entry.origin,
        sourceLocalId: null,
        sourcePath: null,
        cardID: clean(entry.officialCardID),
        name: clean(entry.name),
        setCode: clean(entry.setCode),
        numerator: clean(entry.numerator) || null,
        denominator: clean(entry.denominator) || null,
        detailUrl: clean(entry.officialUrl),
        localId: clean(entry.localId),
        variation: clean(entry.variation) || null,
      })),
    ];
    resolutions.push({
      schema: receipt.schema,
      generatedAt: receipt.generatedAt,
      sourceCommit: receipt.sourceCommit,
      setId: row.setId,
      setName: row.setName,
      product: {
        value: clean(row.product.value),
        label: clean(row.product.label),
        url: clean(row.product.url) || productUrl(row.product),
      },
      sourceCardCount: row.sourceCards,
      officialCardCount: row.officialCards,
      sourceNumberCrosswalkCount: row.sourceNumberMatches,
      sourceEnergyAliasCount: row.sourceEnergyAliasMatches,
      numberedAddedCardCount: row.numberedOfficialAdditions,
      unnumberedAddedCardCount: row.unnumberedEnergyAdditions,
      evidence,
    });
  }
  return resolutions;
}

async function collectJsonFiles(inputPath: string): Promise<string[]> {
  const resolved = resolve(inputPath);
  const inputStat = await stat(resolved);
  if (inputStat.isFile()) return [resolved];
  if (!inputStat.isDirectory()) return [];
  const files: string[] = [];
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    const child = join(resolved, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonFiles(child)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(child);
  }
  return files;
}

async function loadResolutions(paths: string[]) {
  const bySet = new Map<string, NormalizedResolution>();
  const files = (
    await Promise.all(paths.map((entry) => collectJsonFiles(entry)))
  ).flat();
  for (const file of files) {
    let parsed: HistoricalReceipt | EnergyReceipt;
    try {
      parsed = JSON.parse(await readFile(file, "utf8")) as
        | HistoricalReceipt
        | EnergyReceipt;
    } catch {
      continue;
    }
    const resolutions =
      parsed.schema === HISTORICAL_SCHEMA
        ? normalizeHistoricalReceipt(parsed as HistoricalReceipt)
        : parsed.schema === ENERGY_SCHEMA
          ? normalizeEnergyReceipt(parsed as EnergyReceipt)
          : [];
    for (const resolution of resolutions) {
      const key = clean(resolution.setId).toLowerCase();
      const existing = bySet.get(key);
      if (existing) {
        throw new Error(
          `${resolution.setId} appears in both ${existing.schema} and ${resolution.schema} resolution evidence.`,
        );
      }
      bySet.set(key, resolution);
    }
  }
  return bySet;
}

function buildBundle(params: {
  source: SourceSet;
  resolution: NormalizedResolution;
  sourceCommit: string;
}) {
  const { source, resolution } = params;
  if (HELD_VARIANT_SETS.has(source.setId.toLowerCase())) {
    throw new Error(`${source.setId} is held for physical-variant review.`);
  }
  if (
    source.sourceCards.length !== resolution.sourceCardCount ||
    source.sourceCards.some((card) => card.name)
  ) {
    throw new Error(
      `${source.setId} source population or missing-name state changed after resolution.`,
    );
  }
  if (
    resolution.sourceCardCount +
      resolution.numberedAddedCardCount +
      resolution.unnumberedAddedCardCount !==
    resolution.officialCardCount
  ) {
    throw new Error(`${source.setId} resolution counts do not reconcile.`);
  }

  const sourceByLocalId = new Map(
    source.sourceCards.map((card) => [card.normalizedLocalId, card]),
  );
  if (sourceByLocalId.size !== source.sourceCards.length) {
    throw new Error(`${source.setId} repeats normalized TCGdex local IDs.`);
  }
  const evidenceBySourceLocalId = new Map<string, NormalizedResolution["evidence"][number]>();
  const officialCardIds = new Set<string>();
  for (const entry of resolution.evidence) {
    if (
      !clean(entry.cardID) ||
      !clean(entry.name) ||
      clean(entry.setCode).toLowerCase() !== source.setId.toLowerCase() ||
      !/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(
        clean(entry.detailUrl),
      ) ||
      officialCardIds.has(clean(entry.cardID))
    ) {
      throw new Error(`${source.setId} contains invalid or duplicate official evidence.`);
    }
    officialCardIds.add(clean(entry.cardID));
    if (entry.origin.startsWith("source_")) {
      const key = normalizedLocalId(entry.sourceLocalId);
      if (!key || evidenceBySourceLocalId.has(key)) {
        throw new Error(`${source.setId} repeats source crosswalk ${key}.`);
      }
      evidenceBySourceLocalId.set(key, entry);
    }
  }
  if (
    evidenceBySourceLocalId.size !== source.sourceCards.length ||
    resolution.evidence.length !== resolution.officialCardCount
  ) {
    throw new Error(`${source.setId} resolution evidence is incomplete.`);
  }

  const cards: PokemonJapaneseHistoricalReconciledBundle["cards"] = [];
  const evidence: PokemonJapaneseHistoricalCardEvidence[] = [];
  for (const sourceCard of source.sourceCards) {
    const row = evidenceBySourceLocalId.get(sourceCard.normalizedLocalId);
    if (!row) {
      throw new Error(
        `${source.setId} source card ${sourceCard.localId} lacks resolved official evidence.`,
      );
    }
    if (
      clean(row.sourcePath) !== sourceCard.sourcePath ||
      clean(row.localId) !== sourceCard.localId
    ) {
      throw new Error(
        `${source.setId} source card ${sourceCard.localId} path or local ID drifted.`,
      );
    }
    if (
      row.origin === "source_number_crosswalk" &&
      normalizedLocalId(row.numerator) !== sourceCard.normalizedLocalId
    ) {
      throw new Error(
        `${source.setId} source card ${sourceCard.localId} printed number does not match official evidence.`,
      );
    }
    if (
      row.origin === "source_energy_alias" &&
      (row.numerator !== null || !/エネルギー$/u.test(row.name))
    ) {
      throw new Error(
        `${source.setId} source card ${sourceCard.localId} is not a proved unnumbered energy alias.`,
      );
    }
    cards.push({
      id: sourceCard.id,
      localId: sourceCard.localId,
      name: row.name,
      category: sourceCard.category,
      rarity: sourceCard.rarity,
      illustrator: sourceCard.illustrator,
      regulationMark: sourceCard.regulationMark,
      dexId: sourceCard.dexId,
      variants: sourceCard.variants,
      sourcePath: sourceCard.sourcePath,
    });
    evidence.push({
      bundleCardId: sourceCard.id,
      cardID: row.cardID,
      name: row.name,
      setCode: row.setCode,
      numerator: row.numerator,
      denominator: row.denominator,
      detailUrl: row.detailUrl,
      origin: row.origin,
      sourcePath: sourceCard.sourcePath,
      sourceLocalId: sourceCard.localId,
      variation: null,
    });
  }

  for (const row of resolution.evidence.filter((entry) =>
    entry.origin.startsWith("official_"),
  )) {
    const bundleCardId = `pokemon-card-${source.setId}-${row.cardID}`;
    const unnumbered =
      row.origin === "official_unnumbered_energy_addition";
    const variation = unnumbered ? officialVariation(row.cardID) : null;
    if (
      (unnumbered &&
        (row.numerator !== null ||
          clean(row.localId) !== "UNNUMBERED" ||
          clean(row.variation) !== variation)) ||
      (!unnumbered &&
        (!clean(row.numerator) ||
          clean(row.localId) !== clean(row.numerator) ||
          clean(row.variation)))
    ) {
      throw new Error(
        `${source.setId} official addition ${row.cardID} has invalid numbered or unnumbered identity evidence.`,
      );
    }
    cards.push({
      id: bundleCardId,
      localId: unnumbered ? "UNNUMBERED" : clean(row.numerator),
      name: row.name,
      category: null,
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
      sourcePath: null,
    });
    evidence.push({
      bundleCardId,
      cardID: row.cardID,
      name: row.name,
      setCode: row.setCode,
      numerator: row.numerator,
      denominator: row.denominator,
      detailUrl: row.detailUrl,
      origin: row.origin,
      sourcePath: null,
      sourceLocalId: null,
      variation,
    });
  }

  cards.sort((left, right) =>
    cardSortKey(left).localeCompare(cardSortKey(right)),
  );
  evidence.sort((left, right) => {
    const leftCard = cards.find((card) => card.id === left.bundleCardId);
    const rightCard = cards.find((card) => card.id === right.bundleCardId);
    return cardSortKey(leftCard || { localId: "" }).localeCompare(
      cardSortKey(rightCard || { localId: "" }),
    );
  });
  if (
    cards.length !== resolution.officialCardCount ||
    evidence.length !== resolution.officialCardCount
  ) {
    throw new Error(
      `${source.setId} built ${cards.length} cards and ${evidence.length} evidence rows; expected ${resolution.officialCardCount}.`,
    );
  }

  const bundle: PokemonJapaneseHistoricalReconciledBundle = {
    schema: POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA,
    phase: "official_historical_backfill",
    language: "ja",
    generatedAt: new Date().toISOString(),
    baseSource: {
      repository: SOURCE_REPOSITORY,
      commit: params.sourceCommit,
      setSourcePath: source.sourceSetPath,
      sourceCardCount: source.sourceCards.length,
    },
    official: {
      resolutionGeneratedAt: resolution.generatedAt,
      resolutionSchema: resolution.schema,
      product: resolution.product,
      officialCardCount: resolution.officialCardCount,
      sourceNumberCrosswalkCount:
        resolution.sourceNumberCrosswalkCount,
      sourceEnergyAliasCount: resolution.sourceEnergyAliasCount,
      numberedAddedCardCount: resolution.numberedAddedCardCount,
      unnumberedAddedCardCount: resolution.unnumberedAddedCardCount,
      cards: evidence,
    },
    series: { id: source.seriesId, name: source.seriesName },
    set: {
      id: source.setId,
      name: source.setName,
      officialCardCount: resolution.officialCardCount,
      releaseDate: source.releaseDate,
      sourcePath: source.sourceSetPath,
    },
    cards,
  };
  return bundle;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const sourceArgument = process.argv[2];
  if (!sourceArgument || sourceArgument.startsWith("--")) {
    usage();
    process.exitCode = 1;
    return;
  }
  const sourceDirectory = resolve(sourceArgument);
  const outputDirectory = resolve(
    process.argv[3] && !process.argv[3].startsWith("--")
      ? process.argv[3]
      : ".codex-run/pokemon-ja-historical-safe-bundles",
  );
  const buildReceiptPath = resolve(
    argumentValue("--build-receipt") ||
      ".codex-run/tcgdex-ja-build-receipt.json",
  );
  const resolutionPaths = argumentValues("--resolution-receipt");
  if (!resolutionPaths.length) {
    resolutionPaths.push(".codex-run/pokemon-ja-phase4c-resolutions");
  }
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-historical-safe-build-receipt.json",
  );
  const requested = argumentValues("--set");
  const targets = (requested.length ? requested : DEFAULT_TARGETS)
    .map(clean)
    .filter(Boolean);
  const continueOnError = process.argv.includes("--continue-on-error");

  const buildReceipt = JSON.parse(
    await readFile(buildReceiptPath, "utf8"),
  ) as BuildReceipt;
  if (buildReceipt.schema !== "tcos.checklist.tcgdexJapaneseBuildReceipt.v1") {
    throw new Error("Unsupported Japanese build receipt schema.");
  }
  const commit = sourceCommit(sourceDirectory);
  if (
    commit !== "unknown" &&
    commit !== buildReceipt.sourceCommit
  ) {
    throw new Error(
      `TCGdex source drift: build ${buildReceipt.sourceCommit}, checkout ${commit}.`,
    );
  }
  const resolutions = await loadResolutions(resolutionPaths);
  await mkdir(outputDirectory, { recursive: true });

  const rows: OutputRow[] = [];
  for (const setId of targets) {
    const key = setId.toLowerCase();
    const buildRow = buildReceipt.rows.find(
      (row) => clean(row.setId).toLowerCase() === key,
    );
    const resolution = resolutions.get(key);
    try {
      if (HELD_VARIANT_SETS.has(key)) {
        throw new Error(`${setId} is held for physical-variant review.`);
      }
      if (!buildRow || buildRow.status !== "incomplete_japanese") {
        throw new Error(`${setId} is not an incomplete Japanese source set.`);
      }
      if (!resolution) {
        throw new Error(`${setId} has no safe Phase 4C resolution receipt.`);
      }
      if (resolution.sourceCommit !== buildReceipt.sourceCommit) {
        throw new Error(`${setId} resolution source commit drifted.`);
      }
      const source = await loadSourceSet({
        sourceDirectory,
        row: buildRow,
      });
      const bundle = buildBundle({
        source,
        resolution,
        sourceCommit: buildReceipt.sourceCommit,
      });
      const outputFile = join(
        outputDirectory,
        `${bundle.series.id}-${bundle.set.id}${OUTPUT_SUFFIX}`,
      );
      await writeFile(
        outputFile,
        `${JSON.stringify(bundle, null, 2)}\n`,
        "utf8",
      );
      rows.push({
        setId: bundle.set.id,
        setName: bundle.set.name,
        status: "built",
        resolutionSchema: bundle.official.resolutionSchema,
        sourceCards: bundle.baseSource.sourceCardCount,
        sourceNumberCrosswalks:
          bundle.official.sourceNumberCrosswalkCount,
        sourceEnergyAliases: bundle.official.sourceEnergyAliasCount,
        numberedOfficialAdditions:
          bundle.official.numberedAddedCardCount,
        unnumberedOfficialAdditions:
          bundle.official.unnumberedAddedCardCount,
        officialCards: bundle.official.officialCardCount,
        variantEvidence: bundle.cards.reduce(
          (sum, card) => sum + (card.variants?.length || 0),
          0,
        ),
        outputFile,
        error: null,
      });
    } catch (error) {
      rows.push({
        setId,
        setName: resolution?.setName || buildRow?.setName || null,
        status: "failed",
        resolutionSchema: resolution?.schema || null,
        sourceCards: 0,
        sourceNumberCrosswalks: 0,
        sourceEnergyAliases: 0,
        numberedOfficialAdditions: 0,
        unnumberedOfficialAdditions: 0,
        officialCards: 0,
        variantEvidence: 0,
        outputFile: null,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!continueOnError) break;
    }
  }

  const failed = rows.filter((row) => row.status === "failed");
  const receipt = {
    schema:
      "tcos.checklist.pokemonJapaneseHistoricalSafeBundleBuildReceipt.v1",
    generatedAt: new Date().toISOString(),
    sourceDirectory,
    sourceCommit: buildReceipt.sourceCommit,
    buildReceipt: buildReceiptPath,
    resolutionReceipts: resolutionPaths.map(resolve),
    outputDirectory,
    requestedSets: targets,
    attemptedSets: rows.length,
    successfulSets: rows.length - failed.length,
    failedSets: failed.length,
    totals: rows.reduce(
      (sum, row) => {
        sum.sourceCards += row.sourceCards;
        sum.sourceNumberCrosswalks += row.sourceNumberCrosswalks;
        sum.sourceEnergyAliases += row.sourceEnergyAliases;
        sum.numberedOfficialAdditions += row.numberedOfficialAdditions;
        sum.unnumberedOfficialAdditions +=
          row.unnumberedOfficialAdditions;
        sum.officialCards += row.officialCards;
        sum.variantEvidence += row.variantEvidence;
        return sum;
      },
      {
        sourceCards: 0,
        sourceNumberCrosswalks: 0,
        sourceEnergyAliases: 0,
        numberedOfficialAdditions: 0,
        unnumberedOfficialAdditions: 0,
        officialCards: 0,
        variantEvidence: 0,
      },
    ),
    rows,
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

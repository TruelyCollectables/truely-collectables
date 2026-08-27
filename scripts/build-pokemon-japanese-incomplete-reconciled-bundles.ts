import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA,
  type PokemonJapaneseIncompleteCardEvidence,
  type PokemonJapaneseIncompleteReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-incomplete-reconciled";
import type { TcgdexJapaneseVariantEvidence } from "../src/lib/checklist-registry/tcgdex-japanese";

const SOURCE_REPOSITORY = "https://github.com/tcgdex/cards-database" as const;
const OUTPUT_SUFFIX = ".pokemon-ja-incomplete-reconciled.bundle.json";
const DEFAULT_TARGETS = ["SV5M", "SV6", "SV6a"];

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
type InventoryEvidenceCard = {
  cardID: string;
  name: string | null;
  setCode: string | null;
  numerator: string | null;
  denominator: string | null;
  normalizedLocalId: string | null;
  url: string;
};
type InventoryProduct = {
  value: string;
  label: string;
};
type InventoryRow = {
  setId: string;
  setName: string;
  status: string;
  sourceCardCount: number;
  missingJapaneseCardNames: number;
  officialProduct: InventoryProduct | null;
  officialComparableCards: number | null;
  detailFetchFailures: number;
  comparableOfficialCards: InventoryEvidenceCard[];
  officialOnlyCards: InventoryEvidenceCard[];
  sourceOnlyLocalIds: string[];
  unresolvedMissingNames: unknown[];
  knownNameMismatches: unknown[];
  duplicateOfficialLocalIds: unknown[];
  unnumberedOfficialCards: unknown[];
};
type InventoryReceipt = {
  schema: string;
  generatedAt: string;
  sourceCommit: string;
  rows: InventoryRow[];
};
type OutputRow = {
  setId: string;
  setName: string | null;
  status: "built" | "failed";
  sourceCards: number;
  preservedNamedCards: number;
  nameBackfilledCards: number;
  addedOfficialCards: number;
  officialCards: number;
  variantEvidence: number;
  outputFile: string | null;
  error: string | null;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/build-pokemon-japanese-incomplete-reconciled-bundles.ts <tcgdex-cards-database-directory> [output-directory] [options]",
      "",
      "Options:",
      "  --build-receipt <path>     Pinned TCGdex Japanese build receipt",
      "  --inventory-receipt <path> Phase 4A official inventory receipt",
      "  --receipt <path>           Build receipt",
      "  --set <set-id>             Build one ready set; repeatable",
      "  --continue-on-error        Continue after a failed set",
      "",
      "This command only writes private local bundles and receipts. It never writes to Registry or Production and never downloads official images.",
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
    throw new Error(`${params.row.sourceSetPath} lacks complete Japanese set metadata.`);
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
  if (sourceCards.length === 0) {
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

function productUrl(product: InventoryProduct) {
  return (
    "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=" +
    encodeURIComponent(clean(product.value))
  );
}

function cardSortKey(value: string) {
  const normalized = normalizedLocalId(value);
  return /^\d+$/.test(normalized)
    ? `0:${String(Number(normalized)).padStart(8, "0")}`
    : `1:${normalized}`;
}

function completeEvidence(
  row: InventoryEvidenceCard,
  setId: string,
): asserts row is InventoryEvidenceCard & {
  name: string;
  setCode: string;
  numerator: string;
  normalizedLocalId: string;
} {
  if (
    !clean(row.cardID) ||
    !clean(row.name) ||
    !clean(row.setCode) ||
    !clean(row.numerator) ||
    !clean(row.normalizedLocalId) ||
    !/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(clean(row.url))
  ) {
    throw new Error(`${setId} has incomplete official card evidence.`);
  }
  if (clean(row.setCode).toLowerCase() !== setId.toLowerCase()) {
    throw new Error(
      `${setId} official card ${row.cardID} reports set ${row.setCode}.`,
    );
  }
}

function buildBundle(params: {
  source: SourceSet;
  inventory: InventoryRow;
  inventoryGeneratedAt: string;
  sourceCommit: string;
}) {
  const { source, inventory } = params;
  if (inventory.status !== "ready_for_card_backfill_proposal") {
    throw new Error(`${source.setId} is not a ready card-backfill proposal.`);
  }
  if (!inventory.officialProduct) {
    throw new Error(`${source.setId} has no resolved official product.`);
  }
  if (
    inventory.detailFetchFailures !== 0 ||
    inventory.unresolvedMissingNames.length !== 0 ||
    inventory.knownNameMismatches.length !== 0 ||
    inventory.sourceOnlyLocalIds.length !== 0 ||
    inventory.duplicateOfficialLocalIds.length !== 0 ||
    inventory.unnumberedOfficialCards.length !== 0
  ) {
    throw new Error(`${source.setId} inventory contains blocking discrepancies.`);
  }
  if (source.sourceCards.length !== inventory.sourceCardCount) {
    throw new Error(
      `${source.setId} source drift: ${source.sourceCards.length}/${inventory.sourceCardCount} cards.`,
    );
  }
  const expectedOfficial = Number(inventory.officialComparableCards);
  if (!Number.isInteger(expectedOfficial) || expectedOfficial <= 0) {
    throw new Error(`${source.setId} has no valid official population count.`);
  }
  if (inventory.comparableOfficialCards.length !== expectedOfficial) {
    throw new Error(
      `${source.setId} inventory evidences ${inventory.comparableOfficialCards.length}/${expectedOfficial} official cards.`,
    );
  }

  const officialByLocalId = new Map<string, InventoryEvidenceCard>();
  for (const evidence of inventory.comparableOfficialCards) {
    completeEvidence(evidence, source.setId);
    const key = normalizedLocalId(evidence.normalizedLocalId);
    if (officialByLocalId.has(key)) {
      throw new Error(`${source.setId} repeats official printed number ${key}.`);
    }
    officialByLocalId.set(key, evidence);
  }

  const cards: PokemonJapaneseIncompleteReconciledBundle["cards"] = [];
  const evidenceRows: PokemonJapaneseIncompleteCardEvidence[] = [];
  const sourceLocalIds = new Set<string>();
  let preservedNamedCardCount = 0;
  let nameBackfilledCardCount = 0;

  for (const sourceCard of source.sourceCards) {
    const key = sourceCard.normalizedLocalId;
    if (sourceLocalIds.has(key)) {
      throw new Error(`${source.setId} repeats source printed number ${sourceCard.localId}.`);
    }
    sourceLocalIds.add(key);
    const official = officialByLocalId.get(key);
    if (!official) {
      throw new Error(
        `${source.setId} source card ${sourceCard.localId} lacks official printed-number evidence.`,
      );
    }
    completeEvidence(official, source.setId);
    const officialName = clean(official.name);
    const origin = sourceCard.name
      ? "source_preserved_name"
      : "source_name_backfill";
    if (sourceCard.name && clean(sourceCard.name) !== officialName) {
      throw new Error(
        `${source.setId} card ${sourceCard.localId} name differs: ${sourceCard.name} / ${officialName}.`,
      );
    }
    if (origin === "source_preserved_name") preservedNamedCardCount += 1;
    else nameBackfilledCardCount += 1;

    cards.push({
      id: sourceCard.id,
      localId: sourceCard.localId,
      name: officialName,
      category: sourceCard.category,
      rarity: sourceCard.rarity,
      illustrator: sourceCard.illustrator,
      regulationMark: sourceCard.regulationMark,
      dexId: sourceCard.dexId,
      variants: sourceCard.variants,
      sourcePath: sourceCard.sourcePath,
    });
    evidenceRows.push({
      bundleCardId: sourceCard.id,
      cardID: clean(official.cardID),
      name: officialName,
      setCode: clean(official.setCode),
      numerator: clean(official.numerator),
      denominator: clean(official.denominator) || null,
      detailUrl: clean(official.url),
      origin,
      sourcePath: sourceCard.sourcePath,
    });
  }

  let addedCardCount = 0;
  for (const official of inventory.comparableOfficialCards) {
    completeEvidence(official, source.setId);
    const key = normalizedLocalId(official.normalizedLocalId);
    if (sourceLocalIds.has(key)) continue;
    const bundleCardId = `pokemon-card-${source.setId}-${clean(official.cardID)}`;
    cards.push({
      id: bundleCardId,
      localId: clean(official.numerator),
      name: clean(official.name),
      category: null,
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
      sourcePath: null,
    });
    evidenceRows.push({
      bundleCardId,
      cardID: clean(official.cardID),
      name: clean(official.name),
      setCode: clean(official.setCode),
      numerator: clean(official.numerator),
      denominator: clean(official.denominator) || null,
      detailUrl: clean(official.url),
      origin: "official_only_addition",
      sourcePath: null,
    });
    addedCardCount += 1;
  }

  const officialOnlyIds = new Set(
    inventory.officialOnlyCards.map((card) => clean(card.cardID)),
  );
  const builtAdditionIds = new Set(
    evidenceRows
      .filter((row) => row.origin === "official_only_addition")
      .map((row) => row.cardID),
  );
  if (
    officialOnlyIds.size !== builtAdditionIds.size ||
    [...officialOnlyIds].some((cardID) => !builtAdditionIds.has(cardID))
  ) {
    throw new Error(`${source.setId} official-only evidence changed after inventory.`);
  }

  cards.sort((left, right) =>
    cardSortKey(left.localId).localeCompare(cardSortKey(right.localId)),
  );
  evidenceRows.sort((left, right) =>
    cardSortKey(left.numerator).localeCompare(cardSortKey(right.numerator)),
  );
  if (cards.length !== expectedOfficial || evidenceRows.length !== expectedOfficial) {
    throw new Error(
      `${source.setId} reconciliation produced ${cards.length} cards and ${evidenceRows.length} evidence rows; expected ${expectedOfficial}.`,
    );
  }
  if (nameBackfilledCardCount !== inventory.missingJapaneseCardNames) {
    throw new Error(
      `${source.setId} backfilled ${nameBackfilledCardCount}/${inventory.missingJapaneseCardNames} missing names.`,
    );
  }
  if (addedCardCount !== inventory.officialOnlyCards.length) {
    throw new Error(
      `${source.setId} added ${addedCardCount}/${inventory.officialOnlyCards.length} official-only cards.`,
    );
  }

  const bundle: PokemonJapaneseIncompleteReconciledBundle = {
    schema: POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA,
    phase: "official_incomplete_backfill",
    language: "ja",
    generatedAt: new Date().toISOString(),
    baseSource: {
      repository: SOURCE_REPOSITORY,
      commit: params.sourceCommit,
      setSourcePath: source.sourceSetPath,
      sourceCardCount: source.sourceCards.length,
    },
    official: {
      inventoryGeneratedAt: params.inventoryGeneratedAt,
      product: {
        value: clean(inventory.officialProduct.value),
        label: clean(inventory.officialProduct.label),
        url: productUrl(inventory.officialProduct),
      },
      comparableCardCount: expectedOfficial,
      sourceCardCount: source.sourceCards.length,
      preservedNamedCardCount,
      nameBackfilledCardCount,
      addedCardCount,
      cards: evidenceRows,
    },
    series: { id: source.seriesId, name: source.seriesName },
    set: {
      id: source.setId,
      name: source.setName,
      officialCardCount: expectedOfficial,
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
      : ".codex-run/pokemon-ja-incomplete-reconciled-bundles",
  );
  const buildReceiptPath = resolve(
    argumentValue("--build-receipt") ||
      ".codex-run/tcgdex-ja-build-receipt.json",
  );
  const inventoryReceiptPath = resolve(
    argumentValue("--inventory-receipt") ||
      ".codex-run/pokemon-ja-incomplete-inventory-receipt.json",
  );
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-incomplete-reconciled-build-receipt.json",
  );
  const requested = argumentValues("--set");
  const targets = (requested.length ? requested : DEFAULT_TARGETS)
    .map(clean)
    .filter(Boolean);
  const continueOnError = process.argv.includes("--continue-on-error");

  const buildReceipt = JSON.parse(
    await readFile(buildReceiptPath, "utf8"),
  ) as BuildReceipt;
  const inventoryReceipt = JSON.parse(
    await readFile(inventoryReceiptPath, "utf8"),
  ) as InventoryReceipt;
  if (
    buildReceipt.schema !== "tcos.checklist.tcgdexJapaneseBuildReceipt.v1" ||
    inventoryReceipt.schema !==
      "tcos.checklist.pokemonJapaneseIncompleteInventory.v1"
  ) {
    throw new Error("Unsupported Japanese source or inventory receipt schema.");
  }
  const commit = sourceCommit(sourceDirectory);
  if (
    buildReceipt.sourceCommit !== inventoryReceipt.sourceCommit ||
    (commit !== "unknown" && commit !== inventoryReceipt.sourceCommit)
  ) {
    throw new Error(
      `TCGdex source drift: build ${buildReceipt.sourceCommit}, inventory ${inventoryReceipt.sourceCommit}, checkout ${commit}.`,
    );
  }
  await mkdir(outputDirectory, { recursive: true });

  const rows: OutputRow[] = [];
  for (const setId of targets) {
    const buildRow = buildReceipt.rows.find(
      (row) => clean(row.setId).toLowerCase() === setId.toLowerCase(),
    );
    const inventoryRow = inventoryReceipt.rows.find(
      (row) => clean(row.setId).toLowerCase() === setId.toLowerCase(),
    );
    try {
      if (!buildRow || buildRow.status !== "incomplete_japanese") {
        throw new Error(`${setId} is not an incomplete Japanese source set.`);
      }
      if (!inventoryRow) {
        throw new Error(`${setId} is absent from the Phase 4A inventory.`);
      }
      const source = await loadSourceSet({ sourceDirectory, row: buildRow });
      const bundle = buildBundle({
        source,
        inventory: inventoryRow,
        inventoryGeneratedAt: inventoryReceipt.generatedAt,
        sourceCommit: inventoryReceipt.sourceCommit,
      });
      const outputFile = join(
        outputDirectory,
        `${bundle.series.id}-${bundle.set.id}${OUTPUT_SUFFIX}`,
      );
      await writeFile(outputFile, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      rows.push({
        setId,
        setName: source.setName,
        status: "built",
        sourceCards: bundle.official.sourceCardCount,
        preservedNamedCards: bundle.official.preservedNamedCardCount,
        nameBackfilledCards: bundle.official.nameBackfilledCardCount,
        addedOfficialCards: bundle.official.addedCardCount,
        officialCards: bundle.official.comparableCardCount,
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
        setName: inventoryRow?.setName || buildRow?.setName || null,
        status: "failed",
        sourceCards: 0,
        preservedNamedCards: 0,
        nameBackfilledCards: 0,
        addedOfficialCards: 0,
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
    schema: "tcos.checklist.pokemonJapaneseIncompleteReconciledBuildReceipt.v1",
    generatedAt: new Date().toISOString(),
    sourceDirectory,
    sourceCommit: inventoryReceipt.sourceCommit,
    buildReceipt: buildReceiptPath,
    inventoryReceipt: inventoryReceiptPath,
    outputDirectory,
    requestedSets: targets,
    attemptedSets: rows.length,
    successfulSets: rows.length - failed.length,
    failedSets: failed.length,
    totals: rows.reduce(
      (sum, row) => {
        sum.sourceCards += row.sourceCards;
        sum.preservedNamedCards += row.preservedNamedCards;
        sum.nameBackfilledCards += row.nameBackfilledCards;
        sum.addedOfficialCards += row.addedOfficialCards;
        sum.officialCards += row.officialCards;
        sum.variantEvidence += row.variantEvidence;
        return sum;
      },
      {
        sourceCards: 0,
        preservedNamedCards: 0,
        nameBackfilledCards: 0,
        addedOfficialCards: 0,
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

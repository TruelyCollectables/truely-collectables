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
  POKEMON_JAPANESE_POKEBALL_REVERSE_NAME,
  POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA,
  type PokemonJapaneseVariantPrintingEvidence,
  type PokemonJapaneseVariantReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-variant-reconciled";
import type { TcgdexJapaneseVariantEvidence } from "../src/lib/checklist-registry/tcgdex-japanese";

const SOURCE_REPOSITORY = "https://github.com/tcgdex/cards-database" as const;
const HISTORICAL_SCHEMA =
  "tcos.checklist.pokemonJapaneseHistoricalProductResolution.v1" as const;
const OUTPUT_SUFFIX = ".pokemon-ja-variant-reconciled.bundle.json";

const SET_SPECS = {
  s10a: {
    setId: "S10a",
    productValue: "859",
    sourceCards: 71,
    reversePrintings: 49,
    additions: 28,
    baseCards: 99,
    officialPrintings: 148,
  },
  s11a: {
    setId: "S11a",
    productValue: "866",
    sourceCards: 68,
    reversePrintings: 46,
    additions: 26,
    baseCards: 94,
    officialPrintings: 140,
  },
} as const;

type SetKey = keyof typeof SET_SPECS;
type Languages<T = string> = Partial<Record<string, T>>;
type TcgdexSet = {
  id?: string;
  name?: Languages;
  serie?: { id?: string; name?: Languages };
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
  products: Array<{ value: string; label: string }>;
  officialComparableCards: number;
  officialOnlyCards: OfficialDetail[];
  duplicateOfficialLocalIds: Array<{
    localId: string;
    cardIDs: string[];
  }>;
  unnumberedOfficialCards: OfficialDetail[];
  knownNameMismatches: unknown[];
  comparableOfficialCards: OfficialDetail[];
  detailFetchFailures: number;
};
type HistoricalRow = {
  setId: string;
  setName: string;
  status: string;
  sourceCardCount: number;
  missingJapaneseCardNames: number;
  candidateProducts: Array<{ value: string; label: string }>;
  evaluatedGroups: HistoricalEvaluation[];
  error: string | null;
};
type HistoricalReceipt = {
  schema: typeof HISTORICAL_SCHEMA;
  generatedAt: string;
  sourceCommit: string;
  rows: HistoricalRow[];
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
type OutputRow = {
  setId: string;
  setName: string | null;
  status: "built" | "failed";
  sourceCards: number;
  reversePokeballPrintings: number;
  numberedOfficialAdditions: number;
  baseCards: number;
  officialPrintings: number;
  outputFile: string | null;
  error: string | null;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/build-pokemon-japanese-variant-reconciled-bundles.ts <tcgdex-directory> [output-directory] [options]",
      "",
      "Options:",
      "  --build-receipt <path>       Pinned TCGdex Japanese build receipt",
      "  --resolution-receipt <path>  Historical resolver receipt; repeatable; directories recurse",
      "  --set <S10a|S11a>            Build one target; repeatable",
      "  --receipt <path>             Build receipt",
      "  --continue-on-error          Continue after a failed target",
      "",
      "This command writes private local bundles only. It never writes to Registry or Production and never downloads official images.",
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
  if (!loaded.default) throw new Error(`${filePath} does not export default.`);
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
    throw new Error(`${params.row.sourceSetPath} lacks complete Japanese metadata.`);
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

function completeOfficialDetail(
  detail: OfficialDetail,
  setId: string,
): asserts detail is OfficialDetail & {
  cardID: string;
  name: string;
  setCode: string;
  numerator: string;
} {
  if (
    !/^\d+$/.test(clean(detail.cardID)) ||
    !clean(detail.name) ||
    clean(detail.setCode).toLowerCase() !== setId.toLowerCase() ||
    !clean(detail.numerator) ||
    !/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(
      clean(detail.url),
    ) ||
    detail.error
  ) {
    throw new Error(`${setId} contains incomplete official card detail evidence.`);
  }
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

async function loadHistoricalRows(paths: string[]) {
  const bySet = new Map<string, { receipt: HistoricalReceipt; row: HistoricalRow }>();
  const files = (
    await Promise.all(paths.map((entry) => collectJsonFiles(entry)))
  ).flat();
  for (const file of files) {
    let parsed: HistoricalReceipt;
    try {
      parsed = JSON.parse(await readFile(file, "utf8")) as HistoricalReceipt;
    } catch {
      continue;
    }
    if (parsed.schema !== HISTORICAL_SCHEMA) continue;
    for (const row of parsed.rows || []) {
      const key = clean(row.setId).toLowerCase();
      if (!(key in SET_SPECS)) continue;
      if (bySet.has(key)) {
        throw new Error(`${row.setId} appears in multiple historical receipts.`);
      }
      bySet.set(key, { receipt: parsed, row });
    }
  }
  return bySet;
}

function cardSortKey(card: { localId: string; id: string }) {
  const local = normalizedLocalId(card.localId);
  return /^\d+$/.test(local)
    ? `0:${String(Number(local)).padStart(8, "0")}:${card.id}`
    : `1:${local}:${card.id}`;
}

function buildBundle(params: {
  source: SourceSet;
  receipt: HistoricalReceipt;
  row: HistoricalRow;
}) {
  const key = params.source.setId.toLowerCase() as SetKey;
  const spec = SET_SPECS[key];
  if (!spec) throw new Error(`${params.source.setId} is not a supported target.`);
  if (
    params.row.status !== "manual_review" ||
    params.row.error ||
    params.row.sourceCardCount !== spec.sourceCards ||
    params.row.missingJapaneseCardNames !== spec.sourceCards ||
    params.source.sourceCards.length !== spec.sourceCards ||
    params.source.sourceCards.some((card) => card.name) ||
    params.source.sourceCards.some((card) => card.variants.length)
  ) {
    throw new Error(`${spec.setId} source or resolver state drifted.`);
  }

  const evaluation = params.row.evaluatedGroups.find(
    (entry) =>
      entry.products.length === 1 &&
      clean(entry.products[0]?.value) === spec.productValue,
  );
  if (
    !evaluation ||
    evaluation.detailFetchFailures !== 0 ||
    evaluation.officialComparableCards !== spec.officialPrintings ||
    evaluation.duplicateOfficialLocalIds.length !== spec.reversePrintings ||
    evaluation.officialOnlyCards.length !== spec.additions ||
    evaluation.unnumberedOfficialCards.length !== 0 ||
    evaluation.knownNameMismatches.length !== 0 ||
    evaluation.comparableOfficialCards.length !== spec.officialPrintings
  ) {
    throw new Error(`${spec.setId} official variant evidence drifted.`);
  }

  const sourceByLocalId = new Map(
    params.source.sourceCards.map((card) => [card.normalizedLocalId, card]),
  );
  if (sourceByLocalId.size !== params.source.sourceCards.length) {
    throw new Error(`${spec.setId} repeats normalized TCGdex local IDs.`);
  }

  const detailsByLocalId = new Map<string, OfficialDetail[]>();
  for (const detail of evaluation.comparableOfficialCards) {
    completeOfficialDetail(detail, spec.setId);
    const localId = normalizedLocalId(detail.numerator);
    const rows = detailsByLocalId.get(localId) || [];
    rows.push(detail);
    detailsByLocalId.set(localId, rows);
  }

  const cards: PokemonJapaneseVariantReconciledBundle["cards"] = [];
  const printings: PokemonJapaneseVariantPrintingEvidence[] = [];
  let reverseCount = 0;

  for (const sourceCard of params.source.sourceCards) {
    const rows = (detailsByLocalId.get(sourceCard.normalizedLocalId) || [])
      .slice()
      .sort((left, right) => Number(left.cardID) - Number(right.cardID));
    if (rows.length !== 1 && rows.length !== 2) {
      throw new Error(
        `${spec.setId} source ${sourceCard.localId} has ${rows.length} official printings.`,
      );
    }
    if (
      rows.some(
        (row) =>
          normalizedLocalId(row.numerator) !== sourceCard.normalizedLocalId ||
          clean(row.name) !== clean(rows[0].name) ||
          clean(row.denominator) !== clean(rows[0].denominator),
      )
    ) {
      throw new Error(
        `${spec.setId} source ${sourceCard.localId} duplicate printing evidence disagrees.`,
      );
    }

    const base = rows[0];
    const reverse = rows[1] || null;
    if (reverse && Number(reverse.cardID) <= Number(base.cardID)) {
      throw new Error(`${spec.setId} source ${sourceCard.localId} reverse ID order drifted.`);
    }
    const variants: TcgdexJapaneseVariantEvidence[] = reverse
      ? [
          {
            type: "normal",
            subtype: null,
            size: null,
            stamps: [],
            foil: null,
            languages: ["ja"],
          },
          {
            type: "reverse",
            subtype: "pokeball",
            size: null,
            stamps: [],
            foil: null,
            languages: ["ja"],
          },
        ]
      : [];
    cards.push({
      id: sourceCard.id,
      localId: sourceCard.localId,
      name: clean(base.name),
      category: sourceCard.category,
      rarity: sourceCard.rarity,
      illustrator: sourceCard.illustrator,
      regulationMark: sourceCard.regulationMark,
      dexId: sourceCard.dexId,
      variants,
      sourcePath: sourceCard.sourcePath,
    });
    printings.push({
      bundleCardId: sourceCard.id,
      cardID: clean(base.cardID),
      name: clean(base.name),
      setCode: clean(base.setCode),
      numerator: clean(base.numerator),
      denominator: clean(base.denominator) || null,
      detailUrl: clean(base.url),
      origin: "source_base_printing",
      sourcePath: sourceCard.sourcePath,
      sourceLocalId: sourceCard.localId,
      parallelName: null,
    });
    if (reverse) {
      reverseCount += 1;
      printings.push({
        bundleCardId: sourceCard.id,
        cardID: clean(reverse.cardID),
        name: clean(reverse.name),
        setCode: clean(reverse.setCode),
        numerator: clean(reverse.numerator),
        denominator: clean(reverse.denominator) || null,
        detailUrl: clean(reverse.url),
        origin: "source_reverse_pokeball_printing",
        sourcePath: sourceCard.sourcePath,
        sourceLocalId: sourceCard.localId,
        parallelName: POKEMON_JAPANESE_POKEBALL_REVERSE_NAME,
      });
    }
  }

  const additions = evaluation.comparableOfficialCards
    .filter((detail) => !sourceByLocalId.has(normalizedLocalId(detail.numerator)))
    .slice()
    .sort((left, right) => Number(left.cardID) - Number(right.cardID));
  if (additions.length !== spec.additions || reverseCount !== spec.reversePrintings) {
    throw new Error(`${spec.setId} reverse or addition population drifted.`);
  }
  for (const detail of additions) {
    completeOfficialDetail(detail, spec.setId);
    const id = `pokemon-card-${spec.setId}-${clean(detail.cardID)}`;
    cards.push({
      id,
      localId: clean(detail.numerator),
      name: clean(detail.name),
      category: null,
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
      sourcePath: null,
    });
    printings.push({
      bundleCardId: id,
      cardID: clean(detail.cardID),
      name: clean(detail.name),
      setCode: clean(detail.setCode),
      numerator: clean(detail.numerator),
      denominator: clean(detail.denominator) || null,
      detailUrl: clean(detail.url),
      origin: "official_numbered_addition",
      sourcePath: null,
      sourceLocalId: null,
      parallelName: null,
    });
  }

  cards.sort((left, right) => cardSortKey(left).localeCompare(cardSortKey(right)));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const originOrder = {
    source_base_printing: 0,
    source_reverse_pokeball_printing: 1,
    official_numbered_addition: 2,
  } as const;
  printings.sort((left, right) => {
    const leftCard = cardById.get(left.bundleCardId);
    const rightCard = cardById.get(right.bundleCardId);
    const cardComparison = cardSortKey(
      leftCard || { id: left.bundleCardId, localId: left.numerator },
    ).localeCompare(
      cardSortKey(
        rightCard || { id: right.bundleCardId, localId: right.numerator },
      ),
    );
    return cardComparison || originOrder[left.origin] - originOrder[right.origin];
  });

  if (cards.length !== spec.baseCards || printings.length !== spec.officialPrintings) {
    throw new Error(
      `${spec.setId} built ${cards.length} base cards and ${printings.length} printings; expected ${spec.baseCards}/${spec.officialPrintings}.`,
    );
  }

  const product = evaluation.products[0];
  const bundle: PokemonJapaneseVariantReconciledBundle = {
    schema: POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA,
    phase: "official_variant_backfill",
    language: "ja",
    generatedAt: new Date().toISOString(),
    baseSource: {
      repository: SOURCE_REPOSITORY,
      commit: params.receipt.sourceCommit,
      setSourcePath: params.source.sourceSetPath,
      sourceCardCount: spec.sourceCards,
    },
    official: {
      resolutionGeneratedAt: params.receipt.generatedAt,
      resolutionSchema: params.receipt.schema,
      product: {
        value: clean(product.value),
        label: clean(product.label),
        url:
          "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=" +
          encodeURIComponent(clean(product.value)),
      },
      baseCardCount: spec.baseCards,
      officialPrintingCount: spec.officialPrintings,
      sourceBasePrintingCount: spec.sourceCards,
      sourceReversePokeballPrintingCount: spec.reversePrintings,
      numberedAddedCardCount: spec.additions,
      printings,
    },
    series: {
      id: params.source.seriesId,
      name: params.source.seriesName,
    },
    set: {
      id: params.source.setId,
      name: params.source.setName,
      officialCardCount: spec.baseCards,
      releaseDate: params.source.releaseDate,
      sourcePath: params.source.sourceSetPath,
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
      : ".codex-run/pokemon-ja-variant-reconciled-bundles",
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
      ".codex-run/pokemon-ja-variant-reconciled-build-receipt.json",
  );
  const requested = argumentValues("--set");
  const targets = (requested.length ? requested : ["S10a", "S11a"])
    .map(clean)
    .filter(Boolean);
  const continueOnError = process.argv.includes("--continue-on-error");

  const buildReceipt = JSON.parse(
    await readFile(buildReceiptPath, "utf8"),
  ) as BuildReceipt;
  if (buildReceipt.schema !== "tcos.checklist.tcgdexJapaneseBuildReceipt.v1") {
    throw new Error("Unsupported Japanese build receipt schema.");
  }
  const checkoutCommit = sourceCommit(sourceDirectory);
  if (
    checkoutCommit !== "unknown" &&
    checkoutCommit !== buildReceipt.sourceCommit
  ) {
    throw new Error(
      `TCGdex source drift: receipt ${buildReceipt.sourceCommit}, checkout ${checkoutCommit}.`,
    );
  }
  const historicalRows = await loadHistoricalRows(resolutionPaths);
  await mkdir(outputDirectory, { recursive: true });

  const rows: OutputRow[] = [];
  for (const target of targets) {
    const key = target.toLowerCase() as SetKey;
    const spec = SET_SPECS[key];
    const buildRow = buildReceipt.rows.find(
      (row) => clean(row.setId).toLowerCase() === key,
    );
    const historical = historicalRows.get(key);
    try {
      if (!spec) throw new Error(`${target} is not S10a or S11a.`);
      if (!buildRow || buildRow.status !== "incomplete_japanese") {
        throw new Error(`${spec.setId} is not an incomplete Japanese source set.`);
      }
      if (!historical) {
        throw new Error(`${spec.setId} has no historical resolution receipt.`);
      }
      if (historical.receipt.sourceCommit !== buildReceipt.sourceCommit) {
        throw new Error(`${spec.setId} resolution source commit drifted.`);
      }
      const source = await loadSourceSet({ sourceDirectory, row: buildRow });
      const bundle = buildBundle({
        source,
        receipt: historical.receipt,
        row: historical.row,
      });
      const outputFile = join(
        outputDirectory,
        `${bundle.series.id}-${bundle.set.id}${OUTPUT_SUFFIX}`,
      );
      await writeFile(outputFile, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      rows.push({
        setId: bundle.set.id,
        setName: bundle.set.name,
        status: "built",
        sourceCards: bundle.baseSource.sourceCardCount,
        reversePokeballPrintings:
          bundle.official.sourceReversePokeballPrintingCount,
        numberedOfficialAdditions: bundle.official.numberedAddedCardCount,
        baseCards: bundle.official.baseCardCount,
        officialPrintings: bundle.official.officialPrintingCount,
        outputFile,
        error: null,
      });
    } catch (error) {
      rows.push({
        setId: spec?.setId || target,
        setName: buildRow?.setName || historical?.row.setName || null,
        status: "failed",
        sourceCards: 0,
        reversePokeballPrintings: 0,
        numberedOfficialAdditions: 0,
        baseCards: 0,
        officialPrintings: 0,
        outputFile: null,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!continueOnError) break;
    }
  }

  const failed = rows.filter((row) => row.status === "failed");
  const receipt = {
    schema:
      "tcos.checklist.pokemonJapaneseVariantReconciledBuildReceipt.v1",
    generatedAt: new Date().toISOString(),
    sourceDirectory,
    sourceCommit: buildReceipt.sourceCommit,
    buildReceipt: buildReceiptPath,
    resolutionReceipts: resolutionPaths.map((entry) => resolve(entry)),
    outputDirectory,
    requestedSets: targets,
    attemptedSets: rows.length,
    successfulSets: rows.length - failed.length,
    failedSets: failed.length,
    totals: rows.reduce(
      (sum, row) => {
        sum.sourceCards += row.sourceCards;
        sum.reversePokeballPrintings += row.reversePokeballPrintings;
        sum.numberedOfficialAdditions += row.numberedOfficialAdditions;
        sum.baseCards += row.baseCards;
        sum.officialPrintings += row.officialPrintings;
        return sum;
      },
      {
        sourceCards: 0,
        reversePokeballPrintings: 0,
        numberedOfficialAdditions: 0,
        baseCards: 0,
        officialPrintings: 0,
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

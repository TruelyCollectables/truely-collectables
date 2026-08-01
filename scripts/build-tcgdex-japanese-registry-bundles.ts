import { execFileSync } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
  type TcgdexJapaneseVariantEvidence,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const SOURCE_REPOSITORY = "https://github.com/tcgdex/cards-database" as const;
const BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";

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

type BuildRow = {
  setId: string | null;
  setName: string | null;
  seriesId: string | null;
  status: "built" | "skipped_non_japanese" | "failed";
  cards: number;
  variantEvidence: number;
  outputFile: string | null;
  error: string | null;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/build-tcgdex-japanese-registry-bundles.ts <tcgdex-cards-database-directory> [output-directory] [--receipt <path>]",
      "",
      "The source directory must contain data-asia. The builder imports only sets with Japanese metadata and fails closed when a Japanese card file lacks a Japanese name.",
    ].join("\n"),
  );
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
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
    return "master";
  }
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function importDefault<T>(filePath: string): Promise<T> {
  const module = (await import(pathToFileURL(filePath).href)) as { default?: T };
  if (!module.default) throw new Error(`${filePath} does not export a default object.`);
  return module.default;
}

function releaseDateJa(value: TcgdexSet["releaseDate"]) {
  if (typeof value === "string") return text(value);
  return text(value?.ja);
}

function normalizeDetailedVariant(value: DetailedVariant): TcgdexJapaneseVariantEvidence | null {
  const type = text(value.type);
  if (!type) return null;
  const languages = Array.isArray(value.languages)
    ? value.languages.map(text).filter(Boolean)
    : [];
  if (languages.length && !languages.includes("ja")) return null;
  return {
    type,
    subtype: text(value.subtype) || null,
    size: text(value.size) || null,
    stamps: [...new Set([...(value.stamp || []), ...(value.stamps || [])].map(text).filter(Boolean))],
    foil: text(value.foil) || null,
    languages,
  };
}

function normalizeVariants(value: TcgdexCard["variants"]) {
  if (Array.isArray(value)) {
    return value.map(normalizeDetailedVariant).filter((entry): entry is TcgdexJapaneseVariantEvidence => Boolean(entry));
  }
  if (!value || typeof value !== "object") return [];
  const legacy = value as LegacyVariants;
  const variants: TcgdexJapaneseVariantEvidence[] = [];
  if (legacy.normal) variants.push({ type: "normal" });
  if (legacy.holo) variants.push({ type: "holo" });
  if (legacy.reverse) variants.push({ type: "reverse" });
  if (legacy.firstEdition) variants.push({ type: "normal", stamps: ["1st-edition"] });
  if (legacy.jumbo) variants.push({ type: "normal", size: "jumbo" });
  if (legacy.preRelease) variants.push({ type: "normal", stamps: ["pre-release"] });
  if (legacy.wPromo) variants.push({ type: "normal", stamps: ["w-promo"] });
  return variants;
}

async function collectSetDefinitions(asiaRoot: string) {
  const definitions: Array<{ setFile: string; cardDirectory: string }> = [];
  for (const seriesEntry of await readdir(asiaRoot, { withFileTypes: true })) {
    if (!seriesEntry.isDirectory()) continue;
    const seriesDirectory = join(asiaRoot, seriesEntry.name);
    for (const entry of await readdir(seriesDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const stem = basename(entry.name, ".ts");
      const cardDirectory = join(seriesDirectory, stem);
      if (await isDirectory(cardDirectory)) {
        definitions.push({ setFile: join(seriesDirectory, entry.name), cardDirectory });
      }
    }
  }
  return definitions.sort((a, b) => a.setFile.localeCompare(b.setFile));
}

async function buildSetBundle(params: {
  repositoryRoot: string;
  commit: string;
  setFile: string;
  cardDirectory: string;
}): Promise<TcgdexJapaneseSetBundle | null> {
  const set = await importDefault<TcgdexSet>(params.setFile);
  const setId = text(set.id);
  const setName = text(set.name?.ja);
  const seriesId = text(set.serie?.id);
  const seriesName = text(set.serie?.name?.ja);
  const releaseDate = releaseDateJa(set.releaseDate);
  if (!setName || !releaseDate) return null;
  if (!setId || !seriesId || !seriesName) {
    throw new Error(`${params.setFile} is missing Japanese set/series identity metadata.`);
  }

  const cards: TcgdexJapaneseSetBundle["cards"] = [];
  const cardFiles = (await readdir(params.cardDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(params.cardDirectory, entry.name))
    .sort((a, b) => a.localeCompare(b));

  for (const cardFile of cardFiles) {
    const card = await importDefault<TcgdexCard>(cardFile);
    const localId = basename(cardFile, ".ts");
    const name = text(card.name?.ja);
    if (!name) {
      throw new Error(`${posixPath(relative(params.repositoryRoot, cardFile))} lacks card.name.ja.`);
    }
    cards.push({
      id: `${setId}-${localId}`,
      localId,
      name,
      category: text(card.category) || null,
      rarity: text(card.rarity) || null,
      illustrator: text(card.illustrator) || null,
      regulationMark: text(card.regulationMark) || null,
      dexId: Array.isArray(card.dexId) ? card.dexId.filter(Number.isInteger) : [],
      variants: normalizeVariants(card.variants),
      sourcePath: posixPath(relative(params.repositoryRoot, cardFile)),
    });
  }

  if (!cards.length) throw new Error(`${params.setFile} has no card files.`);
  return {
    schema: TCGDEX_JAPANESE_BUNDLE_SCHEMA,
    phase: "base_cards",
    language: "ja",
    source: { repository: SOURCE_REPOSITORY, commit: params.commit },
    series: { id: seriesId, name: seriesName },
    set: {
      id: setId,
      name: setName,
      officialCardCount: Number.isInteger(set.cardCount?.official)
        ? Number(set.cardCount?.official)
        : null,
      releaseDate,
      sourcePath: posixPath(relative(params.repositoryRoot, params.setFile)),
    },
    cards,
  };
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
  const repositoryRoot = resolve(sourceArgument);
  const asiaRoot = join(repositoryRoot, "data-asia");
  if (!(await isDirectory(asiaRoot))) {
    throw new Error(`${repositoryRoot} does not contain data-asia.`);
  }
  const outputDirectory = resolve(
    process.argv[3] && !process.argv[3].startsWith("--")
      ? process.argv[3]
      : ".codex-run/tcgdex-ja-registry-bundles",
  );
  const receiptPath = resolve(
    argumentValue("--receipt") || join(outputDirectory, "build-receipt.json"),
  );
  await mkdir(outputDirectory, { recursive: true });

  const commit = sourceCommit(repositoryRoot);
  const rows: BuildRow[] = [];
  for (const definition of await collectSetDefinitions(asiaRoot)) {
    let setId: string | null = null;
    let setName: string | null = null;
    let seriesId: string | null = null;
    try {
      const bundle = await buildSetBundle({ repositoryRoot, commit, ...definition });
      if (!bundle) {
        rows.push({
          setId,
          setName,
          seriesId,
          status: "skipped_non_japanese",
          cards: 0,
          variantEvidence: 0,
          outputFile: null,
          error: null,
        });
        continue;
      }
      setId = bundle.set.id;
      setName = bundle.set.name;
      seriesId = bundle.series.id;
      const outputFile = join(outputDirectory, `${bundle.series.id}-${bundle.set.id}${BUNDLE_SUFFIX}`);
      await writeFile(outputFile, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
      rows.push({
        setId,
        setName,
        seriesId,
        status: "built",
        cards: bundle.cards.length,
        variantEvidence: bundle.cards.reduce((sum, card) => sum + (card.variants?.length || 0), 0),
        outputFile,
        error: null,
      });
    } catch (error) {
      rows.push({
        setId,
        setName,
        seriesId,
        status: "failed",
        cards: 0,
        variantEvidence: 0,
        outputFile: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const built = rows.filter((row) => row.status === "built");
  const failed = rows.filter((row) => row.status === "failed");
  const receipt = {
    schema: "tcos.checklist.tcgdexJapaneseBuildReceipt.v1",
    generatedAt: new Date().toISOString(),
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: commit,
    sourceDirectory: repositoryRoot,
    outputDirectory,
    discoveredSetDefinitions: rows.length,
    builtSets: built.length,
    skippedNonJapaneseSets: rows.filter((row) => row.status === "skipped_non_japanese").length,
    failedSets: failed.length,
    totals: {
      cards: built.reduce((sum, row) => sum + row.cards, 0),
      variantEvidence: built.reduce((sum, row) => sum + row.variantEvidence, 0),
    },
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

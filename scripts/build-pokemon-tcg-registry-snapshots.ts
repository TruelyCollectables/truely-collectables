import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  POKEMON_TCG_REPOSITORY_SCHEMA,
  type PokemonTcgRepositoryCard,
  type PokemonTcgRepositorySet,
  type PokemonTcgRepositorySnapshot,
} from "../src/lib/checklist-registry/pokemon-tcg-repository";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requireArgument(name: string) {
  const value = argument(name);
  if (!value) {
    throw new Error(`Missing required ${name} argument`);
  }
  return value;
}

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `Could not parse ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const sourceDir = resolve(requireArgument("--source-dir"));
const outputDir = resolve(requireArgument("--output-dir"));
const repositoryRef = argument("--ref") || null;
const setsPath = join(sourceDir, "sets", "en.json");
const cardsDir = join(sourceDir, "cards", "en");

if (!existsSync(setsPath)) {
  throw new Error(`Pokémon set index not found: ${setsPath}`);
}
if (!existsSync(cardsDir)) {
  throw new Error(`Pokémon card directory not found: ${cardsDir}`);
}

const sets = readJson<PokemonTcgRepositorySet[]>(setsPath);
if (!Array.isArray(sets) || !sets.length) {
  throw new Error("Pokémon set index must contain at least one set");
}

mkdirSync(outputDir, { recursive: true });

const outputFiles: string[] = [];
const missingCardFiles: string[] = [];
let cardCount = 0;

for (const set of sets) {
  const setId = String(set.id || "").trim();
  if (!setId) {
    throw new Error("Pokémon set index contains a set without an id");
  }

  const cardFile = join(cardsDir, `${setId}.json`);
  if (!existsSync(cardFile)) {
    missingCardFiles.push(cardFile);
    continue;
  }

  const cards = readJson<PokemonTcgRepositoryCard[]>(cardFile);
  if (!Array.isArray(cards)) {
    throw new Error(`${cardFile} must contain a JSON array`);
  }

  const snapshot: PokemonTcgRepositorySnapshot = {
    schema: POKEMON_TCG_REPOSITORY_SCHEMA,
    scope: "full_set",
    repository: {
      owner: "PokemonTCG",
      name: "pokemon-tcg-data",
      ref: repositoryRef,
      setFile: "sets/en.json",
      cardFile: `cards/en/${basename(cardFile)}`,
    },
    set,
    cards,
  };

  const outputPath = join(outputDir, `${setId}.snapshot.json`);
  writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  outputFiles.push(outputPath);
  cardCount += cards.length;
}

const summary = {
  schema: "tcos.pokemonTcg.snapshotBuild.v1",
  sourceDir,
  outputDir,
  repositoryRef,
  setIndexCount: sets.length,
  snapshotCount: outputFiles.length,
  cardCount,
  missingCardFileCount: missingCardFiles.length,
  missingCardFiles,
  outputFiles,
};

const summaryPath = join(outputDir, "snapshot-build-summary.json");
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));

if (missingCardFiles.length) {
  process.exitCode = 1;
}

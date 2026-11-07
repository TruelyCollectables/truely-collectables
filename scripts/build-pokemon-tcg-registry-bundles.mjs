#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const BUNDLE_SCHEMA = "tcos.pokemonTcgData.setBundle.v1";

function usage() {
  console.error(
    "Usage: node scripts/build-pokemon-tcg-registry-bundles.mjs <pokemon-tcg-data-root> [output-directory]",
  );
}

function requireText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const sourceRootArgument = process.argv[2];
  if (!sourceRootArgument) {
    usage();
    process.exitCode = 1;
    return;
  }

  const sourceRoot = resolve(sourceRootArgument);
  const outputDirectory = resolve(
    process.argv[3] || ".codex-run/pokemon-tcg-registry-bundles",
  );
  const setIndexPath = join(sourceRoot, "sets", "en.json");
  const cardsDirectory = join(sourceRoot, "cards", "en");

  const sets = await readJson(setIndexPath);
  if (!Array.isArray(sets)) {
    throw new Error(`${setIndexPath} must contain an array of Pokémon sets.`);
  }

  const setById = new Map(
    sets.map((set) => [requireText(set?.id, "set.id"), set]),
  );
  const cardFiles = (await readdir(cardsDirectory))
    .filter((fileName) => fileName.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  await mkdir(outputDirectory, { recursive: true });

  const results = [];
  for (const cardFile of cardFiles) {
    const setId = basename(cardFile, ".json");
    const set = setById.get(setId);
    if (!set) {
      results.push({
        setId,
        sourceFile: cardFile,
        status: "skipped_missing_set_metadata",
      });
      continue;
    }

    const cards = await readJson(join(cardsDirectory, cardFile));
    if (!Array.isArray(cards)) {
      throw new Error(`${cardFile} must contain an array of Pokémon cards.`);
    }

    const outputFile = `${setId}.pokemon-tcg-data.bundle.json`;
    const bundle = {
      schema: BUNDLE_SCHEMA,
      scope: "full_set",
      language: "en",
      set,
      cards,
    };

    await writeFile(
      join(outputDirectory, outputFile),
      `${JSON.stringify(bundle, null, 2)}\n`,
      "utf8",
    );

    results.push({
      setId,
      setName: set.name || null,
      sourceFile: cardFile,
      outputFile,
      cardCount: cards.length,
      status: "written",
    });
  }

  const receipt = {
    schema: "tcos.checklist.pokemonBundleBuild.v1",
    generatedAt: new Date().toISOString(),
    sourceRoot,
    setIndexPath,
    cardsDirectory,
    outputDirectory,
    setMetadataCount: sets.length,
    cardFileCount: cardFiles.length,
    bundleCount: results.filter((entry) => entry.status === "written").length,
    skippedCount: results.filter((entry) => entry.status !== "written").length,
    results,
  };

  const receiptPath = join(outputDirectory, "pokemon-bundle-build-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

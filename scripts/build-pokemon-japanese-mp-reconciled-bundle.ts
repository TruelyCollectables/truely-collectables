import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  POKEMON_JAPANESE_MP_RECONCILED_SCHEMA,
  type PokemonJapaneseMPCardEvidence,
  type PokemonJapaneseMPReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-mp-reconciled";
import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const TARGET_SET_ID = "M-P";
const BASE_BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";
const OUTPUT_FILE = "M-M-P.pokemon-ja-mp-reconciled.bundle.json";
const EVIDENCE_SCHEMA =
  "tcos.checklist.pokemonJapaneseMPReconciliationEvidence.v1";
const AUDIT_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialVerification.v1";

type OfficialEvidenceCard = {
  cardID: string;
  name: string;
  setCode: string;
  localId: string | null;
  denominator: string | null;
  detailUrl: string;
  unnumbered: boolean;
};

type EvidenceReceipt = {
  schema: string;
  mode: string;
  generatedAt: string;
  auditGeneratedAt: string;
  targetSet: { id: string; name: string; baseSourceCommit: string };
  counts: {
    registryCards: number;
    officialCards: number;
    existingExactMatches: number;
    addNumberedCards: number;
    addUnnumberedCards: number;
    finalCards: number;
    netAdditions: number;
    assetPathSetCodeAnomalies: number;
    missingOfficialNames: number;
    extraRegistryNames: number;
  };
  safeForBundleConstruction: boolean;
  automaticProductionWriteAllowed: boolean;
  addNumbered: OfficialEvidenceCard[];
  addUnnumbered: OfficialEvidenceCard[];
};

type AuditReceipt = {
  schema: string;
  generatedAt: string;
  rows: Array<{
    setId: string;
    status: string;
    officialProduct: { value: string; label: string } | null;
    officialSearchUrl?: string | null;
    officialCollectedCount?: number | null;
    officialComparableCount?: number | null;
    officialExcludedCount?: number | null;
    officialNumberedCount?: number | null;
    officialUnnumberedCount?: number | null;
  }>;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/build-pokemon-japanese-mp-reconciled-bundle.ts <tcgdex-bundle-directory> [output-directory] [options]",
      "",
      "Options:",
      "  --evidence <path>       Corrected M-P reconciliation evidence",
      "  --audit-receipt <path>  Corrected official verification receipt",
      "  --receipt <path>        Build receipt",
      "",
      "This command builds one private complete 114-card M-P replacement bundle. It never writes to the Registry.",
    ].join("\n"),
  );
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedNumber(value: unknown) {
  const text = clean(value).toUpperCase();
  if (/^\d+$/.test(text)) return String(Number(text));
  return text.replace(/\s+/g, "");
}

function productUrl(value: string) {
  return (
    "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=" +
    encodeURIComponent(clean(value))
  );
}

function parseBaseBundle(content: string, file: string) {
  const parsed = JSON.parse(content) as TcgdexJapaneseSetBundle;
  if (
    parsed.schema !== TCGDEX_JAPANESE_BUNDLE_SCHEMA ||
    parsed.language !== "ja" ||
    clean(parsed.set?.id) !== TARGET_SET_ID ||
    !Array.isArray(parsed.cards)
  ) {
    throw new Error(`${file} is not the supported Japanese M-P base bundle.`);
  }
  return parsed;
}

async function loadBaseBundle(directory: string) {
  for (const name of (await readdir(directory)).filter((entry) =>
    entry.endsWith(BASE_BUNDLE_SUFFIX),
  )) {
    const file = join(directory, name);
    const raw = await readFile(file, "utf8");
    const candidate = JSON.parse(raw) as Partial<TcgdexJapaneseSetBundle>;
    if (clean(candidate.set?.id) === TARGET_SET_ID) {
      return { file, bundle: parseBaseBundle(raw, file) };
    }
  }
  throw new Error(`M-P base TCGdex bundle was not found in ${directory}.`);
}

function parseEvidenceCard(
  card: OfficialEvidenceCard,
  unnumbered: boolean,
): PokemonJapaneseMPCardEvidence {
  const cardID = clean(card.cardID);
  const name = clean(card.name);
  const setCode = clean(card.setCode);
  const numerator = card.localId === null ? null : clean(card.localId);
  const denominator = card.denominator === null ? null : clean(card.denominator);
  const detailUrl = clean(card.detailUrl);
  if (
    !cardID ||
    !name ||
    setCode !== TARGET_SET_ID ||
    !/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(detailUrl) ||
    Boolean(card.unnumbered) !== unnumbered
  ) {
    throw new Error(`Official M-P evidence is incomplete for card ${cardID || "unknown"}.`);
  }
  if (unnumbered && (numerator !== null || denominator !== null)) {
    throw new Error(`Unnumbered M-P card ${cardID} contains printed-number evidence.`);
  }
  if (!unnumbered && !numerator) {
    throw new Error(`Numbered M-P card ${cardID} lacks a printed number.`);
  }
  return {
    bundleCardId: `pokemon-card-${TARGET_SET_ID}-${cardID}`,
    cardID,
    name,
    setCode: TARGET_SET_ID,
    numerator,
    denominator,
    detailUrl,
    unnumbered,
  };
}

function newCard(evidence: PokemonJapaneseMPCardEvidence) {
  return {
    id: evidence.bundleCardId,
    localId: evidence.unnumbered ? "UNNUMBERED" : clean(evidence.numerator),
    name: evidence.name,
    category: null,
    rarity: null,
    illustrator: null,
    regulationMark: null,
    dexId: [],
    variants: [],
    sourcePath: null,
  };
}

function cardSortKey(card: { localId: string; id: string }) {
  const number = normalizedNumber(card.localId);
  if (/^\d+$/.test(number)) {
    return `0:${String(Number(number)).padStart(8, "0")}`;
  }
  return `1:${clean(card.id)}`;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const inputArgument = process.argv[2];
  if (!inputArgument || inputArgument.startsWith("--")) {
    usage();
    process.exitCode = 1;
    return;
  }

  const inputDirectory = resolve(inputArgument);
  const outputDirectory = resolve(
    process.argv[3] && !process.argv[3].startsWith("--")
      ? process.argv[3]
      : ".codex-run/pokemon-ja-mp-reconciled-bundle",
  );
  const evidencePath = resolve(
    argumentValue("--evidence") ||
      ".codex-run/pokemon-ja-mp-reconciliation-evidence.json",
  );
  const auditPath = resolve(
    argumentValue("--audit-receipt") ||
      ".codex-run/pokemon-ja-mp-audit-receipt.json",
  );
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-mp-reconciled-build-receipt.json",
  );

  const { file: baseFile, bundle: base } = await loadBaseBundle(inputDirectory);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as EvidenceReceipt;
  const audit = JSON.parse(await readFile(auditPath, "utf8")) as AuditReceipt;
  const auditRow = audit.rows?.find((row) => clean(row.setId) === TARGET_SET_ID);

  if (
    evidence.schema !== EVIDENCE_SCHEMA ||
    evidence.mode !== "read_only" ||
    clean(evidence.targetSet?.id) !== TARGET_SET_ID ||
    evidence.safeForBundleConstruction !== true ||
    evidence.automaticProductionWriteAllowed !== false ||
    !Array.isArray(evidence.addNumbered) ||
    !Array.isArray(evidence.addUnnumbered)
  ) {
    throw new Error(`${evidencePath} is not approved corrected M-P evidence.`);
  }
  if (audit.schema !== AUDIT_SCHEMA || !auditRow?.officialProduct) {
    throw new Error(`${auditPath} has no corrected official M-P product mapping.`);
  }
  if (
    auditRow.status !== "mismatch" ||
    auditRow.officialCollectedCount !== 114 ||
    auditRow.officialComparableCount !== 114 ||
    auditRow.officialExcludedCount !== 0 ||
    auditRow.officialNumberedCount !== 99 ||
    auditRow.officialUnnumberedCount !== 15
  ) {
    throw new Error(`Corrected M-P audit population is not the required 114-card baseline.`);
  }
  const expectedEvidenceCounts = {
    registryCards: 83,
    officialCards: 114,
    existingExactMatches: 83,
    addNumberedCards: 16,
    addUnnumberedCards: 15,
    finalCards: 114,
    netAdditions: 31,
    assetPathSetCodeAnomalies: 8,
    missingOfficialNames: 31,
    extraRegistryNames: 0,
  };
  if (JSON.stringify(evidence.counts) !== JSON.stringify(expectedEvidenceCounts)) {
    throw new Error(`M-P evidence counts changed: ${JSON.stringify(evidence.counts)}.`);
  }
  if (
    base.cards.length !== 83 ||
    evidence.addNumbered.length !== 16 ||
    evidence.addUnnumbered.length !== 15 ||
    clean(base.source.commit) !== clean(evidence.targetSet.baseSourceCommit)
  ) {
    throw new Error("M-P base source or addition population changed after reconciliation approval.");
  }

  const numberedEvidence = evidence.addNumbered.map((card) =>
    parseEvidenceCard(card, false),
  );
  const unnumberedEvidence = evidence.addUnnumbered.map((card) =>
    parseEvidenceCard(card, true),
  );
  const officialCards = [...numberedEvidence, ...unnumberedEvidence];
  const officialIds = new Set(officialCards.map((card) => card.cardID));
  if (officialIds.size !== officialCards.length) {
    throw new Error("M-P addition evidence repeats an official card ID.");
  }

  const baseNumbers = new Set(base.cards.map((card) => normalizedNumber(card.localId)));
  for (const card of numberedEvidence) {
    const number = normalizedNumber(card.numerator);
    if (baseNumbers.has(number)) {
      throw new Error(`Official M-P addition repeats existing printed number ${card.numerator}.`);
    }
    baseNumbers.add(number);
  }

  const additions = officialCards.map(newCard);
  const cards = [...base.cards, ...additions].sort((left, right) =>
    cardSortKey(left).localeCompare(cardSortKey(right)),
  );
  if (cards.length !== 114) {
    throw new Error(`M-P replacement contains ${cards.length} cards instead of 114.`);
  }

  const bundle: PokemonJapaneseMPReconciledBundle = {
    schema: POKEMON_JAPANESE_MP_RECONCILED_SCHEMA,
    phase: "official_mp_reconciliation",
    language: "ja",
    generatedAt: new Date().toISOString(),
    baseSource: {
      repository: base.source.repository,
      commit: base.source.commit,
      setSourcePath: base.set.sourcePath,
      baseCardCount: base.cards.length,
    },
    official: {
      auditGeneratedAt: audit.generatedAt,
      evidenceGeneratedAt: evidence.generatedAt,
      product: {
        value: clean(auditRow.officialProduct.value),
        label: clean(auditRow.officialProduct.label),
        url: productUrl(auditRow.officialProduct.value),
      },
      officialCardCount: 114,
      addedCardCount: 31,
      numberedAddedCardCount: 16,
      unnumberedAddedCardCount: 15,
      cards: officialCards,
    },
    series: base.series,
    set: {
      ...base.set,
      id: TARGET_SET_ID,
      officialCardCount: 114,
    },
    cards,
  };

  await mkdir(outputDirectory, { recursive: true });
  const outputFile = join(outputDirectory, OUTPUT_FILE);
  await writeFile(outputFile, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciledBuildReceipt.v1",
    generatedAt: new Date().toISOString(),
    baseBundle: baseFile,
    evidence: evidencePath,
    auditReceipt: auditPath,
    outputFile,
    status: "built",
    counts: {
      baseCards: 83,
      numberedAdditions: 16,
      unnumberedAdditions: 15,
      additions: 31,
      cards: 114,
    },
  };
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const TARGET_SET_ID = "M-P";
const BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";
const AUDIT_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialVerification.v1";

type BaseCard = TcgdexJapaneseSetBundle["cards"][number];

type DetailEvidence = {
  cardID?: unknown;
  name?: unknown;
  setCode?: unknown;
  numerator?: unknown;
  denominator?: unknown;
  summaryAssetSetCode?: unknown;
  detailUrl?: unknown;
  unnumbered?: unknown;
  error?: unknown;
};

type AuditRow = {
  setId: string;
  setName?: string;
  status: string;
  registryCardCount: number;
  officialCollectedCount?: number | null;
  officialComparableCount?: number | null;
  officialExcludedCount?: number | null;
  officialNumberedCount?: number | null;
  officialUnnumberedCount?: number | null;
  officialAssetSetCodeAnomalyCount?: number | null;
  missingOfficialNamesInRegistry?: Array<{ name: string; count: number }>;
  extraRegistryNames?: Array<{ name: string; count: number }>;
  detailEvidence: DetailEvidence[];
};

type AuditReceipt = {
  schema: string;
  generatedAt: string;
  rows: AuditRow[];
};

type OfficialEvidence = {
  cardID: string;
  name: string;
  setCode: string;
  localId: string | null;
  denominator: string | null;
  detailUrl: string;
  summaryAssetSetCode: string | null;
  unnumbered: boolean;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/build-pokemon-japanese-mp-reconciliation-evidence.ts <tcgdex-bundle-directory> [options]",
      "",
      "Options:",
      "  --audit-receipt <path>  Corrected official audit receipt",
      "  --receipt <path>        Complete read-only M-P reconciliation evidence",
      "  --queue <path>          Bundle-construction queue",
      "",
      "This command is read-only. It creates no Registry versions and performs no Production writes.",
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

function comparableCardName(value: unknown) {
  return clean(value).replace(
    /^(博士の研究|ボスの指令)[(（][^()（）]+[)）]$/u,
    "$1",
  );
}

function compactName(value: unknown) {
  return comparableCardName(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizedCardNumber(value: unknown) {
  const text = clean(value).toUpperCase();
  if (/^\d+$/.test(text)) return String(Number(text));
  return text.replace(/\s+/g, "");
}

function parseBundle(content: string, file: string) {
  const parsed = JSON.parse(content) as TcgdexJapaneseSetBundle;
  if (
    parsed.schema !== TCGDEX_JAPANESE_BUNDLE_SCHEMA ||
    parsed.language !== "ja" ||
    clean(parsed.set?.id).toUpperCase() !== TARGET_SET_ID ||
    !Array.isArray(parsed.cards)
  ) {
    throw new Error(`${file} is not the supported Japanese ${TARGET_SET_ID} bundle.`);
  }
  return parsed;
}

async function loadTargetBundle(directory: string) {
  for (const name of (await readdir(directory)).filter((entry) =>
    entry.endsWith(BUNDLE_SUFFIX),
  )) {
    const file = join(directory, name);
    const raw = await readFile(file, "utf8");
    const candidate = JSON.parse(raw) as Partial<TcgdexJapaneseSetBundle>;
    if (clean(candidate.set?.id).toUpperCase() === TARGET_SET_ID) {
      return { file, bundle: parseBundle(raw, file) };
    }
  }
  throw new Error(`${TARGET_SET_ID} base bundle was not found in ${directory}.`);
}

function parseOfficialEvidence(detail: DetailEvidence): OfficialEvidence {
  const cardID = clean(detail.cardID);
  const name = clean(detail.name);
  const setCode = clean(detail.setCode);
  const numerator = clean(detail.numerator) || null;
  const detailUrl = clean(detail.detailUrl);
  if (
    !cardID ||
    !name ||
    setCode.toUpperCase() !== TARGET_SET_ID ||
    !/^https:\/\/www\.pokemon-card\.com\/card-search\//i.test(detailUrl) ||
    detail.error
  ) {
    throw new Error(
      `Official M-P detail evidence is incomplete for card ${cardID || "unknown"}.`,
    );
  }
  const unnumbered = numerator === null;
  if (Boolean(detail.unnumbered) !== unnumbered) {
    throw new Error(`Official card ${cardID} has inconsistent unnumbered evidence.`);
  }
  return {
    cardID,
    name,
    setCode,
    localId: numerator,
    denominator: clean(detail.denominator) || null,
    detailUrl,
    summaryAssetSetCode: clean(detail.summaryAssetSetCode) || null,
    unnumbered,
  };
}

function baseEvidence(card: BaseCard) {
  return {
    bundleCardId: clean(card.id),
    localId: clean(card.localId),
    name: clean(card.name),
    sourcePath: clean(card.sourcePath) || null,
  };
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
  const auditPath = resolve(
    argumentValue("--audit-receipt") ||
      ".codex-run/pokemon-ja-official-verification-receipt.json",
  );
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-mp-reconciliation-evidence.json",
  );
  const queuePath = resolve(
    argumentValue("--queue") ||
      ".codex-run/pokemon-ja-mp-reconciliation-bundle-queue.json",
  );

  const audit = JSON.parse(await readFile(auditPath, "utf8")) as AuditReceipt;
  if (audit.schema !== AUDIT_SCHEMA || !Array.isArray(audit.rows)) {
    throw new Error(`${auditPath} is not a supported official audit receipt.`);
  }
  const row = audit.rows.find(
    (candidate) => clean(candidate.setId).toUpperCase() === TARGET_SET_ID,
  );
  if (!row || row.status !== "mismatch") {
    throw new Error(`${TARGET_SET_ID} is not a hard mismatch in ${auditPath}.`);
  }

  const { file: baseFile, bundle } = await loadTargetBundle(inputDirectory);
  const officialCards = row.detailEvidence.map(parseOfficialEvidence);
  const uniqueOfficialIds = new Set(officialCards.map((card) => card.cardID));
  if (uniqueOfficialIds.size !== officialCards.length) {
    throw new Error("Official M-P detail evidence repeats an official card ID.");
  }
  if (
    row.officialCollectedCount !== 114 ||
    row.officialComparableCount !== 114 ||
    row.officialExcludedCount !== 0 ||
    row.officialNumberedCount !== 99 ||
    row.officialUnnumberedCount !== 15 ||
    row.officialAssetSetCodeAnomalyCount !== 8 ||
    officialCards.length !== 114
  ) {
    throw new Error(
      `Corrected M-P audit population is unexpected: ${JSON.stringify({
        officialCollectedCount: row.officialCollectedCount,
        officialComparableCount: row.officialComparableCount,
        officialExcludedCount: row.officialExcludedCount,
        officialNumberedCount: row.officialNumberedCount,
        officialUnnumberedCount: row.officialUnnumberedCount,
        officialAssetSetCodeAnomalyCount: row.officialAssetSetCodeAnomalyCount,
        detailEvidence: officialCards.length,
      })}`,
    );
  }

  const numberedOfficial = officialCards.filter(
    (card): card is OfficialEvidence & { localId: string } =>
      card.localId !== null,
  );
  const unnumberedOfficial = officialCards.filter(
    (card) => card.localId === null,
  );
  const officialByNumber = new Map<string, OfficialEvidence>();
  for (const card of numberedOfficial) {
    const key = normalizedCardNumber(card.localId);
    if (officialByNumber.has(key)) {
      throw new Error(`Official M-P evidence repeats printed number ${card.localId}.`);
    }
    officialByNumber.set(key, card);
  }

  const existingMatches = [];
  const baseNumbers = new Set<string>();
  for (const card of bundle.cards) {
    const key = normalizedCardNumber(card.localId);
    if (baseNumbers.has(key)) {
      throw new Error(`TCGdex M-P repeats printed number ${card.localId}.`);
    }
    baseNumbers.add(key);
    const official = officialByNumber.get(key);
    if (!official) {
      throw new Error(
        `TCGdex M-P card ${card.localId} ${card.name} is absent from corrected official evidence.`,
      );
    }
    if (compactName(card.name) !== compactName(official.name)) {
      throw new Error(
        `M-P card ${card.localId} name mismatch: ${card.name} / ${official.name}.`,
      );
    }
    existingMatches.push({
      registry: baseEvidence(card),
      official,
    });
  }

  const addNumbered = numberedOfficial.filter(
    (card) => !baseNumbers.has(normalizedCardNumber(card.localId)),
  );
  const addUnnumbered = unnumberedOfficial.map((card) => ({
    ...card,
    suggestedLocalId: "UNNUMBERED",
    suggestedVariation: `Official Card ${card.cardID}`,
  }));
  const assetPathAnomalies = officialCards.filter(
    (card) =>
      card.summaryAssetSetCode &&
      card.summaryAssetSetCode.toUpperCase() !== TARGET_SET_ID,
  );

  const missingNameCount = (row.missingOfficialNamesInRegistry || []).reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const extraNameCount = (row.extraRegistryNames || []).reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const counts = {
    registryCards: bundle.cards.length,
    officialCards: officialCards.length,
    existingExactMatches: existingMatches.length,
    addNumberedCards: addNumbered.length,
    addUnnumberedCards: addUnnumbered.length,
    finalCards: existingMatches.length + addNumbered.length + addUnnumbered.length,
    netAdditions: officialCards.length - bundle.cards.length,
    assetPathSetCodeAnomalies: assetPathAnomalies.length,
    missingOfficialNames: missingNameCount,
    extraRegistryNames: extraNameCount,
  };
  const safeForBundleConstruction =
    counts.registryCards === 83 &&
    counts.officialCards === 114 &&
    counts.existingExactMatches === 83 &&
    counts.addNumberedCards === 16 &&
    counts.addUnnumberedCards === 15 &&
    counts.finalCards === 114 &&
    counts.netAdditions === 31 &&
    counts.assetPathSetCodeAnomalies === 8 &&
    counts.missingOfficialNames === 31 &&
    counts.extraRegistryNames === 0;

  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciliationEvidence.v1",
    mode: "read_only",
    generatedAt: new Date().toISOString(),
    targetSet: {
      id: TARGET_SET_ID,
      name: clean(bundle.set.name),
      baseBundle: baseFile,
      baseSourceCommit: clean(bundle.source.commit),
    },
    auditGeneratedAt: clean(audit.generatedAt),
    counts,
    safeForBundleConstruction,
    automaticProductionWriteAllowed: false,
    existingMatches,
    addNumbered,
    addUnnumbered,
    assetPathAnomalies,
  };
  const queue = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciliationBundleQueue.v1",
    mode: safeForBundleConstruction
      ? "bundle_construction_ready"
      : "manual_reconciliation_required",
    generatedAt: receipt.generatedAt,
    targetSet: receipt.targetSet,
    counts,
    safeForBundleConstruction,
    automaticProductionWriteAllowed: false,
    keepExisting: existingMatches,
    addNumbered,
    addUnnumbered,
    assetPathAnomalies,
  };

  await mkdir(dirname(receiptPath), { recursive: true });
  await mkdir(dirname(queuePath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        schema: receipt.schema,
        mode: receipt.mode,
        targetSet: receipt.targetSet,
        counts,
        safeForBundleConstruction,
        automaticProductionWriteAllowed: false,
        receipt: receiptPath,
        queue: queuePath,
      },
      null,
      2,
    ),
  );

  if (!safeForBundleConstruction) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

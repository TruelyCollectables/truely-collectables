import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialVerification.v1";
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialDiscrepancyQueue.v1";
const REUSED_PRODUCT_REASON =
  "official_product_mapped_to_multiple_registry_sets";

type DetailEvidence = {
  numberMatches?: boolean | null;
  [key: string]: unknown;
};

type AuditRow = {
  status: string;
  reasons?: string[];
  registryCardCount?: number;
  officialCollectedCount?: number | null;
  officialComparableCount?: number | null;
  officialExcludedCount?: number;
  detailEvidence?: DetailEvidence[];
  [key: string]: unknown;
};

type Receipt = {
  schema: string;
  generatedAt: string;
  officialSource: unknown;
  statusCounts: Record<string, number>;
  totals: Record<string, number>;
  rows: AuditRow[];
  [key: string]: unknown;
};

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : null;
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quarantineReusedProducts(receipt: Receipt) {
  let quarantinedRows = 0;

  for (const row of receipt.rows) {
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    if (
      row.status !== "failed" &&
      reasons.includes(REUSED_PRODUCT_REASON) &&
      row.status !== "official_source_reused"
    ) {
      row.status = "official_source_reused";
      quarantinedRows += 1;
    }
  }

  const statusCounts = receipt.rows.reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    },
    {},
  );
  const discrepancyRows = receipt.rows.filter(
    (row) => row.status !== "verified",
  );

  receipt.statusCounts = statusCounts;
  receipt.totals = {
    ...receipt.totals,
    registryCards: receipt.rows.reduce(
      (sum, row) => sum + numeric(row.registryCardCount),
      0,
    ),
    officialCardsCollected: receipt.rows.reduce(
      (sum, row) =>
        sum +
        numeric(
          row.officialComparableCount ?? row.officialCollectedCount,
        ),
      0,
    ),
    officialProductCardsCollected: receipt.rows.reduce(
      (sum, row) => sum + numeric(row.officialCollectedCount),
      0,
    ),
    excludedOfficialCards: receipt.rows.reduce(
      (sum, row) => sum + numeric(row.officialExcludedCount),
      0,
    ),
    verifiedSets: statusCounts.verified || 0,
    discrepancySets: discrepancyRows.length,
    unmappedSets: statusCounts.official_source_unmapped || 0,
    ambiguousSets:
      (statusCounts.official_source_ambiguous || 0) +
      (statusCounts.official_source_reused || 0),
    mismatchedSets: statusCounts.mismatch || 0,
    failedSets: statusCounts.failed || 0,
    detailSamples: receipt.rows.reduce(
      (sum, row) => sum + (row.detailEvidence?.length || 0),
      0,
    ),
    printedNumberMismatches: receipt.rows.reduce(
      (sum, row) =>
        sum +
        (row.detailEvidence || []).filter(
          (detail) => detail.numberMatches === false,
        ).length,
      0,
    ),
  };

  return { quarantinedRows, discrepancyRows };
}

async function main() {
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-official-verification-receipt.json",
  );
  const queuePath = resolve(
    argumentValue("--queue") ||
      ".codex-run/pokemon-ja-official-discrepancy-queue.json",
  );

  const receipt = JSON.parse(
    await readFile(receiptPath, "utf8"),
  ) as Receipt;
  if (
    receipt.schema !== RECEIPT_SCHEMA ||
    !Array.isArray(receipt.rows)
  ) {
    throw new Error(`${receiptPath} is not a supported audit receipt.`);
  }

  const { quarantinedRows, discrepancyRows } =
    quarantineReusedProducts(receipt);
  const queue = {
    schema: QUEUE_SCHEMA,
    generatedAt: receipt.generatedAt,
    officialSource: receipt.officialSource,
    rows: discrepancyRows,
  };

  await writeFile(
    receiptPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    queuePath,
    `${JSON.stringify(queue, null, 2)}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        schema: receipt.schema,
        quarantinedRows,
        statusCounts: receipt.statusCounts,
        totals: receipt.totals,
        receipt: receiptPath,
        discrepancyQueue: queuePath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : error,
  );
  process.exitCode = 1;
});

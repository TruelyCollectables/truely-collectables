import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";
const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialVerification.v1";
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialDiscrepancyQueue.v1";

type BundleCard = TcgdexJapaneseSetBundle["cards"][number];

type DetailEvidence = {
  name: string | null;
  numerator: string | null;
  expectedName: string | null;
  expectedLocalId: string | null;
  registryCandidateCount?: number;
  nameMatches: boolean | null;
  numberMatches: boolean | null;
  setCodeMatches: boolean | null;
  error: string | null;
  [key: string]: unknown;
};

type AuditRow = {
  setId: string;
  status: string;
  officialProduct: unknown;
  officialCollectedCount: number | null;
  registryCardCount: number;
  countMatches: boolean | null;
  setCodeMatches: boolean | null;
  nameMultisetMatches: boolean | null;
  orderedNameMismatchCount: number | null;
  reasons: string[];
  detailEvidence: DetailEvidence[];
  [key: string]: unknown;
};

type Receipt = {
  schema: string;
  generatedAt: string;
  officialSource: unknown;
  attemptedSets: number;
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

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return clean(value)
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
    !Array.isArray(parsed.cards)
  ) {
    throw new Error(`${file} is not a supported Japanese TCGdex bundle.`);
  }
  return parsed;
}

async function loadBundles(directory: string) {
  const bundles = new Map<string, TcgdexJapaneseSetBundle>();
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(BUNDLE_SUFFIX))
    .sort((a, b) => a.localeCompare(b));

  for (const name of names) {
    const file = join(directory, name);
    const bundle = parseBundle(await readFile(file, "utf8"), file);
    bundles.set(clean(bundle.set.id).toLowerCase(), bundle);
  }
  return bundles;
}

function cardsByNumber(cards: BundleCard[]) {
  const result = new Map<string, BundleCard[]>();
  for (const card of cards) {
    const key = normalizedCardNumber(card.localId);
    if (!key) continue;
    const matches = result.get(key) || [];
    matches.push(card);
    result.set(key, matches);
  }
  return result;
}

function repairDetailEvidence(
  detail: DetailEvidence,
  byNumber: Map<string, BundleCard[]>,
) {
  const candidates = detail.numerator
    ? byNumber.get(normalizedCardNumber(detail.numerator)) || []
    : [];
  const expected = candidates.length === 1 ? candidates[0] : null;

  detail.expectedName = expected ? clean(expected.name) : null;
  detail.expectedLocalId = expected ? clean(expected.localId) : null;
  detail.registryCandidateCount = candidates.length;
  detail.nameMatches =
    detail.name && expected
      ? compact(detail.name) === compact(expected.name)
      : null;
  detail.numberMatches =
    detail.numerator === null
      ? null
      : candidates.length === 0
        ? false
        : candidates.length === 1
          ? true
          : null;

  if (!detail.numerator) {
    detail.error =
      detail.error ||
      "Official detail page did not expose a printed number.";
  } else if (candidates.length > 1) {
    detail.error =
      `Multiple Registry cards use official printed number ${detail.numerator}.`;
  }

  return detail;
}

const DETAIL_REASONS = new Set([
  "official_detail_fetch_incomplete",
  "official_detail_name_mismatch",
  "official_printed_number_mismatch",
  "official_detail_set_code_mismatch",
]);

function finalizeAuditedRow(
  row: AuditRow,
  bundle: TcgdexJapaneseSetBundle,
) {
  const byNumber = cardsByNumber(bundle.cards);
  row.detailEvidence = row.detailEvidence.map((detail) =>
    repairDetailEvidence(detail, byNumber),
  );
  row.reasons = row.reasons.filter(
    (reason) => !DETAIL_REASONS.has(reason),
  );

  if (row.detailEvidence.some((detail) => Boolean(detail.error))) {
    row.reasons.push("official_detail_fetch_incomplete");
  }
  if (
    row.detailEvidence.some(
      (detail) => detail.nameMatches === false,
    )
  ) {
    row.reasons.push("official_detail_name_mismatch");
  }
  if (
    row.detailEvidence.some(
      (detail) => detail.numberMatches === false,
    )
  ) {
    row.reasons.push("official_printed_number_mismatch");
  }
  if (
    row.detailEvidence.some(
      (detail) => detail.setCodeMatches === false,
    )
  ) {
    row.reasons.push("official_detail_set_code_mismatch");
  }

  const hardMismatch =
    row.countMatches === false ||
    row.setCodeMatches === false ||
    row.nameMultisetMatches === false ||
    row.detailEvidence.some(
      (detail) =>
        detail.nameMatches === false ||
        detail.numberMatches === false ||
        detail.setCodeMatches === false,
    );
  const manualReview =
    !hardMismatch &&
    ((row.orderedNameMismatchCount || 0) > 0 ||
      row.detailEvidence.some((detail) => Boolean(detail.error)));

  row.status = hardMismatch
    ? "mismatch"
    : manualReview
      ? "manual_review"
      : "verified";
}

function rebuildTotals(receipt: Receipt) {
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
    registryCards: receipt.rows.reduce(
      (sum, row) => sum + row.registryCardCount,
      0,
    ),
    officialCardsCollected: receipt.rows.reduce(
      (sum, row) => sum + (row.officialCollectedCount || 0),
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
      (sum, row) => sum + row.detailEvidence.length,
      0,
    ),
    printedNumberMismatches: receipt.rows.reduce(
      (sum, row) =>
        sum +
        row.detailEvidence.filter(
          (detail) => detail.numberMatches === false,
        ).length,
      0,
    ),
  };

  return discrepancyRows;
}

async function main() {
  const positional = process.argv[2];
  const bundleDirectory = resolve(
    positional && !positional.startsWith("--")
      ? positional
      : ".codex-run/tcgdex-ja-registry-bundles",
  );
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

  const bundles = await loadBundles(bundleDirectory);
  for (const row of receipt.rows) {
    if (
      !row.officialProduct ||
      row.officialCollectedCount === null ||
      !Array.isArray(row.detailEvidence) ||
      row.status === "failed"
    ) {
      continue;
    }
    const bundle = bundles.get(clean(row.setId).toLowerCase());
    if (!bundle) {
      throw new Error(
        `No Japanese bundle found for audited set ${row.setId}.`,
      );
    }
    finalizeAuditedRow(row, bundle);
  }

  const discrepancyRows = rebuildTotals(receipt);
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
        attemptedSets: receipt.attemptedSets,
        statusCounts: receipt.statusCounts,
        totals: receipt.totals,
        receipt: receiptPath,
        discrepancyQueue: queuePath,
      },
      null,
      2,
    ),
  );

  if ((receipt.statusCounts.failed || 0) > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : error,
  );
  process.exitCode = 1;
});

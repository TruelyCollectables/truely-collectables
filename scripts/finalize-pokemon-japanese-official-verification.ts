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
const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;

const REQUEST_HEADERS = {
  accept: "application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Verification/1.1 (+https://totallycollectibles.com)",
};

type BundleCard = TcgdexJapaneseSetBundle["cards"][number];

type OfficialProductOption = {
  value: string;
  label: string;
};

type OfficialCardSummary = {
  cardID: string;
  cardNameAltText?: string;
  cardNameViewText?: string;
  cardThumbFile?: string;
};

type OfficialResultResponse = {
  result: number;
  errMsg?: string;
  regulation: string;
  hitCnt: number;
  maxPage: number;
  cardList: OfficialCardSummary[];
};

type DetailEvidence = {
  name: string | null;
  setCode?: string | null;
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

type NameCount = {
  name: string;
  count: number;
};

type OrderedNameMismatch = {
  position: number;
  localId: string | null;
  registryName: string | null;
  officialName: string | null;
  cardID: string | null;
};

type AuditRow = {
  setId: string;
  status: string;
  officialProduct: OfficialProductOption | null;
  officialHitCount: number | null;
  officialCollectedCount: number | null;
  officialComparableCount?: number | null;
  officialExcludedCount?: number;
  officialExcludedSetCodes?: string[];
  officialSetCodes?: string[];
  registryCardCount: number;
  countMatches: boolean | null;
  setCodeMatches: boolean | null;
  nameMultisetMatches: boolean | null;
  orderedNameMismatchCount: number | null;
  orderedNameMismatches?: OrderedNameMismatch[];
  missingOfficialNamesInRegistry?: NameCount[];
  extraRegistryNames?: NameCount[];
  reasons: string[];
  detailEvidence: DetailEvidence[];
  error?: string | null;
  [key: string]: unknown;
};

type Receipt = {
  schema: string;
  generatedAt: string;
  mode?: string;
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

function numericArgument(flag: string, fallback: number) {
  const raw = argumentValue(flag);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer.`);
  }
  return parsed;
}

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableCardName(value: unknown) {
  const name = clean(value);
  return name.replace(
    /^(博士の研究|ボスの指令)[(（][^()（）]+[)）]$/u,
    "$1",
  );
}

function compact(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function comparableNameKey(value: unknown) {
  return compact(comparableCardName(value));
}

function normalizedCardNumber(value: unknown) {
  const text = clean(value).toUpperCase();
  if (/^\d+$/.test(text)) return String(Number(text));
  return text.replace(/\s+/g, "");
}

function sleep(ms: number) {
  return ms > 0
    ? new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
    : Promise.resolve();
}

async function fetchWithRetry(url: string, delayMs: number) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (attempt > 1 || delayMs > 0) await sleep(delayMs * attempt);
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        redirect: "follow",
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          `${response.status} ${response.statusText}: ${body.slice(0, 300)}`,
        );
      }
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
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

function officialCardName(card: OfficialCardSummary) {
  return clean(card.cardNameViewText || card.cardNameAltText || "");
}

function officialSetCode(card: OfficialCardSummary) {
  return (
    clean(card.cardThumbFile).match(
      /\/card_images\/large\/([^/]+)\//i,
    )?.[1] || null
  );
}

async function fetchOfficialCards(
  option: OfficialProductOption,
  delayMs: number,
) {
  const cards: OfficialCardSummary[] = [];
  let page = 1;
  let maxPage = 1;
  let hitCnt: number | null = null;

  do {
    const url = new URL(OFFICIAL_RESULT_API);
    url.searchParams.set("mode", "statuslist");
    url.searchParams.set("pg", option.value);
    if (page > 1) url.searchParams.set("page", String(page));

    const parsed = JSON.parse(
      await fetchWithRetry(url.href, delayMs),
    ) as OfficialResultResponse;
    if (parsed.result !== 1 || !Array.isArray(parsed.cardList)) {
      throw new Error(
        `Official result API rejected ${option.value}: ${clean(parsed.errMsg) || "unknown error"}.`,
      );
    }
    if (page === 1) {
      maxPage = Number(parsed.maxPage) || 1;
      hitCnt = Number.isInteger(parsed.hitCnt)
        ? Number(parsed.hitCnt)
        : null;
    }
    cards.push(...parsed.cardList);
    page += 1;
  } while (page <= maxPage);

  const uniqueCards = new Map<string, OfficialCardSummary>();
  for (const card of cards) {
    const id = clean(card.cardID);
    if (id) uniqueCards.set(id, card);
  }
  return {
    cards: [...uniqueCards.values()],
    hitCnt,
  };
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

function nameCounts(values: string[]) {
  const counts = new Map<string, NameCount>();
  for (const value of values) {
    const name = comparableCardName(value);
    const key = comparableNameKey(name);
    if (!key) continue;
    const row = counts.get(key) || { name, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  return counts;
}

function subtractNameCounts(
  left: Map<string, NameCount>,
  right: Map<string, NameCount>,
) {
  return [...left.entries()]
    .map(([key, row]) => ({
      name: row.name,
      count: row.count - (right.get(key)?.count || 0),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
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
      ? comparableNameKey(detail.name) === comparableNameKey(expected.name)
      : null;
  detail.numberMatches =
    detail.numerator === null
      ? null
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
  } else if (candidates.length === 0) {
    detail.error = null;
  }

  return detail;
}

const COMPARISON_REASONS = new Set([
  "official_card_count_mismatch",
  "official_set_code_mismatch",
  "official_name_population_mismatch",
  "official_ordered_name_mismatch",
  "official_detail_fetch_incomplete",
  "official_detail_name_mismatch",
  "official_printed_number_mismatch",
  "official_detail_set_code_mismatch",
]);

function rebuildComparisonReasons(row: AuditRow) {
  row.reasons = row.reasons.filter(
    (reason) => !COMPARISON_REASONS.has(reason),
  );

  if (row.countMatches === false) {
    row.reasons.push("official_card_count_mismatch");
  }
  if (row.setCodeMatches === false) {
    row.reasons.push("official_set_code_mismatch");
  }
  if (row.nameMultisetMatches === false) {
    row.reasons.push("official_name_population_mismatch");
  }
  if ((row.orderedNameMismatchCount || 0) > 0) {
    row.reasons.push("official_ordered_name_mismatch");
  }
  if (row.detailEvidence.some((detail) => Boolean(detail.error))) {
    row.reasons.push("official_detail_fetch_incomplete");
  }
  if (row.detailEvidence.some((detail) => detail.nameMatches === false)) {
    row.reasons.push("official_detail_name_mismatch");
  }
  if (row.detailEvidence.some((detail) => detail.numberMatches === false)) {
    row.reasons.push("official_printed_number_mismatch");
  }
  if (row.detailEvidence.some((detail) => detail.setCodeMatches === false)) {
    row.reasons.push("official_detail_set_code_mismatch");
  }
}

function classifyAuditedRow(row: AuditRow) {
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

async function finalizeAuditedRow(
  row: AuditRow,
  bundle: TcgdexJapaneseSetBundle,
  delayMs: number,
) {
  if (!row.officialProduct) return;

  const official = await fetchOfficialCards(row.officialProduct, delayMs);
  const targetSetId = clean(bundle.set.id).toLowerCase();
  const exactTargetCards = official.cards.filter(
    (card) => officialSetCode(card)?.toLowerCase() === targetSetId,
  );
  const comparableCards = exactTargetCards.length
    ? exactTargetCards
    : official.cards;
  const excludedCards = official.cards.filter(
    (card) => !comparableCards.includes(card),
  );

  row.officialHitCount = official.hitCnt;
  row.officialCollectedCount = official.cards.length;
  row.officialComparableCount = comparableCards.length;
  row.officialExcludedCount = excludedCards.length;
  row.officialSetCodes = [
    ...new Set(
      official.cards
        .map(officialSetCode)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  row.officialExcludedSetCodes = [
    ...new Set(
      excludedCards
        .map(officialSetCode)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  row.countMatches = bundle.cards.length === comparableCards.length;
  row.setCodeMatches = exactTargetCards.length
    ? true
    : row.officialSetCodes.length === 0
      ? null
      : false;

  const registryNames = bundle.cards.map((card) => clean(card.name));
  const officialNames = comparableCards.map(officialCardName);
  const registryCounts = nameCounts(registryNames);
  const officialCounts = nameCounts(officialNames);
  row.missingOfficialNamesInRegistry = subtractNameCounts(
    officialCounts,
    registryCounts,
  );
  row.extraRegistryNames = subtractNameCounts(
    registryCounts,
    officialCounts,
  );
  row.nameMultisetMatches =
    row.missingOfficialNamesInRegistry.length === 0 &&
    row.extraRegistryNames.length === 0;

  const orderedMismatches: OrderedNameMismatch[] = [];
  const comparableLength = Math.min(
    registryNames.length,
    officialNames.length,
  );
  for (let index = 0; index < comparableLength; index += 1) {
    if (
      comparableNameKey(registryNames[index]) ===
      comparableNameKey(officialNames[index])
    ) {
      continue;
    }
    if (orderedMismatches.length < 50) {
      orderedMismatches.push({
        position: index + 1,
        localId: clean(bundle.cards[index]?.localId) || null,
        registryName: registryNames[index] || null,
        officialName: officialNames[index] || null,
        cardID: clean(comparableCards[index]?.cardID) || null,
      });
    }
  }
  row.orderedNameMismatchCount =
    orderedMismatches.length +
    Math.abs(registryNames.length - officialNames.length);
  row.orderedNameMismatches = orderedMismatches;

  const byNumber = cardsByNumber(bundle.cards);
  row.detailEvidence = row.detailEvidence
    .filter((detail) => {
      const detailSetCode = clean(detail.setCode).toLowerCase();
      return !detailSetCode || detailSetCode === targetSetId;
    })
    .map((detail) => repairDetailEvidence(detail, byNumber));

  rebuildComparisonReasons(row);
  classifyAuditedRow(row);
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
      (sum, row) =>
        sum +
        (row.officialComparableCount ?? row.officialCollectedCount ?? 0),
      0,
    ),
    officialProductCardsCollected: receipt.rows.reduce(
      (sum, row) => sum + (row.officialCollectedCount || 0),
      0,
    ),
    excludedOfficialCards: receipt.rows.reduce(
      (sum, row) => sum + (row.officialExcludedCount || 0),
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
  const delayMs = numericArgument("--delay-ms", 125);

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
  if (receipt.mode !== "mapping_only") {
    for (const row of receipt.rows) {
      if (
        !row.officialProduct ||
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
      await finalizeAuditedRow(row, bundle, delayMs);
    }
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

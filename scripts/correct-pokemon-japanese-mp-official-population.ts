import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const TARGET_SET_ID = "M-P";
const BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";
const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialVerification.v1";
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseOfficialDiscrepancyQueue.v1";
const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-MP-Population-Correction/1.0 (+https://totallycollectibles.com)",
};

type BundleCard = TcgdexJapaneseSetBundle["cards"][number];

type OfficialProduct = {
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

type OfficialCardDetail = {
  cardID: string;
  summaryName: string;
  summaryAssetSetCode: string | null;
  detailUrl: string;
  name: string;
  setCode: string;
  numerator: string | null;
  denominator: string | null;
};

type NameCount = {
  name: string;
  count: number;
};

type AuditRow = {
  setId: string;
  setName?: string;
  status: string;
  officialProduct: OfficialProduct | null;
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
  orderedNameMismatches?: unknown[];
  missingOfficialNamesInRegistry?: NameCount[];
  extraRegistryNames?: NameCount[];
  reasons: string[];
  detailEvidence: Array<Record<string, unknown>>;
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

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/correct-pokemon-japanese-mp-official-population.ts <tcgdex-bundle-directory> [options]",
      "",
      "Options:",
      "  --receipt <path>     Official verification receipt to correct",
      "  --queue <path>       Discrepancy queue to rebuild",
      "  --delay-ms <number>  Delay between official detail requests (default 75)",
      "",
      "This command corrects only the M-P audit row using all official detail pages. It never writes to the Registry.",
    ].join("\n"),
  );
}

function argumentValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
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

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function clean(value: unknown) {
  return decodeHtml(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
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

function sleep(ms: number) {
  return ms > 0
    ? new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
    : Promise.resolve();
}

async function fetchWithRetry(url: string, delayMs: number, accept: string) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (attempt > 1 || delayMs > 0) await sleep(delayMs * attempt);
      const response = await fetch(url, {
        headers: { ...REQUEST_HEADERS, accept },
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

function officialCardName(card: OfficialCardSummary) {
  return clean(card.cardNameViewText || card.cardNameAltText || "");
}

function officialAssetSetCode(card: OfficialCardSummary) {
  return (
    clean(card.cardThumbFile).match(
      /\/card_images\/large\/([^/]+)\//i,
    )?.[1] || null
  );
}

function parseDetail(html: string) {
  const heading = html.match(
    /<h1[^>]*class=["'][^"']*Heading1[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  );
  const logo = html.match(
    /<img[^>]*class=["'][^"']*img-regulation[^"']*["'][^>]*>/i,
  )?.[0];
  const setCode = logo?.match(/alt=["']([^"']+)["']/i)?.[1] || null;
  const logoIndex = logo ? html.indexOf(logo) : -1;
  const afterLogo =
    logo && logoIndex >= 0
      ? html.slice(logoIndex + logo.length, logoIndex + logo.length + 220)
      : "";
  const numberMatch = afterLogo.match(
    /(?:&nbsp;|\s)+([0-9A-Z-]+)(?:&nbsp;|\s)*\/(?:&nbsp;|\s)*([0-9A-Z-]+)/i,
  );
  return {
    name: heading ? clean(heading[1]) : "",
    setCode: setCode ? clean(setCode) : "",
    numerator: numberMatch ? clean(numberMatch[1]) : null,
    denominator: numberMatch ? clean(numberMatch[2]) : null,
  };
}

async function fetchOfficialCards(product: OfficialProduct, delayMs: number) {
  const cards: OfficialCardSummary[] = [];
  let page = 1;
  let maxPage = 1;
  let hitCnt: number | null = null;
  let regulation = "all";

  do {
    const url = new URL(OFFICIAL_RESULT_API);
    url.searchParams.set("mode", "statuslist");
    url.searchParams.set("pg", product.value);
    if (page > 1) url.searchParams.set("page", String(page));
    const parsed = JSON.parse(
      await fetchWithRetry(
        url.href,
        delayMs,
        "application/json,*/*;q=0.8",
      ),
    ) as OfficialResultResponse;
    if (parsed.result !== 1 || !Array.isArray(parsed.cardList)) {
      throw new Error(
        `Official result API rejected ${product.value}: ${clean(parsed.errMsg) || "unknown error"}.`,
      );
    }
    if (page === 1) {
      maxPage = Number(parsed.maxPage) || 1;
      hitCnt = Number.isInteger(parsed.hitCnt) ? Number(parsed.hitCnt) : null;
      regulation = clean(parsed.regulation) || "all";
    }
    cards.push(...parsed.cardList);
    page += 1;
  } while (page <= maxPage);

  const unique = new Map<string, OfficialCardSummary>();
  for (const card of cards) {
    const id = clean(card.cardID);
    if (id) unique.set(id, card);
  }
  return { cards: [...unique.values()], hitCnt, regulation };
}

async function fetchCardDetail(params: {
  card: OfficialCardSummary;
  regulation: string;
  delayMs: number;
}): Promise<OfficialCardDetail> {
  const cardID = clean(params.card.cardID);
  const detailUrl =
    `${OFFICIAL_ORIGIN}/card-search/details.php/card/` +
    `${encodeURIComponent(cardID)}/regu/${encodeURIComponent(params.regulation)}`;
  const parsed = parseDetail(
    await fetchWithRetry(
      detailUrl,
      params.delayMs,
      "text/html,application/xhtml+xml",
    ),
  );
  if (!parsed.name || !parsed.setCode) {
    throw new Error(`Official detail ${cardID} is missing name or set code.`);
  }
  return {
    cardID,
    summaryName: officialCardName(params.card),
    summaryAssetSetCode: officialAssetSetCode(params.card),
    detailUrl,
    ...parsed,
  };
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
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(BUNDLE_SUFFIX),
  );
  for (const name of names) {
    const file = join(directory, name);
    const raw = await readFile(file, "utf8");
    const candidate = JSON.parse(raw) as Partial<TcgdexJapaneseSetBundle>;
    if (clean(candidate.set?.id).toUpperCase() === TARGET_SET_ID) {
      return parseBundle(raw, file);
    }
  }
  throw new Error(`${TARGET_SET_ID} base bundle was not found in ${directory}.`);
}

function nameCounts(values: string[]) {
  const counts = new Map<string, NameCount>();
  for (const value of values) {
    const name = comparableCardName(value);
    const key = compactName(name);
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

function rebuildTotals(receipt: Receipt) {
  receipt.statusCounts = receipt.rows.reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    },
    {},
  );
  const discrepancyRows = receipt.rows.filter(
    (row) => row.status !== "verified",
  );
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
    verifiedSets: receipt.statusCounts.verified || 0,
    discrepancySets: discrepancyRows.length,
    unmappedSets: receipt.statusCounts.official_source_unmapped || 0,
    ambiguousSets:
      (receipt.statusCounts.official_source_ambiguous || 0) +
      (receipt.statusCounts.official_source_reused || 0),
    mismatchedSets: receipt.statusCounts.mismatch || 0,
    failedSets: receipt.statusCounts.failed || 0,
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
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
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
  const delayMs = numericArgument("--delay-ms", 75);

  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Receipt;
  if (receipt.schema !== RECEIPT_SCHEMA || !Array.isArray(receipt.rows)) {
    throw new Error(`${receiptPath} is not a supported official audit receipt.`);
  }
  const row = receipt.rows.find(
    (candidate) => clean(candidate.setId).toUpperCase() === TARGET_SET_ID,
  );
  if (!row || !row.officialProduct || row.status === "failed") {
    console.log(
      JSON.stringify(
        {
          schema: RECEIPT_SCHEMA,
          corrected: false,
          reason: row ? "M-P was not auditable." : "M-P was not in the receipt.",
          receipt: receiptPath,
          discrepancyQueue: queuePath,
        },
        null,
        2,
      ),
    );
    return;
  }

  const bundle = await loadTargetBundle(bundleDirectory);
  const product = await fetchOfficialCards(row.officialProduct, delayMs);
  if (product.hitCnt !== null && product.cards.length !== product.hitCnt) {
    throw new Error(
      `Official API pagination collected ${product.cards.length}/${product.hitCnt} M-P cards.`,
    );
  }

  const details: OfficialCardDetail[] = [];
  for (const card of product.cards) {
    const detail = await fetchCardDetail({
      card,
      regulation: product.regulation,
      delayMs,
    });
    if (clean(detail.setCode).toUpperCase() !== TARGET_SET_ID) {
      throw new Error(
        `Official card ${detail.cardID} prints set ${detail.setCode}, expected ${TARGET_SET_ID}.`,
      );
    }
    if (
      detail.summaryName &&
      compactName(detail.summaryName) !== compactName(detail.name)
    ) {
      throw new Error(
        `Official card ${detail.cardID} summary/detail name mismatch: ${detail.summaryName} / ${detail.name}.`,
      );
    }
    details.push(detail);
  }

  const bundleByNumber = new Map<string, BundleCard[]>();
  for (const card of bundle.cards) {
    const key = normalizedCardNumber(card.localId);
    const cards = bundleByNumber.get(key) || [];
    cards.push(card);
    bundleByNumber.set(key, cards);
  }

  row.officialHitCount = product.hitCnt;
  row.officialCollectedCount = details.length;
  row.officialComparableCount = details.length;
  row.officialExcludedCount = 0;
  row.officialExcludedSetCodes = [];
  row.officialSetCodes = [TARGET_SET_ID];
  row.officialAssetSetCodes = [
    ...new Set(
      details
        .map((detail) => detail.summaryAssetSetCode)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  row.officialAssetSetCodeAnomalyCount = details.filter(
    (detail) =>
      detail.summaryAssetSetCode &&
      clean(detail.summaryAssetSetCode).toUpperCase() !== TARGET_SET_ID,
  ).length;
  row.officialNumberedCount = details.filter(
    (detail) => detail.numerator !== null,
  ).length;
  row.officialUnnumberedCount = details.filter(
    (detail) => detail.numerator === null,
  ).length;

  row.countMatches = bundle.cards.length === details.length;
  row.setCodeMatches = true;
  const registryCounts = nameCounts(bundle.cards.map((card) => card.name));
  const officialCounts = nameCounts(details.map((detail) => detail.name));
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
  row.orderedNameMismatchCount = 0;
  row.orderedNameMismatches = [];

  row.detailEvidence = details.map((detail) => {
    const candidates = detail.numerator
      ? bundleByNumber.get(normalizedCardNumber(detail.numerator)) || []
      : [];
    const expected = candidates.length === 1 ? candidates[0] : null;
    return {
      cardID: detail.cardID,
      name: detail.name,
      setCode: detail.setCode,
      numerator: detail.numerator,
      denominator: detail.denominator,
      summaryAssetSetCode: detail.summaryAssetSetCode,
      detailUrl: detail.detailUrl,
      expectedName: expected ? clean(expected.name) : null,
      expectedLocalId: expected ? clean(expected.localId) : null,
      registryCandidateCount: candidates.length,
      nameMatches: expected
        ? compactName(detail.name) === compactName(expected.name)
        : null,
      numberMatches: detail.numerator && expected ? true : null,
      setCodeMatches: true,
      unnumbered: detail.numerator === null,
      error: null,
    };
  });

  row.reasons = row.reasons.filter(
    (reason) => !COMPARISON_REASONS.has(reason),
  );
  if (row.countMatches === false) {
    row.reasons.push("official_card_count_mismatch");
  }
  if (row.nameMultisetMatches === false) {
    row.reasons.push("official_name_population_mismatch");
  }
  row.status =
    row.countMatches === false || row.nameMultisetMatches === false
      ? "mismatch"
      : "verified";
  row.error = null;

  const discrepancyRows = rebuildTotals(receipt);
  const queue = {
    schema: QUEUE_SCHEMA,
    generatedAt: receipt.generatedAt,
    officialSource: receipt.officialSource,
    rows: discrepancyRows,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        schema: RECEIPT_SCHEMA,
        corrected: true,
        setId: TARGET_SET_ID,
        registryCards: bundle.cards.length,
        officialCards: details.length,
        officialNumberedCards: row.officialNumberedCount,
        officialUnnumberedCards: row.officialUnnumberedCount,
        officialAssetSetCodeAnomalies: row.officialAssetSetCodeAnomalyCount,
        missingOfficialNames: row.missingOfficialNamesInRegistry.reduce(
          (sum, entry) => sum + entry.count,
          0,
        ),
        extraRegistryNames: row.extraRegistryNames.reduce(
          (sum, entry) => sum + entry.count,
          0,
        ),
        status: row.status,
        receipt: receiptPath,
        discrepancyQueue: queuePath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

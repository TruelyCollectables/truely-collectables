import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
  type PokemonJapaneseOfficialCardEvidence,
  type PokemonJapaneseOfficialReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-official-reconciled";
import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const BASE_BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";
const OUTPUT_SUFFIX = ".pokemon-ja-official-reconciled.bundle.json";
const DEFAULT_TARGETS = ["SV5K", "SV8"];

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Official-Gap-Builder/1.0 (+https://totallycollectibles.com)",
};

type OfficialProduct = {
  value: string;
  label: string;
};

type AuditRow = {
  setId: string;
  setName: string;
  status: string;
  officialProduct: OfficialProduct | null;
  officialSearchUrl?: string | null;
  officialComparableCount?: number | null;
  officialCollectedCount?: number | null;
  reasons?: string[];
  extraRegistryNames?: Array<{ name: string; count: number }>;
};

type AuditReceipt = {
  schema: string;
  generatedAt: string;
  attemptedSets: number;
  rows: AuditRow[];
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
  detailUrl: string;
  name: string;
  setCode: string;
  numerator: string;
  denominator: string | null;
};

type BuildRow = {
  setId: string;
  setName: string | null;
  status: "built" | "failed";
  baseCards: number;
  officialCards: number;
  addedCards: number;
  fetchedDetails: number;
  outputFile: string | null;
  error: string | null;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/build-pokemon-japanese-official-gap-bundles.ts <tcgdex-bundle-directory> [output-directory] [options]",
      "",
      "Options:",
      "  --audit-receipt <path>   Corrected official verification receipt",
      "  --receipt <path>         Build receipt",
      "  --set <set-id>           Reconcile one set; repeatable (default SV5K and SV8)",
      "  --delay-ms <number>      Delay between official detail requests (default 75)",
      "  --continue-on-error      Continue after a failed set",
      "",
      "This command only builds private reconciliation bundles. It never writes to the Registry and never downloads official card images.",
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

function compact(value: unknown) {
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

function officialSetCode(card: OfficialCardSummary) {
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
      ? html.slice(logoIndex + logo.length, logoIndex + logo.length + 350)
      : "";
  const numberMatch = afterLogo.match(
    /(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*\/(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*/i,
  );
  return {
    name: heading ? clean(heading[1]) : "",
    setCode: setCode ? clean(setCode) : "",
    numerator: numberMatch ? clean(numberMatch[1]) : "",
    denominator: numberMatch ? clean(numberMatch[2]) : null,
  };
}

async function fetchOfficialCards(
  product: OfficialProduct,
  delayMs: number,
) {
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
  if (!parsed.name || !parsed.setCode || !parsed.numerator) {
    throw new Error(
      `Official detail ${cardID} is missing name, set code, or printed number.`,
    );
  }
  return {
    cardID,
    summaryName: officialCardName(params.card),
    detailUrl,
    ...parsed,
  };
}

function parseBaseBundle(content: string, file: string) {
  const parsed = JSON.parse(content) as TcgdexJapaneseSetBundle;
  if (
    parsed.schema !== TCGDEX_JAPANESE_BUNDLE_SCHEMA ||
    parsed.language !== "ja" ||
    !parsed.set ||
    !Array.isArray(parsed.cards)
  ) {
    throw new Error(`${file} is not a supported Japanese TCGdex bundle.`);
  }
  return parsed;
}

async function loadBaseBundles(directory: string) {
  const bundles = new Map<
    string,
    { file: string; bundle: TcgdexJapaneseSetBundle }
  >();
  for (const name of (await readdir(directory)).filter((entry) =>
    entry.endsWith(BASE_BUNDLE_SUFFIX),
  )) {
    const file = join(directory, name);
    const bundle = parseBaseBundle(await readFile(file, "utf8"), file);
    bundles.set(clean(bundle.set.id).toLowerCase(), { file, bundle });
  }
  return bundles;
}

function productUrl(product: OfficialProduct) {
  return (
    `${OFFICIAL_ORIGIN}/card-search/index.php?mode=statuslist&pg=` +
    encodeURIComponent(clean(product.value))
  );
}

function cardSortKey(value: string) {
  const normalized = normalizedCardNumber(value);
  return /^\d+$/.test(normalized)
    ? `0:${String(Number(normalized)).padStart(8, "0")}`
    : `1:${normalized}`;
}

async function buildReconciledBundle(params: {
  row: AuditRow;
  auditGeneratedAt: string;
  base: TcgdexJapaneseSetBundle;
  delayMs: number;
}) {
  const setId = clean(params.base.set.id);
  if (!params.row.officialProduct) {
    throw new Error(`${setId} has no resolved official product.`);
  }
  if (params.row.status !== "mismatch") {
    throw new Error(`${setId} is not classified as a hard mismatch.`);
  }
  if (
    (params.row.reasons || []).includes(
      "official_product_mapped_to_multiple_registry_sets",
    )
  ) {
    throw new Error(`${setId} is a reused official-product mapping.`);
  }
  const extraCount = (params.row.extraRegistryNames || []).reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  if (extraCount !== 0) {
    throw new Error(
      `${setId} has ${extraCount} Registry names outside the official population and cannot use append-only gap reconciliation.`,
    );
  }

  const official = await fetchOfficialCards(
    params.row.officialProduct,
    params.delayMs,
  );
  const summaries = official.cards.filter(
    (card) => officialSetCode(card)?.toLowerCase() === setId.toLowerCase(),
  );
  const expectedCount = Number(params.row.officialComparableCount);
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
    throw new Error(`${setId} audit receipt lacks an official comparable count.`);
  }
  if (summaries.length !== expectedCount) {
    throw new Error(
      `${setId} official API returned ${summaries.length} target-set cards; audit expects ${expectedCount}.`,
    );
  }
  if (official.hitCnt !== null && official.cards.length !== official.hitCnt) {
    throw new Error(
      `${setId} official API pagination collected ${official.cards.length}/${official.hitCnt} product cards.`,
    );
  }

  const details: OfficialCardDetail[] = [];
  for (const card of summaries) {
    details.push(
      await fetchCardDetail({
        card,
        regulation: official.regulation,
        delayMs: params.delayMs,
      }),
    );
  }

  const officialByNumber = new Map<string, OfficialCardDetail>();
  for (const detail of details) {
    if (detail.setCode.toLowerCase() !== setId.toLowerCase()) {
      throw new Error(
        `Official card ${detail.cardID} reports set ${detail.setCode}, expected ${setId}.`,
      );
    }
    if (
      detail.summaryName &&
      compact(detail.summaryName) !== compact(detail.name)
    ) {
      throw new Error(
        `Official card ${detail.cardID} summary/detail name mismatch: ${detail.summaryName} / ${detail.name}.`,
      );
    }
    const key = normalizedCardNumber(detail.numerator);
    if (officialByNumber.has(key)) {
      throw new Error(`${setId} repeats official printed number ${detail.numerator}.`);
    }
    officialByNumber.set(key, detail);
  }

  const baseByNumber = new Map<string, TcgdexJapaneseSetBundle["cards"][number]>();
  for (const card of params.base.cards) {
    const key = normalizedCardNumber(card.localId);
    if (baseByNumber.has(key)) {
      throw new Error(`${setId} repeats TCGdex printed number ${card.localId}.`);
    }
    baseByNumber.set(key, card);
    const detail = officialByNumber.get(key);
    if (!detail) {
      throw new Error(
        `${setId} TCGdex card ${card.localId} ${card.name} is absent from official printed-number evidence.`,
      );
    }
    if (compact(card.name) !== compact(detail.name)) {
      throw new Error(
        `${setId} card ${card.localId} name mismatch: ${card.name} / ${detail.name}.`,
      );
    }
  }

  const additions: PokemonJapaneseOfficialReconciledBundle["cards"] = [];
  const evidence: PokemonJapaneseOfficialCardEvidence[] = [];
  for (const detail of details) {
    const key = normalizedCardNumber(detail.numerator);
    if (baseByNumber.has(key)) continue;
    const bundleCardId = `pokemon-card-${setId}-${detail.cardID}`;
    additions.push({
      id: bundleCardId,
      localId: detail.numerator,
      name: detail.name,
      category: null,
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
      sourcePath: null,
    });
    evidence.push({
      bundleCardId,
      cardID: detail.cardID,
      name: detail.name,
      setCode: detail.setCode,
      numerator: detail.numerator,
      denominator: detail.denominator,
      detailUrl: detail.detailUrl,
    });
  }

  const cards = [...params.base.cards, ...additions].sort((left, right) =>
    cardSortKey(left.localId).localeCompare(cardSortKey(right.localId)),
  );
  if (cards.length !== expectedCount) {
    throw new Error(
      `${setId} reconciliation produced ${cards.length} cards; expected ${expectedCount}.`,
    );
  }
  const expectedAdditions = expectedCount - params.base.cards.length;
  if (additions.length !== expectedAdditions) {
    throw new Error(
      `${setId} reconciliation added ${additions.length} cards; expected ${expectedAdditions}.`,
    );
  }

  const officialUrl = productUrl(params.row.officialProduct);
  const bundle: PokemonJapaneseOfficialReconciledBundle = {
    schema: POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
    phase: "official_gap_backfill",
    language: "ja",
    generatedAt: new Date().toISOString(),
    baseSource: {
      repository: params.base.source.repository,
      commit: params.base.source.commit,
      setSourcePath: params.base.set.sourcePath,
      baseCardCount: params.base.cards.length,
    },
    official: {
      auditGeneratedAt: params.auditGeneratedAt,
      product: {
        value: clean(params.row.officialProduct.value),
        label: clean(params.row.officialProduct.label),
        url: officialUrl,
      },
      comparableCardCount: expectedCount,
      addedCardCount: additions.length,
      cards: evidence,
    },
    series: params.base.series,
    set: {
      ...params.base.set,
      officialCardCount: expectedCount,
    },
    cards,
  };
  return { bundle, detailCount: details.length };
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
      : ".codex-run/pokemon-ja-official-gap-bundles",
  );
  const auditReceiptPath = resolve(
    argumentValue("--audit-receipt") ||
      ".codex-run/pokemon-ja-official-verification-receipt.json",
  );
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-official-gap-build-receipt.json",
  );
  const delayMs = numericArgument("--delay-ms", 75);
  const continueOnError = process.argv.includes("--continue-on-error");
  const requestedSets = argumentValues("--set");
  const targetSetIds = (requestedSets.length ? requestedSets : DEFAULT_TARGETS)
    .map(clean)
    .filter(Boolean);

  const audit = JSON.parse(
    await readFile(auditReceiptPath, "utf8"),
  ) as AuditReceipt;
  if (!Array.isArray(audit.rows) || !clean(audit.generatedAt)) {
    throw new Error(`${auditReceiptPath} is not a supported official audit receipt.`);
  }
  const baseBundles = await loadBaseBundles(inputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const rows: BuildRow[] = [];
  for (const setId of targetSetIds) {
    const auditRow = audit.rows.find(
      (row) => clean(row.setId).toLowerCase() === setId.toLowerCase(),
    );
    const base = baseBundles.get(setId.toLowerCase());
    try {
      if (!auditRow) throw new Error(`${setId} is absent from the audit receipt.`);
      if (!base) throw new Error(`${setId} base TCGdex bundle was not found.`);
      const built = await buildReconciledBundle({
        row: auditRow,
        auditGeneratedAt: audit.generatedAt,
        base: base.bundle,
        delayMs,
      });
      const outputFile = join(
        outputDirectory,
        `${base.bundle.series.id}-${base.bundle.set.id}${OUTPUT_SUFFIX}`,
      );
      await writeFile(
        outputFile,
        `${JSON.stringify(built.bundle, null, 2)}\n`,
        "utf8",
      );
      rows.push({
        setId,
        setName: base.bundle.set.name,
        status: "built",
        baseCards: base.bundle.cards.length,
        officialCards: built.bundle.cards.length,
        addedCards: built.bundle.official.addedCardCount,
        fetchedDetails: built.detailCount,
        outputFile,
        error: null,
      });
    } catch (error) {
      rows.push({
        setId,
        setName: auditRow?.setName || base?.bundle.set.name || null,
        status: "failed",
        baseCards: base?.bundle.cards.length || 0,
        officialCards: 0,
        addedCards: 0,
        fetchedDetails: 0,
        outputFile: null,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!continueOnError) break;
    }
  }

  const failed = rows.filter((row) => row.status === "failed");
  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseOfficialGapBuildReceipt.v1",
    generatedAt: new Date().toISOString(),
    inputDirectory,
    auditReceipt: auditReceiptPath,
    outputDirectory,
    requestedSets: targetSetIds,
    attemptedSets: rows.length,
    successfulSets: rows.length - failed.length,
    failedSets: failed.length,
    totals: rows.reduce(
      (sum, row) => {
        sum.baseCards += row.baseCards;
        sum.officialCards += row.officialCards;
        sum.addedCards += row.addedCards;
        sum.fetchedDetails += row.fetchedDetails;
        return sum;
      },
      { baseCards: 0, officialCards: 0, addedCards: 0, fetchedDetails: 0 },
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

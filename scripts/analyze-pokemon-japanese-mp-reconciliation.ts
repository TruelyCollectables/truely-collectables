import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const BASE_BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";
const TARGET_SET_ID = "M-P";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-MP-Reconciliation/1.0 (+https://totallycollectibles.com)",
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
  officialComparableCount?: number | null;
  officialCollectedCount?: number | null;
  officialExcludedCount?: number | null;
  officialExcludedSetCodes?: string[];
  reasons?: string[];
};

type AuditReceipt = {
  schema: string;
  generatedAt: string;
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

type BaseCard = TcgdexJapaneseSetBundle["cards"][number];

type BaseCardEvidence = {
  bundleCardId: string;
  localId: string;
  name: string;
  sourcePath: string | null;
};

type OfficialCardEvidence = {
  cardID: string;
  localId: string;
  name: string;
  setCode: string;
  denominator: string | null;
  detailUrl: string;
};

type NumberNameMatch = {
  registry: BaseCardEvidence;
  official: OfficialCardEvidence;
};

type NumberNameMismatch = NumberNameMatch & {
  registryComparableName: string;
  officialComparableName: string;
};

type RegistryOnlyCard = {
  registry: BaseCardEvidence;
  sameNameOfficialCandidates: OfficialCardEvidence[];
};

type OfficialOnlyCard = {
  official: OfficialCardEvidence;
  sameNameRegistryCandidates: BaseCardEvidence[];
};

type DuplicateNumberGroup<T> = {
  normalizedNumber: string;
  cards: T[];
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/analyze-pokemon-japanese-mp-reconciliation.ts <tcgdex-bundle-directory> [options]",
      "",
      "Options:",
      "  --audit-receipt <path>   Corrected official verification receipt",
      "  --receipt <path>         Complete read-only analysis receipt",
      "  --queue <path>           Compact unresolved reconciliation queue",
      "  --delay-ms <number>      Delay between official requests (default 75)",
      "",
      "This command is read-only. It fetches official text evidence, never downloads card images, and never writes to the Registry.",
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
    clean(parsed.set?.id).toUpperCase() !== TARGET_SET_ID ||
    !Array.isArray(parsed.cards)
  ) {
    throw new Error(`${file} is not the supported Japanese ${TARGET_SET_ID} bundle.`);
  }
  return parsed;
}

async function loadTargetBundle(directory: string) {
  const candidates = (await readdir(directory)).filter((entry) =>
    entry.endsWith(BASE_BUNDLE_SUFFIX),
  );
  for (const name of candidates) {
    const file = join(directory, name);
    const raw = await readFile(file, "utf8");
    const candidate = JSON.parse(raw) as Partial<TcgdexJapaneseSetBundle>;
    if (clean(candidate.set?.id).toUpperCase() === TARGET_SET_ID) {
      return { file, bundle: parseBaseBundle(raw, file) };
    }
  }
  throw new Error(`${TARGET_SET_ID} base TCGdex bundle was not found in ${directory}.`);
}

function baseEvidence(card: BaseCard): BaseCardEvidence {
  return {
    bundleCardId: clean(card.id),
    localId: clean(card.localId),
    name: clean(card.name),
    sourcePath: card.sourcePath ? clean(card.sourcePath) : null,
  };
}

function officialEvidence(card: OfficialCardDetail): OfficialCardEvidence {
  return {
    cardID: clean(card.cardID),
    localId: clean(card.numerator),
    name: clean(card.name),
    setCode: clean(card.setCode),
    denominator: card.denominator ? clean(card.denominator) : null,
    detailUrl: card.detailUrl,
  };
}

function addToMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function duplicateGroups<T>(
  map: Map<string, T[]>,
  project: (value: T) => BaseCardEvidence | OfficialCardEvidence,
): DuplicateNumberGroup<BaseCardEvidence | OfficialCardEvidence>[] {
  return [...map.entries()]
    .filter(([, cards]) => cards.length > 1)
    .map(([normalizedNumber, cards]) => ({
      normalizedNumber,
      cards: cards.map(project),
    }));
}

function officialProductUrl(product: OfficialProduct) {
  return (
    `${OFFICIAL_ORIGIN}/card-search/index.php?mode=statuslist&pg=` +
    encodeURIComponent(clean(product.value))
  );
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
  const auditReceiptPath = resolve(
    argumentValue("--audit-receipt") ||
      ".codex-run/pokemon-ja-official-verification-receipt.json",
  );
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-mp-reconciliation-analysis.json",
  );
  const queuePath = resolve(
    argumentValue("--queue") ||
      ".codex-run/pokemon-ja-mp-reconciliation-queue.json",
  );
  const delayMs = numericArgument("--delay-ms", 75);

  const audit = JSON.parse(
    await readFile(auditReceiptPath, "utf8"),
  ) as AuditReceipt;
  const auditRow = audit.rows?.find(
    (row) => clean(row.setId).toUpperCase() === TARGET_SET_ID,
  );
  if (!auditRow || !auditRow.officialProduct) {
    throw new Error(`${TARGET_SET_ID} has no resolved official product in ${auditReceiptPath}.`);
  }
  if (auditRow.status !== "mismatch") {
    throw new Error(`${TARGET_SET_ID} is not classified as a hard mismatch.`);
  }
  if (
    (auditRow.reasons || []).includes(
      "official_product_mapped_to_multiple_registry_sets",
    )
  ) {
    throw new Error(`${TARGET_SET_ID} is a reused official-product mapping.`);
  }

  const { file: baseFile, bundle } = await loadTargetBundle(inputDirectory);
  const official = await fetchOfficialCards(auditRow.officialProduct, delayMs);
  if (official.hitCnt !== null && official.cards.length !== official.hitCnt) {
    throw new Error(
      `Official API pagination collected ${official.cards.length}/${official.hitCnt} product cards.`,
    );
  }

  const targetSummaries = official.cards.filter(
    (card) => officialSetCode(card)?.toUpperCase() === TARGET_SET_ID,
  );
  const excludedSummaries = official.cards.filter(
    (card) => officialSetCode(card)?.toUpperCase() !== TARGET_SET_ID,
  );
  const expectedComparableCount = Number(auditRow.officialComparableCount);
  if (
    !Number.isInteger(expectedComparableCount) ||
    expectedComparableCount <= 0 ||
    targetSummaries.length !== expectedComparableCount
  ) {
    throw new Error(
      `${TARGET_SET_ID} official target-card count ${targetSummaries.length} does not match audit count ${auditRow.officialComparableCount}.`,
    );
  }

  const details: OfficialCardDetail[] = [];
  for (const card of targetSummaries) {
    const detail = await fetchCardDetail({
      card,
      regulation: official.regulation,
      delayMs,
    });
    if (clean(detail.setCode).toUpperCase() !== TARGET_SET_ID) {
      throw new Error(
        `Official card ${detail.cardID} reports set ${detail.setCode}, expected ${TARGET_SET_ID}.`,
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

  const baseByNumber = new Map<string, BaseCard[]>();
  const officialByNumber = new Map<string, OfficialCardDetail[]>();
  const baseByName = new Map<string, BaseCard[]>();
  const officialByName = new Map<string, OfficialCardDetail[]>();

  for (const card of bundle.cards) {
    addToMap(baseByNumber, normalizedCardNumber(card.localId), card);
    addToMap(baseByName, compactName(card.name), card);
  }
  for (const card of details) {
    addToMap(officialByNumber, normalizedCardNumber(card.numerator), card);
    addToMap(officialByName, compactName(card.name), card);
  }

  const exactNumberNameMatches: NumberNameMatch[] = [];
  const sameNumberNameMismatches: NumberNameMismatch[] = [];
  const registryOnlyCards: RegistryOnlyCard[] = [];
  const officialOnlyCards: OfficialOnlyCard[] = [];

  for (const baseCard of bundle.cards) {
    const numberKey = normalizedCardNumber(baseCard.localId);
    const officialCandidates = officialByNumber.get(numberKey) || [];
    if (officialCandidates.length === 1) {
      const officialCard = officialCandidates[0];
      const pair = {
        registry: baseEvidence(baseCard),
        official: officialEvidence(officialCard),
      };
      if (compactName(baseCard.name) === compactName(officialCard.name)) {
        exactNumberNameMatches.push(pair);
      } else {
        sameNumberNameMismatches.push({
          ...pair,
          registryComparableName: comparableCardName(baseCard.name),
          officialComparableName: comparableCardName(officialCard.name),
        });
      }
      continue;
    }
    if (officialCandidates.length === 0) {
      registryOnlyCards.push({
        registry: baseEvidence(baseCard),
        sameNameOfficialCandidates: (officialByName.get(compactName(baseCard.name)) || []).map(
          officialEvidence,
        ),
      });
    }
  }

  for (const officialCard of details) {
    const numberKey = normalizedCardNumber(officialCard.numerator);
    if ((baseByNumber.get(numberKey) || []).length === 0) {
      officialOnlyCards.push({
        official: officialEvidence(officialCard),
        sameNameRegistryCandidates: (baseByName.get(compactName(officialCard.name)) || []).map(
          baseEvidence,
        ),
      });
    }
  }

  const duplicateRegistryNumbers = duplicateGroups(baseByNumber, baseEvidence);
  const duplicateOfficialNumbers = duplicateGroups(officialByNumber, officialEvidence);
  const singleCrossNumberMatches = registryOnlyCards.filter(
    (entry) => entry.sameNameOfficialCandidates.length === 1,
  );
  const ambiguousCrossNumberMatches = registryOnlyCards.filter(
    (entry) => entry.sameNameOfficialCandidates.length > 1,
  );
  const registryOnlyWithoutNameMatch = registryOnlyCards.filter(
    (entry) => entry.sameNameOfficialCandidates.length === 0,
  );
  const officialOnlyWithoutNameMatch = officialOnlyCards.filter(
    (entry) => entry.sameNameRegistryCandidates.length === 0,
  );

  const excludedSetCodeCounts = excludedSummaries.reduce<Record<string, number>>(
    (counts, card) => {
      const code = officialSetCode(card) || "unknown";
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    },
    {},
  );

  const safeForAutomaticReplacement =
    sameNumberNameMismatches.length === 0 &&
    registryOnlyCards.length === 0 &&
    duplicateRegistryNumbers.length === 0 &&
    duplicateOfficialNumbers.length === 0;

  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciliationAnalysis.v1",
    mode: "read_only",
    generatedAt: new Date().toISOString(),
    targetSet: {
      id: TARGET_SET_ID,
      name: clean(bundle.set.name),
      baseBundle: baseFile,
      baseSourceCommit: clean(bundle.source.commit),
    },
    official: {
      auditGeneratedAt: clean(audit.generatedAt),
      product: {
        value: clean(auditRow.officialProduct.value),
        label: clean(auditRow.officialProduct.label),
        url: officialProductUrl(auditRow.officialProduct),
      },
      productCardCount: official.cards.length,
      comparableCardCount: details.length,
      excludedCardCount: excludedSummaries.length,
      excludedSetCodeCounts,
      fetchedDetailCount: details.length,
    },
    counts: {
      registryCards: bundle.cards.length,
      officialComparableCards: details.length,
      exactNumberNameMatches: exactNumberNameMatches.length,
      sameNumberNameMismatches: sameNumberNameMismatches.length,
      registryOnlyNumbers: registryOnlyCards.length,
      officialOnlyNumbers: officialOnlyCards.length,
      singleCrossNumberNameMatches: singleCrossNumberMatches.length,
      ambiguousCrossNumberNameMatches: ambiguousCrossNumberMatches.length,
      registryOnlyWithoutNameMatch: registryOnlyWithoutNameMatch.length,
      officialOnlyWithoutNameMatch: officialOnlyWithoutNameMatch.length,
      duplicateRegistryNumbers: duplicateRegistryNumbers.length,
      duplicateOfficialNumbers: duplicateOfficialNumbers.length,
    },
    safeForAutomaticReplacement,
    exactNumberNameMatches,
    sameNumberNameMismatches,
    registryOnlyCards,
    officialOnlyCards,
    duplicateRegistryNumbers,
    duplicateOfficialNumbers,
  };

  const queue = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciliationQueue.v1",
    mode: "manual_reconciliation_required",
    generatedAt: receipt.generatedAt,
    targetSet: receipt.targetSet,
    official: receipt.official,
    counts: receipt.counts,
    safeForAutomaticReplacement,
    sameNumberNameMismatches,
    registryOnlyCards,
    officialOnlyCards,
    duplicateRegistryNumbers,
    duplicateOfficialNumbers,
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
        official: receipt.official,
        counts: receipt.counts,
        safeForAutomaticReplacement,
        receipt: receiptPath,
        queue: queuePath,
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

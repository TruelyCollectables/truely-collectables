import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const TARGET_SET_ID = "M-P";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-MP-Reconciliation-Finalizer/1.0 (+https://totallycollectibles.com)",
};

type OfficialProduct = {
  value: string;
  label: string;
  url: string;
};

type BaseCardEvidence = {
  bundleCardId: string;
  localId: string;
  name: string;
  sourcePath: string | null;
};

type RawOfficialCardEvidence = {
  cardID: string;
  localId: string;
  name: string;
  setCode: string;
  denominator: string | null;
  detailUrl: string;
};

type OfficialCardEvidence = {
  cardID: string;
  localId: string | null;
  name: string;
  setCode: string;
  denominator: string | null;
  detailUrl: string;
  unnumbered: boolean;
};

type RawAnalysis = {
  schema: string;
  mode: string;
  generatedAt: string;
  targetSet: {
    id: string;
    name: string;
    baseBundle: string;
    baseSourceCommit: string;
  };
  official: {
    auditGeneratedAt: string;
    product: OfficialProduct;
    productCardCount: number;
    comparableCardCount: number;
    excludedCardCount: number;
    excludedSetCodeCounts: Record<string, number>;
    fetchedDetailCount: number;
  };
  exactNumberNameMatches: Array<{
    registry: BaseCardEvidence;
    official: RawOfficialCardEvidence;
  }>;
  sameNumberNameMismatches: Array<{
    registry: BaseCardEvidence;
    official: RawOfficialCardEvidence;
  }>;
  registryOnlyCards: Array<{
    registry: BaseCardEvidence;
    sameNameOfficialCandidates: RawOfficialCardEvidence[];
  }>;
  officialOnlyCards: Array<{
    official: RawOfficialCardEvidence;
    sameNameRegistryCandidates: BaseCardEvidence[];
  }>;
  duplicateRegistryNumbers: unknown[];
  duplicateOfficialNumbers: unknown[];
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
  numerator: string | null;
  denominator: string | null;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/finalize-pokemon-japanese-mp-reconciliation-analysis.ts <raw-analysis-receipt> [options]",
      "",
      "Options:",
      "  --receipt <path>     Final read-only analysis receipt",
      "  --queue <path>       Compact construction queue",
      "  --delay-ms <number>  Delay between official requests (default 75)",
      "",
      "This command is read-only. It verifies excluded product cards and normalizes official unnumbered cards without writing to the Registry.",
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

function isPrintedNumber(value: unknown) {
  const text = clean(value);
  return /^[0-9A-Z-]+$/i.test(text) && !/^M-P$/i.test(text);
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

async function fetchOfficialCards(productValue: string, delayMs: number) {
  const cards: OfficialCardSummary[] = [];
  let page = 1;
  let maxPage = 1;
  let hitCnt: number | null = null;
  let regulation = "all";

  do {
    const url = new URL(OFFICIAL_RESULT_API);
    url.searchParams.set("mode", "statuslist");
    url.searchParams.set("pg", productValue);
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
        `Official result API rejected ${productValue}: ${clean(parsed.errMsg) || "unknown error"}.`,
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
    detailUrl,
    ...parsed,
  };
}

function normalizeOfficialEvidence(
  evidence: RawOfficialCardEvidence,
): OfficialCardEvidence {
  const numbered =
    isPrintedNumber(evidence.localId) &&
    (!evidence.denominator || /^[0-9A-Z-]+$/i.test(clean(evidence.denominator)));
  return {
    cardID: clean(evidence.cardID),
    localId: numbered ? clean(evidence.localId) : null,
    name: clean(evidence.name),
    setCode: clean(evidence.setCode),
    denominator: numbered ? clean(evidence.denominator) || null : null,
    detailUrl: clean(evidence.detailUrl),
    unnumbered: !numbered,
  };
}

function uniqueByCardId(cards: OfficialCardEvidence[]) {
  const unique = new Map<string, OfficialCardEvidence>();
  for (const card of cards) unique.set(card.cardID, card);
  return [...unique.values()];
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const rawArgument = process.argv[2];
  if (!rawArgument || rawArgument.startsWith("--")) {
    usage();
    process.exitCode = 1;
    return;
  }

  const rawPath = resolve(rawArgument);
  const receiptPath = resolve(
    argumentValue("--receipt") ||
      ".codex-run/pokemon-ja-mp-reconciliation-final.json",
  );
  const queuePath = resolve(
    argumentValue("--queue") ||
      ".codex-run/pokemon-ja-mp-reconciliation-construction-queue.json",
  );
  const delayMs = numericArgument("--delay-ms", 75);
  const raw = JSON.parse(await readFile(rawPath, "utf8")) as RawAnalysis;

  if (
    raw.schema !== "tcos.checklist.pokemonJapaneseMPReconciliationAnalysis.v1" ||
    raw.mode !== "read_only" ||
    clean(raw.targetSet?.id).toUpperCase() !== TARGET_SET_ID
  ) {
    throw new Error(`${rawPath} is not a supported raw M-P reconciliation receipt.`);
  }

  const allRawOfficialCards: RawOfficialCardEvidence[] = [
    ...raw.exactNumberNameMatches.map((entry) => entry.official),
    ...raw.sameNumberNameMismatches.map((entry) => entry.official),
    ...raw.officialOnlyCards.map((entry) => entry.official),
  ];
  const allOfficialCards = uniqueByCardId(
    allRawOfficialCards.map(normalizeOfficialEvidence),
  );
  if (allOfficialCards.length !== raw.official.comparableCardCount) {
    throw new Error(
      `Normalized ${allOfficialCards.length} official cards; expected ${raw.official.comparableCardCount}.`,
    );
  }

  const registryCards = [
    ...raw.exactNumberNameMatches.map((entry) => entry.registry),
    ...raw.sameNumberNameMismatches.map((entry) => entry.registry),
    ...raw.registryOnlyCards.map((entry) => entry.registry),
  ];
  const registryByNumber = new Map(
    registryCards.map((card) => [normalizedCardNumber(card.localId), card]),
  );
  if (registryByNumber.size !== registryCards.length) {
    throw new Error("M-P Registry evidence contains repeated printed numbers.");
  }

  const officialNumberedCards = allOfficialCards.filter(
    (card): card is OfficialCardEvidence & { localId: string } =>
      card.localId !== null,
  );
  const officialUnnumberedCards = allOfficialCards.filter(
    (card) => card.localId === null,
  );
  const officialByNumber = new Map<string, OfficialCardEvidence>();
  for (const card of officialNumberedCards) {
    const key = normalizedCardNumber(card.localId);
    if (officialByNumber.has(key)) {
      throw new Error(`Official M-P evidence repeats printed number ${card.localId}.`);
    }
    officialByNumber.set(key, card);
  }

  const exactNumberNameMatches = registryCards
    .map((registry) => {
      const official = officialByNumber.get(
        normalizedCardNumber(registry.localId),
      );
      return official && compactName(registry.name) === compactName(official.name)
        ? { registry, official }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const sameNumberNameMismatches = registryCards
    .map((registry) => {
      const official = officialByNumber.get(
        normalizedCardNumber(registry.localId),
      );
      return official && compactName(registry.name) !== compactName(official.name)
        ? { registry, official }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const registryOnlyCards = registryCards.filter(
    (registry) =>
      !officialByNumber.has(normalizedCardNumber(registry.localId)),
  );
  const officialOnlyNumberedCards = officialNumberedCards.filter(
    (official) =>
      !registryByNumber.has(normalizedCardNumber(official.localId)),
  );

  const product = await fetchOfficialCards(raw.official.product.value, delayMs);
  if (product.hitCnt !== null && product.cards.length !== product.hitCnt) {
    throw new Error(
      `Official API pagination collected ${product.cards.length}/${product.hitCnt} product cards.`,
    );
  }
  const excludedSummaries = product.cards.filter(
    (card) => officialSetCode(card)?.toUpperCase() !== TARGET_SET_ID,
  );
  if (excludedSummaries.length !== raw.official.excludedCardCount) {
    throw new Error(
      `Official product returned ${excludedSummaries.length} excluded cards; expected ${raw.official.excludedCardCount}.`,
    );
  }

  const excludedProductCards: OfficialCardEvidence[] = [];
  for (const summary of excludedSummaries) {
    const detail = await fetchCardDetail({
      card: summary,
      regulation: product.regulation,
      delayMs,
    });
    if (!detail.numerator) {
      throw new Error(`Excluded official card ${detail.cardID} is unexpectedly unnumbered.`);
    }
    if (
      detail.summaryName &&
      compactName(detail.summaryName) !== compactName(detail.name)
    ) {
      throw new Error(
        `Excluded official card ${detail.cardID} summary/detail name mismatch: ${detail.summaryName} / ${detail.name}.`,
      );
    }
    excludedProductCards.push({
      cardID: detail.cardID,
      localId: detail.numerator,
      name: detail.name,
      setCode: detail.setCode,
      denominator: detail.denominator,
      detailUrl: detail.detailUrl,
      unnumbered: false,
    });
  }

  const remapCandidates = registryOnlyCards.map((registry) => ({
    registry,
    officialCandidates: excludedProductCards.filter(
      (official) => compactName(official.name) === compactName(registry.name),
    ),
  }));
  const resolvedRemaps = remapCandidates.filter(
    (entry) => entry.officialCandidates.length === 1,
  );
  const unresolvedRemaps = remapCandidates.filter(
    (entry) => entry.officialCandidates.length !== 1,
  );
  const usedExcludedCardIds = new Set(
    resolvedRemaps.map((entry) => entry.officialCandidates[0].cardID),
  );
  const unmatchedExcludedCards = excludedProductCards.filter(
    (card) => !usedExcludedCardIds.has(card.cardID),
  );

  const counts = {
    registryCards: registryCards.length,
    officialComparableCards: allOfficialCards.length,
    officialNumberedCards: officialNumberedCards.length,
    officialUnnumberedCards: officialUnnumberedCards.length,
    exactNumberNameMatches: exactNumberNameMatches.length,
    sameNumberNameMismatches: sameNumberNameMismatches.length,
    registryOnlyNumbers: registryOnlyCards.length,
    officialOnlyNumberedCards: officialOnlyNumberedCards.length,
    excludedProductCards: excludedProductCards.length,
    resolvedRegistryRemaps: resolvedRemaps.length,
    unresolvedRegistryRemaps: unresolvedRemaps.length,
    unmatchedExcludedCards: unmatchedExcludedCards.length,
    netPopulationChange: allOfficialCards.length - registryCards.length,
  };

  const safeForBundleConstruction =
    counts.sameNumberNameMismatches === 0 &&
    counts.resolvedRegistryRemaps === counts.registryOnlyNumbers &&
    counts.unresolvedRegistryRemaps === 0 &&
    counts.unmatchedExcludedCards === 0 &&
    counts.exactNumberNameMatches + counts.registryOnlyNumbers ===
      counts.registryCards &&
    counts.exactNumberNameMatches +
      counts.officialOnlyNumberedCards +
      counts.officialUnnumberedCards ===
      counts.officialComparableCards;

  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciliationFinal.v1",
    mode: "read_only",
    generatedAt: new Date().toISOString(),
    rawAnalysis: rawPath,
    targetSet: raw.targetSet,
    official: {
      ...raw.official,
      excludedProductCards,
    },
    counts,
    safeForBundleConstruction,
    automaticProductionWriteAllowed: false,
    exactNumberNameMatches,
    sameNumberNameMismatches,
    registryOnlyCards,
    officialOnlyNumberedCards,
    officialUnnumberedCards,
    remapCandidates,
    unresolvedRemaps,
    unmatchedExcludedCards,
  };

  const queue = {
    schema: "tcos.checklist.pokemonJapaneseMPReconciliationConstructionQueue.v1",
    mode: safeForBundleConstruction
      ? "bundle_construction_ready"
      : "manual_reconciliation_required",
    generatedAt: receipt.generatedAt,
    targetSet: receipt.targetSet,
    counts,
    safeForBundleConstruction,
    automaticProductionWriteAllowed: false,
    keepInMP: exactNumberNameMatches,
    removeFromMPAndRemap: resolvedRemaps,
    addNumberedToMP: officialOnlyNumberedCards,
    addUnnumberedToMP: officialUnnumberedCards,
    unresolvedRemaps,
    unmatchedExcludedCards,
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

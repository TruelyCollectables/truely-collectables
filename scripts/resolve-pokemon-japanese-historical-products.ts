import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const HISTORICAL_LINK_SOURCE =
  "https://gist.github.com/limithand/a14a6cf55572554ee46d29d444d99505";
const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseHistoricalProductResolution.v1" as const;
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseHistoricalProductResolutionQueue.v1" as const;

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Historical-Product-Resolver/1.0 (+https://totallycollectibles.com)",
};

type Languages<T = string> = Partial<Record<string, T>>;
type TcgdexSet = {
  id?: string;
  name?: Languages;
  serie?: { id?: string; name?: Languages };
  cardCount?: { official?: number };
  releaseDate?: string | Languages;
};
type TcgdexCard = { name?: Languages };
type BuildReceiptRow = {
  setId: string | null;
  setName: string | null;
  seriesId: string | null;
  sourceSetPath: string;
  status: string;
  missingJapaneseCardNames: number;
};
type BuildReceipt = {
  schema: string;
  sourceCommit: string;
  rows: BuildReceiptRow[];
};
type Phase4ARow = {
  setId: string;
  setName: string;
  status: string;
};
type Phase4AReceipt = {
  schema: string;
  sourceCommit: string;
  rows: Phase4ARow[];
};
export type HistoricalProduct = { value: string; label: string };
type ProductGroupSeed = {
  products: HistoricalProduct[];
  reason: string;
};
type SourceCard = {
  localId: string;
  normalizedLocalId: string;
  sourcePath: string;
  name: string | null;
};
type SourceSet = {
  setId: string;
  setName: string;
  seriesId: string;
  seriesName: string;
  releaseDate: string | null;
  officialCardCount: number | null;
  sourceSetPath: string;
  sourceCards: SourceCard[];
  missingJapaneseCardNames: number;
};
type OfficialCardSummary = {
  cardID: string;
  cardNameAltText?: string;
  cardNameViewText?: string;
};
type OfficialResultResponse = {
  result: number;
  errMsg?: string;
  regulation: string;
  hitCnt: number;
  maxPage: number;
  cardList: OfficialCardSummary[];
};
export type OfficialDetail = {
  cardID: string;
  productValues: string[];
  url: string;
  name: string | null;
  summaryName: string | null;
  setCode: string | null;
  numerator: string | null;
  denominator: string | null;
  normalizedLocalId: string | null;
  error: string | null;
};
type ProductEvidence = {
  product: HistoricalProduct;
  hitCount: number | null;
  collectedCards: number;
  regulation: string;
  details: OfficialDetail[];
  error: string | null;
};
export type CandidateGroupEvaluation = {
  products: HistoricalProduct[];
  seedReason: string;
  productCards: number;
  officialComparableCards: number;
  officialExcludedCards: number;
  excludedSetCodes: string[];
  detailFetchFailures: number;
  sourceMatchedCards: number;
  resolvedMissingNames: number;
  unresolvedMissingNames: Array<{
    localId: string;
    sourcePath: string;
    candidateOfficialCardIDs: string[];
    reason: string;
  }>;
  knownNameMismatches: Array<{
    localId: string;
    sourceName: string;
    officialName: string;
    officialCardID: string;
    officialUrl: string;
  }>;
  sourceOnlyLocalIds: string[];
  officialOnlyCards: OfficialDetail[];
  duplicateOfficialLocalIds: Array<{
    localId: string;
    cardIDs: string[];
  }>;
  unnumberedOfficialCards: OfficialDetail[];
  comparableOfficialCards: OfficialDetail[];
  evidenceCardIDs: string[];
  valid: boolean;
  reasons: string[];
};
type ResolutionStatus =
  | "resolved_single_product"
  | "resolved_multi_product"
  | "manual_review"
  | "failed";
type ResolutionRow = {
  setId: string;
  setName: string;
  seriesId: string;
  releaseDate: string | null;
  sourceSetPath: string;
  sourceCardCount: number;
  sourceOfficialCardCount: number | null;
  missingJapaneseCardNames: number;
  status: ResolutionStatus;
  candidateProducts: HistoricalProduct[];
  evaluatedGroups: CandidateGroupEvaluation[];
  selectedProducts: HistoricalProduct[];
  selectedEvaluation: CandidateGroupEvaluation | null;
  reasons: string[];
  error: string | null;
};
type Arguments = {
  sourceDirectory: string;
  buildReceipt: string;
  phase4AReceipt: string;
  receipt: string;
  queue: string;
  setIds: Set<string>;
  delayMs: number;
  continueOnError: boolean;
};

const HISTORICAL_PRODUCT_GROUPS: Record<string, ProductGroupSeed[]> = {
  s4: [{ products: [{ value: "721", label: "拡張パック「仰天のボルテッカー」" }], reason: "historical_pack_link" }],
  s4a: [{ products: [{ value: "723", label: "ハイクラスパック「シャイニースターV」" }], reason: "historical_pack_link" }],
  s5i: [{ products: [{ value: "727", label: "拡張パック「一撃マスター」" }], reason: "historical_pack_link" }],
  s5r: [{ products: [{ value: "728", label: "拡張パック「連撃マスター」" }], reason: "historical_pack_link" }],
  s5a: [{ products: [{ value: "730", label: "強化拡張パック「双璧のファイター」" }], reason: "historical_pack_link" }],
  s6h: [{ products: [{ value: "731", label: "拡張パック「白銀のランス」" }], reason: "historical_pack_link" }],
  s6k: [{ products: [{ value: "732", label: "拡張パック「漆黒のガイスト」" }], reason: "historical_pack_link" }],
  s6a: [{ products: [{ value: "736", label: "強化拡張パック「イーブイヒーローズ」" }], reason: "historical_pack_link" }],
  s7d: [{ products: [{ value: "739", label: "拡張パック「摩天パーフェクト」" }], reason: "historical_pack_link" }],
  s7r: [{ products: [{ value: "740", label: "拡張パック「蒼空ストリーム」" }], reason: "historical_pack_link" }],
  s8: [{ products: [{ value: "745", label: "拡張パック「フュージョンアーツ」" }], reason: "historical_pack_link" }],
  s8a: [{ products: [{ value: "746", label: "拡張パック「25th ANNIVERSARY COLLECTION」" }], reason: "historical_pack_link" }],
  s8b: [{ products: [{ value: "748", label: "ハイクラスパック「VMAXクライマックス」" }], reason: "historical_pack_link" }],
  s10d: [{ products: [{ value: "856", label: "拡張パック「タイムゲイザー」" }], reason: "historical_pack_link" }],
  s10p: [{ products: [{ value: "857", label: "拡張パック「スペースジャグラー」" }], reason: "historical_pack_link" }],
  s10a: [
    { products: [{ value: "858", label: "強化拡張パック「ダークファンタズマ」" }], reason: "historical_duplicate_candidate" },
    { products: [{ value: "859", label: "強化拡張パック「ダークファンタズマ」" }], reason: "historical_duplicate_candidate" },
    { products: [
      { value: "858", label: "強化拡張パック「ダークファンタズマ」" },
      { value: "859", label: "強化拡張パック「ダークファンタズマ」" },
    ], reason: "historical_duplicate_union_candidate" },
  ],
  s10b: [{ products: [{ value: "861", label: "強化拡張パック「Pokémon GO」" }], reason: "historical_pack_link" }],
  s11: [{ products: [{ value: "862", label: "拡張パック「ロストアビス」" }], reason: "historical_pack_link" }],
  s11a: [{ products: [{ value: "866", label: "強化拡張パック「白熱のアルカナ」" }], reason: "historical_pack_link" }],
};

function usage() {
  console.log([
    "Usage:",
    "  npx tsx scripts/resolve-pokemon-japanese-historical-products.ts <tcgdex-cards-database-directory> [options]",
    "",
    "Options:",
    "  --build-receipt <path>    Pinned TCGdex Japanese build receipt",
    "  --phase4a-receipt <path>  Phase 4A incomplete-set inventory receipt",
    "  --receipt <path>          Historical resolution receipt",
    "  --queue <path>            Manual-review queue",
    "  --set <set-id>            Resolve one set; repeatable",
    "  --delay-ms <number>       Delay between official detail requests (default 35)",
    "  --continue-on-error       Continue after a failed set",
    "",
    "Historical links are candidate seeds only. Every selected mapping is proved against live official card details. This command never writes to Registry or Production and never downloads official images.",
  ].join("\n"));
}

function argumentValues(flag: string) {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}
function argumentValue(flag: string) { return argumentValues(flag)[0] || null; }
function numericArgument(flag: string, fallback: number) {
  const raw = argumentValue(flag);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} requires a non-negative integer.`);
  return parsed;
}
function parseArguments(): Arguments {
  const positional = process.argv[2];
  if (!positional || positional.startsWith("--")) throw new Error("The TCGdex cards-database directory is required.");
  return {
    sourceDirectory: resolve(positional),
    buildReceipt: resolve(argumentValue("--build-receipt") || ".codex-run/tcgdex-ja-build-receipt.json"),
    phase4AReceipt: resolve(argumentValue("--phase4a-receipt") || ".codex-run/pokemon-ja-incomplete-inventory-receipt.json"),
    receipt: resolve(argumentValue("--receipt") || ".codex-run/pokemon-ja-historical-product-resolution-receipt.json"),
    queue: resolve(argumentValue("--queue") || ".codex-run/pokemon-ja-historical-product-resolution-queue.json"),
    setIds: new Set(argumentValues("--set").map((value) => clean(value).toLowerCase())),
    delayMs: numericArgument("--delay-ms", 35),
    continueOnError: process.argv.includes("--continue-on-error"),
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
export function clean(value: unknown) {
  return decodeHtml(String(value ?? "")).replace(/<[^>]+>/g, " ").normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
}
function compact(value: unknown) {
  return clean(value).toLowerCase().replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, "");
}
export function normalizedLocalId(value: unknown) {
  const text = clean(value).toUpperCase().replace(/\s+/g, "");
  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}
function canonicalName(value: unknown) {
  return clean(value)
    .replace(/^(博士の研究)[(（][^)）]+[)）]$/, "$1")
    .replace(/^(ボスの指令)[(（][^)）]+[)）]$/, "$1");
}
function canonicalNameKey(value: unknown) { return compact(canonicalName(value)); }
function posixPath(value: string) { return value.split(sep).join("/"); }
function sourceCommit(repositoryRoot: string) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return "unknown"; }
}
async function importDefault<T>(filePath: string): Promise<T> {
  const loaded = (await import(pathToFileURL(filePath).href)) as { default?: T };
  if (!loaded.default) throw new Error(`${filePath} does not export a default object.`);
  return loaded.default;
}
function releaseDateJa(value: TcgdexSet["releaseDate"]) {
  if (typeof value === "string") return clean(value) || null;
  return clean(value?.ja) || null;
}
async function loadSourceSet(repositoryRoot: string, row: BuildReceiptRow): Promise<SourceSet> {
  if (!row.setId || !row.setName || !row.seriesId) throw new Error(`${row.sourceSetPath} is missing set identity.`);
  const setFile = resolve(repositoryRoot, row.sourceSetPath);
  const cardDirectory = setFile.replace(/\.ts$/i, "");
  const set = await importDefault<TcgdexSet>(setFile);
  const setId = clean(set.id);
  const setName = clean(set.name?.ja);
  const seriesId = clean(set.serie?.id);
  const seriesName = clean(set.serie?.name?.ja);
  if (!setId || !setName || !seriesId || !seriesName) throw new Error(`${row.sourceSetPath} lacks complete Japanese metadata.`);
  const cardFiles = (await readdir(cardDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(cardDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const sourceCards: SourceCard[] = [];
  for (const cardFile of cardFiles) {
    const card = await importDefault<TcgdexCard>(cardFile);
    const localId = basename(cardFile, ".ts");
    sourceCards.push({
      localId,
      normalizedLocalId: normalizedLocalId(localId),
      sourcePath: posixPath(cardFile.slice(repositoryRoot.length + 1)),
      name: clean(card.name?.ja) || null,
    });
  }
  return {
    setId, setName, seriesId, seriesName,
    releaseDate: releaseDateJa(set.releaseDate),
    officialCardCount: Number.isInteger(set.cardCount?.official) ? Number(set.cardCount?.official) : null,
    sourceSetPath: row.sourceSetPath,
    sourceCards,
    missingJapaneseCardNames: sourceCards.filter((card) => !card.name).length,
  };
}

function sleep(ms: number) { return ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve(); }
async function fetchWithRetry(url: string, delayMs: number, accept: string) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      if (attempt > 1 || delayMs > 0) await sleep(delayMs * attempt);
      const response = await fetch(url, { headers: { ...REQUEST_HEADERS, accept }, redirect: "follow" });
      const body = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
      return body;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function officialCardName(card: OfficialCardSummary) {
  return clean(card.cardNameViewText || card.cardNameAltText || "");
}
function parseDetail(html: string) {
  const heading = html.match(/<h1[^>]*class=["'][^"']*Heading1[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  const logo = html.match(/<img[^>]*class=["'][^"']*img-regulation[^"']*["'][^>]*>/i)?.[0] || null;
  const setCode = logo?.match(/alt=["']([^"']+)["']/i)?.[1] || null;
  const logoIndex = logo ? html.indexOf(logo) : -1;
  const afterLogo = logo && logoIndex >= 0 ? html.slice(logoIndex + logo.length, logoIndex + logo.length + 500) : "";
  const numberMatch = afterLogo.match(/(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*\/(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*/i);
  return {
    name: heading ? clean(heading[1]) : null,
    setCode: setCode ? clean(setCode) : null,
    numerator: numberMatch ? clean(numberMatch[1]) : null,
    denominator: numberMatch ? clean(numberMatch[2]) : null,
  };
}
async function fetchProduct(product: HistoricalProduct, delayMs: number): Promise<ProductEvidence> {
  try {
    const summaries: OfficialCardSummary[] = [];
    let page = 1;
    let maxPage = 1;
    let hitCount: number | null = null;
    let regulation = "all";
    do {
      const url = new URL(OFFICIAL_RESULT_API);
      url.searchParams.set("mode", "statuslist");
      url.searchParams.set("pg", product.value);
      if (page > 1) url.searchParams.set("page", String(page));
      const parsed = JSON.parse(await fetchWithRetry(url.href, delayMs, "application/json,*/*;q=0.8")) as OfficialResultResponse;
      if (parsed.result !== 1 || !Array.isArray(parsed.cardList)) {
        throw new Error(`Official result API rejected ${product.value}: ${clean(parsed.errMsg) || "unknown error"}.`);
      }
      if (page === 1) {
        maxPage = Number(parsed.maxPage) || 1;
        hitCount = Number.isInteger(parsed.hitCnt) ? Number(parsed.hitCnt) : null;
        regulation = clean(parsed.regulation) || "all";
      }
      summaries.push(...parsed.cardList);
      page += 1;
    } while (page <= maxPage);
    const unique = new Map<string, OfficialCardSummary>();
    for (const summary of summaries) {
      const id = clean(summary.cardID);
      if (id) unique.set(id, summary);
    }
    if (hitCount !== null && unique.size !== hitCount) {
      throw new Error(`Product ${product.value} collected ${unique.size}/${hitCount} cards.`);
    }
    const details: OfficialDetail[] = [];
    for (const summary of unique.values()) {
      const cardID = clean(summary.cardID);
      const url = `${OFFICIAL_ORIGIN}/card-search/details.php/card/${encodeURIComponent(cardID)}/regu/${encodeURIComponent(regulation)}`;
      try {
        const parsed = parseDetail(await fetchWithRetry(url, delayMs, "text/html,application/xhtml+xml"));
        details.push({
          cardID,
          productValues: [product.value],
          url,
          name: parsed.name,
          summaryName: officialCardName(summary) || null,
          setCode: parsed.setCode,
          numerator: parsed.numerator,
          denominator: parsed.denominator,
          normalizedLocalId: normalizedLocalId(parsed.numerator) || null,
          error: !parsed.name || !parsed.setCode ? "detail_missing_name_or_set_code" : null,
        });
      } catch (error) {
        details.push({
          cardID, productValues: [product.value], url,
          name: null, summaryName: officialCardName(summary) || null,
          setCode: null, numerator: null, denominator: null, normalizedLocalId: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { product, hitCount, collectedCards: unique.size, regulation, details, error: null };
  } catch (error) {
    return {
      product, hitCount: null, collectedCards: 0, regulation: "all", details: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergedGroupDetails(products: HistoricalProduct[], evidenceByProduct: Map<string, ProductEvidence>) {
  const merged = new Map<string, OfficialDetail>();
  for (const product of products) {
    const evidence = evidenceByProduct.get(product.value);
    if (!evidence) continue;
    for (const detail of evidence.details) {
      const existing = merged.get(detail.cardID);
      if (!existing) merged.set(detail.cardID, { ...detail, productValues: [product.value] });
      else existing.productValues = [...new Set([...existing.productValues, product.value])].sort();
    }
  }
  return [...merged.values()].sort((left, right) => Number(left.cardID) - Number(right.cardID));
}

export function evaluateCandidateGroup(params: {
  source: SourceSet;
  seed: ProductGroupSeed;
  details: OfficialDetail[];
}): CandidateGroupEvaluation {
  const targetCode = params.source.setId.toLowerCase();
  const comparable = params.details.filter((detail) => clean(detail.setCode).toLowerCase() === targetCode);
  const excluded = params.details.filter((detail) => clean(detail.setCode).toLowerCase() !== targetCode);
  const detailFetchFailures = params.details.filter((detail) => detail.error).length;
  const officialByLocalId = new Map<string, OfficialDetail[]>();
  for (const detail of comparable) {
    const key = normalizedLocalId(detail.normalizedLocalId);
    if (!key) continue;
    const rows = officialByLocalId.get(key) || [];
    rows.push(detail);
    officialByLocalId.set(key, rows);
  }
  const duplicateOfficialLocalIds = [...officialByLocalId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([localId, rows]) => ({ localId, cardIDs: rows.map((row) => row.cardID).sort() }));
  const unresolvedMissingNames: CandidateGroupEvaluation["unresolvedMissingNames"] = [];
  const knownNameMismatches: CandidateGroupEvaluation["knownNameMismatches"] = [];
  let sourceMatchedCards = 0;
  let resolvedMissingNames = 0;
  for (const sourceCard of params.source.sourceCards) {
    const candidates = officialByLocalId.get(sourceCard.normalizedLocalId) || [];
    if (candidates.length !== 1) {
      unresolvedMissingNames.push({
        localId: sourceCard.localId,
        sourcePath: sourceCard.sourcePath,
        candidateOfficialCardIDs: candidates.map((row) => row.cardID),
        reason: candidates.length === 0 ? "official_printed_number_missing" : "official_printed_number_duplicated",
      });
      continue;
    }
    sourceMatchedCards += 1;
    const official = candidates[0];
    if (!sourceCard.name) resolvedMissingNames += 1;
    else if (canonicalNameKey(sourceCard.name) !== canonicalNameKey(official.name)) {
      knownNameMismatches.push({
        localId: sourceCard.localId,
        sourceName: sourceCard.name,
        officialName: clean(official.name),
        officialCardID: official.cardID,
        officialUrl: official.url,
      });
    }
  }
  const sourceIds = new Set(params.source.sourceCards.map((card) => card.normalizedLocalId));
  const officialOnlyCards = comparable.filter((detail) => {
    const key = normalizedLocalId(detail.normalizedLocalId);
    return key && !sourceIds.has(key);
  });
  const sourceOnlyLocalIds = unresolvedMissingNames.map((row) => row.localId);
  const unnumberedOfficialCards = comparable.filter((detail) => !normalizedLocalId(detail.normalizedLocalId));
  const reasons: string[] = [];
  if (detailFetchFailures) reasons.push("official_detail_fetch_failed");
  if (!comparable.length) reasons.push("no_target_set_cards");
  if (sourceOnlyLocalIds.length) reasons.push("source_cards_not_crosswalked");
  if (duplicateOfficialLocalIds.length) reasons.push("duplicate_official_printed_numbers");
  if (knownNameMismatches.length) reasons.push("known_japanese_name_mismatch");
  if (unnumberedOfficialCards.length) reasons.push("unnumbered_official_cards");
  if (resolvedMissingNames !== params.source.missingJapaneseCardNames) reasons.push("missing_names_not_fully_resolved");
  const valid = reasons.length === 0;
  return {
    products: params.seed.products,
    seedReason: params.seed.reason,
    productCards: params.details.length,
    officialComparableCards: comparable.length,
    officialExcludedCards: excluded.length,
    excludedSetCodes: [...new Set(excluded.map((row) => clean(row.setCode) || "(missing)"))].sort(),
    detailFetchFailures,
    sourceMatchedCards,
    resolvedMissingNames,
    unresolvedMissingNames,
    knownNameMismatches,
    sourceOnlyLocalIds,
    officialOnlyCards,
    duplicateOfficialLocalIds,
    unnumberedOfficialCards,
    comparableOfficialCards: comparable,
    evidenceCardIDs: comparable.map((row) => row.cardID).sort(),
    valid,
    reasons,
  };
}

export function selectBestGroup(evaluations: CandidateGroupEvaluation[]) {
  const valid = evaluations.filter((row) => row.valid);
  if (!valid.length) return { selected: null, reason: "no_valid_historical_product_group" };
  valid.sort((left, right) => {
    if (right.officialComparableCards !== left.officialComparableCards) return right.officialComparableCards - left.officialComparableCards;
    if (left.products.length !== right.products.length) return left.products.length - right.products.length;
    return left.products.map((row) => row.value).join(",").localeCompare(right.products.map((row) => row.value).join(","));
  });
  const top = valid[0];
  const tied = valid.filter((row) => row.officialComparableCards === top.officialComparableCards);
  const topEvidence = top.evidenceCardIDs.join(",");
  if (tied.some((row) => row.evidenceCardIDs.join(",") !== topEvidence)) {
    return { selected: null, reason: "multiple_valid_groups_with_different_official_populations" };
  }
  return { selected: top, reason: top.products.length === 1 ? "single_product_proved" : "multi_product_union_proved" };
}

async function resolveSet(source: SourceSet, seeds: ProductGroupSeed[], delayMs: number): Promise<ResolutionRow> {
  const uniqueProducts = new Map<string, HistoricalProduct>();
  for (const seed of seeds) for (const product of seed.products) uniqueProducts.set(product.value, product);
  const evidenceByProduct = new Map<string, ProductEvidence>();
  for (const product of uniqueProducts.values()) evidenceByProduct.set(product.value, await fetchProduct(product, delayMs));
  const productErrors = [...evidenceByProduct.values()].filter((row) => row.error);
  const evaluatedGroups = seeds.map((seed) => evaluateCandidateGroup({
    source,
    seed,
    details: mergedGroupDetails(seed.products, evidenceByProduct),
  }));
  const selection = selectBestGroup(evaluatedGroups);
  const reasons: string[] = [];
  if (productErrors.length) reasons.push("historical_product_fetch_failed");
  if (selection.reason) reasons.push(selection.reason);
  const selected = selection.selected;
  return {
    setId: source.setId,
    setName: source.setName,
    seriesId: source.seriesId,
    releaseDate: source.releaseDate,
    sourceSetPath: source.sourceSetPath,
    sourceCardCount: source.sourceCards.length,
    sourceOfficialCardCount: source.officialCardCount,
    missingJapaneseCardNames: source.missingJapaneseCardNames,
    status: selected
      ? selected.products.length === 1
        ? "resolved_single_product"
        : "resolved_multi_product"
      : "manual_review",
    candidateProducts: [...uniqueProducts.values()],
    evaluatedGroups,
    selectedProducts: selected?.products || [],
    selectedEvaluation: selected,
    reasons,
    error: productErrors.length ? productErrors.map((row) => `${row.product.value}: ${row.error}`).join("; ") : null,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) { usage(); return; }
  const args = parseArguments();
  const buildReceipt = JSON.parse(await readFile(args.buildReceipt, "utf8")) as BuildReceipt;
  const phase4A = JSON.parse(await readFile(args.phase4AReceipt, "utf8")) as Phase4AReceipt;
  if (buildReceipt.schema !== "tcos.checklist.tcgdexJapaneseBuildReceipt.v1" || phase4A.schema !== "tcos.checklist.pokemonJapaneseIncompleteInventory.v1") {
    throw new Error("Unsupported Japanese build or Phase 4A receipt schema.");
  }
  const commit = sourceCommit(args.sourceDirectory);
  if (buildReceipt.sourceCommit !== phase4A.sourceCommit || (commit !== "unknown" && commit !== buildReceipt.sourceCommit)) {
    throw new Error(`TCGdex source drift: build ${buildReceipt.sourceCommit}, Phase 4A ${phase4A.sourceCommit}, checkout ${commit}.`);
  }
  const phase4AUnmapped = new Set(
    phase4A.rows.filter((row) => row.status === "official_source_unmapped").map((row) => clean(row.setId).toLowerCase()),
  );
  const selectedRows = buildReceipt.rows.filter((row) => {
    const key = clean(row.setId).toLowerCase();
    return row.status === "incomplete_japanese" && phase4AUnmapped.has(key) && HISTORICAL_PRODUCT_GROUPS[key] && (!args.setIds.size || args.setIds.has(key));
  });
  const rows: ResolutionRow[] = [];
  for (const buildRow of selectedRows) {
    let source: SourceSet | null = null;
    try {
      source = await loadSourceSet(args.sourceDirectory, buildRow);
      rows.push(await resolveSet(source, HISTORICAL_PRODUCT_GROUPS[source.setId.toLowerCase()] || [], args.delayMs));
    } catch (error) {
      rows.push({
        setId: source?.setId || clean(buildRow.setId),
        setName: source?.setName || clean(buildRow.setName),
        seriesId: source?.seriesId || clean(buildRow.seriesId),
        releaseDate: source?.releaseDate || null,
        sourceSetPath: source?.sourceSetPath || buildRow.sourceSetPath,
        sourceCardCount: source?.sourceCards.length || 0,
        sourceOfficialCardCount: source?.officialCardCount || null,
        missingJapaneseCardNames: source?.missingJapaneseCardNames || buildRow.missingJapaneseCardNames,
        status: "failed",
        candidateProducts: [], evaluatedGroups: [], selectedProducts: [], selectedEvaluation: null,
        reasons: ["resolver_failed"],
        error: error instanceof Error ? error.message : String(error),
      });
      if (!args.continueOnError) break;
    }
  }
  const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  const totals = rows.reduce((sum, row) => {
    sum.sourceCards += row.sourceCardCount;
    sum.missingJapaneseCardNames += row.missingJapaneseCardNames;
    sum.officialComparableCards += row.selectedEvaluation?.officialComparableCards || 0;
    sum.officialOnlyCards += row.selectedEvaluation?.officialOnlyCards.length || 0;
    sum.resolvedMissingNames += row.selectedEvaluation?.resolvedMissingNames || 0;
    sum.detailFetchFailures += row.selectedEvaluation?.detailFetchFailures || 0;
    if (row.status === "failed") sum.failedSets += 1;
    return sum;
  }, {
    sourceCards: 0,
    missingJapaneseCardNames: 0,
    officialComparableCards: 0,
    officialOnlyCards: 0,
    resolvedMissingNames: 0,
    detailFetchFailures: 0,
    failedSets: 0,
  });
  const receipt = {
    schema: RECEIPT_SCHEMA,
    mode: "read_only_historical_product_resolution",
    generatedAt: new Date().toISOString(),
    sourceCommit: buildReceipt.sourceCommit,
    historicalCandidateSource: HISTORICAL_LINK_SOURCE,
    attemptedSets: rows.length,
    statusCounts,
    totals,
    rows,
  };
  const queue = {
    schema: QUEUE_SCHEMA,
    generatedAt: receipt.generatedAt,
    sourceCommit: receipt.sourceCommit,
    rows: rows.filter((row) => row.status !== "resolved_single_product").map((row) => ({
      setId: row.setId,
      setName: row.setName,
      status: row.status,
      selectedProducts: row.selectedProducts,
      reasons: row.reasons,
      error: row.error,
      evaluatedGroups: row.evaluatedGroups.map((group) => ({
        productValues: group.products.map((product) => product.value),
        valid: group.valid,
        officialComparableCards: group.officialComparableCards,
        sourceMatchedCards: group.sourceMatchedCards,
        resolvedMissingNames: group.resolvedMissingNames,
        officialOnlyCards: group.officialOnlyCards.length,
        reasons: group.reasons,
      })),
    })),
  };
  await mkdir(dirname(args.receipt), { recursive: true });
  await writeFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await mkdir(dirname(args.queue), { recursive: true });
  await writeFile(args.queue, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (totals.failedSets) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_SEARCH_URL = `${OFFICIAL_ORIGIN}/card-search/`;
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseIncompleteInventory.v1" as const;
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseIncompleteInventoryQueue.v1" as const;

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Incomplete-Inventory/1.0 (+https://totallycollectibles.com)",
};

type Languages<T = string> = Partial<Record<string, T>>;
type TcgdexSet = {
  id?: string;
  name?: Languages;
  serie?: { id?: string; name?: Languages };
  cardCount?: { official?: number };
  releaseDate?: string | Languages;
};
type DetailedVariant = {
  type?: string;
  subtype?: string;
  size?: string;
  stamp?: string[];
  stamps?: string[];
  foil?: string;
  languages?: string[];
};
type LegacyVariants = {
  normal?: boolean;
  reverse?: boolean;
  holo?: boolean;
  firstEdition?: boolean;
  jumbo?: boolean;
  preRelease?: boolean;
  wPromo?: boolean;
};
type TcgdexCard = {
  name?: Languages;
  category?: string;
  rarity?: string;
  illustrator?: string;
  regulationMark?: string;
  dexId?: number[];
  variants?: DetailedVariant[] | LegacyVariants;
};
type SourceVariantEvidence = {
  type: string;
  subtype: string | null;
  size: string | null;
  stamps: string[];
  foil: string | null;
  languages: string[];
};
type SourceCard = {
  localId: string;
  normalizedLocalId: string;
  sourcePath: string;
  name: string | null;
  category: string | null;
  rarity: string | null;
  illustrator: string | null;
  regulationMark: string | null;
  dexId: number[];
  variants: SourceVariantEvidence[];
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
type BuildReceiptRow = {
  setId: string | null;
  setName: string | null;
  seriesId: string | null;
  sourceSetPath: string;
  status: string;
  cards: number;
  variantEvidence: number;
  missingJapaneseCardNames: number;
  missingJapaneseCardPaths: string[];
  outputFile: string | null;
  error: string | null;
};
type BuildReceipt = {
  schema: string;
  sourceCommit: string;
  incompleteJapaneseSets: number;
  totals: { missingJapaneseCardNames: number };
  rows: BuildReceiptRow[];
};
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
type OfficialDetail = {
  cardID: string;
  url: string;
  status: number;
  name: string | null;
  summaryName: string | null;
  setCode: string | null;
  numerator: string | null;
  denominator: string | null;
  normalizedLocalId: string | null;
  error: string | null;
};
type OfficialEvidenceCard = {
  cardID: string;
  name: string | null;
  setCode: string | null;
  numerator: string | null;
  denominator: string | null;
  normalizedLocalId: string | null;
  url: string;
};
type ResolvedMissingName = {
  sourcePath: string;
  localId: string;
  officialCardID: string;
  officialName: string;
  officialSetCode: string | null;
  officialNumerator: string | null;
  officialDenominator: string | null;
  officialUrl: string;
};
type UnresolvedMissingName = {
  sourcePath: string;
  localId: string;
  candidateOfficialCardIDs: string[];
  reason: string;
};
type KnownNameMismatch = {
  localId: string;
  sourceName: string;
  officialName: string;
  officialCardID: string;
  officialUrl: string;
};
type InventoryStatus =
  | "ready_for_name_backfill"
  | "ready_for_card_backfill_proposal"
  | "partial_official_crosswalk"
  | "official_source_unmapped"
  | "official_source_ambiguous"
  | "official_source_reused"
  | "failed";
type InventoryRow = {
  setId: string;
  setName: string;
  seriesId: string;
  releaseDate: string | null;
  sourceSetPath: string;
  status: InventoryStatus;
  sourceCardCount: number;
  sourceOfficialCardCount: number | null;
  missingJapaneseCardNames: number;
  officialProduct: OfficialProductOption | null;
  candidateProducts: OfficialProductOption[];
  reusedBySetIds: string[];
  officialSearchUrl: string | null;
  officialHitCount: number | null;
  officialProductCards: number | null;
  officialComparableCards: number | null;
  officialExcludedCards: number | null;
  officialExcludedSetCodes: string[];
  detailFetchFailures: number;
  comparableOfficialCards: OfficialEvidenceCard[];
  excludedOfficialCards: OfficialEvidenceCard[];
  resolvedMissingNames: ResolvedMissingName[];
  unresolvedMissingNames: UnresolvedMissingName[];
  knownNameMismatches: KnownNameMismatch[];
  officialOnlyCards: OfficialEvidenceCard[];
  sourceOnlyLocalIds: string[];
  duplicateOfficialLocalIds: Array<{
    localId: string;
    cardIDs: string[];
  }>;
  unnumberedOfficialCards: OfficialEvidenceCard[];
  reasons: string[];
  error: string | null;
};
type Arguments = {
  sourceDirectory: string;
  buildReceipt: string;
  receipt: string;
  queue: string;
  setIds: Set<string>;
  limit: number | null;
  delayMs: number;
  continueOnError: boolean;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/inventory-pokemon-japanese-incomplete-sets.ts <tcgdex-cards-database-directory> [options]",
      "",
      "Options:",
      "  --build-receipt <path>  Existing TCGdex Japanese build receipt",
      "  --receipt <path>        Read-only inventory receipt",
      "  --queue <path>          Manual-review queue",
      "  --set <set-id>          Inventory one set; repeatable",
      "  --limit <number>        Inventory only the first N selected sets",
      "  --delay-ms <number>     Delay between official requests (default 50)",
      "  --continue-on-error     Write all possible evidence before exiting",
      "",
      "This command is read-only except for its local receipt files. It never writes to Registry or Production and never downloads official images.",
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

function numericArgument(flag: string, fallback: number | null) {
  const raw = argumentValue(flag);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer.`);
  }
  return parsed;
}

function parseArguments(): Arguments {
  const positional = process.argv[2];
  if (!positional || positional.startsWith("--")) {
    throw new Error("The TCGdex cards-database directory is required.");
  }
  return {
    sourceDirectory: resolve(positional),
    buildReceipt: resolve(
      argumentValue("--build-receipt") ||
        ".codex-run/tcgdex-ja-build-receipt.json",
    ),
    receipt: resolve(
      argumentValue("--receipt") ||
        ".codex-run/pokemon-ja-incomplete-inventory-receipt.json",
    ),
    queue: resolve(
      argumentValue("--queue") ||
        ".codex-run/pokemon-ja-incomplete-inventory-queue.json",
    ),
    setIds: new Set(argumentValues("--set").map((value) => clean(value).toLowerCase())),
    limit: numericArgument("--limit", null),
    delayMs: numericArgument("--delay-ms", 50) || 0,
    continueOnError: process.argv.includes("--continue-on-error"),
  };
}

export function decodeHtml(value: string) {
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

export function clean(value: unknown) {
  return decodeHtml(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function compact(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function normalizedLocalId(value: unknown) {
  const text = clean(value).toUpperCase().replace(/\s+/g, "");
  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
}

function canonicalName(value: unknown) {
  const name = clean(value);
  return name
    .replace(/^(博士の研究)[(（][^)）]+[)）]$/, "$1")
    .replace(/^(ボスの指令)[(（][^)）]+[)）]$/, "$1");
}

function canonicalNameKey(value: unknown) {
  return compact(canonicalName(value));
}

function posixPath(value: string) {
  return value.split(sep).join("/");
}

function sourceCommit(repositoryRoot: string) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

async function importDefault<T>(filePath: string): Promise<T> {
  const loaded = (await import(pathToFileURL(filePath).href)) as {
    default?: T;
  };
  if (!loaded.default) {
    throw new Error(`${filePath} does not export a default object.`);
  }
  return loaded.default;
}

function releaseDateJa(value: TcgdexSet["releaseDate"]) {
  if (typeof value === "string") return clean(value) || null;
  return clean(value?.ja) || null;
}

function normalizeDetailedVariant(
  value: DetailedVariant,
): SourceVariantEvidence | null {
  const type = clean(value.type);
  if (!type) return null;
  const languages = Array.isArray(value.languages)
    ? value.languages.map(clean).filter(Boolean)
    : [];
  if (languages.length && !languages.includes("ja")) return null;
  return {
    type,
    subtype: clean(value.subtype) || null,
    size: clean(value.size) || null,
    stamps: [
      ...new Set(
        [...(value.stamp || []), ...(value.stamps || [])]
          .map(clean)
          .filter(Boolean),
      ),
    ],
    foil: clean(value.foil) || null,
    languages,
  };
}

function normalizeVariants(value: TcgdexCard["variants"]) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeDetailedVariant)
      .filter((entry): entry is SourceVariantEvidence => Boolean(entry));
  }
  if (!value || typeof value !== "object") return [];
  const legacy = value as LegacyVariants;
  const variants: SourceVariantEvidence[] = [];
  const add = (type: string, values: Partial<SourceVariantEvidence> = {}) => {
    variants.push({
      type,
      subtype: values.subtype || null,
      size: values.size || null,
      stamps: values.stamps || [],
      foil: values.foil || null,
      languages: values.languages || [],
    });
  };
  if (legacy.normal) add("normal");
  if (legacy.holo) add("holo");
  if (legacy.reverse) add("reverse");
  if (legacy.firstEdition) add("normal", { stamps: ["1st-edition"] });
  if (legacy.jumbo) add("normal", { size: "jumbo" });
  if (legacy.preRelease) add("normal", { stamps: ["pre-release"] });
  if (legacy.wPromo) add("normal", { stamps: ["w-promo"] });
  return variants;
}

async function loadSourceSet(
  repositoryRoot: string,
  row: BuildReceiptRow,
): Promise<SourceSet> {
  if (!row.setId || !row.setName || !row.seriesId) {
    throw new Error(`${row.sourceSetPath} is missing set identity in the build receipt.`);
  }
  const setFile = resolve(repositoryRoot, row.sourceSetPath);
  const cardDirectory = setFile.replace(/\.ts$/i, "");
  const set = await importDefault<TcgdexSet>(setFile);
  const seriesName = clean(set.serie?.name?.ja);
  if (!seriesName) {
    throw new Error(`${row.sourceSetPath} is missing the Japanese series name.`);
  }
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
      category: clean(card.category) || null,
      rarity: clean(card.rarity) || null,
      illustrator: clean(card.illustrator) || null,
      regulationMark: clean(card.regulationMark) || null,
      dexId: Array.isArray(card.dexId)
        ? card.dexId.filter(Number.isInteger)
        : [],
      variants: normalizeVariants(card.variants),
    });
  }
  const missingJapaneseCardNames = sourceCards.filter((card) => !card.name).length;
  if (missingJapaneseCardNames !== row.missingJapaneseCardNames) {
    throw new Error(
      `${row.setId} source drift: build receipt expected ${row.missingJapaneseCardNames} missing Japanese names, found ${missingJapaneseCardNames}.`,
    );
  }
  return {
    setId: clean(row.setId),
    setName: clean(row.setName),
    seriesId: clean(row.seriesId),
    seriesName,
    releaseDate: releaseDateJa(set.releaseDate),
    officialCardCount: Number.isInteger(set.cardCount?.official)
      ? Number(set.cardCount?.official)
      : null,
    sourceSetPath: row.sourceSetPath,
    sourceCards,
    missingJapaneseCardNames,
  };
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
      return { response, body };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export function parseOfficialProductOptions(html: string) {
  const rows: OfficialProductOption[] = [];
  const pattern =
    /\{\s*name:\s*["']pg["'],\s*value:\s*["']([^"']*)["'],\s*group:\s*["']group-item-name["'],\s*label:\s*["']([^"']*)["']/g;
  for (const match of html.matchAll(pattern)) {
    const value = clean(match[1]);
    const label = clean(match[2]);
    if (!value || !label || label === "指定なし") continue;
    rows.push({ value, label });
  }
  const unique = new Map<string, OfficialProductOption>();
  for (const row of rows) unique.set(`${row.value}\u0000${row.label}`, row);
  return [...unique.values()];
}

export function mapOfficialProducts(
  setId: string,
  setName: string,
  options: OfficialProductOption[],
) {
  const idKey = clean(setId).toLowerCase();
  const direct = options.filter(
    (option) => clean(option.value).toLowerCase() === idKey,
  );
  if (direct.length) return direct;
  const nameKey = compact(setName);
  if (!nameKey) return [];
  const exact = options.filter((option) => compact(option.label) === nameKey);
  if (exact.length) return exact;
  return options.filter((option) => compact(option.label).includes(nameKey));
}

function officialCardName(card: OfficialCardSummary) {
  return clean(card.cardNameViewText || card.cardNameAltText || "") || null;
}

async function fetchOfficialCards(
  option: OfficialProductOption,
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
    url.searchParams.set("pg", option.value);
    if (page > 1) url.searchParams.set("page", String(page));
    const loaded = await fetchWithRetry(
      url.href,
      delayMs,
      "application/json,*/*;q=0.8",
    );
    const parsed = JSON.parse(loaded.body) as OfficialResultResponse;
    if (parsed.result !== 1 || !Array.isArray(parsed.cardList)) {
      throw new Error(
        `Official result API rejected ${option.value}: ${clean(parsed.errMsg) || "unknown error"}.`,
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
    const cardID = clean(card.cardID);
    if (cardID) unique.set(cardID, card);
  }
  return { cards: [...unique.values()], hitCnt, maxPage, regulation };
}

export function parseOfficialDetail(html: string) {
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
    name: heading ? clean(heading[1]) || null : null,
    setCode: setCode ? clean(setCode) || null : null,
    numerator: numberMatch ? clean(numberMatch[1]) || null : null,
    denominator: numberMatch ? clean(numberMatch[2]) || null : null,
  };
}

async function fetchOfficialDetail(params: {
  card: OfficialCardSummary;
  regulation: string;
  delayMs: number;
}): Promise<OfficialDetail> {
  const cardID = clean(params.card.cardID);
  const url = `${OFFICIAL_ORIGIN}/card-search/details.php/card/${encodeURIComponent(cardID)}/regu/${encodeURIComponent(params.regulation || "all")}`;
  const summaryName = officialCardName(params.card);
  try {
    const loaded = await fetchWithRetry(
      url,
      params.delayMs,
      "text/html,application/xhtml+xml",
    );
    const parsed = parseOfficialDetail(loaded.body);
    return {
      cardID,
      url,
      status: loaded.response.status,
      name: parsed.name,
      summaryName,
      setCode: parsed.setCode,
      numerator: parsed.numerator,
      denominator: parsed.denominator,
      normalizedLocalId: parsed.numerator
        ? normalizedLocalId(parsed.numerator)
        : null,
      error: null,
    };
  } catch (error) {
    return {
      cardID,
      url,
      status: 0,
      name: null,
      summaryName,
      setCode: null,
      numerator: null,
      denominator: null,
      normalizedLocalId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function evidenceCard(detail: OfficialDetail): OfficialEvidenceCard {
  return {
    cardID: detail.cardID,
    name: detail.name || detail.summaryName,
    setCode: detail.setCode,
    numerator: detail.numerator,
    denominator: detail.denominator,
    normalizedLocalId: detail.normalizedLocalId,
    url: detail.url,
  };
}

function baseRow(source: SourceSet, status: InventoryStatus): InventoryRow {
  return {
    setId: source.setId,
    setName: source.setName,
    seriesId: source.seriesId,
    releaseDate: source.releaseDate,
    sourceSetPath: source.sourceSetPath,
    status,
    sourceCardCount: source.sourceCards.length,
    sourceOfficialCardCount: source.officialCardCount,
    missingJapaneseCardNames: source.missingJapaneseCardNames,
    officialProduct: null,
    candidateProducts: [],
    reusedBySetIds: [],
    officialSearchUrl: null,
    officialHitCount: null,
    officialProductCards: null,
    officialComparableCards: null,
    officialExcludedCards: null,
    officialExcludedSetCodes: [],
    detailFetchFailures: 0,
    comparableOfficialCards: [],
    excludedOfficialCards: [],
    resolvedMissingNames: [],
    unresolvedMissingNames: [],
    knownNameMismatches: [],
    officialOnlyCards: [],
    sourceOnlyLocalIds: [],
    duplicateOfficialLocalIds: [],
    unnumberedOfficialCards: [],
    reasons: ["source_missing_japanese_names"],
    error: null,
  };
}

export function analyzeOfficialCrosswalk(params: {
  source: SourceSet;
  product: OfficialProductOption;
  candidateProducts?: OfficialProductOption[];
  reusedBySetIds?: string[];
  hitCount: number | null;
  details: OfficialDetail[];
}): InventoryRow {
  const row = baseRow(params.source, "partial_official_crosswalk");
  row.officialProduct = params.product;
  row.candidateProducts = params.candidateProducts || [params.product];
  row.reusedBySetIds = params.reusedBySetIds || [];
  row.officialSearchUrl = `${OFFICIAL_SEARCH_URL}?pg=${encodeURIComponent(params.product.value)}`;
  row.officialHitCount = params.hitCount;
  row.officialProductCards = params.details.length;
  row.detailFetchFailures = params.details.filter((detail) => detail.error).length;
  if (row.detailFetchFailures) row.reasons.push("official_detail_fetch_failed");

  const targetCode = clean(params.source.setId).toLowerCase();
  const targetDetails = params.details.filter(
    (detail) => clean(detail.setCode).toLowerCase() === targetCode,
  );
  const comparable = targetDetails.length ? targetDetails : params.details;
  const excluded = targetDetails.length
    ? params.details.filter(
        (detail) => clean(detail.setCode).toLowerCase() !== targetCode,
      )
    : [];
  if (!targetDetails.length) row.reasons.push("official_target_set_code_unresolved");
  row.officialComparableCards = comparable.length;
  row.officialExcludedCards = excluded.length;
  row.officialExcludedSetCodes = [
    ...new Set(excluded.map((detail) => clean(detail.setCode)).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
  row.comparableOfficialCards = comparable.map(evidenceCard);
  row.excludedOfficialCards = excluded.map(evidenceCard);

  const officialByLocalId = new Map<string, OfficialDetail[]>();
  for (const detail of comparable) {
    if (!detail.normalizedLocalId) continue;
    const group = officialByLocalId.get(detail.normalizedLocalId) || [];
    group.push(detail);
    officialByLocalId.set(detail.normalizedLocalId, group);
  }
  row.duplicateOfficialLocalIds = [...officialByLocalId.entries()]
    .filter(([, details]) => details.length > 1)
    .map(([localId, details]) => ({
      localId,
      cardIDs: details.map((detail) => detail.cardID).sort(),
    }))
    .sort((left, right) => left.localId.localeCompare(right.localId));
  if (row.duplicateOfficialLocalIds.length) {
    row.reasons.push("official_duplicate_local_id");
  }

  row.unnumberedOfficialCards = comparable
    .filter((detail) => !detail.normalizedLocalId)
    .map(evidenceCard);
  if (row.unnumberedOfficialCards.length) {
    row.reasons.push("official_unnumbered_cards");
  }

  const sourceLocalIds = new Set(
    params.source.sourceCards.map((card) => card.normalizedLocalId),
  );
  for (const sourceCard of params.source.sourceCards) {
    const matches = officialByLocalId.get(sourceCard.normalizedLocalId) || [];
    if (!sourceCard.name) {
      if (matches.length === 1 && (matches[0].name || matches[0].summaryName)) {
        const match = matches[0];
        row.resolvedMissingNames.push({
          sourcePath: sourceCard.sourcePath,
          localId: sourceCard.localId,
          officialCardID: match.cardID,
          officialName: clean(match.name || match.summaryName),
          officialSetCode: match.setCode,
          officialNumerator: match.numerator,
          officialDenominator: match.denominator,
          officialUrl: match.url,
        });
      } else {
        row.unresolvedMissingNames.push({
          sourcePath: sourceCard.sourcePath,
          localId: sourceCard.localId,
          candidateOfficialCardIDs: matches.map((match) => match.cardID),
          reason:
            matches.length === 0
              ? "official_local_id_not_found"
              : matches.length > 1
                ? "official_local_id_ambiguous"
                : "official_name_missing",
        });
      }
      continue;
    }
    if (matches.length === 1) {
      const match = matches[0];
      const officialName = clean(match.name || match.summaryName);
      if (
        officialName &&
        canonicalNameKey(sourceCard.name) !== canonicalNameKey(officialName)
      ) {
        row.knownNameMismatches.push({
          localId: sourceCard.localId,
          sourceName: sourceCard.name,
          officialName,
          officialCardID: match.cardID,
          officialUrl: match.url,
        });
      }
    }
  }
  if (row.unresolvedMissingNames.length) {
    row.reasons.push("source_missing_name_unresolved");
  }
  if (row.knownNameMismatches.length) {
    row.reasons.push("known_source_name_mismatch");
  }

  row.sourceOnlyLocalIds = params.source.sourceCards
    .filter((card) => !officialByLocalId.has(card.normalizedLocalId))
    .map((card) => card.localId)
    .sort((left, right) => left.localeCompare(right));
  if (row.sourceOnlyLocalIds.length) {
    row.reasons.push("source_local_id_not_official");
  }

  row.officialOnlyCards = comparable
    .filter(
      (detail) =>
        detail.normalizedLocalId && !sourceLocalIds.has(detail.normalizedLocalId),
    )
    .map(evidenceCard);
  if (row.officialOnlyCards.length) {
    row.reasons.push("official_cards_absent_from_source");
  }

  const blocked =
    row.detailFetchFailures > 0 ||
    !targetDetails.length ||
    row.duplicateOfficialLocalIds.length > 0 ||
    row.unnumberedOfficialCards.length > 0 ||
    row.unresolvedMissingNames.length > 0 ||
    row.knownNameMismatches.length > 0 ||
    row.sourceOnlyLocalIds.length > 0;
  if (!blocked) {
    row.status = row.officialOnlyCards.length
      ? "ready_for_card_backfill_proposal"
      : "ready_for_name_backfill";
  }
  row.reasons = [...new Set(row.reasons)];
  return row;
}

function statusCount(rows: InventoryRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const args = parseArguments();
  const buildReceipt = JSON.parse(
    await readFile(args.buildReceipt, "utf8"),
  ) as BuildReceipt;
  if (
    buildReceipt.schema !== "tcos.checklist.tcgdexJapaneseBuildReceipt.v1" ||
    !Array.isArray(buildReceipt.rows)
  ) {
    throw new Error(`${args.buildReceipt} is not a supported Japanese build receipt.`);
  }
  const actualCommit = sourceCommit(args.sourceDirectory);
  if (
    actualCommit !== "unknown" &&
    buildReceipt.sourceCommit !== actualCommit
  ) {
    throw new Error(
      `TCGdex source drift: receipt ${buildReceipt.sourceCommit}, checkout ${actualCommit}.`,
    );
  }

  const allJapaneseRows = buildReceipt.rows.filter(
    (row) =>
      Boolean(row.setId && row.setName) &&
      (row.status === "built" || row.status === "incomplete_japanese"),
  );
  let selectedRows = buildReceipt.rows.filter(
    (row) => row.status === "incomplete_japanese",
  );
  if (args.setIds.size) {
    selectedRows = selectedRows.filter((row) =>
      args.setIds.has(clean(row.setId).toLowerCase()),
    );
  }
  if (args.limit !== null) selectedRows = selectedRows.slice(0, args.limit);

  const searchPage = await fetchWithRetry(
    OFFICIAL_SEARCH_URL,
    args.delayMs,
    "text/html,application/xhtml+xml",
  );
  const productOptions = parseOfficialProductOptions(searchPage.body);
  if (!productOptions.length) {
    throw new Error("Official product search page returned no product options.");
  }

  const mappingBySetId = new Map<string, OfficialProductOption[]>();
  const productUsage = new Map<string, string[]>();
  for (const sourceRow of allJapaneseRows) {
    if (!sourceRow.setId || !sourceRow.setName) continue;
    const candidates = mapOfficialProducts(
      sourceRow.setId,
      sourceRow.setName,
      productOptions,
    );
    mappingBySetId.set(sourceRow.setId.toLowerCase(), candidates);
    if (candidates.length === 1) {
      const usage = productUsage.get(candidates[0].value) || [];
      usage.push(sourceRow.setId);
      productUsage.set(candidates[0].value, usage);
    }
  }

  const productCache = new Map<
    string,
    Awaited<ReturnType<typeof fetchOfficialCards>>
  >();
  const detailCache = new Map<string, OfficialDetail>();
  const rows: InventoryRow[] = [];

  for (const buildRow of selectedRows) {
    let source: SourceSet | null = null;
    try {
      source = await loadSourceSet(args.sourceDirectory, buildRow);
      const candidates =
        mappingBySetId.get(source.setId.toLowerCase()) || [];
      if (!candidates.length) {
        const row = baseRow(source, "official_source_unmapped");
        row.reasons.push("official_product_unmapped");
        rows.push(row);
        continue;
      }
      if (candidates.length > 1) {
        const row = baseRow(source, "official_source_ambiguous");
        row.candidateProducts = candidates;
        row.reasons.push("official_product_ambiguous");
        rows.push(row);
        continue;
      }
      const product = candidates[0];
      const reusedBySetIds = productUsage.get(product.value) || [];
      if (reusedBySetIds.length > 1) {
        const row = baseRow(source, "official_source_reused");
        row.officialProduct = product;
        row.candidateProducts = candidates;
        row.reusedBySetIds = [...reusedBySetIds].sort();
        row.officialSearchUrl = `${OFFICIAL_SEARCH_URL}?pg=${encodeURIComponent(product.value)}`;
        row.reasons.push("official_product_mapped_to_multiple_source_sets");
        rows.push(row);
        continue;
      }

      let productResult = productCache.get(product.value);
      if (!productResult) {
        productResult = await fetchOfficialCards(product, args.delayMs);
        productCache.set(product.value, productResult);
      }
      const details: OfficialDetail[] = [];
      for (const card of productResult.cards) {
        const cardID = clean(card.cardID);
        let detail = detailCache.get(cardID);
        if (!detail) {
          detail = await fetchOfficialDetail({
            card,
            regulation: productResult.regulation,
            delayMs: args.delayMs,
          });
          detailCache.set(cardID, detail);
        }
        details.push(detail);
      }
      rows.push(
        analyzeOfficialCrosswalk({
          source,
          product,
          candidateProducts: candidates,
          reusedBySetIds,
          hitCount: productResult.hitCnt,
          details,
        }),
      );
    } catch (error) {
      const fallback: SourceSet =
        source ||
        {
          setId: clean(buildRow.setId) || "unknown",
          setName: clean(buildRow.setName) || "unknown",
          seriesId: clean(buildRow.seriesId) || "unknown",
          seriesName: "unknown",
          releaseDate: null,
          officialCardCount: null,
          sourceSetPath: buildRow.sourceSetPath,
          sourceCards: [],
          missingJapaneseCardNames: buildRow.missingJapaneseCardNames || 0,
        };
      const row = baseRow(fallback, "failed");
      row.error = error instanceof Error ? error.message : String(error);
      row.reasons.push("technical_failure");
      rows.push(row);
      if (!args.continueOnError) break;
    }
  }

  const generatedAt = new Date().toISOString();
  const failedRows = rows.filter((row) => row.status === "failed");
  const receipt = {
    schema: RECEIPT_SCHEMA,
    generatedAt,
    mode: "read_only_official_inventory",
    sourceRepository: "https://github.com/tcgdex/cards-database",
    sourceCommit: buildReceipt.sourceCommit,
    sourceDirectory: args.sourceDirectory,
    buildReceipt: args.buildReceipt,
    officialSearchUrl: OFFICIAL_SEARCH_URL,
    officialResultApi: OFFICIAL_RESULT_API,
    officialProductOptions: productOptions.length,
    attemptedSets: rows.length,
    statusCounts: statusCount(rows),
    totals: {
      sourceCards: rows.reduce((sum, row) => sum + row.sourceCardCount, 0),
      missingJapaneseCardNames: rows.reduce(
        (sum, row) => sum + row.missingJapaneseCardNames,
        0,
      ),
      officialProductCards: rows.reduce(
        (sum, row) => sum + (row.officialProductCards || 0),
        0,
      ),
      officialComparableCards: rows.reduce(
        (sum, row) => sum + (row.officialComparableCards || 0),
        0,
      ),
      officialDetailsFetched: detailCache.size,
      detailFetchFailures: rows.reduce(
        (sum, row) => sum + row.detailFetchFailures,
        0,
      ),
      resolvedMissingNames: rows.reduce(
        (sum, row) => sum + row.resolvedMissingNames.length,
        0,
      ),
      unresolvedMissingNames: rows.reduce(
        (sum, row) => sum + row.unresolvedMissingNames.length,
        0,
      ),
      officialOnlyCards: rows.reduce(
        (sum, row) => sum + row.officialOnlyCards.length,
        0,
      ),
      sourceOnlyLocalIds: rows.reduce(
        (sum, row) => sum + row.sourceOnlyLocalIds.length,
        0,
      ),
      failedSets: failedRows.length,
    },
    rows,
  };
  const queue = {
    schema: QUEUE_SCHEMA,
    generatedAt,
    sourceCommit: buildReceipt.sourceCommit,
    rows: rows
      .filter(
        (row) =>
          row.status !== "ready_for_name_backfill" &&
          row.status !== "ready_for_card_backfill_proposal",
      )
      .map((row) => ({
        setId: row.setId,
        setName: row.setName,
        status: row.status,
        officialProduct: row.officialProduct,
        candidateProducts: row.candidateProducts,
        reusedBySetIds: row.reusedBySetIds,
        missingJapaneseCardNames: row.missingJapaneseCardNames,
        resolvedMissingNames: row.resolvedMissingNames.length,
        unresolvedMissingNames: row.unresolvedMissingNames,
        officialOnlyCards: row.officialOnlyCards,
        sourceOnlyLocalIds: row.sourceOnlyLocalIds,
        duplicateOfficialLocalIds: row.duplicateOfficialLocalIds,
        unnumberedOfficialCards: row.unnumberedOfficialCards,
        detailFetchFailures: row.detailFetchFailures,
        reasons: row.reasons,
        error: row.error,
      })),
  };
  await writeJson(args.receipt, receipt);
  await writeJson(args.queue, queue);
  console.log(JSON.stringify(receipt, null, 2));
  if (failedRows.length) process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

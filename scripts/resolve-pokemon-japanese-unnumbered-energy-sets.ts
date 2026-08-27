import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const HISTORICAL_LINK_SOURCE =
  "https://gist.github.com/limithand/a14a6cf55572554ee46d29d444d99505";
const RECEIPT_SCHEMA =
  "tcos.checklist.pokemonJapaneseUnnumberedEnergyResolution.v1" as const;
const QUEUE_SCHEMA =
  "tcos.checklist.pokemonJapaneseUnnumberedEnergyResolutionQueue.v1" as const;

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Unnumbered-Energy-Resolver/1.0 (+https://totallycollectibles.com)",
};

const TARGETS = {
  s8a: {
    product: {
      value: "746",
      label: "拡張パック「25th ANNIVERSARY COLLECTION」",
    },
  },
  s8b: {
    product: {
      value: "748",
      label: "ハイクラスパック「VMAXクライマックス」",
    },
  },
  s10b: {
    product: {
      value: "861",
      label: "強化拡張パック「Pokémon GO」",
    },
  },
} as const;

const BASIC_ENERGY_NAME_BY_SOURCE_ID: Record<string, string> = {
  GRA: "基本草エネルギー",
  FIR: "基本炎エネルギー",
  WAT: "基本水エネルギー",
  LIG: "基本雷エネルギー",
  PSY: "基本超エネルギー",
  FIG: "基本闘エネルギー",
  DAR: "基本悪エネルギー",
  MET: "基本鋼エネルギー",
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
type OfficialProduct = {
  value: string;
  label: string;
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
type OfficialCardDetail = {
  cardID: string;
  name: string;
  summaryName: string | null;
  setCode: string;
  numerator: string | null;
  denominator: string | null;
  normalizedLocalId: string | null;
  detailUrl: string;
};
type SourceCrosswalkEvidence = {
  sourceLocalId: string;
  sourcePath: string;
  origin: "source_number_crosswalk" | "source_energy_alias";
  officialCardID: string;
  officialName: string;
  officialSetCode: string;
  officialNumerator: string | null;
  officialDenominator: string | null;
  officialUrl: string;
};
type OfficialAdditionEvidence = {
  origin: "official_numbered_addition" | "official_unnumbered_energy_addition";
  officialCardID: string;
  name: string;
  setCode: string;
  numerator: string | null;
  denominator: string | null;
  localId: string;
  variation: string | null;
  officialUrl: string;
};
type ResolutionRow = {
  setId: string;
  setName: string;
  seriesId: string;
  releaseDate: string | null;
  sourceSetPath: string;
  sourceOfficialCardCount: number | null;
  product: OfficialProduct;
  status: "resolved" | "failed";
  sourceCards: number;
  missingJapaneseCardNames: number;
  officialCards: number;
  numberedOfficialCards: number;
  unnumberedOfficialCards: number;
  sourceNumberMatches: number;
  sourceEnergyAliasMatches: number;
  resolvedMissingNames: number;
  numberedOfficialAdditions: number;
  unnumberedEnergyAdditions: number;
  sourceCrosswalk: SourceCrosswalkEvidence[];
  officialAdditions: OfficialAdditionEvidence[];
  detailFetchFailures: number;
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

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/resolve-pokemon-japanese-unnumbered-energy-sets.ts <tcgdex-cards-database-directory> [options]",
      "",
      "Options:",
      "  --build-receipt <path>    Pinned TCGdex Japanese build receipt",
      "  --phase4a-receipt <path>  Phase 4A incomplete-set inventory receipt",
      "  --receipt <path>          Resolution receipt",
      "  --queue <path>            Failure queue",
      "  --set <set-id>            Resolve one set; repeatable",
      "  --delay-ms <number>       Delay between official requests (default 250)",
      "  --continue-on-error       Continue after a failed set",
      "",
      "This command is read-only except for local receipts. It never writes to Registry or Production and never downloads official images.",
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
    phase4AReceipt: resolve(
      argumentValue("--phase4a-receipt") ||
        ".codex-run/pokemon-ja-incomplete-inventory-receipt.json",
    ),
    receipt: resolve(
      argumentValue("--receipt") ||
        ".codex-run/pokemon-ja-unnumbered-energy-resolution-receipt.json",
    ),
    queue: resolve(
      argumentValue("--queue") ||
        ".codex-run/pokemon-ja-unnumbered-energy-resolution-queue.json",
    ),
    setIds: new Set(
      argumentValues("--set").map((value) => clean(value).toLowerCase()),
    ),
    delayMs: numericArgument("--delay-ms", 250),
    continueOnError: process.argv.includes("--continue-on-error"),
  };
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
function compact(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
function canonicalName(value: unknown) {
  return clean(value)
    .replace(/^(博士の研究)[(（][^)）]+[)）]$/, "$1")
    .replace(/^(ボスの指令)[(（][^)）]+[)）]$/, "$1");
}
function canonicalNameKey(value: unknown) {
  return compact(canonicalName(value));
}
function normalizedLocalId(value: unknown) {
  const text = clean(value).toUpperCase().replace(/\s+/g, "");
  if (!text) return "";
  if (/^\d+$/.test(text)) return String(Number(text));
  return text;
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

async function loadSourceSet(
  repositoryRoot: string,
  row: BuildReceiptRow,
): Promise<SourceSet> {
  if (!row.setId || !row.setName || !row.seriesId) {
    throw new Error(`${row.sourceSetPath} is missing set identity.`);
  }
  const setFile = resolve(repositoryRoot, row.sourceSetPath);
  const cardDirectory = setFile.replace(/\.ts$/i, "");
  const set = await importDefault<TcgdexSet>(setFile);
  const setId = clean(set.id);
  const setName = clean(set.name?.ja);
  const seriesId = clean(set.serie?.id);
  const seriesName = clean(set.serie?.name?.ja);
  if (!setId || !setName || !seriesId || !seriesName) {
    throw new Error(`${row.sourceSetPath} lacks complete Japanese metadata.`);
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
    });
  }
  return {
    setId,
    setName,
    seriesId,
    seriesName,
    releaseDate: releaseDateJa(set.releaseDate),
    officialCardCount: Number.isInteger(set.cardCount?.official)
      ? Number(set.cardCount?.official)
      : null,
    sourceSetPath: row.sourceSetPath,
    sourceCards,
    missingJapaneseCardNames: sourceCards.filter((card) => !card.name).length,
  };
}

function sleep(ms: number) {
  return ms > 0
    ? new Promise((done) => setTimeout(done, ms))
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
function parseDetail(html: string) {
  const heading = html.match(
    /<h1[^>]*class=["'][^"']*Heading1[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  );
  const logo =
    html.match(
      /<img[^>]*class=["'][^"']*img-regulation[^"']*["'][^>]*>/i,
    )?.[0] || null;
  const setCode = logo?.match(/alt=["']([^"']+)["']/i)?.[1] || null;
  const logoIndex = logo ? html.indexOf(logo) : -1;
  const afterLogo =
    logo && logoIndex >= 0
      ? html.slice(logoIndex + logo.length, logoIndex + logo.length + 500)
      : "";
  const numberMatch = afterLogo.match(
    /(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*\/(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*/i,
  );
  return {
    name: heading ? clean(heading[1]) : "",
    setCode: setCode ? clean(setCode) : "",
    numerator: numberMatch ? clean(numberMatch[1]) : null,
    denominator: numberMatch ? clean(numberMatch[2]) : null,
  };
}

async function fetchOfficialProduct(
  product: OfficialProduct,
  delayMs: number,
) {
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
    throw new Error(
      `Product ${product.value} collected ${unique.size}/${hitCount} cards.`,
    );
  }

  const details: OfficialCardDetail[] = [];
  for (const summary of unique.values()) {
    const cardID = clean(summary.cardID);
    const detailUrl =
      `${OFFICIAL_ORIGIN}/card-search/details.php/card/` +
      `${encodeURIComponent(cardID)}/regu/${encodeURIComponent(regulation)}`;
    const parsed = parseDetail(
      await fetchWithRetry(
        detailUrl,
        delayMs,
        "text/html,application/xhtml+xml",
      ),
    );
    if (!parsed.name || !parsed.setCode) {
      throw new Error(
        `Official card ${cardID} lacks Japanese name or printed set code.`,
      );
    }
    const summaryName = officialCardName(summary) || null;
    if (
      summaryName &&
      canonicalNameKey(summaryName) !== canonicalNameKey(parsed.name)
    ) {
      throw new Error(
        `Official card ${cardID} summary/detail name mismatch: ${summaryName} / ${parsed.name}.`,
      );
    }
    details.push({
      cardID,
      name: parsed.name,
      summaryName,
      setCode: parsed.setCode,
      numerator: parsed.numerator,
      denominator: parsed.denominator,
      normalizedLocalId: normalizedLocalId(parsed.numerator) || null,
      detailUrl,
    });
  }
  return { hitCount, regulation, details };
}

function productUrl(product: OfficialProduct) {
  return (
    `${OFFICIAL_ORIGIN}/card-search/index.php?mode=statuslist&pg=` +
    encodeURIComponent(product.value)
  );
}

function resolveSet(params: {
  source: SourceSet;
  product: OfficialProduct;
  details: OfficialCardDetail[];
}): ResolutionRow {
  const setCode = params.source.setId.toLowerCase();
  const wrongSet = params.details.filter(
    (detail) => detail.setCode.toLowerCase() !== setCode,
  );
  if (wrongSet.length) {
    throw new Error(
      `${params.source.setId} product includes ${wrongSet.length} cards with other printed set codes.`,
    );
  }

  const numberedByLocalId = new Map<string, OfficialCardDetail[]>();
  const unnumberedByName = new Map<string, OfficialCardDetail[]>();
  for (const detail of params.details) {
    if (detail.normalizedLocalId) {
      const rows = numberedByLocalId.get(detail.normalizedLocalId) || [];
      rows.push(detail);
      numberedByLocalId.set(detail.normalizedLocalId, rows);
    } else {
      const key = canonicalNameKey(detail.name);
      const rows = unnumberedByName.get(key) || [];
      rows.push(detail);
      unnumberedByName.set(key, rows);
    }
  }

  const duplicateNumbers = [...numberedByLocalId.entries()].filter(
    ([, rows]) => rows.length !== 1,
  );
  if (duplicateNumbers.length) {
    throw new Error(
      `${params.source.setId} repeats ${duplicateNumbers.length} numbered official card IDs.`,
    );
  }

  const expectedEnergyNames = Object.values(BASIC_ENERGY_NAME_BY_SOURCE_ID);
  const unnumbered = params.details.filter(
    (detail) => !detail.normalizedLocalId,
  );
  const unsupportedUnnumbered = unnumbered.filter(
    (detail) =>
      !expectedEnergyNames.some(
        (name) => canonicalNameKey(name) === canonicalNameKey(detail.name),
      ),
  );
  if (unsupportedUnnumbered.length) {
    throw new Error(
      `${params.source.setId} includes unsupported unnumbered official cards.`,
    );
  }
  for (const name of expectedEnergyNames) {
    const rows = unnumberedByName.get(canonicalNameKey(name)) || [];
    if (rows.length !== 1) {
      throw new Error(
        `${params.source.setId} requires exactly one unnumbered ${name}; found ${rows.length}.`,
      );
    }
  }

  const usedOfficialCardIDs = new Set<string>();
  const sourceCrosswalk: SourceCrosswalkEvidence[] = [];
  let sourceNumberMatches = 0;
  let sourceEnergyAliasMatches = 0;
  for (const sourceCard of params.source.sourceCards) {
    const energyName =
      BASIC_ENERGY_NAME_BY_SOURCE_ID[sourceCard.normalizedLocalId];
    const candidate = energyName
      ? (unnumberedByName.get(canonicalNameKey(energyName)) || [])[0]
      : (numberedByLocalId.get(sourceCard.normalizedLocalId) || [])[0];
    if (!candidate) {
      throw new Error(
        `${params.source.setId} source card ${sourceCard.localId} has no official number or energy alias match.`,
      );
    }
    if (usedOfficialCardIDs.has(candidate.cardID)) {
      throw new Error(
        `${params.source.setId} official card ${candidate.cardID} was assigned twice.`,
      );
    }
    if (
      sourceCard.name &&
      canonicalNameKey(sourceCard.name) !== canonicalNameKey(candidate.name)
    ) {
      throw new Error(
        `${params.source.setId} card ${sourceCard.localId} name mismatch: ${sourceCard.name} / ${candidate.name}.`,
      );
    }
    usedOfficialCardIDs.add(candidate.cardID);
    sourceCrosswalk.push({
      sourceLocalId: sourceCard.localId,
      sourcePath: sourceCard.sourcePath,
      origin: energyName
        ? "source_energy_alias"
        : "source_number_crosswalk",
      officialCardID: candidate.cardID,
      officialName: candidate.name,
      officialSetCode: candidate.setCode,
      officialNumerator: candidate.numerator,
      officialDenominator: candidate.denominator,
      officialUrl: candidate.detailUrl,
    });
    if (energyName) sourceEnergyAliasMatches += 1;
    else sourceNumberMatches += 1;
  }

  const additions = params.details.filter(
    (detail) => !usedOfficialCardIDs.has(detail.cardID),
  );
  const officialAdditions: OfficialAdditionEvidence[] = additions.map(
    (detail) => {
      if (!detail.normalizedLocalId) {
        return {
          origin: "official_unnumbered_energy_addition" as const,
          officialCardID: detail.cardID,
          name: detail.name,
          setCode: detail.setCode,
          numerator: null,
          denominator: detail.denominator,
          localId: "UNNUMBERED",
          variation: `Official Card ${detail.cardID}`,
          officialUrl: detail.detailUrl,
        };
      }
      return {
        origin: "official_numbered_addition" as const,
        officialCardID: detail.cardID,
        name: detail.name,
        setCode: detail.setCode,
        numerator: detail.numerator,
        denominator: detail.denominator,
        localId: clean(detail.numerator),
        variation: null,
        officialUrl: detail.detailUrl,
      };
    },
  );

  const numberedOfficialAdditions = officialAdditions.filter(
    (row) => row.origin === "official_numbered_addition",
  ).length;
  const unnumberedEnergyAdditions = officialAdditions.filter(
    (row) => row.origin === "official_unnumbered_energy_addition",
  ).length;
  const resolvedMissingNames = sourceCrosswalk.filter((row) => {
    const source = params.source.sourceCards.find(
      (card) => card.localId === row.sourceLocalId,
    );
    return source && !source.name;
  }).length;

  if (sourceCrosswalk.length !== params.source.sourceCards.length) {
    throw new Error(`${params.source.setId} source crosswalk is incomplete.`);
  }
  if (resolvedMissingNames !== params.source.missingJapaneseCardNames) {
    throw new Error(
      `${params.source.setId} resolved ${resolvedMissingNames}/${params.source.missingJapaneseCardNames} missing names.`,
    );
  }
  if (
    sourceCrosswalk.length + officialAdditions.length !==
    params.details.length
  ) {
    throw new Error(`${params.source.setId} official population does not reconcile.`);
  }

  return {
    setId: params.source.setId,
    setName: params.source.setName,
    seriesId: params.source.seriesId,
    releaseDate: params.source.releaseDate,
    sourceSetPath: params.source.sourceSetPath,
    sourceOfficialCardCount: params.source.officialCardCount,
    product: params.product,
    status: "resolved",
    sourceCards: params.source.sourceCards.length,
    missingJapaneseCardNames: params.source.missingJapaneseCardNames,
    officialCards: params.details.length,
    numberedOfficialCards: params.details.length - unnumbered.length,
    unnumberedOfficialCards: unnumbered.length,
    sourceNumberMatches,
    sourceEnergyAliasMatches,
    resolvedMissingNames,
    numberedOfficialAdditions,
    unnumberedEnergyAdditions,
    sourceCrosswalk,
    officialAdditions,
    detailFetchFailures: 0,
    reasons: ["official_product_and_unnumbered_energy_population_proved"],
    error: null,
  };
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
  const phase4A = JSON.parse(
    await readFile(args.phase4AReceipt, "utf8"),
  ) as Phase4AReceipt;
  if (
    buildReceipt.schema !== "tcos.checklist.tcgdexJapaneseBuildReceipt.v1" ||
    phase4A.schema !== "tcos.checklist.pokemonJapaneseIncompleteInventory.v1"
  ) {
    throw new Error("Unsupported Japanese build or Phase 4A receipt schema.");
  }
  const commit = sourceCommit(args.sourceDirectory);
  if (
    buildReceipt.sourceCommit !== phase4A.sourceCommit ||
    (commit !== "unknown" && commit !== buildReceipt.sourceCommit)
  ) {
    throw new Error(
      `TCGdex source drift: build ${buildReceipt.sourceCommit}, Phase 4A ${phase4A.sourceCommit}, checkout ${commit}.`,
    );
  }

  const phase4ABySet = new Map(
    phase4A.rows.map((row) => [clean(row.setId).toLowerCase(), row]),
  );
  const buildRows = new Map(
    buildReceipt.rows.map((row) => [clean(row.setId).toLowerCase(), row]),
  );
  const targetKeys = Object.keys(TARGETS).filter(
    (key) => !args.setIds.size || args.setIds.has(key),
  );
  const rows: ResolutionRow[] = [];
  for (const key of targetKeys) {
    const target = TARGETS[key as keyof typeof TARGETS];
    const buildRow = buildRows.get(key);
    const phase4ARow = phase4ABySet.get(key);
    let source: SourceSet | null = null;
    try {
      if (!buildRow || buildRow.status !== "incomplete_japanese") {
        throw new Error(`${key} is not an incomplete Japanese source set.`);
      }
      if (!phase4ARow || phase4ARow.status !== "official_source_unmapped") {
        throw new Error(`${key} is not held as Phase 4A official_source_unmapped.`);
      }
      source = await loadSourceSet(args.sourceDirectory, buildRow);
      const official = await fetchOfficialProduct(target.product, args.delayMs);
      rows.push(
        resolveSet({
          source,
          product: target.product,
          details: official.details,
        }),
      );
    } catch (error) {
      rows.push({
        setId: source?.setId || clean(buildRow?.setId) || key,
        setName: source?.setName || clean(buildRow?.setName) || key,
        seriesId: source?.seriesId || clean(buildRow?.seriesId),
        releaseDate: source?.releaseDate || null,
        sourceSetPath: source?.sourceSetPath || buildRow?.sourceSetPath || "",
        sourceOfficialCardCount: source?.officialCardCount || null,
        product: target.product,
        status: "failed",
        sourceCards: source?.sourceCards.length || 0,
        missingJapaneseCardNames:
          source?.missingJapaneseCardNames ||
          buildRow?.missingJapaneseCardNames ||
          0,
        officialCards: 0,
        numberedOfficialCards: 0,
        unnumberedOfficialCards: 0,
        sourceNumberMatches: 0,
        sourceEnergyAliasMatches: 0,
        resolvedMissingNames: 0,
        numberedOfficialAdditions: 0,
        unnumberedEnergyAdditions: 0,
        sourceCrosswalk: [],
        officialAdditions: [],
        detailFetchFailures: 0,
        reasons: ["unnumbered_energy_resolution_failed"],
        error: error instanceof Error ? error.message : String(error),
      });
      if (!args.continueOnError) break;
    }
  }

  const failed = rows.filter((row) => row.status === "failed");
  const totals = rows.reduce(
    (sum, row) => {
      sum.sourceCards += row.sourceCards;
      sum.missingJapaneseCardNames += row.missingJapaneseCardNames;
      sum.officialCards += row.officialCards;
      sum.numberedOfficialCards += row.numberedOfficialCards;
      sum.unnumberedOfficialCards += row.unnumberedOfficialCards;
      sum.sourceNumberMatches += row.sourceNumberMatches;
      sum.sourceEnergyAliasMatches += row.sourceEnergyAliasMatches;
      sum.resolvedMissingNames += row.resolvedMissingNames;
      sum.numberedOfficialAdditions += row.numberedOfficialAdditions;
      sum.unnumberedEnergyAdditions += row.unnumberedEnergyAdditions;
      sum.detailFetchFailures += row.detailFetchFailures;
      return sum;
    },
    {
      sourceCards: 0,
      missingJapaneseCardNames: 0,
      officialCards: 0,
      numberedOfficialCards: 0,
      unnumberedOfficialCards: 0,
      sourceNumberMatches: 0,
      sourceEnergyAliasMatches: 0,
      resolvedMissingNames: 0,
      numberedOfficialAdditions: 0,
      unnumberedEnergyAdditions: 0,
      detailFetchFailures: 0,
    },
  );
  const receipt = {
    schema: RECEIPT_SCHEMA,
    mode: "read_only_unnumbered_energy_resolution",
    generatedAt: new Date().toISOString(),
    sourceCommit: buildReceipt.sourceCommit,
    historicalCandidateSource: HISTORICAL_LINK_SOURCE,
    attemptedSets: rows.length,
    successfulSets: rows.length - failed.length,
    failedSets: failed.length,
    totals,
    rows: rows.map((row) => ({
      ...row,
      product: {
        ...row.product,
        url: productUrl(row.product),
      },
    })),
  };
  const queue = {
    schema: QUEUE_SCHEMA,
    generatedAt: receipt.generatedAt,
    sourceCommit: receipt.sourceCommit,
    rows: rows
      .filter((row) => row.status === "failed")
      .map((row) => ({
        setId: row.setId,
        setName: row.setName,
        product: row.product,
        reasons: row.reasons,
        error: row.error,
      })),
  };
  await mkdir(dirname(args.receipt), { recursive: true });
  await writeFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await mkdir(dirname(args.queue), { recursive: true });
  await writeFile(args.queue, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (failed.length) process.exitCode = 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

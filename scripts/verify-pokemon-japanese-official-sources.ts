import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  TCGDEX_JAPANESE_BUNDLE_SCHEMA,
  type TcgdexJapaneseSetBundle,
} from "../src/lib/checklist-registry/tcgdex-japanese";

const OFFICIAL_ORIGIN = "https://www.pokemon-card.com";
const OFFICIAL_SEARCH_URL = `${OFFICIAL_ORIGIN}/card-search/`;
const OFFICIAL_RESULT_API = `${OFFICIAL_ORIGIN}/card-search/resultAPI.php`;
const BUNDLE_SUFFIX = ".tcgdex-ja.bundle.json";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Verification/1.0 (+https://totallycollectibles.com)",
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
  thisPage: number;
  cardStart?: number;
  cardEnd?: number;
  cardList: OfficialCardSummary[];
};

type DetailEvidence = {
  cardID: string;
  url: string;
  status: number;
  name: string | null;
  setCode: string | null;
  numerator: string | null;
  denominator: string | null;
  expectedName: string | null;
  expectedLocalId: string | null;
  nameMatches: boolean | null;
  numberMatches: boolean | null;
  setCodeMatches: boolean | null;
  error: string | null;
};

type AuditStatus =
  | "verified"
  | "manual_review"
  | "mismatch"
  | "official_source_unmapped"
  | "official_source_ambiguous"
  | "official_source_reused"
  | "failed";

type AuditRow = {
  file: string;
  setId: string;
  setName: string;
  releaseDate: string;
  status: AuditStatus;
  officialProduct: OfficialProductOption | null;
  officialSearchUrl: string | null;
  registryCardCount: number;
  officialHitCount: number | null;
  officialCollectedCount: number | null;
  officialMaxPage: number | null;
  officialSetCodes: string[];
  countMatches: boolean | null;
  setCodeMatches: boolean | null;
  nameMultisetMatches: boolean | null;
  orderedNameMismatchCount: number | null;
  orderedNameMismatches: Array<{
    position: number;
    localId: string | null;
    registryName: string | null;
    officialName: string | null;
    cardID: string | null;
  }>;
  missingOfficialNamesInRegistry: Array<{ name: string; count: number }>;
  extraRegistryNames: Array<{ name: string; count: number }>;
  detailEvidence: DetailEvidence[];
  candidateProducts: OfficialProductOption[];
  reasons: string[];
  error: string | null;
};

type Arguments = {
  input: string;
  receipt: string;
  queue: string;
  setIds: Set<string>;
  limit: number | null;
  delayMs: number;
  detailSamples: number;
  mappingOnly: boolean;
};

function usage() {
  console.log(
    [
      "Usage:",
      "  npx tsx scripts/verify-pokemon-japanese-official-sources.ts [bundle-directory] [options]",
      "",
      "Options:",
      "  --receipt <path>          JSON audit receipt",
      "  --queue <path>            JSON discrepancy queue",
      "  --set <set-id>            Audit only one set; repeatable",
      "  --limit <number>          Audit only the first N selected bundles",
      "  --delay-ms <number>       Delay between official requests (default 125)",
      "  --detail-samples <number> Printed-number samples per mapped set (default 5)",
      "  --mapping-only            Resolve official product mappings without API card requests",
      "",
      "This command is audit-only. It never writes to the Checklist Registry and never downloads official card images.",
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
  const value = argumentValue(flag);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer.`);
  }
  return parsed;
}

function parseArguments(): Arguments {
  const positional = process.argv[2];
  const input = resolve(
    positional && !positional.startsWith("--")
      ? positional
      : ".codex-run/tcgdex-ja-registry-bundles",
  );
  return {
    input,
    receipt: resolve(
      argumentValue("--receipt") ||
        ".codex-run/pokemon-ja-official-verification-receipt.json",
    ),
    queue: resolve(
      argumentValue("--queue") ||
        ".codex-run/pokemon-ja-official-discrepancy-queue.json",
    ),
    setIds: new Set(argumentValues("--set").map((value) => value.toLowerCase())),
    limit: numericArgument("--limit", null),
    delayMs: numericArgument("--delay-ms", 125) || 0,
    detailSamples: numericArgument("--detail-samples", 5) || 0,
    mappingOnly: process.argv.includes("--mapping-only"),
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

function normalizedCardNumber(value: unknown) {
  const text = clean(value).toUpperCase();
  if (/^\d+$/.test(text)) return String(Number(text));
  return text.replace(/\s+/g, "");
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolvePromise) => setTimeout(resolvePromise, ms)) : Promise.resolve();
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
        throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
      }
      return { response, body };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseOfficialProductOptions(html: string) {
  const rows: OfficialProductOption[] = [];
  const pattern = /\{\s*name:\s*["']pg["'],\s*value:\s*["']([^"']*)["'],\s*group:\s*["']group-item-name["'],\s*label:\s*["']([^"']*)["']/g;
  for (const match of html.matchAll(pattern)) {
    const value = clean(match[1]);
    const label = clean(match[2]);
    if (!value || !label || label === "指定なし") continue;
    rows.push({ value, label });
  }
  const uniqueRows = new Map<string, OfficialProductOption>();
  for (const row of rows) uniqueRows.set(`${row.value}\u0000${row.label}`, row);
  return [...uniqueRows.values()];
}

function mapOfficialProducts(
  bundle: TcgdexJapaneseSetBundle,
  options: OfficialProductOption[],
) {
  const setId = clean(bundle.set.id);
  const setName = clean(bundle.set.name);
  const idKey = setId.toLowerCase();
  const nameKey = compact(setName);
  const direct = options.filter((option) => option.value.toLowerCase() === idKey);
  if (direct.length) return direct;
  if (!nameKey) return [];
  return options.filter((option) => {
    const labelKey = compact(option.label);
    return labelKey === nameKey || labelKey.includes(nameKey);
  });
}

function parseBundle(content: string, file: string) {
  const parsed = JSON.parse(content) as TcgdexJapaneseSetBundle;
  if (parsed.schema !== TCGDEX_JAPANESE_BUNDLE_SCHEMA) {
    throw new Error(`${file} has unsupported schema ${String(parsed.schema)}.`);
  }
  if (parsed.language !== "ja" || !parsed.set || !Array.isArray(parsed.cards)) {
    throw new Error(`${file} is not a Japanese TCGdex set bundle.`);
  }
  return parsed;
}

async function loadBundles(input: string) {
  const names = (await readdir(input))
    .filter((name) => name.endsWith(BUNDLE_SUFFIX))
    .sort((a, b) => a.localeCompare(b));
  const rows: Array<{ file: string; bundle: TcgdexJapaneseSetBundle }> = [];
  for (const name of names) {
    const file = join(input, name);
    rows.push({ file, bundle: parseBundle(await readFile(file, "utf8"), file) });
  }
  return rows;
}

function officialCardName(card: OfficialCardSummary) {
  return clean(card.cardNameViewText || card.cardNameAltText || "");
}

function officialSetCode(card: OfficialCardSummary) {
  return (
    clean(card.cardThumbFile).match(/\/card_images\/large\/([^/]+)\//i)?.[1] || null
  );
}

function nameCounts(values: string[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const value of values) {
    const name = clean(value);
    const key = compact(name);
    if (!key) continue;
    const row = counts.get(key) || { name, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  return counts;
}

function subtractNameCounts(
  left: Map<string, { name: string; count: number }>,
  right: Map<string, { name: string; count: number }>,
) {
  return [...left.entries()]
    .map(([key, row]) => ({ name: row.name, count: row.count - (right.get(key)?.count || 0) }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sampleIndexes(length: number, requested: number, mismatchIndexes: number[]) {
  const indexes = new Set<number>();
  if (length > 0 && requested > 0) {
    const samples = Math.min(length, requested);
    for (let index = 0; index < samples; index += 1) {
      indexes.add(
        samples === 1 ? 0 : Math.round((index * (length - 1)) / (samples - 1)),
      );
    }
  }
  for (const index of mismatchIndexes.slice(0, 10)) {
    if (index >= 0 && index < length) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function parseDetailEvidence(html: string) {
  const heading = html.match(
    /<h1[^>]*class=["'][^"']*Heading1[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
  );
  const logo = html.match(
    /<img[^>]*class=["'][^"']*img-regulation[^"']*["'][^>]*>/i,
  )?.[0];
  const setCode = logo?.match(/alt=["']([^"']+)["']/i)?.[1] || null;
  const logoIndex = logo ? html.indexOf(logo) : -1;
  const afterLogo = logoIndex >= 0 ? html.slice(logoIndex + logo.length, logoIndex + logo.length + 350) : "";
  const numberMatch = afterLogo.match(
    /(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*\/(?:&nbsp;|\s)*([^<>&\s]+)(?:&nbsp;|\s)*/i,
  );
  return {
    name: heading ? clean(heading[1]) : null,
    setCode: setCode ? clean(setCode) : null,
    numerator: numberMatch ? clean(numberMatch[1]) : null,
    denominator: numberMatch ? clean(numberMatch[2]) : null,
  };
}

async function fetchOfficialCards(option: OfficialProductOption, delayMs: number) {
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
    const loaded = await fetchWithRetry(url.href, delayMs, "application/json,*/*;q=0.8");
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

  const uniqueCards = new Map<string, OfficialCardSummary>();
  for (const card of cards) {
    const id = clean(card.cardID);
    if (id) uniqueCards.set(id, card);
  }
  return { cards: [...uniqueCards.values()], hitCnt, maxPage, regulation };
}

async function fetchDetailEvidence(params: {
  card: OfficialCardSummary;
  regulation: string;
  expectedName: string | null;
  expectedLocalId: string | null;
  expectedSetId: string;
  delayMs: number;
}): Promise<DetailEvidence> {
  const cardID = clean(params.card.cardID);
  const url = `${OFFICIAL_ORIGIN}/card-search/details.php/card/${encodeURIComponent(cardID)}/regu/${encodeURIComponent(params.regulation || "all")}`;
  try {
    const loaded = await fetchWithRetry(url, params.delayMs, "text/html,application/xhtml+xml");
    const parsed = parseDetailEvidence(loaded.body);
    return {
      cardID,
      url,
      status: loaded.response.status,
      ...parsed,
      expectedName: params.expectedName,
      expectedLocalId: params.expectedLocalId,
      nameMatches:
        parsed.name && params.expectedName
          ? compact(parsed.name) === compact(params.expectedName)
          : null,
      numberMatches:
        parsed.numerator && params.expectedLocalId
          ? normalizedCardNumber(parsed.numerator) ===
            normalizedCardNumber(params.expectedLocalId)
          : null,
      setCodeMatches: parsed.setCode
        ? parsed.setCode.toLowerCase() === params.expectedSetId.toLowerCase()
        : null,
      error: null,
    };
  } catch (error) {
    return {
      cardID,
      url,
      status: 0,
      name: null,
      setCode: null,
      numerator: null,
      denominator: null,
      expectedName: params.expectedName,
      expectedLocalId: params.expectedLocalId,
      nameMatches: null,
      numberMatches: null,
      setCodeMatches: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function baseRow(
  file: string,
  bundle: TcgdexJapaneseSetBundle,
  status: AuditStatus,
): AuditRow {
  return {
    file,
    setId: clean(bundle.set.id),
    setName: clean(bundle.set.name),
    releaseDate: clean(bundle.set.releaseDate),
    status,
    officialProduct: null,
    officialSearchUrl: null,
    registryCardCount: bundle.cards.length,
    officialHitCount: null,
    officialCollectedCount: null,
    officialMaxPage: null,
    officialSetCodes: [],
    countMatches: null,
    setCodeMatches: null,
    nameMultisetMatches: null,
    orderedNameMismatchCount: null,
    orderedNameMismatches: [],
    missingOfficialNamesInRegistry: [],
    extraRegistryNames: [],
    detailEvidence: [],
    candidateProducts: [],
    reasons: [],
    error: null,
  };
}

async function auditMappedSet(params: {
  file: string;
  bundle: TcgdexJapaneseSetBundle;
  option: OfficialProductOption;
  delayMs: number;
  detailSamples: number;
}) {
  const row = baseRow(params.file, params.bundle, "manual_review");
  row.officialProduct = params.option;
  row.officialSearchUrl = `${OFFICIAL_ORIGIN}/card-search/index.php?mode=statuslist&pg=${encodeURIComponent(params.option.value)}`;

  try {
    const official = await fetchOfficialCards(params.option, params.delayMs);
    row.officialHitCount = official.hitCnt;
    row.officialCollectedCount = official.cards.length;
    row.officialMaxPage = official.maxPage;
    row.countMatches =
      params.bundle.cards.length === official.cards.length &&
      (official.hitCnt === null || official.hitCnt === official.cards.length);

    row.officialSetCodes = [
      ...new Set(official.cards.map(officialSetCode).filter((value): value is string => Boolean(value))),
    ].sort();
    row.setCodeMatches =
      row.officialSetCodes.length === 1 &&
      row.officialSetCodes[0].toLowerCase() === params.bundle.set.id.toLowerCase();

    const registryNames = params.bundle.cards.map((card) => clean(card.name));
    const officialNames = official.cards.map(officialCardName);
    const registryCounts = nameCounts(registryNames);
    const officialCounts = nameCounts(officialNames);
    row.missingOfficialNamesInRegistry = subtractNameCounts(
      officialCounts,
      registryCounts,
    );
    row.extraRegistryNames = subtractNameCounts(registryCounts, officialCounts);
    row.nameMultisetMatches =
      row.missingOfficialNamesInRegistry.length === 0 &&
      row.extraRegistryNames.length === 0;

    const orderedMismatchIndexes: number[] = [];
    const comparableLength = Math.min(registryNames.length, officialNames.length);
    for (let index = 0; index < comparableLength; index += 1) {
      if (compact(registryNames[index]) === compact(officialNames[index])) continue;
      orderedMismatchIndexes.push(index);
      if (row.orderedNameMismatches.length < 50) {
        row.orderedNameMismatches.push({
          position: index + 1,
          localId: clean(params.bundle.cards[index]?.localId) || null,
          registryName: registryNames[index] || null,
          officialName: officialNames[index] || null,
          cardID: clean(official.cards[index]?.cardID) || null,
        });
      }
    }
    row.orderedNameMismatchCount =
      orderedMismatchIndexes.length +
      Math.abs(registryNames.length - officialNames.length);

    const details: DetailEvidence[] = [];
    for (const index of sampleIndexes(
      official.cards.length,
      params.detailSamples,
      orderedMismatchIndexes,
    )) {
      const expected = params.bundle.cards[index];
      details.push(
        await fetchDetailEvidence({
          card: official.cards[index],
          regulation: official.regulation,
          expectedName: expected ? clean(expected.name) : null,
          expectedLocalId: expected ? clean(expected.localId) : null,
          expectedSetId: params.bundle.set.id,
          delayMs: params.delayMs,
        }),
      );
    }
    row.detailEvidence = details;

    if (!row.countMatches) row.reasons.push("official_card_count_mismatch");
    if (!row.setCodeMatches) row.reasons.push("official_set_code_mismatch");
    if (!row.nameMultisetMatches) row.reasons.push("official_name_population_mismatch");
    if ((row.orderedNameMismatchCount || 0) > 0) {
      row.reasons.push("official_ordered_name_mismatch");
    }
    if (details.some((detail) => detail.error)) {
      row.reasons.push("official_detail_fetch_incomplete");
    }
    if (details.some((detail) => detail.nameMatches === false)) {
      row.reasons.push("official_detail_name_mismatch");
    }
    if (details.some((detail) => detail.numberMatches === false)) {
      row.reasons.push("official_printed_number_mismatch");
    }
    if (details.some((detail) => detail.setCodeMatches === false)) {
      row.reasons.push("official_detail_set_code_mismatch");
    }

    const hardMismatch =
      !row.countMatches ||
      !row.setCodeMatches ||
      !row.nameMultisetMatches ||
      details.some(
        (detail) =>
          detail.nameMatches === false ||
          detail.numberMatches === false ||
          detail.setCodeMatches === false,
      );
    const manualReview =
      !hardMismatch &&
      ((row.orderedNameMismatchCount || 0) > 0 ||
        details.some((detail) => Boolean(detail.error)));
    row.status = hardMismatch
      ? "mismatch"
      : manualReview
        ? "manual_review"
        : "verified";
  } catch (error) {
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
    row.reasons.push("official_source_request_failed");
  }
  return row;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const args = parseArguments();
  let bundles = await loadBundles(args.input);
  if (args.setIds.size) {
    bundles = bundles.filter(({ bundle }) =>
      args.setIds.has(clean(bundle.set.id).toLowerCase()),
    );
  }
  if (args.limit !== null) bundles = bundles.slice(0, args.limit);
  if (!bundles.length) throw new Error(`No Japanese bundle files selected in ${args.input}.`);

  const officialSearch = await fetchWithRetry(
    OFFICIAL_SEARCH_URL,
    args.delayMs,
    "text/html,application/xhtml+xml",
  );
  const options = parseOfficialProductOptions(officialSearch.body);
  if (!options.length) {
    throw new Error("Official Pokémon Card search exposed no product options.");
  }

  const mappings = bundles.map(({ file, bundle }) => ({
    file,
    bundle,
    candidates: mapOfficialProducts(bundle, options),
  }));
  const optionUse = new Map<string, number>();
  for (const mapping of mappings) {
    if (mapping.candidates.length !== 1) continue;
    const key = mapping.candidates[0].value;
    optionUse.set(key, (optionUse.get(key) || 0) + 1);
  }

  const rows: AuditRow[] = [];
  for (const mapping of mappings) {
    if (mapping.candidates.length === 0) {
      const row = baseRow(mapping.file, mapping.bundle, "official_source_unmapped");
      row.reasons.push("official_product_not_found");
      rows.push(row);
      continue;
    }
    if (mapping.candidates.length > 1) {
      const row = baseRow(mapping.file, mapping.bundle, "official_source_ambiguous");
      row.candidateProducts = mapping.candidates;
      row.reasons.push("multiple_official_product_candidates");
      rows.push(row);
      continue;
    }
    const option = mapping.candidates[0];
    if ((optionUse.get(option.value) || 0) > 1) {
      const row = baseRow(mapping.file, mapping.bundle, "official_source_reused");
      row.officialProduct = option;
      row.candidateProducts = [option];
      row.reasons.push("official_product_mapped_to_multiple_registry_sets");
      rows.push(row);
      continue;
    }
    if (args.mappingOnly) {
      const row = baseRow(mapping.file, mapping.bundle, "manual_review");
      row.officialProduct = option;
      row.officialSearchUrl = `${OFFICIAL_ORIGIN}/card-search/index.php?mode=statuslist&pg=${encodeURIComponent(option.value)}`;
      row.reasons.push("mapping_only_not_card_verified");
      rows.push(row);
      continue;
    }
    rows.push(
      await auditMappedSet({
        file: mapping.file,
        bundle: mapping.bundle,
        option,
        delayMs: args.delayMs,
        detailSamples: args.detailSamples,
      }),
    );
  }

  const statusCounts = rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  const discrepancyRows = rows.filter((row) => row.status !== "verified");
  const receipt = {
    schema: "tcos.checklist.pokemonJapaneseOfficialVerification.v1",
    generatedAt: new Date().toISOString(),
    mode: args.mappingOnly ? "mapping_only" : "official_verification",
    officialSource: {
      searchUrl: OFFICIAL_SEARCH_URL,
      resultApi: OFFICIAL_RESULT_API,
      productOptions: options.length,
      imagesDownloaded: false,
    },
    input: args.input,
    attemptedSets: rows.length,
    statusCounts,
    totals: {
      registryCards: rows.reduce((sum, row) => sum + row.registryCardCount, 0),
      officialCardsCollected: rows.reduce(
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
      detailSamples: rows.reduce(
        (sum, row) => sum + row.detailEvidence.length,
        0,
      ),
      printedNumberMismatches: rows.reduce(
        (sum, row) =>
          sum + row.detailEvidence.filter((detail) => detail.numberMatches === false).length,
        0,
      ),
    },
    rows,
  };
  const queue = {
    schema: "tcos.checklist.pokemonJapaneseOfficialDiscrepancyQueue.v1",
    generatedAt: receipt.generatedAt,
    officialSource: receipt.officialSource,
    rows: discrepancyRows,
  };

  await mkdir(dirname(args.receipt), { recursive: true });
  await mkdir(dirname(args.queue), { recursive: true });
  await writeFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(args.queue, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        schema: receipt.schema,
        mode: receipt.mode,
        attemptedSets: receipt.attemptedSets,
        officialProductOptions: options.length,
        statusCounts,
        totals: receipt.totals,
        receipt: args.receipt,
        discrepancyQueue: args.queue,
      },
      null,
      2,
    ),
  );

  if ((statusCounts.failed || 0) > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

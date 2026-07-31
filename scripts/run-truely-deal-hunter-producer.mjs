import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.resolve(
  process.env.TRUELY_DEAL_HUNTER_OUTPUT_DIR ||
    ".codex-run/truely-deal-hunter-producer",
);

const PRIMARY_HOST = "https://truelycollectables.com";
const FAILOVER_HOST = "https://truely-collectables.vercel.app";
const SCHEMA = "TCOS_NATIVE_EBAY_FEED_V1";
const ARTIFACT_SCHEMA = "TRUELY_COLLECTABLES_DEAL_HUNTER_ARTIFACT_V1";

const feeds = [
  {
    key: "wnba",
    path: "/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=wnba",
    expectedFamilyCount: 15,
    requiredFlag: ["requiredWnbaFamiliesExecuted", true],
  },
  {
    key: "ivan_demidov",
    path: "/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=ivan_demidov",
    expectedFamilyCount: 3,
  },
  {
    key: "matvei_michkov_young_guns",
    path:
      "/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=matvei_michkov_young_guns",
    expectedFamilyCount: 8,
    requiredFlag: ["requiredMichkovFamiliesExecuted", true],
  },
  {
    key: "matvei_michkov_opc_platinum",
    path: "/api/tcos/deal-hunter-michkov-opc-platinum?perQuery=20",
    expectedFamilyCount: 10,
    requiredFlag: ["requiredMichkovOpcPlatinumFamiliesExecuted", true],
    requiredCountField: ["requiredMichkovOpcPlatinumFamilyCount", 10],
  },
  {
    key: "baseball_prospects",
    path:
      "/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=baseball_prospects",
    expectedFamilyCount: 10,
  },
  {
    key: "signed_baseballs",
    path:
      "/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=signed_baseballs",
    expectedFamilyCount: 5,
  },
];

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  return error;
}

async function fetchJson(url, timeoutMs = 150_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "TruelyCollectables-DealHunterProducer/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw fail("Gateway returned non-JSON content", {
        url,
        status: response.status,
        preview: text.slice(0, 500),
      });
    }
    if (!response.ok) {
      throw fail("Gateway returned a non-success status", {
        url,
        status: response.status,
        payload,
      });
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function validateFeed(payload, spec) {
  const errors = [];
  const familyCount = Number(payload?.queryFamilyCount ?? -1);
  const successfulCount = Number(payload?.successfulQueryCount ?? -1);
  const failedCount = Number(payload?.failedQueryCount ?? -1);
  const sourceCoverage = Array.isArray(payload?.sourceCoverage)
    ? payload.sourceCoverage
    : [];
  const results = Array.isArray(payload?.results) ? payload.results : [];

  if (payload?.schema !== SCHEMA) errors.push(`schema=${payload?.schema}`);
  if (payload?.ok !== true) errors.push(`ok=${payload?.ok}`);
  if (payload?.nativeEbayUsed !== true) {
    errors.push(`nativeEbayUsed=${payload?.nativeEbayUsed}`);
  }
  if (payload?.tokenMode !== "client_credentials") {
    errors.push(`tokenMode=${payload?.tokenMode}`);
  }
  if (familyCount !== spec.expectedFamilyCount) {
    errors.push(
      `queryFamilyCount=${familyCount}; expected=${spec.expectedFamilyCount}`,
    );
  }
  if (successfulCount !== familyCount) {
    errors.push(
      `successfulQueryCount=${successfulCount}; queryFamilyCount=${familyCount}`,
    );
  }
  if (failedCount !== 0) errors.push(`failedQueryCount=${failedCount}`);
  if (sourceCoverage.length !== familyCount) {
    errors.push(
      `sourceCoverage.length=${sourceCoverage.length}; queryFamilyCount=${familyCount}`,
    );
  }

  const incompleteCoverage = sourceCoverage
    .filter((row) => row?.status !== "COMPLETE")
    .map((row) => ({ familyId: row?.familyId, status: row?.status }));
  if (incompleteCoverage.length > 0) {
    errors.push(`incompleteSourceCoverage=${JSON.stringify(incompleteCoverage)}`);
  }

  if (spec.requiredFlag) {
    const [field, expected] = spec.requiredFlag;
    if (payload?.[field] !== expected) {
      errors.push(`${field}=${payload?.[field]}; expected=${expected}`);
    }
  }
  if (spec.requiredCountField) {
    const [field, expected] = spec.requiredCountField;
    if (Number(payload?.[field]) !== expected) {
      errors.push(`${field}=${payload?.[field]}; expected=${expected}`);
    }
  }

  const invalidListingUrls = results
    .filter(
      (row) =>
        typeof row?.listingUrl !== "string" ||
        !/^https:\/\/(?:www\.)?ebay\.com\/itm\//i.test(row.listingUrl),
    )
    .map((row) => row?.listingUrl ?? null);
  if (invalidListingUrls.length > 0) {
    errors.push(`invalidDirectListingUrls=${JSON.stringify(invalidListingUrls)}`);
  }

  if (errors.length > 0) {
    throw fail(`Native contract failed for ${spec.key}`, {
      key: spec.key,
      errors,
    });
  }

  return {
    familyCount,
    successfulCount,
    failedCount,
    rawResultCount: Number(payload?.rawResultCount || 0),
    deduplicatedResultCount: Number(payload?.deduplicatedResultCount || 0),
    resultCount: results.length,
    coverageCount: sourceCoverage.length,
    deployment: payload?.deployment || null,
  };
}

async function retrieveFeed(spec) {
  const attempts = [];
  for (const host of [PRIMARY_HOST, FAILOVER_HOST]) {
    const url = `${host}${spec.path}`;
    const startedAt = Date.now();
    try {
      const payload = await fetchJson(url);
      const validation = validateFeed(payload, spec);
      return {
        key: spec.key,
        ok: true,
        host,
        url,
        durationMs: Date.now() - startedAt,
        validation,
        payload,
        attempts,
      };
    } catch (error) {
      attempts.push({
        host,
        url,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        details: error?.details || null,
      });
    }
  }
  return {
    key: spec.key,
    ok: false,
    host: null,
    url: null,
    attempts,
  };
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const generatedAt = new Date().toISOString();
const feedResults = await Promise.all(feeds.map(retrieveFeed));
const successfulFeeds = feedResults.filter((feed) => feed.ok);
const failedFeeds = feedResults.filter((feed) => !feed.ok);

const aggregateListings = new Map();
for (const feed of successfulFeeds) {
  for (const listing of feed.payload.results || []) {
    const key = listing.listingItemId || listing.listingUrl;
    if (!key) continue;
    const existing = aggregateListings.get(key);
    aggregateListings.set(
      key,
      existing
        ? {
            ...existing,
            queryFamilyIds: Array.from(
              new Set([
                ...(existing.queryFamilyIds || []),
                ...(listing.queryFamilyIds || []),
              ]),
            ),
            sourceFeedKeys: Array.from(
              new Set([...(existing.sourceFeedKeys || []), feed.key]),
            ),
          }
        : { ...listing, sourceFeedKeys: [feed.key] },
    );
  }
}

const summary = {
  ok: failedFeeds.length === 0 && successfulFeeds.length === feeds.length,
  generatedAt,
  artifactSchema: ARTIFACT_SCHEMA,
  nativeSchema: SCHEMA,
  repository: process.env.GITHUB_REPOSITORY || null,
  commitSha: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  expectedFeedCount: feeds.length,
  successfulFeedCount: successfulFeeds.length,
  failedFeedCount: failedFeeds.length,
  expectedQueryFamilyCount: feeds.reduce(
    (sum, feed) => sum + feed.expectedFamilyCount,
    0,
  ),
  successfulQueryFamilyCount: successfulFeeds.reduce(
    (sum, feed) => sum + feed.validation.successfulCount,
    0,
  ),
  rawResultCount: successfulFeeds.reduce(
    (sum, feed) => sum + feed.validation.rawResultCount,
    0,
  ),
  feedDeduplicatedResultCount: successfulFeeds.reduce(
    (sum, feed) => sum + feed.validation.deduplicatedResultCount,
    0,
  ),
  globallyDeduplicatedListingCount: aggregateListings.size,
  feeds: feedResults.map((feed) => ({
    key: feed.key,
    ok: feed.ok,
    host: feed.host,
    url: feed.url,
    validation: feed.validation || null,
    attempts: feed.attempts,
  })),
};

const artifact = {
  schema: ARTIFACT_SCHEMA,
  generatedAt,
  summary,
  feeds: feedResults,
  aggregateListings: [...aggregateListings.values()],
  boundaries: {
    discoveryOnly: true,
    purchaseCapability: false,
    ledgerMutationCapability: false,
    betaOneCursorMutationCapability: false,
  },
};

await fs.writeFile(
  path.join(OUTPUT_DIR, "producer-artifact.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(OUTPUT_DIR, "producer-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
await fs.writeFile(
  path.join(OUTPUT_DIR, "producer-summary.md"),
  [
    "# Truely Collectables Deal Hunter Producer",
    "",
    `- Status: **${summary.ok ? "COMPLETE" : "FAILED"}**`,
    `- Generated: ${generatedAt}`,
    `- Native query-family coverage: ${summary.successfulQueryFamilyCount}/${summary.expectedQueryFamilyCount}`,
    `- Successful feeds: ${summary.successfulFeedCount}/${summary.expectedFeedCount}`,
    `- Raw observations: ${summary.rawResultCount}`,
    `- Globally deduplicated listings: ${summary.globallyDeduplicatedListingCount}`,
    "",
    ...summary.feeds.map(
      (feed) =>
        `- ${feed.key}: ${feed.ok ? "COMPLETE" : "FAILED"}${
          feed.host ? ` via ${feed.host}` : ""
        }`,
    ),
    "",
  ].join("\n"),
  "utf8",
);

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exitCode = 1;

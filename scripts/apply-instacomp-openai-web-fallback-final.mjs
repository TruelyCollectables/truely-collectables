import fs from "node:fs";

const routePath = "src/app/api/account/seller/inventory/instacomp/route.ts";
const regressionPath = "scripts/run-instacomp-exact-market-proof-regressions.ts";
const liveProofPath = "scripts/run-instacomp-batch-001-live-market-proof.ts";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Could not locate ${label}`);
  return source.replace(before, after);
}

let route = fs.readFileSync(routePath, "utf8");
route = replaceOnce(
  route,
  'import { getExactEbayMarketProviders } from "../../../../../../lib/instacomp-exact-market-provider";\n',
  'import { getExactEbayMarketProviders } from "../../../../../../lib/instacomp-exact-market-provider";\nimport { getOpenAiExactEbayMarketProviders } from "../../../../../../lib/instacomp-openai-web-market-provider";\n',
  "OpenAI exact-market import",
);
route = replaceOnce(
  route,
  `type Evidence = {
  title: string;
  price: number;
  currency: string;`,
  `type Evidence = {
  title: string;
  price: number;
  itemPrice: number | null;
  shippingPrice: number | null;
  priceIncludesShipping: boolean;
  currency: string;`,
  "delivered-price evidence fields",
);
route = replaceOnce(
  route,
  `    title: typeof row.title === "string" ? row.title : "Untitled listing",
    price: Math.round(price * 100) / 100,
    currency: typeof row.currency === "string" ? row.currency : "USD",`,
  `    title: typeof row.title === "string" ? row.title : "Untitled listing",
    price: Math.round(price * 100) / 100,
    itemPrice:
      Number.isFinite(Number(row.itemPrice)) && Number(row.itemPrice) > 0
        ? Math.round(Number(row.itemPrice) * 100) / 100
        : null,
    shippingPrice:
      Number.isFinite(Number(row.shippingPrice)) && Number(row.shippingPrice) >= 0
        ? Math.round(Number(row.shippingPrice) * 100) / 100
        : null,
    priceIncludesShipping: row.priceIncludesShipping === true,
    currency: typeof row.currency === "string" ? row.currency : "USD",`,
  "delivered-price normalization",
);
route = replaceOnce(
  route,
  `    const fallbackQuery = buildInstaCompQueries(ai).primary;
    const market = await getExactEbayMarketProviders({
      exactTitle: item.title,
      fallbackQuery,
      ai,
    });
    const soldCandidates = forceImageVerification(evidenceList(market.sold.results, 50));
    const activeCandidates = forceImageVerification(evidenceList(market.active.results, 30));`,
  `    const fallbackQuery = buildInstaCompQueries(ai).primary;
    const serpMarket = await getExactEbayMarketProviders({
      exactTitle: item.title,
      fallbackQuery,
      ai,
    });
    const shouldSearchOpenAiWeb =
      serpMarket.sold.results.length === 0 || serpMarket.active.results.length === 0;
    const openAiMarket = shouldSearchOpenAiWeb
      ? await getOpenAiExactEbayMarketProviders({
          exactTitle: item.title,
          ai,
        })
      : null;
    const mergedSoldCandidates = dedupeEvidence(
      [
        ...evidenceList(serpMarket.sold.results, 50),
        ...evidenceList(openAiMarket?.sold.results, 20),
      ],
      50,
    );
    const mergedActiveCandidates = dedupeEvidence(
      [
        ...evidenceList(serpMarket.active.results, 30),
        ...evidenceList(openAiMarket?.active.results, 20),
      ],
      30,
    );
    const soldCandidates = forceImageVerification(mergedSoldCandidates);
    const activeCandidates = forceImageVerification(mergedActiveCandidates);`,
  "provider orchestration",
);
route = replaceOnce(
  route,
  `    const providerCoverage = [providerCoverageRow(market.sold), providerCoverageRow(market.active)];
    const sourceLinks = {
      ...recordValue(currentInstaComp.sourceLinks),
      ebaySoldUrl: market.sold.searchUrl || null,
      ebayActiveUrl: market.active.searchUrl || null,
    };`,
  `    const providerCoverage = [
      providerCoverageRow(serpMarket.sold),
      providerCoverageRow(serpMarket.active),
      ...(openAiMarket
        ? [providerCoverageRow(openAiMarket.sold), providerCoverageRow(openAiMarket.active)]
        : []),
    ];
    const sourceLinks = {
      ...recordValue(currentInstaComp.sourceLinks),
      ebaySoldUrl: serpMarket.sold.searchUrl || null,
      ebayActiveUrl: serpMarket.active.searchUrl || null,
    };`,
  "provider coverage",
);
route = replaceOnce(
  route,
  `        exactStoredTitleQuery: market.query,
        exactMarketQueries: market.queries,`,
  `        exactStoredTitleQuery: serpMarket.query,
        exactMarketQueries: serpMarket.queries,
        openAiWebMarket: openAiMarket
          ? {
              model: openAiMarket.model,
              responseId: openAiMarket.responseId,
              citedItemIds: openAiMarket.citedItemIds,
              notes: openAiMarket.notes,
              cached: openAiMarket.cached,
            }
          : null,`,
  "stored OpenAI provider metadata",
);
route = replaceOnce(
  route,
  `      exactMarketQueries: market.queries,
      exactMarketVisualReview: {`,
  `      exactMarketQueries: serpMarket.queries,
      openAiWebMarket: openAiMarket
        ? {
            model: openAiMarket.model,
            responseId: openAiMarket.responseId,
            citedItemIds: openAiMarket.citedItemIds,
            notes: openAiMarket.notes,
            cached: openAiMarket.cached,
          }
        : null,
      exactMarketVisualReview: {`,
  "response OpenAI provider metadata",
);
if (/\bmarket\.(?:sold|active|query|queries)\b/.test(route)) {
  throw new Error("Stale market variable remains after provider orchestration patch");
}
fs.writeFileSync(routePath, route);

let regression = fs.readFileSync(regressionPath, "utf8");
regression = replaceOnce(
  regression,
  `assert.ok(proofSource.includes("filterStrictExactMarketMatches"));

const sellerRoute = fs.readFileSync(`,
  `assert.ok(proofSource.includes("filterStrictExactMarketMatches"));

const openAiWebSource = fs.readFileSync(
  "src/lib/instacomp-openai-web-market-provider.ts",
  "utf8",
);
assert.ok(openAiWebSource.includes('type: "web_search"'));
assert.ok(openAiWebSource.includes('allowed_domains: ["ebay.com"]'));
assert.ok(openAiWebSource.includes("sourceItemIds"));
assert.ok(openAiWebSource.includes("citedIds.has(itemId)"));
assert.ok(openAiWebSource.includes('params.lane === "sold" && !soldAt'));
assert.ok(openAiWebSource.includes("shippingPrice === null"));
assert.ok(openAiWebSource.includes("!title || !imageUrl"));
assert.ok(openAiWebSource.includes("filterStrictExactMarketMatches"));

const sellerRoute = fs.readFileSync(`,
  "OpenAI provider regressions",
);
regression = replaceOnce(
  regression,
  `assert.ok(sellerRoute.includes("getExactEbayMarketProviders"));
assert.match(`,
  `assert.ok(sellerRoute.includes("getExactEbayMarketProviders"));
assert.ok(sellerRoute.includes("getOpenAiExactEbayMarketProviders"));
assert.ok(sellerRoute.includes("shouldSearchOpenAiWeb"));
assert.ok(sellerRoute.includes("mergedSoldCandidates"));
assert.ok(sellerRoute.includes("mergedActiveCandidates"));
assert.match(`,
  "route fallback assertions",
);
fs.writeFileSync(regressionPath, regression);

fs.writeFileSync(
  liveProofPath,
  `import assert from "node:assert/strict";
import fs from "node:fs";
import type { InstaCompAiResult, InstaCompComp } from "../src/lib/instacomp";
import { getExactEbayMarketProviders } from "../src/lib/instacomp-exact-market-provider";
import { getOpenAiExactEbayMarketProviders } from "../src/lib/instacomp-openai-web-market-provider";
import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";

type FixtureCard = {
  id: string;
  exactTitle: string;
  ai: InstaCompAiResult;
};

function dedupe(values: InstaCompComp[], limit: number) {
  return Array.from(new Map(values.map((row) => [row.url, row])).values()).slice(0, limit);
}

async function main() {
  assert.ok(
    process.env.SERPAPI_API_KEY || process.env.OPENAI_API_KEY,
    "SERPAPI_API_KEY or OPENAI_API_KEY is required for the live six-card exact-market proof",
  );
  const fixture = JSON.parse(
    fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
  ) as { cards: FixtureCard[] };

  const startedAt = new Date().toISOString();
  const cards: Array<Record<string, unknown>> = [];
  for (const card of fixture.cards) {
    const serp = await getExactEbayMarketProviders({
      exactTitle: card.exactTitle,
      fallbackQuery: card.exactTitle,
      ai: card.ai,
    });
    const openAi =
      serp.sold.results.length === 0 || serp.active.results.length === 0
        ? await getOpenAiExactEbayMarketProviders({
            exactTitle: card.exactTitle,
            ai: card.ai,
            bypassCache: true,
          })
        : null;
    const sold = dedupe(
      [...serp.sold.results, ...(openAi?.sold.results || [])],
      20,
    );
    const active = dedupe(
      [...serp.active.results, ...(openAi?.active.results || [])],
      20,
    );
    const pricing = calculateInstaCompSweetSpot({ sold, active });
    const suggestedPrice = sold.length > 0 ? pricing.suggestedPrice : 0;

    cards.push({
      id: card.id,
      identity: card.exactTitle,
      queries: serp.queries,
      soldProviderStatus: sold.length ? "live" : openAi?.sold.status || serp.sold.status,
      activeProviderStatus: active.length ? "live" : openAi?.active.status || serp.active.status,
      soldMessages: [serp.sold.message, openAi?.sold.message].filter(Boolean),
      activeMessages: [serp.active.message, openAi?.active.message].filter(Boolean),
      soldCount: sold.length,
      activeCount: active.length,
      suggestedPrice,
      pricing: { ...pricing, suggestedPrice },
      sold: sold.map((comp) => ({
        title: comp.title,
        deliveredPrice: comp.price,
        soldAt: comp.soldAt || null,
        url: comp.url,
        imageUrl: comp.imageUrl,
        matchScore: comp.matchScore,
        flags: comp.flags,
      })),
      active: active.map((comp) => ({
        title: comp.title,
        deliveredPrice: comp.price,
        listedAt: comp.listedAt || null,
        url: comp.url,
        imageUrl: comp.imageUrl,
        matchScore: comp.matchScore,
        flags: comp.flags,
      })),
      providerAttempts: {
        sold: serp.sold.attempts,
        active: serp.active.attempts,
      },
      openAiWeb: openAi
        ? {
            model: openAi.model,
            responseId: openAi.responseId,
            citedItemIds: openAi.citedItemIds,
            notes: openAi.notes,
            cached: openAi.cached,
          }
        : null,
    });
  }

  const failures = cards.filter(
    (card) =>
      card.soldProviderStatus !== "live" ||
      card.activeProviderStatus !== "live" ||
      Number(card.soldCount || 0) < 1 ||
      Number(card.activeCount || 0) < 1 ||
      Number(card.suggestedPrice || 0) <= 0,
  );
  const proof = {
    schema: "tcos.instacompBatch001LiveMarketProof.v2",
    startedAt,
    completedAt: new Date().toISOString(),
    success: failures.length === 0,
    cardCount: cards.length,
    failures: failures.map((card) => card.id),
    cards,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-batch-001-live-market-proof.json",
    \`${JSON.stringify(proof, null, 2)}\\n\`,
  );

  assert.equal(
    failures.length,
    0,
    \`Live exact-market proof is blocked for: \${failures.map((card) => card.id).join(", ")}\`,
  );
  console.log(
    \`InstaComp Batch 001 live proof passed: \${cards.length}/6 cards each returned strict exact sold evidence, strict exact active competition, and a sold-backed suggested price.\`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
);

console.log("Applied clean cited OpenAI web exact-market fallback and live proof v2.");

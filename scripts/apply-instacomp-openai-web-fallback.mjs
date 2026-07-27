import fs from "node:fs";

const routePath = "src/app/api/account/seller/inventory/instacomp/route.ts";
const regressionPath = "scripts/run-instacomp-exact-market-proof-regressions.ts";

let route = fs.readFileSync(routePath, "utf8");

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Could not locate ${label}`);
  }
  return source.replace(before, after);
}

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

console.log("Applied cited OpenAI web exact sold/active fallback to the real seller InstaComp route.");

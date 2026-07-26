import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Could not find ${label}.`);
  }
  return content.replace(search, replacement);
}

const providerPath = "src/lib/instacomp-ebay-serp-provider.ts";
let provider = read(providerPath);
provider = replaceOnce(
  provider,
  "function normalizeItems(value: unknown): EbaySerpItem[] {",
  "export function normalizeEbaySerpItems(value: unknown): EbaySerpItem[] {",
  "export eBay result normalizer",
);
provider = replaceOnce(
  provider,
  "    const items = normalizeItems(payload);",
  "    const items = normalizeEbaySerpItems(payload);",
  "use exported eBay result normalizer",
);
provider = replaceOnce(
  provider,
  "  const url = new URL(\"https://serpapi.com/search.json\");\n  url.searchParams.set(\"engine\", \"ebay\");\n  url.searchParams.set(\"api_key\", SERPAPI_API_KEY);\n  url.searchParams.set(\"ebay_domain\", \"ebay.com\");\n  url.searchParams.set(\"_nkw\", query);\n  url.searchParams.set(\"_ipg\", String(RESULT_LIMIT));\n  url.searchParams.set(\"_blrs\", \"spell_auto_correct\");\n  if (lane === \"sold\") url.searchParams.set(\"show_only\", \"Sold\");\n  else url.searchParams.set(\"_sop\", \"10\");",
  "  const url = buildSerpApiEbayRequestUrl(query, lane, SERPAPI_API_KEY);",
  "central SerpApi eBay request URL",
);
provider = replaceOnce(
  provider,
  "async function fetchLane(query: string, lane: EbayLane) {",
  `export function buildSerpApiEbayRequestUrl(
  query: string,
  lane: EbayLane,
  apiKey = "test-key",
) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "ebay");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("ebay_domain", "ebay.com");
  url.searchParams.set("_nkw", query);
  url.searchParams.set("_ipg", String(RESULT_LIMIT));
  url.searchParams.set("_blrs", "spell_auto_correct");
  if (lane === "sold") url.searchParams.set("show_only", "Sold");
  else url.searchParams.set("_sop", "10");
  return url;
}

async function fetchLane(query: string, lane: EbayLane) {`,
  "SerpApi eBay request URL builder",
);
write(providerPath, provider);

const instacompPath = "src/lib/instacomp.ts";
let instacomp = read(instacompPath);
instacomp = replaceOnce(
  instacomp,
  `  if (
    ai.isAuto &&
    containsAny(\` \${t} \`, [" auto ", " autograph ", " autographed ", " signed "])
  ) {
    score += 12;
    flags.push("autograph");
  }

  if (
    ai.isRelic &&
    containsAny(\` \${t} \`, [" relic ", " patch ", " jersey ", " memorabilia "])
  ) {
    score += 12;
    flags.push("relic");
  }`,
  `  const matchedSetEvidence =
    flags.includes("set") || flags.includes("set partial");
  const normalizedTargetSet = \` \${normalizeText(ai.setName)} \`;
  const setImpliesAutograph = containsAny(normalizedTargetSet, [
    " autograph ",
    " autographs ",
    " signature ",
    " signatures ",
    " signed ",
    " rookie patch autographs ",
  ]);
  const setImpliesRelic = containsAny(normalizedTargetSet, [
    " swatch ",
    " swatches ",
    " materials ",
    " memorabilia ",
    " relic ",
    " relics ",
    " jersey ",
    " jerseys ",
    " patch ",
    " patches ",
  ]);

  if (
    ai.isAuto &&
    (containsAny(\` \${t} \`, [" auto ", " autograph ", " autographed ", " signed "]) ||
      (setImpliesAutograph && matchedSetEvidence))
  ) {
    score += 12;
    flags.push("autograph");
  }

  if (
    ai.isRelic &&
    (containsAny(\` \${t} \`, [" relic ", " patch ", " jersey ", " memorabilia ", " mem "]) ||
      (setImpliesRelic && matchedSetEvidence))
  ) {
    score += 12;
    flags.push("relic");
  }`,
  "set-implied autograph and relic evidence",
);
write(instacompPath, instacomp);

const scanPath = "src/app/api/instacomp/scan/route.ts";
let scan = read(scanPath);
scan = replaceOnce(
  scan,
  'import { detectGradingDetails } from "../../../../lib/grading-cert";\n',
  'import { detectGradingDetails } from "../../../../lib/grading-cert";\nimport { getUniversalEbaySerpProviders } from "../../../../lib/instacomp-ebay-serp-provider";\n',
  "universal eBay provider import",
);
scan = replaceOnce(
  scan,
  `    aiCouncilTier:
      typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : null,
    operatorSerialNumberOverride:`,
  `    aiCouncilTier:
      typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : null,
    listingTitle:
      typeof body?.listingTitle === "string"
        ? body.listingTitle.trim().slice(0, 300)
        : null,
    operatorSerialNumberOverride:`,
  "queued listing title",
);
scan = replaceOnce(
  scan,
  `  let persistentContext: PersistentJobScanContext | null = null;
  let requestedAiCouncilTier: string | null = null;
  let operatorSerialNumberOverride: string | null | undefined = undefined;`,
  `  let persistentContext: PersistentJobScanContext | null = null;
  let requestedAiCouncilTier: string | null = null;
  let requestedListingTitle: string | null = null;
  let operatorSerialNumberOverride: string | null | undefined = undefined;`,
  "requested listing title state",
);
scan = replaceOnce(
  scan,
  `      requestedAiCouncilTier = queuedScan.aiCouncilTier;
      operatorSerialNumberOverride = queuedScan.operatorSerialNumberOverride;`,
  `      requestedAiCouncilTier = queuedScan.aiCouncilTier;
      requestedListingTitle = queuedScan.listingTitle;
      operatorSerialNumberOverride = queuedScan.operatorSerialNumberOverride;`,
  "queued listing title assignment",
);
scan = replaceOnce(
  scan,
  `      const submittedAiCouncilTier = formData.get("aiCouncilTier");
      const submittedOperatorSerialNumberOverride = formData.get(`,
  `      const submittedAiCouncilTier = formData.get("aiCouncilTier");
      const submittedListingTitle = formData.get("listingTitle");
      const submittedOperatorSerialNumberOverride = formData.get(`,
  "form listing title read",
);
scan = replaceOnce(
  scan,
  `      requestedAiCouncilTier =
        typeof submittedAiCouncilTier === "string" ? submittedAiCouncilTier : null;
      operatorSerialNumberOverride = normalizeOperatorSerialNumberOverride(`,
  `      requestedAiCouncilTier =
        typeof submittedAiCouncilTier === "string" ? submittedAiCouncilTier : null;
      requestedListingTitle =
        typeof submittedListingTitle === "string" && submittedListingTitle.trim()
          ? submittedListingTitle.trim().slice(0, 300)
          : null;
      operatorSerialNumberOverride = normalizeOperatorSerialNumberOverride(`,
  "form listing title assignment",
);
scan = replaceOnce(
  scan,
  `    const queries = buildInstaCompQueries(ai);
    const links = buildCompLinks(queries.primary);
    const compQueries = [queries.primary, ...queries.backupQueries];

    const [
      ebayProvider,
      tcosProvider,
      priceChartingProvider,
      externalSearchProvider,
    ] =
      await Promise.all([
        getBestEbayProvider(compQueries, ai, links.ebayActiveUrl),
        getTcosInventoryProvider(queries.primary, ai),
        getPriceChartingProvider(queries.primary, ai),
        getExternalSearchProvider(queries.primary, ai, links.broadCardMarketUrl),
      ]);

    const providers = [
      ebayProvider,
      tcosProvider,
      priceChartingProvider,
      externalSearchProvider,
    ];`,
  `    const queries = buildInstaCompQueries(ai);
    const baseLinks = buildCompLinks(queries.primary);
    const compQueries = [queries.primary, ...queries.backupQueries];

    const [
      ebayBrowseProvider,
      tcosProvider,
      priceChartingProvider,
      externalSearchProvider,
      universalEbay,
    ] = await Promise.all([
      getBestEbayProvider(compQueries, ai, baseLinks.ebayActiveUrl),
      getTcosInventoryProvider(queries.primary, ai),
      getPriceChartingProvider(queries.primary, ai),
      getExternalSearchProvider(queries.primary, ai, baseLinks.broadCardMarketUrl),
      getUniversalEbaySerpProviders({
        exactTitle: requestedListingTitle,
        fallbackQuery: queries.primary,
        ai,
      }),
    ]);

    const ebayActiveProvider =
      universalEbay.active.status === "live"
        ? universalEbay.active
        : ebayBrowseProvider;
    const providers = [
      universalEbay.sold,
      ebayActiveProvider,
      tcosProvider,
      priceChartingProvider,
      externalSearchProvider,
    ];
    const links = {
      ...baseLinks,
      ebaySoldUrl: universalEbay.sold.searchUrl || baseLinks.ebaySoldUrl,
      ebayActiveUrl: universalEbay.active.searchUrl || baseLinks.ebayActiveUrl,
    };`,
  "universal eBay provider integration",
);
scan = replaceOnce(
  scan,
  `      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      links,`,
  `      searchQuery: queries.primary,
      exactStoredTitleQuery: universalEbay.query,
      backupQueries: queries.backupQueries,
      links,`,
  "exact stored title response evidence",
);
write(scanPath, scan);

const sellerPath = "src/app/api/account/seller/inventory/instacomp/route.ts";
let seller = read(sellerPath);
seller = replaceOnce(
  seller,
  `function isExcludedEvidence(comp: ReturnType<typeof compactComp>) {`,
  `function soldSuggestion(values: Array<NonNullable<ReturnType<typeof compactComp>>>) {
  const prices = values
    .map((value) => value.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);
  if (!prices.length) return 0;
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[middle - 1] + prices[middle]) / 2
      : prices[middle];
  return Math.round(median * 100) / 100;
}

function isExcludedEvidence(comp: ReturnType<typeof compactComp>) {`,
  "sold evidence median helper",
);
seller = replaceOnce(
  seller,
  `    formData.set("frontImage", files[0]);
    if (files[1]) formData.set("backImage", files[1]);`,
  `    formData.set("frontImage", files[0]);
    formData.set("listingTitle", item.title);
    if (files[1]) formData.set("backImage", files[1]);`,
  "exact stored title submission",
);
seller = replaceOnce(
  seller,
  `    const soldCompEvidence = compactCompList(scan?.soldComps, 20).filter(
      (comp) => comp.sourceCategory === "sold" && !isExcludedEvidence(comp),
    );
    const competitionCandidates = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      20,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" ||
          comp.sourceCategory === "auction" ||
          comp.source === "ebay_active") &&
        !isOwnStoreCompetition(comp),
    );
    const visualCompetitionReview = await verifyInstaCompCompetitionImages({
      targetFrontImage: files[0],
      targetAi: scan.ai,
      candidates: competitionCandidates,
    });
    const activeCompetition = visualCompetitionReview.accepted.filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isExcludedEvidence(comp),
    );
    const rejectedCandidates = visualCompetitionReview.rejected;

    const reliableSoldCompCount = soldCompEvidence.length;
    const priceCandidate = roundedPrice(
      scan?.soldStats?.suggestedPrice || scan?.soldStats?.median || 0,
    );
    const trustedForPricing = scan?.review?.trustedForPricing === true;
    const hasReliableSoldComps =
      trustedForPricing && reliableSoldCompCount > 0 && priceCandidate > 0;`,
  `    const soldCandidates = compactCompList(scan?.soldComps, 50).filter(
      (comp) => comp.sourceCategory === "sold",
    );
    const visualSoldReview = await verifyInstaCompCompetitionImages({
      targetFrontImage: files[0],
      targetAi: scan.ai,
      candidates: soldCandidates,
    });
    const soldCompEvidence = visualSoldReview.accepted.filter(
      (comp) => comp.sourceCategory === "sold" && !isExcludedEvidence(comp),
    );
    const competitionCandidates = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      30,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" ||
          comp.sourceCategory === "auction" ||
          comp.source === "ebay_active" ||
          comp.source === "ebay_active_serpapi") &&
        !isOwnStoreCompetition(comp),
    );
    const visualCompetitionReview = await verifyInstaCompCompetitionImages({
      targetFrontImage: files[0],
      targetAi: scan.ai,
      candidates: competitionCandidates,
    });
    const activeCompetition = visualCompetitionReview.accepted.filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isExcludedEvidence(comp),
    );
    const rejectedCandidates = [
      ...visualSoldReview.rejected,
      ...visualCompetitionReview.rejected,
    ];

    const reliableSoldCompCount = soldCompEvidence.length;
    const priceCandidate = soldSuggestion(soldCompEvidence);
    const trustedForIdentity =
      scan?.consensus?.trustedForIdentity === true ||
      scan?.review?.trustedForPricing === true;
    const hasReliableSoldComps =
      trustedForIdentity && reliableSoldCompCount > 0 && priceCandidate > 0;`,
  "sold and active image-first evidence split",
);
seller = replaceOnce(
  seller,
  `        visualCompetitionReview: {
          reviewedCount: visualCompetitionReview.reviewedCount,
          titleOverrides: visualCompetitionReview.titleOverrides,
          configured: visualCompetitionReview.configured,
          model: visualCompetitionReview.model,
        },`,
  `        visualSoldReview: {
          reviewedCount: visualSoldReview.reviewedCount,
          titleOverrides: visualSoldReview.titleOverrides,
          configured: visualSoldReview.configured,
          model: visualSoldReview.model,
        },
        visualCompetitionReview: {
          reviewedCount: visualCompetitionReview.reviewedCount,
          titleOverrides: visualCompetitionReview.titleOverrides,
          configured: visualCompetitionReview.configured,
          model: visualCompetitionReview.model,
        },`,
  "sold visual review metadata",
);
write(sellerPath, seller);

fs.rmSync("scripts/apply-instacomp-universal-ebay-sold.mjs");
console.log("Applied universal eBay sold/active ingestion, exact stored-title search, set-implied relic/auto evidence, and sold-evidence pricing.");

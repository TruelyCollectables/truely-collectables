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

function removeOnce(content, search, label) {
  return replaceOnce(content, search, "", label);
}

const enginePath = "src/lib/instacomp-market-pricing.ts";
let engine = read(enginePath);
engine = replaceOnce(
  engine,
  "  const soldListTarget = soldAnchor + Math.max(0, soldQ3 - soldAnchor) * 0.4;\n  const quickSale = soldQ1 || soldAnchor;\n  const stretch = Math.max(soldQ3 || soldAnchor, soldListTarget);",
  "  const soldListTarget = soldAnchor + Math.max(0, soldQ3 - soldAnchor) * 0.75;\n  const quickSale = Math.max(soldQ1 || soldAnchor, soldAnchor * 0.85);\n  const stretch = Math.max(soldQ3 || soldAnchor, soldAnchor * 1.25);",
  "adult sold-position targets",
);
write(enginePath, engine);

const universalPath =
  "src/app/api/account/seller/inventory/instacomp-universal/route.ts";
let universal = read(universalPath);
universal = replaceOnce(
  universal,
  'import { buildInstaCompQueries } from "../../../../../../lib/instacomp";\n',
  'import { buildInstaCompQueries } from "../../../../../../lib/instacomp";\nimport { calculateInstaCompMarketPricing } from "../../../../../../lib/instacomp-market-pricing";\n',
  "market pricing import",
);
universal = removeOnce(
  universal,
  `function soldSuggestion(values: Evidence[]) {
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

`,
  "sold-only suggestion function",
);
universal = replaceOnce(
  universal,
  `    const suggestedPrice = soldSuggestion(soldCompEvidence);
    const reliableSoldCompCount = soldCompEvidence.length;
    const hasReliableSoldComps = reliableSoldCompCount > 0 && suggestedPrice > 0;
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = hasReliableSoldComps
      ? \`${"${reliableSoldCompCount}"} exact sold comp${"${reliableSoldCompCount === 1 ? \"\" : \"s\"}"} passed the universal eBay identity filter. Active listings were not used to calculate the ${"${suggestedPrice.toFixed(2)}"} suggestion.\`
      : \`The universal eBay sold lane returned no accepted exact sale. Seller pricing is required. Sold provider: ${"${universal.sold.message || universal.sold.status}"}.\`;`,
  `    const pricingModel = calculateInstaCompMarketPricing({
      sold: soldCompEvidence,
      active: activeCompetition,
    });
    const suggestedPrice = pricingModel.suggestedPrice;
    const reliableSoldCompCount = soldCompEvidence.length;
    const hasReliableSoldComps = reliableSoldCompCount > 0 && suggestedPrice > 0;
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = hasReliableSoldComps
      ? \`${"${reliableSoldCompCount}"} exact sold comp${"${reliableSoldCompCount === 1 ? \"\" : \"s\"}"} and ${"${activeCompetition.length}"} exact active listing${"${activeCompetition.length === 1 ? \"\" : \"s\"}"} produced a ${"${pricingModel.strategy.replaceAll(\"_\", \" \")}"} recommendation. Sold market value: $${"${pricingModel.marketValue.toFixed(2)}"}; Suggested Price: $${"${suggestedPrice.toFixed(2)}"}.\`
      : \`The universal eBay sold lane returned no accepted exact sale. ${"${activeCompetition.length}"} exact active listing${"${activeCompetition.length === 1 ? \" was\" : \"s were\"}"} retained for competition review, but seller pricing is required because active asks alone cannot prove value.\`;`,
  "market sweet-spot calculation",
);
universal = replaceOnce(
  universal,
  `        schema: "truely.instacompInventoryScan.v3",
        exactStoredTitleQuery: universal.query,
        fallbackIdentityQuery: universal.fallbackQuery,
        marketPrice: suggestedPrice,
        suggestedPrice,`,
  `        schema: "truely.instacompInventoryScan.v4",
        exactStoredTitleQuery: universal.query,
        fallbackIdentityQuery: universal.fallbackQuery,
        marketPrice: pricingModel.marketValue,
        suggestedPrice,
        quickSalePrice: pricingModel.quickSalePrice,
        stretchPrice: pricingModel.stretchPrice,
        pricingModel,`,
  "market pricing metadata",
);
universal = replaceOnce(
  universal,
  `      suggestedPrice,
      pricingStatus,
      pricingReason,`,
  `      suggestedPrice,
      marketValue: pricingModel.marketValue,
      quickSalePrice: pricingModel.quickSalePrice,
      stretchPrice: pricingModel.stretchPrice,
      pricingModel,
      pricingStatus,
      pricingReason,`,
  "market pricing response",
);
write(universalPath, universaln  '      priceSource = "instacomp_market_sweet_spot";',
  "market suggestion source",
);
write(pricePath, priceRoute);

constn  pending,
  `function providerCoverageList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        source: textValue(row.source),
        label: textValue(row.label),
        status: textValue(row.status),
        resultCount: Math.max(0, Number(row.resultCount || 0)),
        message: textValue(row.message),
        searchUrl: textValue(row.searchUrl),
      };
    });
}
`,
  `function providerCoverageList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        source: textValue(row.source),
        label: textValue(row.label),
        status: textValue(row.status),
        resultCount: Math.max(0, Number(row.resultCount || 0)),
        message: textValue(row.message),
        searchUrl: textValue(row.searchUrl),
      };
    });
}

function marketStats(value: unknown) {
  const row = recordValue(value);
  return {
    count: Math.max(0, Number(row.count || 0)),
    usedCount: Math.max(0, Number(row.usedCount || 0)),
    outliersRemoved: Math.max(0, Number(row.outliersRemoved || 0)),
    low: optionalPrice(row.low),
    q1: optionalPrice(row.q1),
    median: optionalPrice(row.median),
    average: optionalPrice(row.average),
    q3: optionalPrice(row.q3),
    high: optionalPrice(row.high),
  };
}

function pricingModelValue(value: unknown) {
  const model = recordValue(value);
  const sold = recordValue(model.sold);
  const active = recordValue(model.active);
  return {
    strategy: textValue(model.strategy),
    confidence: textValue(model.confidence),
    marketValue: optionalPrice(model.marketValue),
    quickSalePrice: optionalPrice(model.quickSalePrice),
    stretchPrice: optionalPrice(model.stretchPrice),
    activeInfluenceApplied: model.activeInfluenceApplied === true,
    sold: {
      ...marketStats(sold),
      recencyWeightedMedian: optionalPrice(sold.recencyWeightedMedian),
    },
    active: {
      ...marketStats(active),
      competitiveEntryPrice: optionalPrice(active.competitiveEntryPrice),
      competitiveTargetPrice: optionalPrice(active.competitiveTargetPrice),
    },
    rationale: Array.isArray(model.rationale)
      ? model.rationale.map((entry) => String(entry)).slice(0, 10)
      : [],
  };
}
`,
  "pending pricing-model normalizer",
);
pending = replaceOnce(
  pending,
  `      const sourceLinks = recordValue(instaComp.sourceLinks);
      const product = row.legacy_product_id`,
  `      const sourceLinks = recordValue(instaComp.sourceLinks);
      const pricingModel = pricingModelValue(instaComp.pricingModel);
      const product = row.legacy_product_id`,
  "pending pricing model read",
);
pending = replaceOnce(
  pending,
  `          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          listingPrice: optionalPrice(instaComp.listingPrice),`,
  `          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          pricingModel,
          listingPrice: optionalPrice(instaComp.listingPrice),`,
  "pending pricing model response",
);
pending = replaceOnce(
  pending,
  `        pricingRule: {
          reliableSoldComps:
            "Only exact sold comps calculate the suggested price. Active listings never set it.",
          noReliableSoldComps:
            "$0.00 means no reliable sold comps passed; seller pricing is required.",
          activeCompetition:
            "Active listings are shown separately only to inspect current competition.",
        },`,
  `        pricingRule: {
          reliableSoldComps:
            "Exact sold comps establish market value; exact active listings position the Suggested Price inside the live competitive market.",
          noReliableSoldComps:
            "$0.00 means no reliable sold comps passed; active asking prices alone cannot prove value, so seller pricing is required.",
          activeCompetition:
            "Active listings are shown separately and influence competitive positioning only after sold value is established.",
        },`,
  "adult pending pricing rule",
);
write(pendingPath, pending);

const pricePath = "src/app/api 1 ? \"\" : \"s\"}"} removed`
                               : ""}
                           </div>
                         </div>
                       ) : null}
                       <div className="mt-3 flex flex-wrap gap-2">`,
  "market pricing breakdown",
);
page = replaceOnce(
  page,
  "                           Sold comps used for pricing ({item.instaComp.soldCompEvidence.length})",
  "                           Exact sold comps establishing market value ({item.instaComp.soldCompEvidence.length})",
  "sold market panel title",
);
page = replaceOnce(
  page,
  `                           These are currently for sale and never calculate the sold-comp
                           suggestion.`,
  `                           These exact current listings position the competitive sweet spot.
                           Sold history still anchors value so TCOS never blindly copies asking prices.`,
  "active competition explanation",
);
write(pagePath, page);

console.log("Applied universal sold-plus-active InstaComp market pricing and adult review UI.");

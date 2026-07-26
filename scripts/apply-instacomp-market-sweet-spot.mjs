import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  if (search instanceof RegExp) {
    if (!search.test(content)) throw new Error(`Could not find ${label}.`);
    return content.replace(search, replacement);
  }
  if (!content.includes(search)) throw new Error(`Could not find ${label}.`);
  return content.replace(search, replacement);
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

const universalPath = "src/app/api/account/seller/inventory/instacomp-universal/route.ts";
let universal = read(universalPath);
universal = replaceOnce(
  universal,
  'import { buildInstaCompQueries } from "../../../../../../lib/instacomp";\n',
  'import { buildInstaCompQueries } from "../../../../../../lib/instacomp";\nimport { calculateInstaCompMarketPricing } from "../../../../../../lib/instacomp-market-pricing";\n',
  "market pricing import",
);
universal = replaceOnce(
  universal,
  /function soldSuggestion\(values: Evidence\[\]\) \{[\s\S]*?\n\}\n\nasync function downloadFrontImage/,
  "async function downloadFrontImage",
  "sold-only suggestion function",
);
universal = replaceOnce(
  universal,
  /    const suggestedPrice = soldSuggestion\(soldCompEvidence\);[\s\S]*?    const checkedAt = new Date\(\)\.toISOString\(\);/,
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
      : \`The universal eBay sold lane returned no accepted exact sale. ${"${activeCompetition.length}"} exact active listing${"${activeCompetition.length === 1 ? \" was\" : \"s were\"}"} retained for competition review, but seller pricing is required because active asks alone cannot prove value.\`;
    const checkedAt = new Date().toISOString();`,
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
write(universalPath, universal);

const pricePath = "src/app/api/account/seller/instacomp-pending/price/route.ts";
let priceRoute = read(pricePath);
priceRoute = replaceOnce(
  priceRoute,
  '      priceSource = "instacomp_reliable_sold_comps";',
  '      priceSource = "instacomp_market_sweet_spot";',
  "market price source",
);
priceRoute = priceRoute.replaceAll(
  "No reliable sold-comp suggestion is available.",
  "No reliable InstaComp market suggestion is available.",
);
write(pricePath, priceRoute);

const pendingPath = "src/app/api/account/seller/instacomp-pending/route.ts";
let pending = read(pendingPath);
pending = replaceOnce(
  pending,
  "function effectiveGraderStatus(metadata: Record<string, unknown>) {",
  `function marketStats(value: unknown) {
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

function effectiveGraderStatus(metadata: Record<string, unknown>) {`,
  "pricing-model normalizer",
);
pending = replaceOnce(
  pending,
  `      const sourceLinks = recordValue(instaComp.sourceLinks);
      const product = row.legacy_product_id`,
  `      const sourceLinks = recordValue(instaComp.sourceLinks);
      const pricingModel = pricingModelValue(instaComp.pricingModel);
      const product = row.legacy_product_id`,
  "pricing-model read",
);
pending = replaceOnce(
  pending,
  `          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          listingPrice: optionalPrice(instaComp.listingPrice),`,
  `          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          pricingModel,
          listingPrice: optionalPrice(instaComp.listingPrice),`,
  "pricing-model response",
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
            "Active listings influence competitive positioning only after sold value is established.",
        },`,
  "adult pricing rule",
);
write(pendingPath, pending);

const pagePath = "src/app/seller/instacomp-pending/page.tsx";
let page = read(pagePath);
page = replaceOnce(
  page,
  "type PendingItem = {",
  `type MarketStats = {
  count: number;
  usedCount: number;
  outliersRemoved: number;
  low: number | null;
  q1: number | null;
  median: number | null;
  average: number | null;
  q3: number | null;
  high: number | null;
};

type PricingModel = {
  strategy: string | null;
  confidence: string | null;
  marketValue: number | null;
  quickSalePrice: number | null;
  stretchPrice: number | null;
  activeInfluenceApplied: boolean;
  sold: MarketStats & { recencyWeightedMedian: number | null };
  active: MarketStats & {
    competitiveEntryPrice: number | null;
    competitiveTargetPrice: number | null;
  };
  rationale: string[];
};

type PendingItem = {`,
  "page pricing-model types",
);
page = replaceOnce(
  page,
  `    pricingCheckedAt: string | null;
    listingPrice: number | null;`,
  `    pricingCheckedAt: string | null;
    pricingModel: PricingModel;
    listingPrice: number | null;`,
  "page pricing-model field",
);
page = replaceOnce(
  page,
  `                 New scanned drafts automatically receive an InstaComp outcome. Sold comps
                 alone calculate suggested price. Active listings are shown separately as
                 current competition. Select any combination to scan, price, edit quantity,
                 or publish after seller verification.`,
  `                 New scanned drafts automatically receive a complete market outcome. Exact
                 sold comps establish proven value; exact active listings position the live
                 competitive sweet spot. TCOS shows quick-sale, market-value, Suggested Price,
                 and stretch positions before the seller edits or publishes.`,
  "adult page introduction",
);
page = page.replace('["Sold Suggestions", pricingSummary.suggested]', '["Market Suggestions", pricingSummary.suggested]');
page = page.replace(
  "Images → exact identity → sold evidence → active listing image verification → save result",
  "Images → exact identity → sold market → active competition → sweet-spot pricing → save result",
);
page = replaceOnce(
  page,
  `                       <p className="mt-1 text-sm font-semibold text-sky-950">
                         {item.instaComp.pricingReason}
                       </p>
                       <div className="mt-3 flex flex-wrap gap-2">`,
  `                       <p className="mt-1 text-sm font-semibold text-sky-950">
                         {item.instaComp.pricingReason}
                       </p>
                       {item.instaComp.pricingModel.strategy ? (
                         <div className="mt-3 rounded-lg border border-sky-300 bg-white p-3">
                           <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Quick sale</p><p className="text-xl font-black">{money(item.instaComp.pricingModel.quickSalePrice)}</p></div>
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Sold market value</p><p className="text-xl font-black">{money(item.instaComp.pricingModel.marketValue)}</p></div>
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Suggested Price</p><p className="text-xl font-black text-emerald-800">{money(item.instaComp.suggestedPrice)}</p></div>
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Stretch price</p><p className="text-xl font-black">{money(item.instaComp.pricingModel.stretchPrice)}</p></div>
                           </div>
                           <p className="mt-3 text-xs font-black uppercase text-sky-900">
                             {label(item.instaComp.pricingModel.strategy)} · {label(item.instaComp.pricingModel.confidence)} confidence
                           </p>
                           <p className="mt-1 text-xs font-semibold text-neutral-700">
                             Sold used {item.instaComp.pricingModel.sold.usedCount}/{item.instaComp.pricingModel.sold.count} · Active used {item.instaComp.pricingModel.active.usedCount}/{item.instaComp.pricingModel.active.count}
                             {item.instaComp.pricingModel.sold.outliersRemoved ? \` · ${"${item.instaComp.pricingModel.sold.outliersRemoved}"} sold outlier${"${item.instaComp.pricingModel.sold.outliersRemoved === 1 ? \"\" : \"s\"}"} removed\` : ""}
                             {item.instaComp.pricingModel.active.outliersRemoved ? \` · ${"${item.instaComp.pricingModel.active.outliersRemoved}"} active outlier${"${item.instaComp.pricingModel.active.outliersRemoved === 1 ? \"\" : \"s\"}"} removed\` : ""}
                           </p>
                           {item.instaComp.pricingModel.rationale.length ? (
                             <ul className="mt-2 space-y-1 text-xs font-semibold text-neutral-700">
                               {item.instaComp.pricingModel.rationale.map((reason, reasonIndex) => <li key={reasonIndex}>• {reason}</li>)}
                             </ul>
                           ) : null}
                         </div>
                       ) : null}
                       <div className="mt-3 flex flex-wrap gap-2">`,
  "market pricing breakdown",
);
page = page.replace(
  "Sold comps used for pricing ({item.instaComp.soldCompEvidence.length})",
  "Exact sold comps establishing market value ({item.instaComp.soldCompEvidence.length})",
);
page = replaceOnce(
  page,
  `                           These are currently for sale and never calculate the sold-comp
                           suggestion.`,
  `                           These exact current listings position the competitive sweet spot.
                           Sold history still anchors value so TCOS never blindly copies asking prices.`,
  "active competition copy",
);
write(pagePath, page);

console.log("Applied sold-plus-active InstaComp market sweet-spot pricing and adult review UI.");

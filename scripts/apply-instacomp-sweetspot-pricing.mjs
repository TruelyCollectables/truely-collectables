import fs from "node:fs";

function patch(path, transform) {
  const before = fs.readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No change applied to ${path}`);
  fs.writeFileSync(path, after);
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Missing ${label}`);
  return source.replace(search, replacement);
}

patch("src/app/api/account/seller/inventory/instacomp-universal/route.ts", (source) => {
  source = replaceOnce(
    source,
    'import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";',
    'import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";\nimport { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";',
    "sweet spot import",
  );
  source = source.replace(/\nfunction soldSuggestion\([\s\S]*?\n}\n\nasync function downloadFrontImage/, "\nasync function downloadFrontImage");
  source = replaceOnce(
    source,
    `    const suggestedPrice = soldSuggestion(soldCompEvidence);
    const reliableSoldCompCount = soldCompEvidence.length;
    const hasReliableSoldComps = reliableSoldCompCount > 0 && suggestedPrice > 0;
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = hasReliableSoldComps
      ? \`${'${reliableSoldCompCount}'} exact sold comp${'${reliableSoldCompCount === 1 ? "" : "s"}'} passed the universal eBay identity filter. Active listings were not used to calculate the ${'${suggestedPrice.toFixed(2)}'} suggestion.\`
      : \`The universal eBay sold lane returned no accepted exact sale. Seller pricing is required. Sold provider: ${'${universal.sold.message || universal.sold.status}'}.\`;`,
    `    const pricingAnalysis = calculateInstaCompSweetSpot({
      sold: soldCompEvidence,
      active: activeCompetition,
    });
    const suggestedPrice = pricingAnalysis.suggestedPrice;
    const reliableSoldCompCount = pricingAnalysis.soldCount;
    const hasReliableSoldComps = pricingAnalysis.soldCount > 0;
    const pricingStatus = suggestedPrice > 0
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = pricingAnalysis.explanation;`,
    "sweet spot calculation",
  );
  source = replaceOnce(source, "        pricingReason,\n        reliableSoldCompCount", "        pricingReason,\n        pricingAnalysis,\n        reliableSoldCompCount", "metadata analysis");
  source = replaceOnce(source, "      pricingReason,\n      trustedForPricing", "      pricingReason,\n      pricingAnalysis,\n      trustedForPricing", "response analysis");
  return source;
});

patch("src/app/api/account/seller/instacomp-pending/route.ts", (source) => {
  source = replaceOnce(source, "      const sourceLinks = recordValue(instaComp.sourceLinks);", "      const sourceLinks = recordValue(instaComp.sourceLinks);\n      const pricingAnalysis = recordValue(instaComp.pricingAnalysis);", "pricing analysis record");
  source = replaceOnce(
    source,
    `          reliableSoldCompCount: Math.max(
            0,
            Number(instaComp.reliableSoldCompCount || 0),
          ),`,
    `          reliableSoldCompCount: Math.max(
            0,
            Number(instaComp.reliableSoldCompCount || 0),
          ),
          pricingAnalysis: {
            strategy: textValue(pricingAnalysis.strategy) || "no_market",
            soldCount: Math.max(0, Number(pricingAnalysis.soldCount || 0)),
            activeCount: Math.max(0, Number(pricingAnalysis.activeCount || 0)),
            soldLow: optionalPrice(pricingAnalysis.soldLow),
            soldMedian: optionalPrice(pricingAnalysis.soldMedian),
            soldAverage: optionalPrice(pricingAnalysis.soldAverage),
            soldHigh: optionalPrice(pricingAnalysis.soldHigh),
            activeLow: optionalPrice(pricingAnalysis.activeLow),
            activeMedian: optionalPrice(pricingAnalysis.activeMedian),
            activeAverage: optionalPrice(pricingAnalysis.activeAverage),
            activeHigh: optionalPrice(pricingAnalysis.activeHigh),
            soldListTarget: optionalPrice(pricingAnalysis.soldListTarget),
            competitiveTarget: optionalPrice(pricingAnalysis.competitiveTarget),
          },`,
    "pending pricing analysis",
  );
  source = source.replace("Only exact sold comps calculate the suggested price. Active listings never set it.", "Exact sold comps establish market value. Exact active listings establish current competition. InstaComp combines both into a transparent sweet-spot listing suggestion.");
  source = source.replace("Active listings are shown separately only to inspect current competition.", "Active listings are shown separately and also constrain the sweet-spot listing target without replacing sold-market evidence.");
  return source;
});

patch("src/app/seller/instacomp-pending/page.tsx", (source) => {
  source = replaceOnce(
    source,
    "    reliableSoldCompCount: number;\n    pricingCheckedAt: string | null;",
    `    reliableSoldCompCount: number;
    pricingAnalysis: {
      strategy: string;
      soldCount: number;
      activeCount: number;
      soldLow: number | null;
      soldMedian: number | null;
      soldAverage: number | null;
      soldHigh: number | null;
      activeLow: number | null;
      activeMedian: number | null;
      activeAverage: number | null;
      activeHigh: number | null;
      soldListTarget: number | null;
      competitiveTarget: number | null;
    };
    pricingCheckedAt: string | null;`,
    "page pricing type",
  );
  source = replaceOnce(
    source,
    `                      <div className="mt-3 flex flex-wrap gap-2">`,
    `                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          ["Sold range", item.instaComp.pricingAnalysis.soldLow !== null ? \`${'${money(item.instaComp.pricingAnalysis.soldLow)}'}–${'${money(item.instaComp.pricingAnalysis.soldHigh)}'}\` : "None"],
                          ["Sold median", item.instaComp.pricingAnalysis.soldMedian !== null ? money(item.instaComp.pricingAnalysis.soldMedian) : "None"],
                          ["Active range", item.instaComp.pricingAnalysis.activeLow !== null ? \`${'${money(item.instaComp.pricingAnalysis.activeLow)}'}–${'${money(item.instaComp.pricingAnalysis.activeHigh)}'}\` : "None"],
                          ["Active median", item.instaComp.pricingAnalysis.activeMedian !== null ? money(item.instaComp.pricingAnalysis.activeMedian) : "None"],
                          ["Sold list target", item.instaComp.pricingAnalysis.soldListTarget !== null ? money(item.instaComp.pricingAnalysis.soldListTarget) : "None"],
                          ["Competition target", item.instaComp.pricingAnalysis.competitiveTarget !== null ? money(item.instaComp.pricingAnalysis.competitiveTarget) : "None"],
                          ["Exact sold", item.instaComp.pricingAnalysis.soldCount],
                          ["Exact active", item.instaComp.pricingAnalysis.activeCount],
                        ].map(([title, value]) => (
                          <div key={String(title)} className="rounded-lg border border-sky-300 bg-white p-2">
                            <p className="text-[10px] font-black uppercase text-sky-800">{title}</p>
                            <p className="mt-1 text-sm font-black text-neutral-950">{value}</p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] font-black uppercase tracking-wide text-sky-800">
                        Strategy: {label(item.instaComp.pricingAnalysis.strategy)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">`,
    "visible price breakdown",
  );
  source = source.replace("These are currently for sale and never calculate the sold-comp\n                           suggestion.", "These are currently for sale. They define the competitive band used to cap the final sweet-spot suggestion, while sold comps remain the market-value anchor.");
  return source;
});

console.log("Applied full InstaComp sold + active sweet-spot pricing integration.");

import assert from "node:assert/strict";
import { calculateInstaCompMarketPricing } from "../src/lib/instacomp-market-pricing";

const sold = [
  [3.99, "2026-07-18"],
  [3.0, "2026-07-16"],
  [4.0, "2026-07-16"],
  [5.0, "2026-07-13"],
  [1.99, "2026-07-10"],
  [5.0, "2026-07-07"],
  [2.1, "2026-07-04"],
].map(([price, soldAt]) => ({ price: Number(price), soldAt: String(soldAt) }));

const active = [6.99, 7.49].map((price) => ({ price }));
const market = calculateInstaCompMarketPricing({
  sold,
  active,
  now: new Date("2026-07-26T12:00:00Z"),
});

assert.equal(market.sold.usedCount, 7);
assert.equal(market.active.usedCount, 2);
assert.equal(market.marketValue, 3.99);
assert.equal(market.suggestedPrice, 4.49);
assert.equal(market.quickSalePrice, 3.49);
assert.equal(market.stretchPrice, 4.99);
assert.equal(market.strategy, "sold_value_below_active_market");
assert.equal(market.activeInfluenceApplied, true);
assert.equal(market.active.competitiveEntryPrice, 6.99);
assert.equal(market.active.competitiveTargetPrice, 6.98);

const competitive = calculateInstaCompMarketPricing({
  sold,
  active: [{ price: 4.5 }, { price: 4.75 }, { price: 5.25 }],
  now: new Date("2026-07-26T12:00:00Z"),
});
assert.equal(competitive.strategy, "active_competitive_sweet_spot");
assert.ok(competitive.suggestedPrice <= 4.74);
assert.ok(competitive.suggestedPrice >= competitive.quickSalePrice);

const compression = calculateInstaCompMarketPricing({
  sold,
  active: [{ price: 2.99 }, { price: 3.1 }, { price: 3.25 }],
  now: new Date("2026-07-26T12:00:00Z"),
});
assert.equal(compression.strategy, "active_market_compression");
assert.ok(compression.suggestedPrice < compression.marketValue);

const loneLow = calculateInstaCompMarketPricing({
  sold,
  active: [{ price: 1.0 }],
  now: new Date("2026-07-26T12:00:00Z"),
});
assert.equal(loneLow.strategy, "single_active_outlier_guard");
assert.ok(loneLow.suggestedPrice >= loneLow.quickSalePrice);

const soldOnly = calculateInstaCompMarketPricing({
  sold,
  active: [],
  now: new Date("2026-07-26T12:00:00Z"),
});
assert.equal(soldOnly.strategy, "sold_only_market_anchor");
assert.equal(soldOnly.suggestedPrice, 4.49);
assert.equal(soldOnly.activeInfluenceApplied, false);

const activeOnly = calculateInstaCompMarketPricing({
  sold: [],
  active: [{ price: 5 }, { price: 6 }],
  now: new Date("2026-07-26T12:00:00Z"),
});
assert.equal(activeOnly.strategy, "seller_price_required");
assert.equal(activeOnly.suggestedPrice, 0);
assert.equal(activeOnly.marketValue, 0);
assert.equal(activeOnly.active.usedCount, 2);

const outlierControl = calculateInstaCompMarketPricing({
  sold: [...sold, { price: 1000, soldAt: "2026-07-20" }],
  active,
  now: new Date("2026-07-26T12:00:00Z"),
});
assert.equal(outlierControl.sold.outliersRemoved, 1);
assert.ok(outlierControl.suggestedPrice < 10);

console.log(
  "InstaComp market sweet-spot regressions passed: sold value, active competition, market compression, lone-active protection, sold-only fallback, active-only refusal, and outlier control all behave transparently.",
);

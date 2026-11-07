import assert from "node:assert/strict";
import {
  resolveStoreSale,
  storeSaleCampaignIsLive,
  storeSaleCampaignMatches,
  type StoreSaleCampaign,
} from "../src/lib/store-sales";

const base: StoreSaleCampaign = {
  id: "sale-1",
  store_id: "store-1",
  name: "WNBA Weekend",
  percent_off: 20,
  active: true,
  starts_at: "2026-09-05T00:00:00.000Z",
  ends_at: "2026-09-07T00:00:00.000Z",
  scope_type: "filter",
  scope: { sections: ["WNBA"], minPrice: 5, maxPrice: 100 },
};
const now = new Date("2026-09-05T18:00:00.000Z");
const card = { productId: 101, title: "2025 Prizm Kiki Iriafen Silver", player: "Kiki Iriafen", section: "WNBA", price: 25 };

assert.equal(storeSaleCampaignIsLive(base, now), true);
assert.equal(storeSaleCampaignMatches(base, card), true);
assert.equal(storeSaleCampaignMatches(base, { ...card, section: "NBA" }), false);
assert.equal(storeSaleCampaignMatches(base, { ...card, price: 150 }), false);

const resolved = resolveStoreSale({ campaigns: [base], candidate: card, now });
assert.equal(resolved.originalPrice, 25);
assert.equal(resolved.price, 20);
assert.equal(resolved.discountPercent, 20);
assert.equal(resolved.campaign?.id, "sale-1");

const deeper: StoreSaleCampaign = { ...base, id: "sale-2", name: "Flash", percent_off: 30, scope_type: "all", scope: {} };
const overlap = resolveStoreSale({ campaigns: [base, deeper], candidate: card, now });
assert.equal(overlap.price, 17.5);
assert.equal(overlap.campaign?.id, "sale-2");

const selected: StoreSaleCampaign = { ...base, id: "sale-3", scope_type: "products", scope: { productIds: [101, 102] } };
assert.equal(storeSaleCampaignMatches(selected, card), true);
assert.equal(storeSaleCampaignMatches(selected, { ...card, productId: 999 }), false);

const future = { ...base, starts_at: "2026-09-06T00:00:00.000Z" };
assert.equal(storeSaleCampaignIsLive(future, now), false);
const ended = { ...base, ends_at: "2026-09-05T17:00:00.000Z" };
assert.equal(storeSaleCampaignIsLive(ended, now), false);

console.log("store sales simulations: PASS");

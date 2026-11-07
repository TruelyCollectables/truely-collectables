import assert from "node:assert/strict";
import {
  kingmakerPricingReceiptOwner,
  mapKingmakerPricingReceipt,
} from "../src/lib/kingmaker-pricing-receipt-history-server";

assert.deepEqual(
  kingmakerPricingReceiptOwner({ type: "seller", storeId: "store-1", sellerAccountId: "seller-1" }),
  { storeId: "store-1", sellerAccountId: "seller-1" },
);
assert.deepEqual(
  kingmakerPricingReceiptOwner({ type: "admin", storeId: "store-1", sellerAccountId: null }),
  { storeId: "store-1", sellerAccountId: null },
);

const receipt = mapKingmakerPricingReceipt({
  id: "receipt-1",
  identity_id: "identity-1",
  profile_name: "TCOS Standard",
  profile_selection: "fallback",
  decision_status: "ready",
  suggested_list_price: "120.00",
  buy_ceiling: "70.00",
  estimated_net_proceeds: "95.00",
  expected_profit: "25.00",
  confidence: "0.91",
  sold_comp_count: 4,
  review_reasons: [],
  created_at: "2026-08-03T18:00:00.000Z",
});

assert.equal(receipt.id, "receipt-1");
assert.equal(receipt.identityId, "identity-1");
assert.equal(receipt.suggestedListPrice, 120);
assert.equal(receipt.estimatedProfitAtCeiling, 25);
assert.equal(receipt.boundary, "advisory_only");
assert.equal("storeId" in receipt, false);
assert.equal("sellerAccountId" in receipt, false);
assert.equal("source" in receipt, false);

console.log("KINGMAKER Pricing receipt history regressions passed.");

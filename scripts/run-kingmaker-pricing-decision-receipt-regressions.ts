import assert from "node:assert/strict";
import { buildKingmakerPricingDecisionReceiptRow } from "../src/lib/kingmaker-pricing-decision-receipt-server";

const decision = {
  schema: "tcos.kingmaker.pricingDecision.v1" as const,
  status: "ready" as const,
  suggestedListPrice: 120,
  buyCeiling: 70,
  marketMedian: 110,
  referenceMidpoint: 100,
  estimatedNetProceeds: 95,
  expectedProfit: 25,
  minimumProfitableListPrice: 88,
  confidence: 0.91,
  soldCompCount: 4,
  reviewReasons: [],
  marketplaceFeePct: 0.08,
  paymentFeePct: 0.029,
  paymentFixedFee: 0.3,
  shippingCost: 6.99,
  targetMarginPct: 0.3,
  boundary: "advisory_only" as const,
};

const sellerRow = buildKingmakerPricingDecisionReceiptRow({
  actor: { type: "seller", storeId: "store-1", sellerAccountId: "seller-1" },
  identityId: "identity-1",
  profileResolution: {
    selection: "default",
    profile: {
      id: "profile-1",
      name: "My Profile",
      marketplaceFeePct: 0.08,
      paymentFeePct: 0.029,
      paymentFixedFee: 0.3,
      estimatedShippingCost: 6.99,
      targetMarginPct: 0.3,
      isDefault: true,
    },
  },
  decision,
});

assert.equal(sellerRow.store_id, "store-1");
assert.equal(sellerRow.seller_account_id, "seller-1");
assert.equal(sellerRow.identity_id, "identity-1");
assert.equal(sellerRow.profile_selection, "default");
assert.equal(sellerRow.boundary, "advisory_only");
assert.equal(sellerRow.expected_profit, 25);

const adminFallback = buildKingmakerPricingDecisionReceiptRow({
  actor: { type: "admin", storeId: "store-1" },
  identityId: "identity-2",
  profileResolution: {
    selection: "fallback",
    profile: {
      id: "tcos-standard",
      name: "TCOS Standard",
      marketplaceFeePct: 0.08,
      paymentFeePct: 0.029,
      paymentFixedFee: 0.3,
      estimatedShippingCost: 6.99,
      targetMarginPct: 0.3,
      isDefault: true,
    },
  },
  decision: { ...decision, status: "review_required", suggestedListPrice: null, buyCeiling: null },
});

assert.equal(adminFallback.seller_account_id, null);
assert.equal(adminFallback.profile_id, null);
assert.equal(adminFallback.profile_selection, "fallback");
assert.equal(adminFallback.decision_status, "review_required");

console.log("KINGMAKER Pricing decision receipt regressions passed.");

import assert from "node:assert/strict";
import type { KingmakerPricingDecision } from "../src/lib/kingmaker-pricing-decision";
import { buildKingmakerPricingDecisionReceiptRow } from "../src/lib/kingmaker-pricing-decision-receipt-server";

const decision: KingmakerPricingDecision = {
  schema: "tcos.kingmaker.pricingDecision.v1",
  status: "ready",
  suggestedListPrice: 120,
  minimumProfitableListPrice: 88,
  buyCeiling: 70,
  estimatedNetProceeds: 95,
  estimatedProfitAtCeiling: 25,
  marketMedian: 110,
  referenceMidpoint: 100,
  confidence: 0.91,
  soldCompCount: 4,
  economics: {
    marketplaceFeePct: 0.08,
    paymentFeePct: 0.029,
    paymentFixedFee: 0.3,
    shippingCost: 6.99,
    targetMarginPct: 0.3,
  },
  reviewReasons: [],
  boundary: "advisory_only",
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
assert.equal(sellerRow.marketplace_fee_pct, 0.08);
assert.equal(sellerRow.target_margin_pct, 0.3);

const adminFallback = buildKingmakerPricingDecisionReceiptRow({
  actor: { type: "admin", storeId: "store-1", sellerAccountId: null },
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
  decision: {
    ...decision,
    status: "review_required",
    suggestedListPrice: null,
    minimumProfitableListPrice: null,
    buyCeiling: null,
    estimatedNetProceeds: null,
    estimatedProfitAtCeiling: null,
  },
});

assert.equal(adminFallback.seller_account_id, null);
assert.equal(adminFallback.profile_id, null);
assert.equal(adminFallback.profile_selection, "fallback");
assert.equal(adminFallback.decision_status, "review_required");

console.log("KINGMAKER Pricing decision receipt regressions passed.");

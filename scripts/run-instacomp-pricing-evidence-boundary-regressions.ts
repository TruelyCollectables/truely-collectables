import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildKingmakerPricingDecision } from "../src/lib/kingmaker-pricing-decision";
import {
  INSTACOMP_SERVER_OWNED_PRICING_FIELDS,
  suppliedInstaCompServerOwnedPricingFields,
} from "../src/lib/instacomp-pricing-request-security";

const hostileBody = Object.fromEntries(
  INSTACOMP_SERVER_OWNED_PRICING_FIELDS.map((field) => [field, undefined]),
);
assert.deepEqual(
  suppliedInstaCompServerOwnedPricingFields(hostileBody),
  [...INSTACOMP_SERVER_OWNED_PRICING_FIELDS],
  "Every client-authored evidence/economics field must be rejected even when its value is undefined.",
);

assert.deepEqual(
  suppliedInstaCompServerOwnedPricingFields({
    identityId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002",
  }),
  [],
  "Identity and actor-scoped profile selection must remain allowed.",
);

const decisionWithoutAuthoritativeSales = buildKingmakerPricingDecision({
  exactIdentity: true,
  pricing: {
    low: 90,
    high: 110,
    midpoint: 100,
    confidence: 0.99,
    status: "verified",
    trendPct: 5,
  },
  soldComps: [],
  targetMarginPct: 0.3,
  marketplaceFeePct: 0.08,
  paymentFeePct: 0.029,
  paymentFixedFee: 0.3,
  shippingCost: 6.99,
});
assert.equal(decisionWithoutAuthoritativeSales.status, "insufficient_evidence");
assert.equal(decisionWithoutAuthoritativeSales.suggestedListPrice, null);
assert.equal(decisionWithoutAuthoritativeSales.buyCeiling, null);
assert.equal(decisionWithoutAuthoritativeSales.soldCompCount, 0);
assert.ok(
  decisionWithoutAuthoritativeSales.reviewReasons.includes(
    "three_verified_sold_comps_required",
  ),
);

const routePath = path.join(
  process.cwd(),
  "src/app/api/instacomp/pricing/decision/route.ts",
);
const route = fs.readFileSync(routePath, "utf8");

for (const forbiddenReference of [
  "body.exactIdentity",
  "body.soldComps",
  "body.targetMarginPct",
  "body.marketplaceFeePct",
  "body.paymentFeePct",
  "body.paymentFixedFee",
  "body.shippingCost",
]) {
  assert.equal(
    route.includes(forbiddenReference),
    false,
    `Decision route must not trust ${forbiddenReference}.`,
  );
}

for (const requiredMarker of [
  "suppliedInstaCompServerOwnedPricingFields",
  'exactIdentity: pricing?.status === "verified"',
  "soldComps: []",
  "authoritative_loader_required",
]) {
  assert.ok(
    route.includes(requiredMarker),
    `Missing pricing evidence-boundary marker: ${requiredMarker}`,
  );
}

console.log("InstaComp Round Three pricing evidence-boundary regressions passed.");

import {
  calculateShipping,
  getAvailableShippingMethods,
  getMinimumShippingMethod,
  resolveShippingMethod,
  SHIPPING_RULES,
  type ShippingMethod,
} from "./shipping";

export type OfferShippingSnapshot = {
  requestedMethod: ShippingMethod;
  method: ShippingMethod;
  name: string;
  amount: number;
  saleSubtotal: number;
  listingPriceBasis: number;
  itemCount: number;
  profile: string;
  eligibilityBasisType: "product_listing_price_at_offer_decision";
  standardEnvelopeEligible: boolean;
  standardEnvelopeEstimatedOunces: number;
  resolutionReason: string;
};

function profileForMethod(method: ShippingMethod) {
  if (method === "STANDARD_ENVELOPE") {
    return "tracked_card_letter_limited_usps_imb";
  }
  if (method === "PRIORITY_MAIL") return "priority_mail";
  return "ground_advantage";
}

export function buildOfferShippingSnapshot(params: {
  saleSubtotal: number;
  listingPriceBasis: number;
  requestedMethod?: ShippingMethod;
}): OfferShippingSnapshot {
  const saleSubtotal = Math.max(
    0,
    Math.round(Number(params.saleSubtotal || 0) * 100) / 100,
  );
  const listingPriceBasis = Math.max(
    0,
    Math.round(Number(params.listingPriceBasis || 0) * 100) / 100,
  );
  const itemCount = 1;
  const minimumMethod = getMinimumShippingMethod({
    itemCount,
    subtotal: saleSubtotal,
    listingPriceBasis,
  });
  const requestedMethod = params.requestedMethod || minimumMethod;
  const resolved = resolveShippingMethod({
    requestedMethod,
    itemCount,
    subtotal: saleSubtotal,
    listingPriceBasis,
  });
  const amount = calculateShipping({
    itemCount,
    subtotal: saleSubtotal,
    listingPriceBasis,
    method: resolved.method,
  });

  return {
    requestedMethod,
    method: resolved.method,
    name: SHIPPING_RULES[resolved.method].name,
    amount,
    saleSubtotal,
    listingPriceBasis,
    itemCount,
    profile: profileForMethod(resolved.method),
    eligibilityBasisType: "product_listing_price_at_offer_decision",
    standardEnvelopeEligible: resolved.standardEnvelope.eligible,
    standardEnvelopeEstimatedOunces:
      resolved.standardEnvelope.estimatedOunces,
    resolutionReason: resolved.reason || "",
  };
}

export function offerShippingChoices(params: {
  saleSubtotal: number;
  listingPriceBasis: number;
}) {
  return getAvailableShippingMethods({
    itemCount: 1,
    subtotal: params.saleSubtotal,
    listingPriceBasis: params.listingPriceBasis,
  }).map((method) =>
    buildOfferShippingSnapshot({
      ...params,
      requestedMethod: method,
    }),
  );
}

export function offerShippingMetadata(snapshot: OfferShippingSnapshot) {
  return {
    shipping_method: snapshot.method,
    shipping_name: snapshot.name,
    shipping_amount: snapshot.amount.toFixed(2),
    shipping_profile: snapshot.profile,
    shipping_eligibility_basis_type: snapshot.eligibilityBasisType,
    shipping_eligibility_basis_price: snapshot.listingPriceBasis.toFixed(2),
    listing_price_basis: snapshot.listingPriceBasis.toFixed(2),
    standard_envelope_eligible: snapshot.standardEnvelopeEligible
      ? "true"
      : "false",
    standard_envelope_estimated_oz: String(
      snapshot.standardEnvelopeEstimatedOunces,
    ),
    shipping_policy_reason: snapshot.resolutionReason,
  };
}

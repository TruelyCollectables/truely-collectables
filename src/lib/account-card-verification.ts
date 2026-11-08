import type Stripe from "stripe";

export type AccountCardVerificationEvidence = {
  allowed: boolean;
  failureReason: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardFunding: string | null;
  billingName: string | null;
  billingLine1: string | null;
  billingLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingCountry: string | null;
  billingPostalCode: string | null;
};

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text : null;
}

export function evaluateAccountCardVerification(
  paymentMethod: Stripe.PaymentMethod | null,
): AccountCardVerificationEvidence {
  const card = paymentMethod?.type === "card" ? paymentMethod.card : null;
  const billingDetails = paymentMethod?.billing_details ?? null;
  const billingAddress = billingDetails?.address ?? null;
  const billingCountry = cleanText(billingAddress?.country)?.toUpperCase() ?? null;
  const billingPostalCode = cleanText(billingAddress?.postal_code);
  const billingLine1 = cleanText(billingAddress?.line1);
  const billingCity = cleanText(billingAddress?.city);
  const billingState = cleanText(billingAddress?.state);

  let failureReason: string | null = null;

  if (!paymentMethod) {
    failureReason = "missing_payment_method";
  } else if (!card) {
    failureReason = "missing_card_payment_method";
  } else if (!billingCountry) {
    failureReason = "missing_billing_country";
  } else if (billingCountry !== "US") {
    failureReason = "non_us_billing_country";
  } else if (!billingPostalCode) {
    failureReason = "missing_billing_postal_code";
  } else if (!billingLine1) {
    failureReason = "missing_billing_address_line1";
  } else if (!billingCity) {
    failureReason = "missing_billing_city";
  } else if (!billingState) {
    failureReason = "missing_billing_state";
  }

  return {
    allowed: failureReason === null,
    failureReason,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    cardExpMonth: card?.exp_month ?? null,
    cardExpYear: card?.exp_year ?? null,
    cardFunding: card?.funding ?? null,
    billingName: cleanText(billingDetails?.name),
    billingLine1,
    billingLine2: cleanText(billingAddress?.line2),
    billingCity,
    billingState,
    billingCountry,
    billingPostalCode,
  };
}

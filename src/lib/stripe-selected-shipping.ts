import type Stripe from "stripe";
import {
  isShippingMethod,
  SHIPPING_RULES,
  type ShippingMethod,
} from "./shipping";

export type SelectedCheckoutShipping = {
  method: ShippingMethod | string | null;
  name: string | null;
  amount: number;
  shippingRateId: string | null;
};

export async function selectedCheckoutShipping(params: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  metadata: Record<string, string>;
}): Promise<SelectedCheckoutShipping> {
  const fallbackMethod = params.metadata.shipping_method || null;
  const fallbackName = params.metadata.shipping_name || null;
  const fallbackAmount = Number(params.metadata.shipping_amount || 0);

  if (params.metadata.shipping_selection_mode !== "stripe_shipping_options") {
    return {
      method: fallbackMethod,
      name: fallbackName,
      amount: fallbackAmount,
      shippingRateId: null,
    };
  }

  const shippingCost = params.session.shipping_cost;
  const shippingRateReference = shippingCost?.shipping_rate;
  const shippingRateId =
    typeof shippingRateReference === "string"
      ? shippingRateReference
      : shippingRateReference?.id || null;
  let shippingRate: Stripe.ShippingRate | null =
    typeof shippingRateReference === "object" && shippingRateReference
      ? shippingRateReference
      : null;

  if (!shippingRate && shippingRateId) {
    try {
      shippingRate = await params.stripe.shippingRates.retrieve(shippingRateId);
    } catch (error) {
      console.error("Selected Stripe shipping rate could not be retrieved", error);
    }
  }

  const rateMethod = shippingRate?.metadata?.shipping_method;
  const method = isShippingMethod(rateMethod)
    ? rateMethod
    : isShippingMethod(fallbackMethod)
      ? fallbackMethod
      : fallbackMethod;
  const amount =
    typeof shippingCost?.amount_total === "number"
      ? shippingCost.amount_total / 100
      : fallbackAmount;
  const name =
    shippingRate?.display_name ||
    (isShippingMethod(method) ? SHIPPING_RULES[method].name : fallbackName);

  return {
    method,
    name,
    amount: Math.max(0, Math.round(Number(amount || 0) * 100) / 100),
    shippingRateId,
  };
}

import { isShippingMethod, type ShippingMethod } from "./shipping";

export const GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID = 5832609916;

export type GoogleCustomerReviewsOptInConfig = {
  merchant_id: number;
  order_id: string;
  email: string;
  delivery_country: string;
  estimated_delivery_date: string;
};

const DELIVERY_BUSINESS_DAYS_BY_METHOD: Record<ShippingMethod, number> = {
  STANDARD_ENVELOPE: 10,
  GROUND_ADVANTAGE: 7,
  PRIORITY_MAIL: 5,
};

function dateOnlyUtc(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function addBusinessDays(value: Date, businessDays: number) {
  const result = dateOnlyUtc(value);
  let added = 0;

  while (added < businessDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();

    if (day !== 0 && day !== 6) added += 1;
  }

  return result;
}

function validEmail(value: unknown) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function validDeliveryCountry(value: unknown) {
  const country = String(value || "").trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(country) || country === "ZZ") return null;
  return country;
}

export function estimateGoogleCustomerReviewsDeliveryDate(params: {
  orderedAt?: string | null;
  shippingMethod?: unknown;
  now?: Date;
}) {
  const now = params.now || new Date();
  const parsedOrderDate = params.orderedAt
    ? new Date(params.orderedAt)
    : now;
  const orderDate = Number.isNaN(parsedOrderDate.getTime())
    ? now
    : parsedOrderDate;
  const today = dateOnlyUtc(now);
  const orderedDay = dateOnlyUtc(orderDate);
  const estimateStart =
    orderedDay.getTime() > today.getTime() ? orderedDay : today;
  const shippingMethod = isShippingMethod(params.shippingMethod)
    ? params.shippingMethod
    : "GROUND_ADVANTAGE";
  const estimatedDate = addBusinessDays(
    estimateStart,
    DELIVERY_BUSINESS_DAYS_BY_METHOD[shippingMethod],
  );

  return estimatedDate.toISOString().slice(0, 10);
}

export function buildGoogleCustomerReviewsOptInConfig(params: {
  orderId?: unknown;
  email?: unknown;
  deliveryCountry?: unknown;
  orderedAt?: string | null;
  shippingMethod?: unknown;
}): GoogleCustomerReviewsOptInConfig | null {
  const orderId = String(params.orderId || "").trim();
  const email = validEmail(params.email);
  const deliveryCountry = validDeliveryCountry(params.deliveryCountry);

  if (!orderId || !email || !deliveryCountry) return null;

  return {
    merchant_id: GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID,
    order_id: orderId,
    email,
    delivery_country: deliveryCountry,
    estimated_delivery_date: estimateGoogleCustomerReviewsDeliveryDate({
      orderedAt: params.orderedAt,
      shippingMethod: params.shippingMethod,
    }),
  };
}

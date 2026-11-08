const REVIEW_FULFILLMENT_STATUSES = new Set([
  "inventory_review",
  "shipping_review",
]);

export function isPaidOrderStatus(status: string | null | undefined) {
  return String(status || "").startsWith("paid");
}

export function isReadyToShipStatus(
  orderStatus: string | null | undefined,
  fulfillmentStatus: string | null | undefined,
) {
  return (
    orderStatus === "paid" &&
    (fulfillmentStatus === "ready_to_ship" || !fulfillmentStatus)
  );
}

export function isOrderReviewStatus(
  orderStatus: string | null | undefined,
  fulfillmentStatus: string | null | undefined,
) {
  return (
    String(orderStatus || "").endsWith("_review") ||
    REVIEW_FULFILLMENT_STATUSES.has(String(fulfillmentStatus || ""))
  );
}

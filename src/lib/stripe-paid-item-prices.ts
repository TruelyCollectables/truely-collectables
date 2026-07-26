import Stripe from "stripe";

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : null;
}

export async function loadStripePaidUnitPrices(params: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  expectedProductIds: number[];
  checkoutType: string;
  metadata: Record<string, string>;
}) {
  const expected = new Set(params.expectedProductIds);
  const prices = new Map<number, number>();
  const lineItems = await params.stripe.checkout.sessions.listLineItems(
    params.session.id,
    {
      limit: 100,
      expand: ["data.price.product"],
    },
  );

  for (const lineItem of lineItems.data) {
    const stripeProduct =
      lineItem.price?.product && typeof lineItem.price.product === "object"
        ? lineItem.price.product
        : null;
    const productMetadata = stripeProduct?.metadata || {};
    if (productMetadata.tcos_line_type) continue;

    let productId = positiveInteger(productMetadata.legacy_product_id);
    if (!productId && params.checkoutType === "accepted_offer") {
      productId = positiveInteger(params.metadata.product_id);
    }
    if (!productId || !expected.has(productId)) continue;

    const quantity = positiveInteger(lineItem.quantity) || 1;
    const amountSubtotal = money(Number(lineItem.amount_subtotal || 0) / 100);
    if (amountSubtotal === null || amountSubtotal < 0) continue;
    const unitPrice = money(amountSubtotal / quantity);
    if (unitPrice === null || unitPrice < 0) continue;

    const existing = prices.get(productId);
    if (existing !== undefined && Math.abs(existing - unitPrice) > 0.001) {
      throw new Error(
        `Stripe returned conflicting paid unit prices for product ${productId}.`,
      );
    }
    prices.set(productId, unitPrice);
  }

  const missing = params.expectedProductIds.filter(
    (productId) => !prices.has(productId),
  );
  if (missing.length > 0) {
    throw new Error(
      `Stripe paid line-item prices were unavailable for product(s): ${missing.join(", ")}.`,
    );
  }

  return prices;
}

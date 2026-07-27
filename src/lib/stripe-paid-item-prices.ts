import Stripe from "stripe";

export type ExpectedPaidItem = {
  id: number;
  quantity: number;
};

export type StripePaidCheckoutAmounts = {
  unitPrices: Map<number, number>;
  itemSubtotal: number;
  shippingAmount: number;
  buyerProtectionAmount: number;
  total: number;
  lineItemCount: number;
};

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function cents(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function dollars(valueInCents: number) {
  return Math.round(valueInCents) / 100;
}

function productMetadata(
  product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined,
): Stripe.Metadata {
  if (
    !product ||
    typeof product === "string" ||
    ("deleted" in product && product.deleted === true)
  ) {
    return {};
  }

  return product.metadata || {};
}

async function loadAllLineItems(params: {
  stripe: Stripe;
  sessionId: string;
}) {
  const rows: Stripe.LineItem[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const response = await params.stripe.checkout.sessions.listLineItems(
      params.sessionId,
      {
        limit: 100,
        expand: ["data.price.product"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
    );

    rows.push(...response.data);
    if (!response.has_more) return rows;

    const lastId = response.data.at(-1)?.id;
    if (!lastId) {
      throw new Error("Stripe line-item pagination could not advance safely.");
    }
    startingAfter = lastId;
  }

  throw new Error("Stripe returned more checkout line items than the audit limit.");
}

export async function loadStripePaidCheckoutAmounts(params: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  expectedItems: ExpectedPaidItem[];
  checkoutType: string;
  metadata: Record<string, string>;
}): Promise<StripePaidCheckoutAmounts> {
  const expected = new Map<number, number>();
  for (const item of params.expectedItems) {
    const productId = positiveInteger(item.id);
    const quantity = positiveInteger(item.quantity);
    if (!productId || !quantity) {
      throw new Error("The expected paid cart contains an invalid product or quantity.");
    }
    expected.set(productId, (expected.get(productId) || 0) + quantity);
  }

  const chargedByProduct = new Map<
    number,
    { quantity: number; amountCents: number }
  >();
  let shippingCents = 0;
  let buyerProtectionCents = 0;
  let totalCents = 0;
  const lineItems = await loadAllLineItems({
    stripe: params.stripe,
    sessionId: params.session.id,
  });

  for (const lineItem of lineItems) {
    const quantity = positiveInteger(lineItem.quantity) || 1;
    const amountCents =
      cents(lineItem.amount_total) ?? cents(lineItem.amount_subtotal);
    if (amountCents === null) {
      throw new Error(`Stripe line item ${lineItem.id} has an invalid amount.`);
    }
    totalCents += amountCents;

    const metadata = productMetadata(lineItem.price?.product);
    const lineType = String(metadata.tcos_line_type || "").trim();
    if (lineType) {
      if (lineType === "shipping") {
        shippingCents += amountCents;
        continue;
      }
      if (lineType === "buyer_protection") {
        buyerProtectionCents += amountCents;
        continue;
      }
      throw new Error(`Stripe returned an unknown checkout line type: ${lineType}.`);
    }

    let productId = positiveInteger(metadata.legacy_product_id);
    if (
      !productId &&
      params.checkoutType === "accepted_offer" &&
      expected.size === 1
    ) {
      productId = positiveInteger(params.metadata.product_id);
    }
    if (!productId || !expected.has(productId)) {
      throw new Error(
        `Stripe line item ${lineItem.id} could not be mapped to the paid cart.`,
      );
    }

    const current = chargedByProduct.get(productId) || {
      quantity: 0,
      amountCents: 0,
    };
    chargedByProduct.set(productId, {
      quantity: current.quantity + quantity,
      amountCents: current.amountCents + amountCents,
    });
  }

  const unitPrices = new Map<number, number>();
  let itemSubtotalCents = 0;
  for (const [productId, expectedQuantity] of expected) {
    const charged = chargedByProduct.get(productId);
    if (!charged) {
      throw new Error(`Stripe paid line items are missing product ${productId}.`);
    }
    if (charged.quantity !== expectedQuantity) {
      throw new Error(
        `Stripe paid quantity for product ${productId} was ${charged.quantity}; expected ${expectedQuantity}.`,
      );
    }
    if (charged.amountCents % charged.quantity !== 0) {
      throw new Error(
        `Stripe paid amount for product ${productId} does not produce an exact unit price.`,
      );
    }
    unitPrices.set(productId, dollars(charged.amountCents / charged.quantity));
    itemSubtotalCents += charged.amountCents;
  }

  if (chargedByProduct.size !== expected.size) {
    throw new Error("Stripe returned an unexpected paid product line.");
  }

  const sessionTotalCents = cents(params.session.amount_total);
  if (sessionTotalCents === null || sessionTotalCents !== totalCents) {
    throw new Error(
      `Stripe line-item total ${totalCents} did not match Checkout total ${String(params.session.amount_total)}.`,
    );
  }

  return {
    unitPrices,
    itemSubtotal: dollars(itemSubtotalCents),
    shippingAmount: dollars(shippingCents),
    buyerProtectionAmount: dollars(buyerProtectionCents),
    total: dollars(totalCents),
    lineItemCount: lineItems.length,
  };
}

export async function loadStripePaidUnitPrices(params: {
  stripe: Stripe;
  session: Stripe.Checkout.Session;
  expectedProductIds: number[];
  checkoutType: string;
  metadata: Record<string, string>;
}) {
  const amounts = await loadStripePaidCheckoutAmounts({
    ...params,
    expectedItems: params.expectedProductIds.map((id) => ({ id, quantity: 1 })),
  });
  return amounts.unitPrices;
}

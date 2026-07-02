import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type SellerPayoutOrderItem = {
  id: number;
  product_id?: number | null;
  seller_account_id?: string | null;
  title?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stripePaymentIntentId(session: Stripe.Checkout.Session) {
  if (typeof session.payment_intent === "string") return session.payment_intent;
  return session.payment_intent?.id || null;
}

export async function createSellerPayoutLedgerForOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  orderItems: SellerPayoutOrderItem[];
  shippingAmount: number;
  platformFeeRate: number;
  stripeSession?: Stripe.Checkout.Session | null;
}) {
  const sellerItems = params.orderItems.filter(
    (item) => item.seller_account_id,
  );

  if (sellerItems.length === 0) {
    return { created: 0 };
  }

  const orderGross = params.orderItems.reduce((sum, item) => {
    return (
      sum +
      moneyNumber(item.price) * Math.max(0, Math.trunc(moneyNumber(item.quantity)))
    );
  }, 0);

  const platformFeeRate =
    Number.isFinite(params.platformFeeRate) && params.platformFeeRate >= 0
      ? params.platformFeeRate
      : 0.08;

  const rows = sellerItems.map((item) => {
    const quantity = Math.max(0, Math.trunc(moneyNumber(item.quantity)));
    const grossItemAmount = roundMoney(moneyNumber(item.price) * quantity);
    const shippingAllocatedAmount =
      orderGross > 0
        ? roundMoney((grossItemAmount / orderGross) * params.shippingAmount)
        : 0;
    const totalBasisAmount = roundMoney(
      grossItemAmount + shippingAllocatedAmount,
    );
    const platformFeeAmount = roundMoney(totalBasisAmount * platformFeeRate);

    return {
      store_id: params.storeId,
      seller_account_id: item.seller_account_id,
      order_id: params.orderId,
      order_item_id: item.id,
      product_id: item.product_id ?? null,
      source_type: "tcos_website_checkout",
      gross_item_amount: grossItemAmount,
      shipping_allocated_amount: shippingAllocatedAmount,
      total_basis_amount: totalBasisAmount,
      platform_fee_rate: platformFeeRate,
      platform_fee_amount: platformFeeAmount,
      seller_payable_amount: roundMoney(totalBasisAmount - platformFeeAmount),
      payout_status: "hold_pending_fulfillment",
      stripe_session_id: params.stripeSession?.id ?? null,
      stripe_payment_intent_id: params.stripeSession
        ? stripePaymentIntentId(params.stripeSession)
        : null,
      metadata: {
        item_title: item.title ?? null,
        quantity,
      },
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await params.supabase
    .from("seller_payout_ledger_entries")
    .upsert(rows, {
      onConflict: "store_id,order_item_id,seller_account_id",
    });

  if (error) throw error;

  return { created: rows.length };
}

export async function createPlatformFeeLedgerForOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  orderItems: SellerPayoutOrderItem[];
  shippingAmount: number;
  platformFeeRate: number;
  stripeSession?: Stripe.Checkout.Session | null;
}) {
  if (params.orderItems.length === 0) {
    return { created: 0 };
  }

  const orderGross = params.orderItems.reduce((sum, item) => {
    return (
      sum +
      moneyNumber(item.price) * Math.max(0, Math.trunc(moneyNumber(item.quantity)))
    );
  }, 0);

  const platformFeeRate =
    Number.isFinite(params.platformFeeRate) && params.platformFeeRate >= 0
      ? params.platformFeeRate
      : 0.08;

  const rows = params.orderItems.map((item) => {
    const quantity = Math.max(0, Math.trunc(moneyNumber(item.quantity)));
    const grossItemAmount = roundMoney(moneyNumber(item.price) * quantity);
    const shippingAllocatedAmount =
      orderGross > 0
        ? roundMoney((grossItemAmount / orderGross) * params.shippingAmount)
        : 0;
    const totalBasisAmount = roundMoney(
      grossItemAmount + shippingAllocatedAmount,
    );

    return {
      store_id: params.storeId,
      order_id: params.orderId,
      order_item_id: item.id,
      product_id: item.product_id ?? null,
      seller_account_id: item.seller_account_id ?? null,
      source_type: "tcos_website_checkout",
      gross_item_amount: grossItemAmount,
      shipping_allocated_amount: shippingAllocatedAmount,
      total_basis_amount: totalBasisAmount,
      platform_fee_rate: platformFeeRate,
      platform_fee_amount: roundMoney(totalBasisAmount * platformFeeRate),
      fee_status: "recognized_pending_settlement",
      stripe_session_id: params.stripeSession?.id ?? null,
      stripe_payment_intent_id: params.stripeSession
        ? stripePaymentIntentId(params.stripeSession)
        : null,
      metadata: {
        item_title: item.title ?? null,
        quantity,
        fee_owner: "Dag Danky Holdings LLC",
        fee_scope: "TCOS website checkout purchases only",
      },
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await params.supabase
    .from("platform_fee_ledger_entries")
    .upsert(rows, {
      onConflict: "store_id,order_item_id,source_type",
    });

  if (error) throw error;

  return { created: rows.length };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

type OrderRow = {
  id: number;
  total: number | string | null;
  status: string | null;
  fulfillment_status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
};

type PlatformFeeRow = {
  id: string;
  order_item_id: number;
  seller_account_id: string | null;
  platform_fee_amount: number | string | null;
};

type SellerPayoutRow = {
  id: string;
  order_item_id: number;
  seller_account_id: string;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
};

export type StripePostPaymentResult = {
  outcome: string;
  orderId: number | null;
  providerObjectId: string;
  adjustmentCount: number;
  heldSellerRows: number;
  reviewCaseId: string | null;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function stripeId(value: unknown) {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && "id" in value) {
    const id = String((value as { id?: unknown }).id || "").trim();
    return id || null;
  }
  return null;
}

function stripeCreatedAt(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : null;
}

async function findOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
}) {
  const select =
    "id,total,status,fulfillment_status,stripe_payment_intent_id,stripe_charge_id";

  if (params.paymentIntentId) {
    const { data, error } = await params.supabase
      .from("orders")
      .select(select)
      .eq("store_id", params.storeId)
      .eq("stripe_payment_intent_id", params.paymentIntentId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as OrderRow;
  }

  if (params.chargeId) {
    const { data, error } = await params.supabase
      .from("orders")
      .select(select)
      .eq("store_id", params.storeId)
      .eq("stripe_charge_id", params.chargeId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as unknown as OrderRow;
  }

  if (params.paymentIntentId) {
    const { data: ledger, error: ledgerError } = await params.supabase
      .from("platform_fee_ledger_entries")
      .select("order_id")
      .eq("store_id", params.storeId)
      .eq("stripe_payment_intent_id", params.paymentIntentId)
      .limit(1)
      .maybeSingle();
    if (ledgerError) throw ledgerError;

    if (ledger?.order_id) {
      const { data, error } = await params.supabase
        .from("orders")
        .select(select)
        .eq("store_id", params.storeId)
        .eq("id", ledger.order_id)
        .single();
      if (error) throw error;
      return data as unknown as OrderRow;
    }
  }

  return null;
}

async function savePostPaymentObject(params: {
  supabase: SupabaseClient;
  storeId: string;
  event: Stripe.Event;
  objectType: "refund" | "dispute";
  providerObjectId: string;
  orderId: number | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  status: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  providerCreatedAt: string | null;
  metadata: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const { error } = await params.supabase
    .from("stripe_post_payment_objects")
    .upsert(
      {
        store_id: params.storeId,
        object_type: params.objectType,
        provider_object_id: params.providerObjectId,
        order_id: params.orderId,
        payment_intent_id: params.paymentIntentId,
        charge_id: params.chargeId,
        current_status: params.status,
        amount: params.amount,
        currency: params.currency,
        reason: params.reason,
        last_provider_event_id: params.event.id,
        provider_created_at: params.providerCreatedAt,
        last_event_at: stripeCreatedAt(params.event.created) || now,
        metadata: params.metadata,
        updated_at: now,
      },
      { onConflict: "store_id,object_type,provider_object_id" },
    );

  if (error) throw error;
}

async function insertAdjustment(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number | null;
  orderItemId?: number | null;
  sellerAccountId?: string | null;
  event: Stripe.Event;
  providerObjectId: string;
  economicKey: string;
  entryType: string;
  ledgerAccount: string;
  balanceEffect: string;
  amount: number;
  currency: string;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await params.supabase
    .from("financial_adjustment_ledger_entries")
    .upsert(
      {
        store_id: params.storeId,
        order_id: params.orderId,
        order_item_id: params.orderItemId || null,
        seller_account_id: params.sellerAccountId || null,
        provider: "stripe",
        provider_event_id: params.event.id,
        provider_object_id: params.providerObjectId,
        economic_key: params.economicKey,
        entry_type: params.entryType,
        ledger_account: params.ledgerAccount,
        balance_effect: params.balanceEffect,
        amount: roundMoney(params.amount),
        currency: params.currency,
        metadata: params.metadata || {},
      },
      { onConflict: "store_id,economic_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function loadBaseLedgers(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
}) {
  const [fees, payouts] = await Promise.all([
    params.supabase
      .from("platform_fee_ledger_entries")
      .select("id,order_item_id,seller_account_id,platform_fee_amount")
      .eq("store_id", params.storeId)
      .eq("order_id", params.orderId)
      .eq("source_type", "tcos_website_checkout"),
    params.supabase
      .from("seller_payout_ledger_entries")
      .select(
        "id,order_item_id,seller_account_id,seller_payable_amount,payout_status",
      )
      .eq("store_id", params.storeId)
      .eq("order_id", params.orderId)
      .eq("source_type", "tcos_website_checkout"),
  ]);

  if (fees.error) throw fees.error;
  if (payouts.error) throw payouts.error;

  return {
    fees: (fees.data || []) as unknown as PlatformFeeRow[],
    payouts: (payouts.data || []) as unknown as SellerPayoutRow[],
  };
}

export async function processStripeRefundEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  event: Stripe.Event;
  refund: Stripe.Refund;
}): Promise<StripePostPaymentResult> {
  const refund = params.refund as Stripe.Refund & {
    payment_intent?: string | Stripe.PaymentIntent | null;
  };
  const refundId = refund.id;
  const paymentIntentId = stripeId(refund.payment_intent);
  const chargeId = stripeId(refund.charge);
  const amount = roundMoney(Number(refund.amount || 0) / 100);
  const currency = String(refund.currency || "usd").toUpperCase();
  const status = String(refund.status || "unknown");
  const order = await findOrder({
    supabase: params.supabase,
    storeId: params.storeId,
    paymentIntentId,
    chargeId,
  });

  await savePostPaymentObject({
    ...params,
    objectType: "refund",
    providerObjectId: refundId,
    orderId: order?.id || null,
    paymentIntentId,
    chargeId,
    status,
    amount,
    currency,
    reason: refund.reason || null,
    providerCreatedAt: stripeCreatedAt(refund.created),
    metadata: {
      receipt_number: refund.receipt_number || null,
      failure_reason: refund.failure_reason || null,
      outside_inventory_restore: false,
    },
  });

  if (!order) {
    return {
      outcome: "refund_unmatched",
      orderId: null,
      providerObjectId: refundId,
      adjustmentCount: 0,
      heldSellerRows: 0,
      reviewCaseId: null,
    };
  }

  if (status !== "succeeded") {
    const { error: orderStatusError } = await params.supabase
      .from("orders")
      .update({
        refund_status: status,
        last_payment_event_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("store_id", params.storeId);
    if (orderStatusError) throw orderStatusError;

    return {
      outcome: `refund_${status}`,
      orderId: order.id,
      providerObjectId: refundId,
      adjustmentCount: 0,
      heldSellerRows: 0,
      reviewCaseId: null,
    };
  }

  const orderTotal = money(order.total);
  const ratio = orderTotal > 0 ? Math.min(amount / orderTotal, 1) : 0;
  const ledgers = await loadBaseLedgers({
    supabase: params.supabase,
    storeId: params.storeId,
    orderId: order.id,
  });
  let adjustmentCount = 0;

  if (
    await insertAdjustment({
      ...params,
      orderId: order.id,
      providerObjectId: refundId,
      economicKey: `refund:${refundId}:customer`,
      entryType: "customer_refund",
      ledgerAccount: "platform_cash",
      balanceEffect: "debit",
      amount,
      currency,
      metadata: { refund_ratio: ratio },
    })
  ) adjustmentCount += 1;

  for (const row of ledgers.fees) {
    const reversal = roundMoney(money(row.platform_fee_amount) * ratio);
    if (reversal <= 0) continue;
    if (
      await insertAdjustment({
        ...params,
        orderId: order.id,
        orderItemId: row.order_item_id,
        sellerAccountId: row.seller_account_id,
        providerObjectId: refundId,
        economicKey: `refund:${refundId}:platform_fee:${row.id}`,
        entryType: "platform_fee_reversal",
        ledgerAccount: "platform_fee_revenue",
        balanceEffect: "debit",
        amount: reversal,
        currency,
        metadata: { refund_ratio: ratio, base_platform_fee_row_id: row.id },
      })
    ) adjustmentCount += 1;
  }

  for (const row of ledgers.payouts) {
    const reversal = roundMoney(money(row.seller_payable_amount) * ratio);
    if (reversal <= 0) continue;
    if (
      await insertAdjustment({
        ...params,
        orderId: order.id,
        orderItemId: row.order_item_id,
        sellerAccountId: row.seller_account_id,
        providerObjectId: refundId,
        economicKey: `refund:${refundId}:seller_payable:${row.id}`,
        entryType: "seller_payable_reversal",
        ledgerAccount: "seller_payable",
        balanceEffect: "debit",
        amount: reversal,
        currency,
        metadata: { refund_ratio: ratio, base_seller_payout_row_id: row.id },
      })
    ) adjustmentCount += 1;

    if (row.payout_status === "paid") {
      if (
        await insertAdjustment({
          ...params,
          orderId: order.id,
          orderItemId: row.order_item_id,
          sellerAccountId: row.seller_account_id,
          providerObjectId: refundId,
          economicKey: `refund:${refundId}:seller_recovery:${row.id}`,
          entryType: "seller_recovery_required",
          ledgerAccount: "seller_recovery",
          balanceEffect: "debit",
          amount: reversal,
          currency,
          metadata: { recovery_source: "already_paid_seller_payout" },
        })
      ) adjustmentCount += 1;
    }
  }

  const { data: refunds, error: refundsError } = await params.supabase
    .from("stripe_post_payment_objects")
    .select("amount")
    .eq("store_id", params.storeId)
    .eq("order_id", order.id)
    .eq("object_type", "refund")
    .eq("current_status", "succeeded");
  if (refundsError) throw refundsError;

  const totalRefunded = roundMoney(
    (refunds || []).reduce((sum, row) => sum + money(row.amount), 0),
  );
  const fullyRefunded = orderTotal > 0 && totalRefunded >= orderTotal - 0.01;
  const holdableStatuses = [
    "hold_pending_fulfillment",
    "hold_dispute_or_review",
    "eligible",
  ];
  const { error: payoutUpdateError } = await params.supabase
    .from("seller_payout_ledger_entries")
    .update({
      payout_status: fullyRefunded ? "reversed" : "hold_dispute_or_review",
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", params.storeId)
    .eq("order_id", order.id)
    .in("payout_status", holdableStatuses);
  if (payoutUpdateError) throw payoutUpdateError;

  if (fullyRefunded) {
    const { error: feeUpdateError } = await params.supabase
      .from("platform_fee_ledger_entries")
      .update({ fee_status: "reversed", updated_at: new Date().toISOString() })
      .eq("store_id", params.storeId)
      .eq("order_id", order.id)
      .eq("source_type", "tcos_website_checkout");
    if (feeUpdateError) throw feeUpdateError;
  }

  const { error: orderUpdateError } = await params.supabase
    .from("orders")
    .update({
      payment_status: fullyRefunded ? "refunded" : "partially_refunded",
      refund_status: status,
      amount_refunded: totalRefunded,
      last_payment_event_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("store_id", params.storeId);
  if (orderUpdateError) throw orderUpdateError;

  return {
    outcome: fullyRefunded ? "refund_applied_full" : "refund_applied_partial",
    orderId: order.id,
    providerObjectId: refundId,
    adjustmentCount,
    heldSellerRows: ledgers.payouts.filter((row) => row.payout_status !== "paid").length,
    reviewCaseId: null,
  };
}

async function ensureDisputeCase(params: {
  supabase: SupabaseClient;
  storeId: string;
  order: OrderRow;
  dispute: Stripe.Dispute;
}) {
  const { data: existing, error: existingError } = await params.supabase
    .from("order_review_cases")
    .select("id,status")
    .eq("store_id", params.storeId)
    .eq("provider", "stripe")
    .eq("provider_case_id", params.dispute.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { id: String(existing.id), created: false };

  const deadline = stripeCreatedAt(params.dispute.evidence_details?.due_by);
  const { data: created, error } = await params.supabase
    .from("order_review_cases")
    .insert({
      store_id: params.storeId,
      order_id: params.order.id,
      case_type: "chargeback",
      status: "open",
      severity: "critical",
      title: `Stripe dispute ${params.dispute.id}`,
      description: `Stripe reported a ${params.dispute.reason || "payment"} dispute. Evidence deadline: ${deadline || "not provided"}.`,
      opened_by: "stripe_webhook",
      hold_seller_payouts: true,
      hold_order_fulfillment: true,
      provider: "stripe",
      provider_case_id: params.dispute.id,
      metadata: {
        stripe_dispute_status: params.dispute.status,
        stripe_dispute_reason: params.dispute.reason,
        evidence_due_by: deadline,
      },
    })
    .select("id")
    .single();
  if (error || !created?.id) throw error || new Error("Could not create dispute case");

  const { error: eventError } = await params.supabase
    .from("order_review_case_events")
    .insert({
      store_id: params.storeId,
      case_id: created.id,
      order_id: params.order.id,
      event_type: "case_created",
      new_status: "open",
      note: "Case opened automatically from a signed Stripe dispute webhook.",
      actor_type: "stripe_webhook",
      metadata: { stripe_dispute_id: params.dispute.id },
    });
  if (eventError) throw eventError;

  return { id: String(created.id), created: true };
}

export async function processStripeDisputeEvent(params: {
  supabase: SupabaseClient;
  storeId: string;
  event: Stripe.Event;
  dispute: Stripe.Dispute;
}): Promise<StripePostPaymentResult> {
  const dispute = params.dispute as Stripe.Dispute & {
    payment_intent?: string | Stripe.PaymentIntent | null;
  };
  const disputeId = dispute.id;
  const paymentIntentId = stripeId(dispute.payment_intent);
  const chargeId = stripeId(dispute.charge);
  const amount = roundMoney(Number(dispute.amount || 0) / 100);
  const currency = String(dispute.currency || "usd").toUpperCase();
  const order = await findOrder({
    supabase: params.supabase,
    storeId: params.storeId,
    paymentIntentId,
    chargeId,
  });

  await savePostPaymentObject({
    ...params,
    objectType: "dispute",
    providerObjectId: disputeId,
    orderId: order?.id || null,
    paymentIntentId,
    chargeId,
    status: dispute.status || null,
    amount,
    currency,
    reason: dispute.reason || null,
    providerCreatedAt: stripeCreatedAt(dispute.created),
    metadata: {
      evidence_due_by: stripeCreatedAt(dispute.evidence_details?.due_by),
      has_evidence: dispute.evidence_details?.has_evidence === true,
      is_charge_refundable: dispute.is_charge_refundable === true,
    },
  });

  if (!order) {
    return {
      outcome: "dispute_unmatched",
      orderId: null,
      providerObjectId: disputeId,
      adjustmentCount: 0,
      heldSellerRows: 0,
      reviewCaseId: null,
    };
  }

  const reviewCase = await ensureDisputeCase({
    supabase: params.supabase,
    storeId: params.storeId,
    order,
    dispute,
  });
  const ledgers = await loadBaseLedgers({
    supabase: params.supabase,
    storeId: params.storeId,
    orderId: order.id,
  });
  let adjustmentCount = 0;
  const disputeRatio =
    money(order.total) > 0 ? Math.min(amount / money(order.total), 1) : 0;

  for (const row of ledgers.payouts) {
    const heldAmount = roundMoney(
      money(row.seller_payable_amount) * disputeRatio,
    );
    if (heldAmount <= 0) continue;
    if (
      await insertAdjustment({
        ...params,
        orderId: order.id,
        orderItemId: row.order_item_id,
        sellerAccountId: row.seller_account_id,
        providerObjectId: disputeId,
        economicKey: `dispute:${disputeId}:hold:${row.id}`,
        entryType: "dispute_hold",
        ledgerAccount: "dispute_reserve",
        balanceEffect: "hold",
        amount: heldAmount,
        currency,
        metadata: { base_seller_payout_row_id: row.id },
      })
    ) adjustmentCount += 1;

    if (row.payout_status === "paid") {
      if (
        await insertAdjustment({
          ...params,
          orderId: order.id,
          orderItemId: row.order_item_id,
          sellerAccountId: row.seller_account_id,
          providerObjectId: disputeId,
          economicKey: `dispute:${disputeId}:seller_recovery:${row.id}`,
          entryType: "seller_recovery_required",
          ledgerAccount: "seller_recovery",
          balanceEffect: "debit",
          amount: heldAmount,
          currency,
          metadata: { recovery_source: "already_paid_seller_payout" },
        })
      ) adjustmentCount += 1;
    }
  }

  const eventEntry =
    params.event.type === "charge.dispute.funds_withdrawn"
      ? {
          key: "funds_withdrawn",
          type: "dispute_funds_withdrawn",
          account: "platform_cash",
          effect: "debit",
        }
      : params.event.type === "charge.dispute.funds_reinstated"
        ? {
            key: "funds_reinstated",
            type: "dispute_funds_reinstated",
            account: "platform_cash",
            effect: "credit",
          }
        : params.event.type === "charge.dispute.closed" && dispute.status === "lost"
          ? {
              key: "chargeback_loss",
              type: "chargeback_loss",
              account: "dispute_reserve",
              effect: "memo",
            }
          : params.event.type === "charge.dispute.closed" && dispute.status === "won"
            ? {
                key: "dispute_won",
                type: "dispute_won",
                account: "dispute_reserve",
                effect: "memo",
              }
            : null;

  if (
    eventEntry &&
    (await insertAdjustment({
      ...params,
      orderId: order.id,
      providerObjectId: disputeId,
      economicKey: `dispute:${disputeId}:${eventEntry.key}`,
      entryType: eventEntry.type,
      ledgerAccount: eventEntry.account,
      balanceEffect: eventEntry.effect,
      amount,
      currency,
      metadata: { stripe_dispute_status: dispute.status },
    }))
  ) adjustmentCount += 1;

  const { error: payoutError } = await params.supabase
    .from("seller_payout_ledger_entries")
    .update({
      payout_status: "hold_dispute_or_review",
      updated_at: new Date().toISOString(),
    })
    .eq("store_id", params.storeId)
    .eq("order_id", order.id)
    .in("payout_status", ["hold_pending_fulfillment", "eligible"]);
  if (payoutError) throw payoutError;

  const paymentStatus =
    dispute.status === "lost"
      ? "chargeback_lost"
      : dispute.status === "won"
        ? "dispute_won_review"
        : "disputed";
  const { error: orderError } = await params.supabase
    .from("orders")
    .update({
      payment_status: paymentStatus,
      dispute_status: dispute.status,
      stripe_payment_intent_id: paymentIntentId,
      stripe_charge_id: chargeId,
      last_payment_event_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("store_id", params.storeId);
  if (orderError) throw orderError;

  if (params.event.type === "charge.dispute.closed") {
    const { error: caseUpdateError } = await params.supabase
      .from("order_review_cases")
      .update({
        outcome_summary: `Stripe closed the dispute with status ${dispute.status}. Seller liability still requires TCOS review.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reviewCase.id)
      .eq("store_id", params.storeId);
    if (caseUpdateError) throw caseUpdateError;
  }

  const { error: caseEventError } = await params.supabase
    .from("order_review_case_events")
    .insert({
      store_id: params.storeId,
      case_id: reviewCase.id,
      order_id: order.id,
      event_type: "case_note_added",
      note: `Stripe event ${params.event.type}: dispute status ${dispute.status}.`,
      actor_type: "stripe_webhook",
      metadata: {
        stripe_event_id: params.event.id,
        stripe_dispute_id: disputeId,
      },
    });
  if (caseEventError) throw caseEventError;

  return {
    outcome: `dispute_${dispute.status || "updated"}`,
    orderId: order.id,
    providerObjectId: disputeId,
    adjustmentCount,
    heldSellerRows: ledgers.payouts.filter((row) => row.payout_status !== "paid").length,
    reviewCaseId: reviewCase.id,
  };
}

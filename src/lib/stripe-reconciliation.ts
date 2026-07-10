import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

const MAX_STRIPE_TRANSACTIONS = 1000;
const MONEY_TOLERANCE = 0.01;

type ReconciliationSource = "scheduled_cron" | "admin_manual";

type ReconciliationItem = {
  item_key: string;
  severity: "info" | "warning" | "high" | "critical";
  mismatch_type:
    | "stripe_only"
    | "tcos_only"
    | "amount_mismatch"
    | "aggregate_difference"
    | "volume_limit"
    | "unexpected_category";
  transaction_category: string;
  stripe_balance_transaction_id?: string | null;
  stripe_source_id?: string | null;
  internal_record_type?: string | null;
  internal_record_id?: string | null;
  stripe_amount?: number | null;
  internal_amount?: number | null;
  difference_amount?: number | null;
  currency?: string;
  title: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
};

type InternalMatch = {
  type: "order" | "refund" | "dispute" | "payout_request";
  id: string;
  amount: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
}

function sourceId(value: unknown) {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id?: unknown }).id || "") || null;
  }
  return null;
}

function transactionCategory(transaction: Stripe.BalanceTransaction) {
  const category = String(transaction.reporting_category || transaction.type);
  if (["charge", "payment"].includes(category)) return "charge";
  if (category.includes("refund")) return "refund";
  if (category.includes("dispute")) return "dispute";
  if (category.includes("transfer")) return "transfer";
  if (category.includes("payout")) return "payout";
  if (category.includes("fee")) return "fee";
  return category || "unknown";
}

export function previousUtcDayWindow(now = new Date()) {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function findInternalMatch(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  storeId: string;
  category: string;
  sourceId: string | null;
}): Promise<InternalMatch | null> {
  if (!params.sourceId) return null;

  if (params.category === "charge") {
    let { data, error } = await params.supabase
      .from("orders")
      .select("id,total")
      .eq("store_id", params.storeId)
      .eq("is_test", false)
      .eq("stripe_charge_id", params.sourceId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (!data && params.sourceId.startsWith("ch_")) {
      const charge = await params.stripe.charges.retrieve(params.sourceId);
      const paymentIntentId = sourceId(charge.payment_intent);

      if (paymentIntentId) {
        const result = await params.supabase
          .from("orders")
          .select("id,total")
          .eq("store_id", params.storeId)
          .eq("is_test", false)
          .eq("stripe_payment_intent_id", paymentIntentId)
          .limit(1)
          .maybeSingle();
        data = result.data;
        error = result.error;
        if (error) throw error;

        if (data?.id) {
          const { error: updateError } = await params.supabase
            .from("orders")
            .update({ stripe_charge_id: params.sourceId })
            .eq("id", data.id)
            .eq("store_id", params.storeId);
          if (updateError) throw updateError;
        }
      }
    }

    return data
      ? { type: "order", id: String(data.id), amount: money(data.total) }
      : null;
  }

  if (params.category === "refund" || params.category === "dispute") {
    const objectType = params.category;
    const { data, error } = await params.supabase
      .from("stripe_post_payment_objects")
      .select("id,amount")
      .eq("store_id", params.storeId)
      .eq("object_type", objectType)
      .eq("provider_object_id", params.sourceId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data
      ? { type: objectType, id: String(data.id), amount: money(data.amount) }
      : null;
  }

  if (params.category === "payout" || params.category === "transfer") {
    const { data, error } = await params.supabase
      .from("seller_payout_requests")
      .select("id,requested_amount,final_net_amount")
      .eq("store_id", params.storeId)
      .eq("provider_payout_reference", params.sourceId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          type: "payout_request",
          id: String(data.id),
          amount: money(data.final_net_amount) || money(data.requested_amount),
        }
      : null;
  }

  return null;
}

async function loadInternalWindow(params: {
  supabase: SupabaseClient;
  storeId: string;
  start: string;
  end: string;
}) {
  const [orders, objects, fees, payables, payouts] = await Promise.all([
    params.supabase
      .from("orders")
      .select("id,total,stripe_charge_id,stripe_payment_intent_id,created_at")
      .eq("store_id", params.storeId)
      .eq("is_test", false)
      .gte("created_at", params.start)
      .lt("created_at", params.end),
    params.supabase
      .from("stripe_post_payment_objects")
      .select("id,object_type,provider_object_id,amount,current_status,provider_created_at")
      .eq("store_id", params.storeId)
      .gte("provider_created_at", params.start)
      .lt("provider_created_at", params.end),
    params.supabase
      .from("platform_fee_ledger_entries")
      .select("platform_fee_amount,created_at")
      .eq("store_id", params.storeId)
      .gte("created_at", params.start)
      .lt("created_at", params.end),
    params.supabase
      .from("seller_payout_ledger_entries")
      .select("seller_payable_amount,created_at")
      .eq("store_id", params.storeId)
      .gte("created_at", params.start)
      .lt("created_at", params.end),
    params.supabase
      .from("seller_payout_requests")
      .select("id,provider_payout_reference,requested_amount,final_net_amount,completed_at")
      .eq("store_id", params.storeId)
      .eq("status", "paid")
      .not("provider_payout_reference", "is", null)
      .gte("completed_at", params.start)
      .lt("completed_at", params.end),
  ]);

  for (const result of [orders, objects, fees, payables, payouts]) {
    if (result.error) throw result.error;
  }

  return {
    orders: orders.data || [],
    objects: objects.data || [],
    fees: fees.data || [],
    payables: payables.data || [],
    payouts: payouts.data || [],
  };
}

export async function reconcileStripeDaily(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  storeId: string;
  source: ReconciliationSource;
  windowStart: string;
  windowEnd: string;
}) {
  const existing = await params.supabase
    .from("stripe_reconciliation_runs")
    .select("id,run_status,summary,started_at")
    .eq("store_id", params.storeId)
    .eq("window_start", params.windowStart)
    .eq("window_end", params.windowEnd)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const staleRunning =
    existing.data?.run_status === "running" &&
    Date.now() - new Date(existing.data.started_at).getTime() > 15 * 60 * 1000;
  if (existing.data && existing.data.run_status !== "failed" && !staleRunning) {
    return {
      runId: String(existing.data.id),
      status: String(existing.data.run_status),
      replayed: true,
      summary: existing.data.summary || {},
    };
  }

  let runId: string;
  if (existing.data) {
    runId = String(existing.data.id);
    const { error: deleteError } = await params.supabase
      .from("stripe_reconciliation_items")
      .delete()
      .eq("run_id", runId);
    if (deleteError) throw deleteError;

    const { error: restartError } = await params.supabase
      .from("stripe_reconciliation_runs")
      .update({
        source: params.source,
        run_status: "running",
        stripe_transaction_count: 0,
        matched_count: 0,
        unmatched_count: 0,
        amount_mismatch_count: 0,
        warning_count: 0,
        critical_count: 0,
        summary: {},
        last_error: null,
        started_at: new Date().toISOString(),
        completed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (restartError) throw restartError;
  } else {
    const { data: run, error: runError } = await params.supabase
      .from("stripe_reconciliation_runs")
      .insert({
        store_id: params.storeId,
        source: params.source,
        run_status: "running",
        window_start: params.windowStart,
        window_end: params.windowEnd,
      })
      .select("id")
      .single();
    if (runError || !run?.id) {
      throw runError || new Error("Could not start Stripe reconciliation");
    }
    runId = String(run.id);
  }

  try {
    const startSeconds = Math.floor(new Date(params.windowStart).getTime() / 1000);
    const endSeconds = Math.floor(new Date(params.windowEnd).getTime() / 1000);
    const transactions: Stripe.BalanceTransaction[] = [];
    let startingAfter: string | undefined;

    while (transactions.length < MAX_STRIPE_TRANSACTIONS) {
      const page = await params.stripe.balanceTransactions.list({
        created: { gte: startSeconds, lt: endSeconds },
        limit: 100,
        starting_after: startingAfter,
      });
      transactions.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data.at(-1)?.id;
    }

    const internal = await loadInternalWindow({
      supabase: params.supabase,
      storeId: params.storeId,
      start: params.windowStart,
      end: params.windowEnd,
    });
    const items: ReconciliationItem[] = [];
    const matchedInternal = new Set<string>();
    let matchedCount = 0;
    let amountMismatchCount = 0;
    let stripeGross = 0;
    let stripeFees = 0;
    let stripeNet = 0;
    let expectedInternalNet = 0;

    for (const transaction of transactions) {
      const category = transactionCategory(transaction);
      const transactionAmount = roundMoney(transaction.amount / 100);
      const absoluteAmount = Math.abs(transactionAmount);
      const transactionSourceId = sourceId(transaction.source);
      stripeGross = roundMoney(stripeGross + transactionAmount);
      stripeFees = roundMoney(stripeFees + transaction.fee / 100);
      stripeNet = roundMoney(stripeNet + transaction.net / 100);

      if (category === "fee") {
        expectedInternalNet = roundMoney(
          expectedInternalNet + transaction.net / 100,
        );
        continue;
      }

      const match = await findInternalMatch({
        supabase: params.supabase,
        stripe: params.stripe,
        storeId: params.storeId,
        category,
        sourceId: transactionSourceId,
      });

      if (!match) {
        const expectedCategory = ["charge", "refund", "dispute", "transfer", "payout"].includes(category);
        items.push({
          item_key: `stripe:${transaction.id}`,
          severity: category === "charge" ? "critical" : expectedCategory ? "high" : "warning",
          mismatch_type: expectedCategory ? "stripe_only" : "unexpected_category",
          transaction_category: category,
          stripe_balance_transaction_id: transaction.id,
          stripe_source_id: transactionSourceId,
          stripe_amount: absoluteAmount,
          difference_amount: absoluteAmount,
          currency: transaction.currency.toUpperCase(),
          title: expectedCategory
            ? `Stripe ${category} has no TCOS record`
            : `Unexpected Stripe balance category: ${category}`,
          detail: "Review this funds movement before closing the accounting period.",
          metadata: {
            reporting_category: transaction.reporting_category,
            transaction_type: transaction.type,
            available_on: transaction.available_on,
          },
        });
        continue;
      }

      matchedCount += 1;
      matchedInternal.add(`${match.type}:${match.id}`);
      const direction = transactionAmount < 0 ? -1 : 1;
      expectedInternalNet = roundMoney(
        expectedInternalNet + direction * match.amount - transaction.fee / 100,
      );
      const difference = roundMoney(absoluteAmount - match.amount);
      if (Math.abs(difference) > MONEY_TOLERANCE) {
        amountMismatchCount += 1;
        items.push({
          item_key: `amount:${transaction.id}`,
          severity: "high",
          mismatch_type: "amount_mismatch",
          transaction_category: category,
          stripe_balance_transaction_id: transaction.id,
          stripe_source_id: transactionSourceId,
          internal_record_type: match.type,
          internal_record_id: match.id,
          stripe_amount: absoluteAmount,
          internal_amount: match.amount,
          difference_amount: difference,
          currency: transaction.currency.toUpperCase(),
          title: `Stripe and TCOS ${category} amounts differ`,
          detail: "The matched records disagree beyond the one-cent tolerance.",
        });
      }
    }

    for (const order of internal.orders) {
      if (!order.stripe_charge_id || matchedInternal.has(`order:${order.id}`)) continue;
      items.push({
        item_key: `tcos:order:${order.id}`,
        severity: "critical",
        mismatch_type: "tcos_only",
        transaction_category: "charge",
        stripe_source_id: order.stripe_charge_id,
        internal_record_type: "order",
        internal_record_id: String(order.id),
        internal_amount: money(order.total),
        difference_amount: -money(order.total),
        title: "TCOS order has no Stripe balance transaction",
      });
    }

    const reconcilableObjects = internal.objects.filter(
      (object) =>
        object.object_type !== "refund" ||
        !["failed", "canceled"].includes(String(object.current_status)),
    );

    for (const object of reconcilableObjects) {
      const key = `${object.object_type}:${object.id}`;
      if (matchedInternal.has(key)) continue;
      items.push({
        item_key: `tcos:${object.object_type}:${object.id}`,
        severity: "high",
        mismatch_type: "tcos_only",
        transaction_category: String(object.object_type),
        stripe_source_id: String(object.provider_object_id),
        internal_record_type: String(object.object_type),
        internal_record_id: String(object.id),
        internal_amount: money(object.amount),
        difference_amount: -money(object.amount),
        title: `TCOS ${object.object_type} has no Stripe balance transaction`,
      });
    }

    for (const payout of internal.payouts) {
      if (!payout.provider_payout_reference || matchedInternal.has(`payout_request:${payout.id}`)) continue;
      const payoutAmount = money(payout.final_net_amount) || money(payout.requested_amount);
      items.push({
        item_key: `tcos:payout:${payout.id}`,
        severity: "high",
        mismatch_type: "tcos_only",
        transaction_category: "payout",
        stripe_source_id: String(payout.provider_payout_reference),
        internal_record_type: "payout_request",
        internal_record_id: String(payout.id),
        internal_amount: payoutAmount,
        difference_amount: -payoutAmount,
        title: "TCOS payout has no Stripe balance transaction",
      });
    }

    if (transactions.length >= MAX_STRIPE_TRANSACTIONS) {
      items.push({
        item_key: "volume_limit",
        severity: "critical",
        mismatch_type: "volume_limit",
        transaction_category: "all",
        title: "Stripe reconciliation transaction limit reached",
        detail: `Only the first ${MAX_STRIPE_TRANSACTIONS} transactions were checked. Split the window before resolving this alert.`,
      });
    }

    const tcosOrderGross = roundMoney(
      internal.orders
        .filter((row) => row.stripe_charge_id)
        .reduce((sum, row) => sum + money(row.total), 0),
    );
    const tcosRefunds = roundMoney(
      reconcilableObjects
        .filter((row) => row.object_type === "refund" && row.current_status === "succeeded")
        .reduce((sum, row) => sum + money(row.amount), 0),
    );
    const tcosDisputes = roundMoney(
      reconcilableObjects
        .filter((row) => row.object_type === "dispute")
        .reduce((sum, row) => sum + money(row.amount), 0),
    );
    const tcosPayouts = roundMoney(
      internal.payouts.reduce(
        (sum, row) =>
          sum + (money(row.final_net_amount) || money(row.requested_amount)),
        0,
      ),
    );
    const tcosPlatformFees = roundMoney(
      internal.fees.reduce((sum, row) => sum + money(row.platform_fee_amount), 0),
    );
    const tcosSellerPayable = roundMoney(
      internal.payables.reduce((sum, row) => sum + money(row.seller_payable_amount), 0),
    );
    const netDifference = roundMoney(stripeNet - expectedInternalNet);

    if (Math.abs(netDifference) > MONEY_TOLERANCE) {
      items.push({
        item_key: "aggregate:net",
        severity: "high",
        mismatch_type: "aggregate_difference",
        transaction_category: "net",
        stripe_amount: stripeNet,
        internal_amount: expectedInternalNet,
        difference_amount: netDifference,
        title: "Stripe net activity does not match TCOS activity",
        detail: "Resolve transaction-level alerts before closing this period.",
      });
    }

    if (items.length > 0) {
      const { error: itemError } = await params.supabase
        .from("stripe_reconciliation_items")
        .insert(items.map((item) => ({ ...item, run_id: runId, store_id: params.storeId })));
      if (itemError) throw itemError;
    }

    const criticalCount = items.filter((item) => item.severity === "critical").length;
    const warningCount = items.filter((item) => item.severity !== "info").length;
    const summary = {
      stripe_transaction_count: transactions.length,
      matched_count: matchedCount,
      open_alert_count: items.length,
      window_start: params.windowStart,
      window_end: params.windowEnd,
      category_totals: transactions.reduce((totals, transaction) => {
        const category = transactionCategory(transaction);
        totals[category] = roundMoney((totals[category] || 0) + transaction.amount / 100);
        return totals;
      }, {} as Record<string, number>),
      expected_internal_net: expectedInternalNet,
    };
    const status = items.length === 0 ? "balanced" : "differences_found";
    const completedAt = new Date().toISOString();
    const { error: updateError } = await params.supabase
      .from("stripe_reconciliation_runs")
      .update({
        run_status: status,
        stripe_transaction_count: transactions.length,
        matched_count: matchedCount,
        unmatched_count: items.filter((item) =>
          ["stripe_only", "tcos_only"].includes(item.mismatch_type),
        ).length,
        amount_mismatch_count: amountMismatchCount,
        warning_count: warningCount,
        critical_count: criticalCount,
        stripe_gross: stripeGross,
        stripe_fees: stripeFees,
        stripe_net: stripeNet,
        tcos_order_gross: tcosOrderGross,
        tcos_refunds: tcosRefunds,
        tcos_disputes: tcosDisputes,
        tcos_payouts: tcosPayouts,
        tcos_platform_fees: tcosPlatformFees,
        tcos_seller_payable: tcosSellerPayable,
        net_difference: netDifference,
        summary,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", runId);
    if (updateError) throw updateError;

    return { runId, status, replayed: false, summary };
  } catch (error: any) {
    await params.supabase
      .from("stripe_reconciliation_runs")
      .update({
        run_status: "failed",
        last_error: String(error.message || "Stripe reconciliation failed").slice(0, 1000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw error;
  }
}

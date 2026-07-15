import Link from "next/link";
import { PLATFORM_SOFTWARE_NAME } from "../../lib/legal";
import {
  buildShippingProviderSetupPacket,
  type ProviderSetupActionPlanStep,
} from "../../lib/shipping-provider-setup";
import {
  runLaunchGateDrill,
  type LaunchGatePostureStatus,
} from "../../lib/launch-gate-drill";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getStoreSettings } from "../../lib/store-settings";
import { getActiveStoreId } from "../../lib/stores";
import { isDryRunShippingReference } from "../../lib/shipping-dry-run";
import {
  isOrderReviewStatus,
  isPaidOrderStatus,
  isReadyToShipStatus,
} from "../../lib/order-status";
import { LIVE_MONEY_JSON_EVIDENCE } from "../../lib/live-money-evidence";
import { EMERGENCY_BACKUP_EVIDENCE } from "../../lib/emergency-backup-evidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: number;
  title: string | null;
  price: number | null;
  quantity: number | null;
  sport: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
  created_at: string;
};

type OfferRow = {
  id: number;
  status: string | null;
  offer_amount: number | null;
  customer_name: string | null;
  customer_email: string | null;
  created_at: string;
  products?: { title?: string | null; price?: number | null } | null;
};

type ReconciliationAlertRow = {
  id: string;
  title: string;
  severity: string;
  mismatch_type: string;
  difference_amount: number | null;
};

type SellerConnectRow = {
  id: string;
  account_id: string;
  provider_account_id: string;
  onboarding_status: string | null;
  payouts_enabled: boolean | null;
  details_submitted: boolean | null;
  requirements_currently_due: string[] | null;
  requirements_past_due: string[] | null;
  disabled_reason: string | null;
};

type OrderRow = {
  id: number;
  customer_email: string | null;
  total: number | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  tracking_number: string | null;
  carrier: string | null;
  item_count: number | null;
  created_at: string;
};

type OrderReviewCaseRow = {
  id: string;
  order_id: number;
  status: string | null;
  severity: string | null;
  case_type: string | null;
  title: string | null;
  updated_at: string | null;
};

type EvidenceRow = {
  id: string;
  order_id: number;
  status: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
};

type SyncDecisionRow = {
  decision: string | null;
  action: string | null;
  reason: string | null;
  product_title: string | null;
  sku: string | null;
  created_at: string;
};

type BlockedSyncSummaryRow = {
  reason: string | null;
  decision_count: number | null;
  latest_decision_at: string | null;
};

type PublicInventoryStatsRow = {
  total_products: number | null;
  in_stock_products: number | null;
  sold_out_products: number | null;
  ebay_linked_products: number | null;
  missing_sku_products: number | null;
  latest_ebay_seen_at: string | null;
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function percent(part: number, whole: number) {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function listValue(items: string[]) {
  return items.length > 0 ? items.join(", ") : "none";
}

function isPaid(order: OrderRow) {
  return isPaidOrderStatus(order.status);
}

function isReadyToShip(order: OrderRow) {
  return isReadyToShipStatus(order.status, order.fulfillment_status);
}

function isReview(order: OrderRow) {
  return isOrderReviewStatus(order.status, order.fulfillment_status);
}

function isShipped(order: OrderRow) {
  return order.fulfillment_status === "shipped";
}

function statusTone(status: string | null | undefined) {
  if (status === "paid" || status === "active" || status === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    status === "pending" ||
    status === "countered" ||
    status === "ready_to_ship" ||
    status === "shipping_review" ||
    status === "paid_shipping_review" ||
    status === "inventory_review" ||
    status === "paid_inventory_review"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "declined" || status === "sold" || status === "blocked") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function shippingSetupTone(status: string): "green" | "amber" | "rose" {
  if (status === "live_blocked") return "rose";
  if (status === "ready_for_live_adapter_build") return "green";
  return "amber";
}

function launchPostureTone(status: LaunchGatePostureStatus): "green" | "amber" | "rose" {
  if (status === "ready") return "green";
  if (status === "locked") return "amber";
  return "rose";
}

export default async function AdminDashboard() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [storeSettings, launchGateDrill] = await Promise.all([
    getStoreSettings(supabase, storeId),
    runLaunchGateDrill({ supabase, storeId }),
  ]);
  const shippingProviderSetup = buildShippingProviderSetupPacket();
  const shippingDecision = shippingProviderSetup.decision;

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [
    productsResult,
    offersResult,
    ordersResult,
    orderReviewCasesResult,
    evidenceResult,
    syncDecisionsResult,
    blockedSyncResult,
    inventoryStatsResult,
    reconciliationAlertsResult,
    sellerConnectResult,
  ] = await Promise.all([
      supabase
        .from("products")
        .select("id,title,price,quantity,sport,ebay_item_id,last_seen_at,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("offers")
        .select(
          "id,status,offer_amount,customer_name,customer_email,created_at,products(title,price)",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select(
          "id,customer_email,total,status,fulfillment_status,shipping_name,tracking_number,carrier,item_count,created_at",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_review_cases")
        .select("id,order_id,status,severity,case_type,title,updated_at")
        .eq("store_id", storeId)
        .order("updated_at", { ascending: false })
        .limit(25),
      supabase
        .from("transaction_evidence_reports")
        .select("id,order_id,status,email_sent_at,email_error,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("ebay_sync_decision_events")
        .select("decision,action,reason,product_title,sku,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("tcos_ebay_missing_sync_decision_summary")
        .select("reason,decision_count,latest_decision_at")
        .eq("store_id", storeId)
        .order("decision_count", { ascending: false })
        .limit(5),
      supabase
        .from("tcos_public_inventory_stats")
        .select(
          "total_products,in_stock_products,sold_out_products,ebay_linked_products,missing_sku_products,latest_ebay_seen_at",
        )
        .eq("store_id", storeId)
        .maybeSingle(),
      supabase
        .from("stripe_reconciliation_items")
        .select("id,title,severity,mismatch_type,difference_amount")
        .eq("store_id", storeId)
        .eq("item_status", "open")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("seller_payout_accounts")
        .select(
          "id,account_id,provider_account_id,onboarding_status,payouts_enabled,details_submitted,requirements_currently_due,requirements_past_due,disabled_reason",
        )
        .eq("store_id", storeId)
        .eq("provider", "stripe_connect")
        .order("updated_at", { ascending: false })
        .limit(25),
    ]);

  const products = (productsResult.data || []) as ProductRow[];
  const offers = (offersResult.data || []) as OfferRow[];
  const orders = (ordersResult.data || []) as OrderRow[];
  const orderReviewCases =
    (orderReviewCasesResult.data || []) as OrderReviewCaseRow[];
  const evidenceReports = (evidenceResult.data || []) as EvidenceRow[];
  const syncDecisions = (syncDecisionsResult.data || []) as SyncDecisionRow[];
  const blockedSyncRows = (blockedSyncResult.data || []) as BlockedSyncSummaryRow[];
  const inventoryStats =
    (inventoryStatsResult.data as PublicInventoryStatsRow | null) ?? null;
  const reconciliationAlerts =
    (reconciliationAlertsResult.data || []) as ReconciliationAlertRow[];
  const sellerConnectAccounts =
    (sellerConnectResult.data || []) as SellerConnectRow[];
  const syncPolicyAvailable =
    !syncDecisionsResult.error &&
    !blockedSyncResult.error &&
    !inventoryStatsResult.error;

  const paidOrders = orders.filter(isPaid);
  const readyOrders = orders.filter(isReadyToShip);
  const reviewOrders = orders.filter(isReview);
  const activeOrderReviewCases = orderReviewCases.filter(
    (reviewCase) =>
      !["decided_for_buyer", "decided_for_seller", "closed"].includes(
        reviewCase.status || "open",
      ),
  );
  const criticalOrderReviewCases = activeOrderReviewCases.filter(
    (reviewCase) => reviewCase.severity === "critical",
  );
  const shippedOrders = orders.filter(isShipped);
  const dryRunShippingOrders = orders.filter((order) =>
    isDryRunShippingReference(order.tracking_number),
  );
  const pendingOffers = offers.filter((offer) => offer.status === "pending");
  const counteredOffers = offers.filter((offer) => offer.status === "countered");
  const activeProducts = products.filter((product) => Number(product.quantity || 0) > 0);
  const soldOutProducts = products.filter((product) => Number(product.quantity || 0) <= 0);
  const lowInventory = activeProducts.filter(
    (product) => Number(product.quantity || 0) <= 1,
  );
  const ebayLinked = products.filter((product) => product.ebay_item_id);
  const evidenceErrors = evidenceReports.filter((report) => report.email_error);
  const recentPolicyBlocked = syncDecisions.filter(
    (decision) => decision.decision === "blocked_by_tcos_policy",
  );
  const recentNeedsReview = syncDecisions.filter(
    (decision) => decision.decision === "needs_review",
  );
  const blockedSyncTotal = blockedSyncRows.reduce(
    (sum, row) => sum + Number(row.decision_count || 0),
    0,
  );
  const sellerConnectUnavailable = Boolean(sellerConnectResult.error);
  const sellerConnectNeedsAction = sellerConnectAccounts.filter(
    (account) =>
      account.onboarding_status !== "active" ||
      account.payouts_enabled !== true ||
      account.details_submitted !== true ||
      (account.requirements_currently_due || []).length > 0 ||
      (account.requirements_past_due || []).length > 0 ||
      Boolean(account.disabled_reason),
  );

  const revenueToday = paidOrders
    .filter((order) => new Date(order.created_at) >= today)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const revenueMonth = paidOrders
    .filter((order) => new Date(order.created_at) >= monthStart)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const allTimeRevenue = paidOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0,
  );
  const averageOrder =
    paidOrders.length > 0 ? allTimeRevenue / paidOrders.length : 0;
  const inventoryValue = activeProducts.reduce(
    (sum, product) =>
      sum + Number(product.price || 0) * Number(product.quantity || 0),
    0,
  );

  const latestEbaySeen = ebayLinked
    .map((product) => product.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  const opsAlerts = [
    readyOrders.length > 0
      ? `${readyOrders.length} paid order${readyOrders.length === 1 ? "" : "s"} ready to ship`
      : "No paid orders waiting on fulfillment",
    reviewOrders.length > 0
      ? `${reviewOrders.length} paid order${reviewOrders.length === 1 ? "" : "s"} held for review`
      : "No paid orders held for review",
    dryRunShippingOrders.length > 0
      ? `${dryRunShippingOrders.length} order${
          dryRunShippingOrders.length === 1 ? "" : "s"
        } still have dry-run shipping references`
      : "No dry-run tracking references visible on orders",
    activeOrderReviewCases.length > 0
      ? `${activeOrderReviewCases.length} order case${activeOrderReviewCases.length === 1 ? "" : "s"} open in the case queue`
      : "Order case queue is clear",
    criticalOrderReviewCases.length > 0
      ? `${criticalOrderReviewCases.length} critical case${criticalOrderReviewCases.length === 1 ? "" : "s"} need immediate review`
      : "No critical order cases open",
    pendingOffers.length > 0
      ? `${pendingOffers.length} offer${pendingOffers.length === 1 ? "" : "s"} need review`
      : "Offer queue is clear",
    lowInventory.length > 0
      ? `${lowInventory.length} product${lowInventory.length === 1 ? "" : "s"} at one unit`
      : "No low-stock warnings",
    evidenceErrors.length > 0
      ? `${evidenceErrors.length} evidence email issue${evidenceErrors.length === 1 ? "" : "s"}`
      : "Evidence packet emails show no recent errors",
    !syncPolicyAvailable
      ? "eBay sync policy summary is not available"
      : blockedSyncTotal > 0
      ? `${blockedSyncTotal} eBay sync policy block${blockedSyncTotal === 1 ? "" : "s"} need review`
      : "eBay sync policy blocks are clear",
    sellerConnectUnavailable
      ? "Seller Connect readiness is not available"
      : sellerConnectNeedsAction.length > 0
      ? `${sellerConnectNeedsAction.length} seller Connect account${
          sellerConnectNeedsAction.length === 1 ? "" : "s"
        } need onboarding action`
      : "Seller Connect onboarding is clear",
    `Shipping setup verdict: ${label(shippingDecision.status)} - ${shippingDecision.summary}`,
  ];

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              {PLATFORM_SOFTWARE_NAME}
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              {storeSettings.displayName} Command Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Store #{storeSettings.storeId.slice(-4)} operational control for
              inventory, payments, offers, fulfillment, evidence, and launch
              readiness.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandButton href="/admin/products/new" label="Add Product" primary />
            <CommandButton href="/admin/inventory" label="Inventory V2" />
            <CommandButton href="/admin/accounts" label="Accounts" />
            <CommandButton href="/admin/order-review-cases" label="Cases" />
            <CommandButton href="/admin/shipping" label="Shipping" />
            <CommandButton href="/admin/seller-payouts" label="Payouts" />
            <CommandButton href="/admin/financial-reconciliation" label="Money Audit" />
            <CommandButton href="/admin/payment-simulations" label="Payment Tests" />
            <CommandButton href="/admin/ebay" label="eBay Health" />
            <CommandButton href="/admin/settings" label="Settings" />
            <CommandButton href="/admin/security" label="Security" />
            <CommandButton href="/admin/ebay/sync-control" label="Sync Control" />
            <CommandButton href="/admin/launch-readiness" label="Readiness" />
            <CommandButton href="/admin/launch-gate-drill" label="Gate Drill" />
            <CommandButton href="/admin/logout" label="Logout" danger />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="Revenue Today" value={money(revenueToday)} detail="Paid orders since midnight" />
          <MetricTile label="Revenue Month" value={money(revenueMonth)} detail="Paid orders this month" />
          <MetricTile label="Inventory Value" value={money(inventoryValue)} detail={`${activeProducts.length} active products`} />
          <MetricTile label="Average Order" value={money(averageOrder)} detail={`${paidOrders.length} paid orders tracked`} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 p-5">
              <div>
                <h2 className="text-2xl font-black">Operations Board</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Live queues that need attention before money, inventory, or
                  customer trust gets messy.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Pill label={`${readyOrders.length} ready`} tone="amber" />
                <Pill label={`${reviewOrders.length} review`} tone="amber" />
                {dryRunShippingOrders.length > 0 ? (
                  <Pill label={`${dryRunShippingOrders.length} dry-run ship`} tone="rose" />
                ) : null}
                <Pill label={`${pendingOffers.length} offers`} tone="amber" />
                <Pill label={`${lowInventory.length} low stock`} tone="rose" />
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-neutral-200 lg:grid-cols-6 lg:divide-x lg:divide-y-0">
              <QueuePanel
                title="Fulfillment"
                href="/admin/orders"
                empty="No orders waiting to ship."
                rows={readyOrders.slice(0, 5).map((order) => ({
                  key: String(order.id),
                  title: `Order #${order.id}`,
                  meta: order.customer_email || "No customer email",
                  value: money(order.total),
                  href: `/admin/orders/${order.id}`,
                }))}
              />
              <QueuePanel
                title="Order Review"
                href="/admin/order-review-cases"
                empty="No order cases or paid review holds."
                rows={[
                  ...activeOrderReviewCases.slice(0, 3).map((reviewCase) => ({
                    key: `case-${reviewCase.id}`,
                    title: reviewCase.title || `Case ${reviewCase.id}`,
                    meta: `${label(reviewCase.case_type)} / ${label(
                      reviewCase.severity,
                    )}`,
                    value: label(reviewCase.status),
                    href: `/admin/order-review-cases?status=${
                      reviewCase.status || "open"
                    }`,
                  })),
                  ...reviewOrders.slice(0, 2).map((order) => ({
                    key: `order-${order.id}`,
                    title: `Order #${order.id}`,
                    meta: label(order.fulfillment_status || order.status),
                    value: money(order.total),
                    href: `/admin/orders/${order.id}`,
                  })),
                ].slice(0, 5)}
              />
              <QueuePanel
                title="Offer Desk"
                href="/admin/offers"
                empty="No pending offers."
                rows={[...pendingOffers, ...counteredOffers].slice(0, 5).map((offer) => ({
                  key: String(offer.id),
                  title: offer.products?.title || "Unknown product",
                  meta: offer.customer_name || offer.customer_email || "No customer",
                  value: money(offer.offer_amount),
                }))}
              />
              <QueuePanel
                title="Inventory Watch"
                href="/admin/products"
                empty="No low-stock products."
                rows={lowInventory.slice(0, 5).map((product) => ({
                  key: String(product.id),
                  title: product.title || `Product #${product.id}`,
                  meta: product.ebay_item_id ? "eBay linked" : "Local only",
                  value: `${Number(product.quantity || 0)} left`,
                  href: `/admin/products/${product.id}`,
                }))}
              />
              <QueuePanel
                title="Money Audit"
                href="/admin/financial-reconciliation"
                empty="No unmatched Stripe money."
                rows={reconciliationAlerts.map((alert) => ({
                  key: alert.id,
                  title: alert.title,
                  meta: `${label(alert.severity)} / ${label(alert.mismatch_type)}`,
                  value: money(alert.difference_amount),
                  href: "/admin/financial-reconciliation",
                }))}
              />
              <QueuePanel
                title="Seller Connect"
                href="/admin/seller-payouts"
                empty={
                  sellerConnectUnavailable
                    ? "Connect readiness table is unavailable."
                    : "No seller onboarding action needed."
                }
                rows={sellerConnectNeedsAction.slice(0, 5).map((account) => {
                  const dueCount =
                    (account.requirements_currently_due || []).length +
                    (account.requirements_past_due || []).length;

                  return {
                    key: account.id,
                    title: account.provider_account_id,
                    meta:
                      dueCount > 0
                        ? `${dueCount} Stripe requirement${dueCount === 1 ? "" : "s"}`
                        : label(account.onboarding_status),
                    value: account.payouts_enabled ? "Review" : "Blocked",
                    href: "/admin/seller-payouts",
                  };
                })}
              />
            </div>
          </div>

          <aside className="space-y-6">
            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Store Stack</h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    Active TCOS store context.
                  </p>
                </div>
                <Pill
                  label={storeSettings.source === "database" ? "DB settings" : "fallback"}
                  tone={storeSettings.source === "database" ? "green" : "amber"}
                />
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <InfoLine label="Legal" value={storeSettings.legalName || "Not set"} />
                <InfoLine label="Status" value={label(storeSettings.status)} />
                <InfoLine label="eBay" value={storeSettings.ebayEnvironment} />
                <InfoLine label="Stripe" value={storeSettings.stripeMode} />
                <InfoLine label="Support" value={storeSettings.supportEmail} />
                <InfoLine
                  label="Commission"
                  value={`${(storeSettings.sellerCommissionRate * 100).toFixed(2)}%`}
                />
              </dl>
            </section>

            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Launch Locks</h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    Runtime posture from the no-money gate drill.
                  </p>
                </div>
                <Pill
                  label={
                    launchGateDrill.summary.failed === 0
                      ? "DRILL PASS"
                      : "DRILL FAIL"
                  }
                  tone={launchGateDrill.summary.failed === 0 ? "green" : "rose"}
                />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase text-neutral-500">
                        Payment
                      </p>
                      <p className="mt-1 font-black">
                        {launchGateDrill.posture.payment.label}
                      </p>
                    </div>
                    <Pill
                      label={launchGateDrill.posture.payment.status.toUpperCase()}
                      tone={launchPostureTone(
                        launchGateDrill.posture.payment.status,
                      )}
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-neutral-600">
                    {launchGateDrill.payment.paymentMode.toUpperCase()} mode,
                    live payments{" "}
                    {launchGateDrill.payment.livePaymentsEnabled
                      ? "enabled"
                      : "locked"}
                    .
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <MiniLaunchCount
                      label="approval blockers"
                      value={launchGateDrill.payment.approvalBlockingCount}
                      tone={
                        launchGateDrill.payment.approvalBlockingCount > 0
                          ? "rose"
                          : "green"
                      }
                    />
                    <MiniLaunchCount
                      label="launch locks"
                      value={launchGateDrill.payment.launchLockCount}
                      tone={
                        launchGateDrill.payment.livePaymentsEnabled
                          ? "green"
                          : "amber"
                      }
                    />
                    <MiniLaunchCount
                      label="warnings"
                      value={launchGateDrill.payment.warningCount}
                      tone={
                        launchGateDrill.payment.warningCount > 0
                          ? "amber"
                          : "green"
                      }
                    />
                  </div>
                  <p className="mt-3 text-xs font-black text-neutral-700">
                    Live money runway: {launchGateDrill.payment.operatorSummary}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-neutral-600">
                    Next live-money action:{" "}
                    {launchGateDrill.payment.nextActions[0] ||
                      "Monitor Stripe webhooks, reconciliation, refunds, disputes, seller payout holds, and emergency revocation readiness."}
                  </p>
                  <div className="mt-3 rounded border border-emerald-200 bg-white p-3 text-xs text-neutral-700">
                    <p className="font-black text-emerald-800">
                      {LIVE_MONEY_JSON_EVIDENCE.title}
                    </p>
                    <p className="mt-1 font-semibold">
                      Archive{" "}
                      <code>{LIVE_MONEY_JSON_EVIDENCE.statusCommand}</code>{" "}
                      after smoke or write a timestamped file with{" "}
                      <code>{LIVE_MONEY_JSON_EVIDENCE.archiveCommand}</code>;
                      run{" "}
                      <code>{LIVE_MONEY_JSON_EVIDENCE.preflightCommand}</code>{" "}
                      or{" "}
                      <code>
                        {LIVE_MONEY_JSON_EVIDENCE.preflightArchiveCommand}
                      </code>{" "}
                      in the final go-live window before changing{" "}
                      <code>TCOS_LIVE_PAYMENTS_ENABLED</code>.
                    </p>
                    <p className="mt-1 font-semibold">
                      Accepted states:{" "}
                      <span className="font-mono">
                        {LIVE_MONEY_JSON_EVIDENCE.readyStates.join(", ")}
                      </span>
                      . Halt states:{" "}
                      <span className="font-mono">
                        {LIVE_MONEY_JSON_EVIDENCE.blockedStates.join(", ")}
                      </span>
                      .
                    </p>
                    <p className="mt-1 font-semibold">
                      Schema:{" "}
                      <code>{LIVE_MONEY_JSON_EVIDENCE.schema}</code>.{" "}
                      Archive directory:{" "}
                      <code>{LIVE_MONEY_JSON_EVIDENCE.archiveDirectory}</code>.{" "}
                      {LIVE_MONEY_JSON_EVIDENCE.readOnlyGuarantee}
                    </p>
                    <p className="mt-1 font-semibold">
                      Supabase bootstrap environment:{" "}
                      <span className="font-mono">
                        {LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.supabaseBootstrap.join(
                          "; ",
                        )}
                      </span>
                      .
                    </p>
                    <p className="mt-1 font-semibold">
                      Final live-payment runtime environment:{" "}
                      <span className="font-mono">
                        {LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.finalLivePaymentRuntime.join(
                          "; ",
                        )}
                      </span>
                      .
                    </p>
                  </div>
                  <div className="mt-3 rounded border border-cyan-200 bg-white p-3 text-xs text-neutral-700">
                    <p className="font-black text-cyan-800">
                      {EMERGENCY_BACKUP_EVIDENCE.title}
                    </p>
                    <p className="mt-1 font-semibold">
                      Preserve backup proof with{" "}
                      <code>{EMERGENCY_BACKUP_EVIDENCE.runwayArchiveCommand}</code>;
                      drill the lane directly with{" "}
                      <code>{EMERGENCY_BACKUP_EVIDENCE.statusArchiveCommand}</code>{" "}
                      and{" "}
                      <code>
                        {EMERGENCY_BACKUP_EVIDENCE.verificationArchiveCommand}
                      </code>
                      .
                    </p>
                    <p className="mt-1 font-semibold">
                      Accepted backup posture:{" "}
                      {EMERGENCY_BACKUP_EVIDENCE.acceptedStatus}
                    </p>
                    <p className="mt-1 font-semibold">
                      Schemas:{" "}
                      <code>{EMERGENCY_BACKUP_EVIDENCE.statusSchema}</code>,{" "}
                      <code>{EMERGENCY_BACKUP_EVIDENCE.verificationSchema}</code>,
                      and <code>{EMERGENCY_BACKUP_EVIDENCE.runwaySchema}</code>.
                      Evidence directories:{" "}
                      <code>
                        {EMERGENCY_BACKUP_EVIDENCE.statusArchiveDirectory}
                      </code>
                      ,{" "}
                      <code>
                        {EMERGENCY_BACKUP_EVIDENCE.verificationArchiveDirectory}
                      </code>
                      ,{" "}
                      <code>
                        {EMERGENCY_BACKUP_EVIDENCE.runwayArchiveDirectory}
                      </code>
                      .
                    </p>
                    <p className="mt-1 font-semibold">
                      {EMERGENCY_BACKUP_EVIDENCE.retentionWindow}{" "}
                      {EMERGENCY_BACKUP_EVIDENCE.readOnlyGuarantee}{" "}
                      {EMERGENCY_BACKUP_EVIDENCE.sideEffectBoundary}
                    </p>
                  </div>
                </div>

                <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase text-neutral-500">
                        Shipping
                      </p>
                      <p className="mt-1 font-black">
                        {launchGateDrill.posture.shipping.label}
                      </p>
                    </div>
                    <Pill
                      label={launchGateDrill.posture.shipping.status.toUpperCase()}
                      tone={launchPostureTone(
                        launchGateDrill.posture.shipping.status,
                      )}
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-neutral-600">
                    {launchGateDrill.shipping.purchaseMode.toUpperCase()} mode,
                    live shipping{" "}
                    {launchGateDrill.shipping.liveShippingEnabled
                      ? "enabled"
                      : "locked"}
                    .
                  </p>
                  <p className="mt-1 text-xs font-black text-neutral-700">
                    Standard Envelope evidence validator is{" "}
                    {launchGateDrill.shipping.standardEnvelopeEvidenceContractReady
                      ? "ready"
                      : "blocked"}
                    .
                  </p>
                  <p className="mt-1 text-xs font-black text-neutral-700">
                    Purchase-audit key drift: missing{" "}
                    {listValue(
                      launchGateDrill.shipping
                        .purchaseAttemptAuditMissingScenarioKeys,
                    )}
                    ; unexpected{" "}
                    {listValue(
                      launchGateDrill.shipping
                        .purchaseAttemptAuditUnexpectedScenarioKeys,
                    )}
                    .
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <LinkButton href="/admin/launch-gate-drill" label="Gate Drill" />
                <LinkButton href="/admin/launch-readiness" label="Readiness" />
                <LinkButton href="/admin/live-payment-launch" label="Pay Gate" />
                <LinkButton href="/admin/live-shipping-launch" label="Ship Gate" />
                <LinkButton href="/api/admin/launch-readiness" label="Brief JSON" />
                <LinkButton
                  href="/api/admin/launch-readiness?format=markdown"
                  label="Brief MD"
                />
                <LinkButton
                  href="/api/admin/launch-readiness?format=handoff-bundle"
                  label="Hand-off Bundle"
                />
                <LinkButton href="/admin/production-smoke" label="Smoke Report" />
              </div>
            </section>

            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <h2 className="text-xl font-black">Command Links</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <LinkButton href="/admin/products" label="Products" />
                <LinkButton href="/admin/inventory" label="Inventory V2" />
                <LinkButton href="/admin/ebay" label="eBay" />
                <LinkButton href="/admin/settings" label="Settings" />
                <LinkButton href="/admin/security" label="Security" />
                <LinkButton href="/admin/accounts" label="Accounts" />
                <LinkButton href="/admin/order-review-cases" label="Cases" />
                <LinkButton href="/admin/shipping" label="Shipping" />
                <LinkButton href="/admin/seller-payouts" label="Payouts" />
                <LinkButton href="/admin/financial-reconciliation" label="Money Audit" />
                <LinkButton href="/admin/payment-simulations" label="Payment Tests" />
                <LinkButton href="/admin/production-smoke" label="Prod Smoke" />
                <LinkButton href="/admin/orders" label="Orders" />
                <LinkButton href="/admin/offers" label="Offers" />
                <LinkButton href="/admin/files" label="Files" />
                <LinkButton href="/admin/launch-readiness" label="Launch" />
                <LinkButton href="/admin/launch-gate-drill" label="Gate Drill" />
                <LinkButton href="/shop" label="Shop" />
              </div>
            </section>

            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Shipping Setup</h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    Shared go/no-go verdict for provider setup.
                  </p>
                </div>
                <Pill
                  label={label(shippingDecision.status)}
                  tone={shippingSetupTone(shippingDecision.status)}
                />
              </div>
              <p className="mt-4 text-sm font-semibold text-neutral-700">
                {shippingDecision.summary}
              </p>
              <p className="mt-2 text-xs font-bold text-neutral-600">
                {shippingDecision.nextAction}
              </p>
              <p className="mt-2 text-xs font-black text-neutral-700">
                Standard Envelope evidence validator:{" "}
                {shippingProviderSetup.standardEnvelopeEvidenceContractReady
                  ? "ready"
                  : "blocked"}
                .
              </p>
              {shippingDecision.blockers.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {shippingDecision.blockers.slice(0, 4).map((blocker) => (
                    <span
                      key={blocker}
                      className="rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-black text-neutral-700"
                    >
                      {blocker}
                    </span>
                  ))}
                </div>
              ) : null}
              <ShippingProviderUnlockPlan
                actionPlan={shippingProviderSetup.actionPlan}
              />
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <LinkButton href="/admin/shipping" label="Shipping Ops" />
                <LinkButton href="/admin/launch-readiness" label="Readiness" />
                <LinkButton href="/admin/launch-gate-drill" label="Gate Drill" />
                <LinkButton
                  href="/api/admin/shipping/provider-setup"
                  label="Setup JSON"
                />
                <LinkButton
                  href="/api/admin/shipping/provider-setup?format=env-template"
                  label="Env Template"
                />
                <LinkButton
                  href="/api/admin/shipping/provider-setup?format=vercel-commands"
                  label="Vercel Commands"
                />
                <LinkButton
                  href="/api/admin/shipping/provider-setup?format=operator-checklist"
                  label="Checklist"
                />
              </div>
            </section>
          </aside>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-4">
          <StatusPanel
            title="Sales Pulse"
            rows={[
              ["Paid orders", String(paidOrders.length)],
              ["Ready to ship", String(readyOrders.length)],
              ["Needs review", String(reviewOrders.length)],
              ["Shipped", String(shippedOrders.length)],
              ["Fulfillment rate", percent(shippedOrders.length, paidOrders.length)],
            ]}
          />
          <StatusPanel
            title="Inventory Pulse"
            rows={[
              ["Active products", String(inventoryStats?.in_stock_products ?? activeProducts.length)],
              ["Sold out / zero", String(inventoryStats?.sold_out_products ?? soldOutProducts.length)],
              [
                "eBay linked",
                `${inventoryStats?.ebay_linked_products ?? ebayLinked.length} (${percent(
                  inventoryStats?.ebay_linked_products ?? ebayLinked.length,
                  inventoryStats?.total_products ?? products.length,
                )})`,
              ],
              ["Last eBay seen", shortDate(inventoryStats?.latest_ebay_seen_at || latestEbaySeen || null)],
            ]}
          />
          <StatusPanel
            title="eBay Sync Policy"
            rows={[
              ["Status", syncPolicyAvailable ? "Available" : "Not available"],
              ["Missing SKU", String(inventoryStats?.missing_sku_products ?? 0)],
              ["Recent blocked", String(recentPolicyBlocked.length)],
              ["Recent needs review", String(recentNeedsReview.length)],
            ]}
          />
          <StatusPanel
            title="Trust And Evidence"
            rows={[
              ["Evidence reports", String(evidenceReports.length)],
              ["Recent email errors", String(evidenceErrors.length)],
              ["Evidence inbox", storeSettings.evidenceEmail || "Not configured"],
              ["Settings source", storeSettings.source],
            ]}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md border border-neutral-200 bg-white p-5">
            <h2 className="text-xl font-black">Operator Alerts</h2>
            <div className="mt-4 space-y-3">
              {opsAlerts.map((alert) => (
                <div
                  key={alert}
                  className="border-l-4 border-neutral-900 bg-neutral-50 px-4 py-3 text-sm font-semibold"
                >
                  {alert}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-xl font-black">Latest Orders</h2>
            </div>
            <div className="divide-y divide-neutral-200">
              {orders.slice(0, 6).length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">No orders yet.</p>
              ) : (
                orders.slice(0, 6).map((order) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="grid gap-2 p-4 text-sm hover:bg-neutral-50 md:grid-cols-[1fr_auto_auto]"
                  >
                    <div>
                      <p className="font-bold">Order #{order.id}</p>
                      <p className="text-neutral-600">
                        {order.customer_email || "No customer email"}
                      </p>
                    </div>
                    <span className={`w-fit rounded border px-2 py-1 text-xs font-bold ${statusTone(order.fulfillment_status || order.status)}`}>
                      {label(order.fulfillment_status || order.status)}
                    </span>
                    <p className="font-black">{money(order.total)}</p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
              <div>
                <h2 className="text-xl font-black">Recent eBay Policy Decisions</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Latest local TCOS import decisions from the eBay sync guard.
                </p>
              </div>
              <Link
                href="/admin/ebay/sync-control"
                className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-bold hover:bg-white"
              >
                Open Sync Control
              </Link>
            </div>
            <div className="divide-y divide-neutral-200">
              {!syncPolicyAvailable ? (
                <p className="p-5 text-sm font-semibold text-amber-800">
                  Apply the eBay sync decision migration to enable policy
                  decision history.
                </p>
              ) : syncDecisions.length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">
                  No eBay sync policy decisions recorded yet.
                </p>
              ) : (
                syncDecisions.map((decision) => (
                  <div
                    key={`${decision.created_at}-${decision.sku || decision.reason}`}
                    className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-bold">
                        {decision.product_title || decision.sku || "Unknown listing"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {label(decision.action)} / {label(decision.reason)} /{" "}
                        {shortDate(decision.created_at)}
                      </p>
                    </div>
                    <span className={`h-fit w-fit rounded border px-2 py-1 text-xs font-black ${statusTone(decision.decision)}`}>
                      {label(decision.decision)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 bg-white p-5">
            <h2 className="text-xl font-black">Blocked Sync Reasons</h2>
            <div className="mt-4 space-y-3">
              {!syncPolicyAvailable ? (
                <p className="text-sm font-semibold text-amber-800">
                  Policy summary view is not available yet.
                </p>
              ) : blockedSyncRows.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No blocked eBay sync reasons recorded.
                </p>
              ) : (
                blockedSyncRows.map((row) => (
                  <div
                    key={row.reason || "blocked_reason"}
                    className="rounded-md border border-neutral-200 bg-neutral-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold">{label(row.reason)}</p>
                      <p className="text-lg font-black">
                        {Number(row.decision_count || 0)}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-neutral-600">
                      Latest: {shortDate(row.latest_decision_at)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-neutral-600">{detail}</p>
    </div>
  );
}

function ShippingProviderUnlockPlan({
  actionPlan,
}: {
  actionPlan: ProviderSetupActionPlanStep[];
}) {
  return (
    <div className="mt-4 rounded border border-indigo-200 bg-indigo-50 p-3 text-indigo-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest opacity-70">
            No-secret handoff
          </p>
          <h3 className="mt-1 text-sm font-black">
            Shipping Provider Unlock Action Plan
          </h3>
        </div>
        <Link
          href="/api/admin/shipping/provider-setup?format=operator-checklist"
          className="rounded border border-indigo-300 bg-white px-2 py-1 text-[11px] font-black"
        >
          Checklist
        </Link>
      </div>
      <ol className="mt-3 space-y-2">
        {actionPlan.slice(0, 3).map((step) => (
          <li
            key={step.order}
            className="rounded border border-indigo-100 bg-white p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black">
                {step.order}. {step.title}
              </p>
              <span className="rounded border border-current px-1.5 py-0.5 text-[10px] font-black uppercase">
                {step.status}
              </span>
            </div>
            <p className="mt-1 text-[11px] font-semibold opacity-80">
              {step.action}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] font-bold opacity-80">
        Open Shipping Ops, Launch Readiness, Live Shipping Gate, or Gate Drill
        for the full five-step unlock sequence.
      </p>
    </div>
  );
}

function CommandButton({
  href,
  label,
  primary,
  danger,
}: {
  href: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : danger
    ? "border border-rose-400 text-rose-200 hover:bg-rose-950"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link href={href} className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}>
      {label}
    </Link>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "rose";
}) {
  const className =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-rose-200 bg-rose-50 text-rose-800";

  return (
    <span className={`rounded border px-2.5 py-1 text-xs font-black ${className}`}>
      {label}
    </span>
  );
}

function MiniLaunchCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "rose";
}) {
  const className =
    tone === "green"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : "text-rose-700";

  return (
    <div className="rounded border border-neutral-200 bg-white px-2 py-1.5">
      <p className={`text-lg font-black ${className}`}>{value}</p>
      <p className="text-[10px] font-black uppercase leading-tight text-neutral-500">
        {label}
      </p>
    </div>
  );
}

function QueuePanel({
  title,
  href,
  empty,
  rows,
}: {
  title: string;
  href: string;
  empty: string;
  rows: Array<{
    key: string;
    title: string;
    meta: string;
    value: string;
    href?: string;
  }>;
}) {
  return (
    <div className="min-h-[320px] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-black">{title}</h3>
        <Link href={href} className="text-sm font-bold underline">
          Open
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{empty}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const content = (
              <>
                <div className="min-w-0">
                  <p className="truncate font-bold">{row.title}</p>
                  <p className="truncate text-xs text-neutral-600">{row.meta}</p>
                </div>
                <p className="shrink-0 text-sm font-black">{row.value}</p>
              </>
            );

            return row.href ? (
              <Link
                key={row.key}
                href={row.href}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3 hover:bg-neutral-50"
              >
                {content}
              </Link>
            ) : (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="font-bold text-neutral-500">{label}</dt>
      <dd className="break-words font-semibold">{value}</dd>
    </div>
  );
}

function LinkButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-center font-bold hover:bg-white"
    >
      {label}
    </Link>
  );
}

function StatusPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-5">
      <h2 className="text-xl font-black">{title}</h2>
      <dl className="mt-4 divide-y divide-neutral-200 text-sm">
        {rows.map(([labelText, value]) => (
          <div key={labelText} className="flex items-center justify-between gap-4 py-3">
            <dt className="font-semibold text-neutral-600">{labelText}</dt>
            <dd className="break-words text-right font-black">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

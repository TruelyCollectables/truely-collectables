import Link from "next/link";
import AdminSubmitButton from "./AdminSubmitButton";
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
import { createAdminSessionValue } from "../../lib/admin-session";
import { addAdminHandoff } from "../../lib/admin-handoff";
import { getMarketIntelPurchaseLedger } from "../../lib/market-intel";

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

type SalesCompSnapshotRow = {
  id: number;
  legacy_product_id: number;
  query: string | null;
  suggested_price: number | null;
  suggested_price_method: string | null;
  average_price: number | null;
  median_price: number | null;
  comp_count: number | null;
  recent_comp_count: number | null;
  source_status: string | null;
  created_at: string;
};

type InstaCompPriceRadarIgnoreRow = {
  legacy_product_id: number;
  ignore_until: string | null;
  ignore_forever: boolean | null;
  updated_at: string | null;
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

function signedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)}%`;
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

function priceRadarTone(deltaPercent: number): "green" | "amber" | "rose" {
  const absoluteDelta = Math.abs(deltaPercent);

  if (absoluteDelta <= 5) return "green";
  if (absoluteDelta <= 15) return "amber";
  return "rose";
}

type QueuePanelRow = {
  key: string;
  title: string;
  meta: string;
  value: string;
  href?: string;
};

type AdminTone = "green" | "amber" | "rose";

type AdminDataHealthIssue = {
  key: string;
  label: string;
  message: string;
  href: string;
};

type AttentionPanelRow = {
  key: string;
  eyebrow: string;
  title: string;
  detail: string;
  value: string;
  href: string;
  tone: AdminTone;
};

function addAdminHandoffToRows(
  rows: QueuePanelRow[],
  adminHref: (href: string) => string,
) {
  return rows.map((row) => ({
    ...row,
    href: row.href ? adminHref(row.href) : row.href,
  }));
}

function adminDataIssue(
  key: string,
  label: string,
  error: unknown,
  href = "/admin/production-smoke",
): AdminDataHealthIssue | null {
  if (!error) return null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";
  const cleanMessage = message.trim();

  return {
    key,
    label,
    href,
    message: cleanMessage
      ? cleanMessage.slice(0, 180)
      : "This admin data source did not return a healthy response.",
  };
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
  const adminDashboardHandoff = await createAdminSessionValue();
  const adminHref = (href: string) => addAdminHandoff(href, adminDashboardHandoff);

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
    salesCompSnapshotsResult,
    priceRadarIgnoresResult,
    marketIntelResult,
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
      supabase
        .from("sales_comp_snapshots")
        .select(
          "id,legacy_product_id,query,suggested_price,suggested_price_method,average_price,median_price,comp_count,recent_comp_count,source_status,created_at",
        )
        .eq("store_id", storeId)
        .not("suggested_price", "is", null)
        .gt("suggested_price", 0)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("instacomp_price_radar_ignores")
        .select("legacy_product_id,ignore_until,ignore_forever,updated_at")
        .eq("store_id", storeId),
      getMarketIntelPurchaseLedger()
        .then((data) => ({ data, error: null as Error | null }))
        .catch((error: unknown) => ({
          data: [],
          error:
            error instanceof Error
              ? error
              : new Error("Unable to load Market Intel purchases."),
        })),
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
  const salesCompSnapshots =
    (salesCompSnapshotsResult.data || []) as SalesCompSnapshotRow[];
  const priceRadarIgnores =
    (priceRadarIgnoresResult.data || []) as InstaCompPriceRadarIgnoreRow[];
  const marketIntelRows = marketIntelResult.data;
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
  const productById = new Map(products.map((product) => [product.id, product]));
  const latestCompByProduct = new Map<number, SalesCompSnapshotRow>();

  for (const snapshot of salesCompSnapshots) {
    const productId = Number(snapshot.legacy_product_id);

    if (!latestCompByProduct.has(productId)) {
      latestCompByProduct.set(productId, snapshot);
    }
  }

  const ignoredPriceRadarProductIds = new Set(
    priceRadarIgnores
      .filter((ignore) => {
        if (ignore.ignore_forever) return true;
        if (!ignore.ignore_until) return false;
        return new Date(ignore.ignore_until).getTime() > now.getTime();
      })
      .map((ignore) => Number(ignore.legacy_product_id)),
  );
  const priceRadarRows = [...latestCompByProduct.entries()]
    .map(([productId, snapshot]) => {
      const product = productById.get(productId);
      const currentPrice = Number(product?.price || 0);
      const marketPrice = Number(snapshot.suggested_price || 0);
      const deltaPercent =
        marketPrice > 0 ? ((currentPrice - marketPrice) / marketPrice) * 100 : 0;

      return {
        product,
        snapshot,
        currentPrice,
        marketPrice,
        deltaPercent,
        absoluteDelta: Math.abs(deltaPercent),
      };
    })
    .filter(
      (row) =>
        row.product &&
        Number(row.product.quantity || 0) > 0 &&
        row.currentPrice > 0 &&
        row.marketPrice > 0 &&
        row.absoluteDelta >= 3 &&
        !ignoredPriceRadarProductIds.has(row.product.id),
    )
    .sort((left, right) => right.absoluteDelta - left.absoluteDelta)
    .slice(0, 8);
  const ignoredPriceRadarCount = ignoredPriceRadarProductIds.size;
  const compHistoryAvailable = !salesCompSnapshotsResult.error;
  const priceRadarIgnoreAvailable = !priceRadarIgnoresResult.error;
  const marketIntelAvailable = !marketIntelResult.error;
  const adminDataHealthIssues = [
    adminDataIssue("products", "Products", productsResult.error, "/admin/products"),
    adminDataIssue("offers", "Offers", offersResult.error, "/admin/offers"),
    adminDataIssue("orders", "Orders", ordersResult.error, "/admin/orders"),
    adminDataIssue(
      "order-review-cases",
      "Order review cases",
      orderReviewCasesResult.error,
      "/admin/order-review-cases",
    ),
    adminDataIssue(
      "evidence-reports",
      "Evidence reports",
      evidenceResult.error,
      "/admin/financial-reconciliation",
    ),
    adminDataIssue(
      "ebay-sync-decisions",
      "eBay sync decisions",
      syncDecisionsResult.error,
      "/admin/ebay/sync-control",
    ),
    adminDataIssue(
      "ebay-sync-summary",
      "eBay sync policy summary",
      blockedSyncResult.error,
      "/admin/ebay/sync-control",
    ),
    adminDataIssue(
      "inventory-stats",
      "Public inventory stats",
      inventoryStatsResult.error,
      "/admin/inventory",
    ),
    adminDataIssue(
      "reconciliation-alerts",
      "Financial reconciliation",
      reconciliationAlertsResult.error,
      "/admin/financial-reconciliation",
    ),
    adminDataIssue(
      "seller-connect",
      "Seller Connect readiness",
      sellerConnectResult.error,
      "/admin/seller-payouts",
    ),
    adminDataIssue(
      "sales-comp-snapshots",
      "InstaComp™ comp history",
      salesCompSnapshotsResult.error,
      "/admin/instacomp-direct",
    ),
    adminDataIssue(
      "price-radar-ignores",
      "Price-radar ignores",
      priceRadarIgnoresResult.error,
      "/admin/instacomp-direct",
    ),
    adminDataIssue(
      "market-intel-ledger",
      "Market Intel purchase ledger",
      marketIntelResult.error,
      "/admin/market-intel",
    ),
  ].filter((issue): issue is AdminDataHealthIssue => Boolean(issue));
  const adminDataHealthStatus =
    adminDataHealthIssues.length > 0 ? "DEGRADED" : "HEALTHY";
  const marketIntelTotals = marketIntelRows.reduce(
    (sum, row) => {
      const remaining =
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased;

      sum.invested += Number(row.lot.total_acquisition_cost || 0);
      sum.netProceeds += Number(row.performance?.realized_net_proceeds || 0);
      sum.grossProfit += Number(row.performance?.realized_gross_profit || 0);
      sum.remainingUnits += Number(remaining || 0);
      sum.soldUnits += Number(row.performance?.quantity_sold || 0);
      if (["ordered", "awaiting_receipt"].includes(row.lot.status)) {
        sum.awaitingReceipt += 1;
      }

      return sum;
    },
    {
      invested: 0,
      netProceeds: 0,
      grossProfit: 0,
      remainingUnits: 0,
      soldUnits: 0,
      awaitingReceipt: 0,
    },
  );
  const marketIntelBreakEven =
    marketIntelTotals.invested > 0
      ? Math.min(
          100,
          (marketIntelTotals.netProceeds / marketIntelTotals.invested) * 100,
        )
      : 0;
  const priceAdjustmentMultipliers = [
    { label: "-25%", value: "0.75" },
    { label: "-15%", value: "0.85" },
    { label: "-10%", value: "0.9" },
    { label: "-5%", value: "0.95" },
    { label: "Market", value: "1" },
    { label: "+5%", value: "1.05" },
    { label: "+10%", value: "1.1" },
    { label: "+15%", value: "1.15" },
    { label: "+25%", value: "1.25" },
  ];
  const adminCommandTiles = [
    {
      href: "/admin/instacomp-direct",
      icon: "⚾",
      title: "InstaComp™",
      detail: `${priceRadarRows.length} pricing alert${
        priceRadarRows.length === 1 ? "" : "s"
      }`,
      accent: "from-amber-100 to-white",
    },
    {
      href: "/admin/ebay/inventory-intake",
      icon: "🏀",
      title: "eBay Import",
      detail: "One-button listing intake",
      accent: "from-orange-100 to-white",
    },
    {
      href: "/admin/products",
      icon: "🏈",
      title: "Products",
      detail: `${activeProducts.length} active`,
      accent: "from-lime-100 to-white",
    },
    {
      href: "/admin/inventory",
      icon: "🏒",
      title: "Inventory Control",
      detail: "Stock and marketplace truth",
      accent: "from-sky-100 to-white",
    },
    {
      href: "/admin/orders",
      icon: "🥅",
      title: "Orders",
      detail: `${readyOrders.length} ready to ship`,
      accent: "from-emerald-100 to-white",
    },
    {
      href: "/admin/offers",
      icon: "🥊",
      title: "Best Offers",
      detail: `${pendingOffers.length} pending`,
      accent: "from-rose-100 to-white",
    },
    {
      href: "/admin/ebay/duplicates",
      icon: "🥎",
      title: "Dupe Finder",
      detail: "Merge or trash safely",
      accent: "from-yellow-100 to-white",
    },
    {
      href: "/admin/financial-reconciliation",
      icon: "🏆",
      title: "Money Audit",
      detail: `${reconciliationAlerts.length} open alert${
        reconciliationAlerts.length === 1 ? "" : "s"
      }`,
      accent: "from-purple-100 to-white",
    },
    {
      href: "/admin/market-intel",
      icon: "📈",
      title: "Market Intel",
      detail: marketIntelAvailable
        ? `${marketIntelRows.length} purchase lot${
            marketIntelRows.length === 1 ? "" : "s"
          }`
        : "Ledger unavailable",
      accent: "from-cyan-100 to-white",
    },
  ];
  const operatorActionCards = [
    {
      href: "/admin/instacomp-direct",
      eyebrow: "Scan desk",
      title: "Fix scans before they become bad inventory",
      detail:
        "Remove bad scan rows, merge selected quantities, retry OCR, and turn clean InstaComp™ results into priced drafts from the focused Direct lane.",
      cta: "Open InstaComp™ Direct",
      tone: "border-blue-200 bg-blue-50 text-blue-950",
    },
    {
      href: "/admin/products",
      eyebrow: "Inventory desk",
      title: "Edit, end, and audit products without guessing",
      detail:
        "Use the hardened product workbench for bulk saves, sold/end-early policy checks, quantity review, and one-card detail fixes.",
      cta: "Open Products",
      tone: "border-lime-200 bg-lime-50 text-lime-950",
    },
    {
      href: "/admin/offers",
      eyebrow: "Offer desk",
      title: "Decide buyer offers with locked actions",
      detail:
        "Accept, counter, or decline offers from the protected offer desk so money and inventory state stay synchronized.",
      cta: "Open Offers",
      tone: "border-rose-200 bg-rose-50 text-rose-950",
    },
    {
      href: "/admin/orders",
      eyebrow: "Fulfillment desk",
      title: "Ship paid orders from the live queue",
      detail:
        "Review holds, dry-run tracking references, evidence errors, and ready-to-ship orders from one fulfillment command path.",
      cta: "Open Orders",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
  ];
  const adminToolGroups = [
    {
      title: "eBay operations",
      detail: "Import, reconcile, publish, and control marketplace syncs.",
      links: [
        { href: "/admin/ebay", label: "Reconciliation" },
        { href: "/admin/ebay/inventory-intake", label: "Inventory Intake" },
        { href: "/admin/ebay/import-runner", label: "Import Runner" },
        { href: "/admin/ebay/publish", label: "Listing Launcher" },
        { href: "/admin/ebay/sync-control", label: "Sync Control" },
        { href: "/admin/ebay/duplicates", label: "Duplicate Cleanup" },
      ],
    },
    {
      title: "Inventory and scan control",
      detail: "Clean scans, review stock truth, and keep product data sane.",
      links: [
        { href: "/admin/instacomp-direct", label: "Direct Scan Lab" },
        { href: "/admin/instacomp", label: "Scan Lab" },
        { href: "/admin/products", label: "Products" },
        { href: "/admin/products/new", label: "New Product" },
        { href: "/admin/inventory", label: "Inventory Bridge" },
        { href: "/admin/inventory/category-review", label: "Category Review" },
      ],
    },
    {
      title: "Market intelligence",
      detail: "Research comps, buying targets, portfolio health, and alerts.",
      links: [
        { href: "/admin/market-intel", label: "Command Desk" },
        { href: "/admin/market-intel/readiness", label: "Readiness" },
        { href: "/admin/market-intel/watchlist", label: "Watchlist" },
        { href: "/admin/market-intel/comps", label: "Sold Comps" },
        { href: "/admin/market-intel/discovery", label: "Discovery Desk" },
        { href: "/admin/market-intel/ebay", label: "Active Scanner" },
        { href: "/admin/market-intel/deals", label: "Deal Engine" },
        { href: "/admin/market-intel/growth-specs", label: "Growth Specs" },
        {
          href: "/admin/market-intel/growth-specs/prospects",
          label: "Value Watchlists",
        },
        { href: "/admin/market-intel/buy", label: "Buy Desk" },
        { href: "/admin/market-intel/portfolio", label: "Portfolio" },
        { href: "/admin/market-intel/purchases", label: "Purchase Ledger" },
        {
          href: "/admin/market-intel/purchases/ebay-intake",
          label: "eBay Purchase Inbox",
        },
        { href: "/admin/market-intel/ingestion", label: "Ingestion Health" },
        { href: "/admin/market-intel/reports", label: "Reports" },
        { href: "/admin/market-intel/delivery", label: "Delivery Center" },
        { href: "/admin/market-intel/delivery/test", label: "Test Email" },
      ],
    },
    {
      title: "Launch, money, and shipping",
      detail: "Gate live-money readiness, simulations, payouts, and labels.",
      links: [
        { href: "/admin/financial-reconciliation", label: "Money Audit" },
        { href: "/admin/launch-readiness", label: "Launch Readiness" },
        { href: "/admin/launch-gate-drill", label: "Gate Drill" },
        { href: "/admin/live-payment-launch", label: "Payment Gate" },
        { href: "/admin/live-shipping-launch", label: "Shipping Gate" },
        { href: "/admin/payment-simulations", label: "Payment Simulations" },
        { href: "/admin/shipping", label: "Shipping Control" },
        { href: "/admin/shipping/simulations", label: "Shipping Simulations" },
        { href: "/admin/seller-payouts", label: "Seller Payouts" },
      ],
    },
    {
      title: "Orders, accounts, and admin support",
      detail: "Resolve buyer work, account status, files, settings, and security.",
      links: [
        { href: "/admin/orders", label: "Orders" },
        { href: "/admin/order-review-cases", label: "Review Cases" },
        { href: "/admin/offers", label: "Offers" },
        { href: "/admin/accounts", label: "Accounts" },
        { href: "/admin/files", label: "Files" },
        { href: "/admin/settings", label: "Settings" },
        { href: "/admin/security", label: "Security" },
        { href: "/admin/production-smoke", label: "Production Smoke" },
      ],
    },
  ];

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
    adminDataHealthIssues.length > 0
      ? `${adminDataHealthIssues.length} admin data source${
          adminDataHealthIssues.length === 1 ? "" : "s"
        } failed to load`
      : "Admin dashboard data sources loaded cleanly",
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
    !marketIntelAvailable
      ? "Market Intel purchase ledger is not available"
      : marketIntelTotals.awaitingReceipt > 0
      ? `${marketIntelTotals.awaitingReceipt} Market Intel purchase lot${
          marketIntelTotals.awaitingReceipt === 1 ? "" : "s"
        } waiting to be received`
      : "Market Intel receipt queue is clear",
    `Shipping setup verdict: ${label(shippingDecision.status)} - ${shippingDecision.summary}`,
  ];
  const adminAttentionRows: AttentionPanelRow[] = [
    {
      key: "data-health",
      eyebrow: "Data health",
      title:
        adminDataHealthIssues.length > 0
          ? "Dashboard data source failed"
          : "Dashboard data sources healthy",
      detail:
        adminDataHealthIssues.length > 0
          ? "Open the affected workbench or Production Smoke before trusting empty counts."
          : "All command-center data sources returned healthy responses.",
      value:
        adminDataHealthIssues.length > 0
          ? String(adminDataHealthIssues.length)
          : "OK",
      href: adminDataHealthIssues[0]?.href || "/admin/production-smoke",
      tone: adminDataHealthIssues.length > 0 ? "rose" : "green",
    },
    {
      key: "critical-cases",
      eyebrow: "Disputes",
      title:
        criticalOrderReviewCases.length > 0
          ? "Critical order cases need eyes"
          : "Critical cases clear",
      detail:
        activeOrderReviewCases.length > 0
          ? `${activeOrderReviewCases.length} total open case${
              activeOrderReviewCases.length === 1 ? "" : "s"
            } in the review queue.`
          : "No open order-review cases blocking fulfillment.",
      value: String(criticalOrderReviewCases.length),
      href: "/admin/order-review-cases",
      tone: criticalOrderReviewCases.length > 0 ? "rose" : "green",
    },
    {
      key: "ready-fulfillment",
      eyebrow: "Fulfillment",
      title:
        readyOrders.length > 0
          ? "Paid orders are ready to ship"
          : "No paid orders waiting",
      detail:
        dryRunShippingOrders.length > 0
          ? `${dryRunShippingOrders.length} order${
              dryRunShippingOrders.length === 1 ? "" : "s"
            } still show dry-run tracking references.`
          : "Ready queue and dry-run tracking references are visible from Orders.",
      value: String(readyOrders.length),
      href: "/admin/orders",
      tone: dryRunShippingOrders.length > 0 ? "rose" : readyOrders.length > 0 ? "amber" : "green",
    },
    {
      key: "offers",
      eyebrow: "Offers",
      title:
        pendingOffers.length > 0
          ? "Buyer offers need decisions"
          : "Offer desk clear",
      detail:
        counteredOffers.length > 0
          ? `${counteredOffers.length} countered offer${
              counteredOffers.length === 1 ? "" : "s"
            } still in play.`
          : "Accept, counter, or decline from the protected offer desk.",
      value: String(pendingOffers.length),
      href: "/admin/offers",
      tone: pendingOffers.length > 0 ? "amber" : "green",
    },
    {
      key: "instacomp-price-radar",
      eyebrow: "Pricing",
      title:
        priceRadarRows.length > 0
          ? "InstaComp™ found price gaps"
          : "Price radar calm",
      detail:
        priceRadarRows.length > 0
          ? "Open the dashboard radar or Direct Scan Lab to reprice and repair card rows."
          : "No active card has a large InstaComp™ market-price gap right now.",
      value: String(priceRadarRows.length),
      href: "/admin/instacomp-direct",
      tone: priceRadarRows.length > 0 ? "amber" : "green",
    },
    {
      key: "money-evidence",
      eyebrow: "Money",
      title:
        reconciliationAlerts.length > 0 || evidenceErrors.length > 0
          ? "Money or evidence needs cleanup"
          : "Money evidence clean",
      detail:
        evidenceErrors.length > 0
          ? `${evidenceErrors.length} recent evidence email issue${
              evidenceErrors.length === 1 ? "" : "s"
            } plus ${reconciliationAlerts.length} reconciliation alert${
              reconciliationAlerts.length === 1 ? "" : "s"
            }.`
          : "Stripe reconciliation and recent evidence email status are summarized here.",
      value: String(reconciliationAlerts.length + evidenceErrors.length),
      href: "/admin/financial-reconciliation",
      tone:
        reconciliationAlerts.length > 0 || evidenceErrors.length > 0
          ? "rose"
          : "green",
    },
    {
      key: "seller-connect",
      eyebrow: "Payouts",
      title:
        sellerConnectUnavailable
          ? "Seller Connect status unavailable"
          : sellerConnectNeedsAction.length > 0
          ? "Seller payouts need onboarding"
          : "Seller payouts clear",
      detail:
        sellerConnectUnavailable
          ? "Open Payouts to inspect the Stripe Connect readiness table."
          : sellerConnectNeedsAction.length > 0
          ? "Stripe requirements, disabled reasons, and payout readiness are one click away."
          : "No seller Connect account currently needs onboarding action.",
      value: sellerConnectUnavailable ? "!" : String(sellerConnectNeedsAction.length),
      href: "/admin/seller-payouts",
      tone:
        sellerConnectUnavailable || sellerConnectNeedsAction.length > 0
          ? "amber"
          : "green",
    },
    {
      key: "market-intel-receiving",
      eyebrow: "Buying",
      title:
        !marketIntelAvailable
          ? "Market Intel ledger unavailable"
          : marketIntelTotals.awaitingReceipt > 0
          ? "Purchased lots need receiving"
          : "Market Intel receiving clear",
      detail:
        marketIntelAvailable
          ? `${marketIntelTotals.remainingUnits} unit${
              marketIntelTotals.remainingUnits === 1 ? "" : "s"
            } remain across purchase lots.`
          : "Open Market Intel to inspect purchase-ledger availability.",
      value: marketIntelAvailable
        ? String(marketIntelTotals.awaitingReceipt)
        : "!",
      href: "/admin/market-intel/purchases",
      tone:
        !marketIntelAvailable || marketIntelTotals.awaitingReceipt > 0
          ? "amber"
          : "green",
    },
    {
      key: "launch-locks",
      eyebrow: "Launch",
      title:
        launchGateDrill.summary.failed > 0
          ? "Launch gate has blockers"
          : "Launch drill passing",
      detail:
        shippingDecision.status === "live_blocked"
          ? shippingDecision.summary
          : "Payment, shipping, provider setup, and smoke-report links are grouped below.",
      value: String(launchGateDrill.summary.failed),
      href: "/admin/launch-readiness",
      tone:
        launchGateDrill.summary.failed > 0 ||
        shippingDecision.status === "live_blocked"
          ? "rose"
          : "green",
    },
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
            <BaseCommandButton
              href={adminHref("/admin/products/new")}
              label="Add Product"
              primary
            />
            <BaseCommandButton
              href={adminHref("/admin/instacomp-direct")}
              label="InstaComp Direct"
            />
            <BaseCommandButton href={adminHref("/admin/orders")} label="Orders" />
            <BaseCommandButton href={adminHref("/admin/offers")} label="Offers" />
            <BaseCommandButton href={adminHref("/admin/inventory")} label="Inventory Control" />
            <BaseCommandButton
              href={adminHref("/admin/ebay/inventory-intake")}
              label="eBay Intake"
            />
            <BaseCommandButton href={adminHref("/admin/accounts")} label="Accounts" />
            <BaseCommandButton
              href={adminHref("/admin/order-review-cases")}
              label="Cases"
            />
            <BaseCommandButton href={adminHref("/admin/shipping")} label="Shipping" />
            <BaseCommandButton href={adminHref("/admin/seller-payouts")} label="Payouts" />
            <BaseCommandButton
              href={adminHref("/admin/financial-reconciliation")}
              label="Money Audit"
            />
            <BaseCommandButton
              href={adminHref("/admin/market-intel")}
              label="Market Intel"
            />
            <BaseCommandButton
              href={adminHref("/admin/payment-simulations")}
              label="Payment Tests"
            />
            <BaseCommandButton href={adminHref("/admin/ebay")} label="eBay Health" />
            <BaseCommandButton href={adminHref("/admin/settings")} label="Settings" />
            <BaseCommandButton href={adminHref("/admin/security")} label="Security" />
            <BaseCommandButton
              href={adminHref("/admin/ebay/sync-control")}
              label="Sync Control"
            />
            <BaseCommandButton
              href={adminHref("/admin/launch-readiness")}
              label="Readiness"
            />
            <BaseCommandButton
              href={adminHref("/admin/launch-gate-drill")}
              label="Gate Drill"
            />
            <BaseCommandButton href={adminHref("/admin/logout")} label="Logout" danger />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section
          className={`rounded-2xl border p-5 shadow-sm ${
            adminDataHealthIssues.length > 0
              ? "border-rose-200 bg-rose-50 text-rose-950"
              : "border-emerald-200 bg-emerald-50 text-emerald-950"
          }`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">
                Admin data health
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {adminDataHealthStatus === "DEGRADED"
                  ? "Do not trust empty counts yet"
                  : "Dashboard data sources loaded cleanly"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 opacity-80">
                {adminDataHealthStatus === "DEGRADED"
                  ? "One or more dashboard feeds failed. The affected panels are listed below so a broken query does not look like an all-clear queue."
                  : "Products, orders, offers, evidence, payouts, pricing, sync policy, and buying feeds returned usable responses."}
              </p>
            </div>
            <Pill
              label={adminDataHealthStatus}
              tone={adminDataHealthIssues.length > 0 ? "rose" : "green"}
            />
          </div>

          {adminDataHealthIssues.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {adminDataHealthIssues.map((issue) => (
                <Link
                  key={issue.key}
                  href={adminHref(issue.href)}
                  className="rounded-xl border border-rose-200 bg-white/70 p-4 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <p className="text-[11px] font-black uppercase tracking-widest text-rose-700">
                    {issue.label}
                  </p>
                  <p className="mt-2 font-black">Open affected workbench →</p>
                  <p className="mt-2 text-rose-900">{issue.message}</p>
                </Link>
              ))}
              <Link
                href={adminHref("/admin/production-smoke")}
                className="rounded-xl border border-rose-200 bg-white/70 p-4 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <p className="text-[11px] font-black uppercase tracking-widest text-rose-700">
                  Verification
                </p>
                <p className="mt-2 font-black">Open Production Smoke →</p>
                <p className="mt-2 text-rose-900">
                  Run the smoke report before deciding an empty queue is truly clear.
                </p>
              </Link>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">
                Operator attention strip
              </p>
              <h2 className="mt-1 text-3xl font-black">
                What needs eyes before anything else
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
                Live admin counts turned into direct routes: cases, shipping,
                offers, pricing, evidence, payouts, buying, and launch locks.
              </p>
            </div>
            <Pill
              label={
                adminAttentionRows.some((row) => row.tone === "rose")
                  ? "ACTION REQUIRED"
                  : adminAttentionRows.some((row) => row.tone === "amber")
                  ? "WATCHLIST"
                  : "ALL CLEAR"
              }
              tone={
                adminAttentionRows.some((row) => row.tone === "rose")
                  ? "rose"
                  : adminAttentionRows.some((row) => row.tone === "amber")
                  ? "amber"
                  : "green"
              }
            />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {adminAttentionRows.map((row) => (
              <AttentionPanelCard
                key={row.key}
                href={adminHref(row.href)}
                eyebrow={row.eyebrow}
                title={row.title}
                detail={row.detail}
                value={row.value}
                tone={row.tone}
              />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
                Operator action map
              </p>
              <h2 className="mt-1 text-3xl font-black">
                Start here when the admin side feels stuck
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
                These are the four highest-risk admin jobs with direct, tested
                paths—scan cleanup, product control, offer decisions, and paid
                order fulfillment.
              </p>
            </div>
            <Pill label="No dead-end action paths" tone="green" />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {operatorActionCards.map((card) => (
              <OperatorActionCard
                key={card.href}
                href={adminHref(card.href)}
                eyebrow={card.eyebrow}
                title={card.title}
                detail={card.detail}
                cta={card.cta}
                tone={card.tone}
              />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
                Admin tools index
              </p>
              <h2 className="mt-1 text-3xl font-black">
                Every operator page, grouped by job
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
                Secondary workbenches stay one click away without burying the
                high-risk scan, product, offer, and fulfillment paths.
              </p>
            </div>
            <Pill label="Runtime-smoked routes" tone="green" />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {adminToolGroups.map((group) => (
              <AdminToolGroupCard
                key={group.title}
                title={group.title}
                detail={group.detail}
                links={group.links.map((link) => ({
                  ...link,
                  href: adminHref(link.href),
                }))}
              />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-neutral-200 p-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                InstaComp™ Pricing Radar
              </p>
              <h2 className="mt-1 text-3xl font-black">
                Cards priced high, low, or ready to leave alone
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
                This is the first stop: compare your live price against the latest
                InstaComp™ suggested price, then snap it to market or move it
                above/below market in one click.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill
                label={
                  compHistoryAvailable
                    ? `${salesCompSnapshots.length} comp snapshots checked`
                    : "comp table unavailable"
                }
                tone={compHistoryAvailable ? "green" : "rose"}
              />
              <Pill
                label={`${ignoredPriceRadarCount} ignored`}
                tone={priceRadarIgnoreAvailable ? "amber" : "rose"}
              />
              <BaseLinkButton
                href={adminHref("/admin/instacomp-direct")}
                label="Open InstaComp™"
              />
            </div>
          </div>

          {priceRadarRows.length === 0 ? (
            <div className="p-5">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="text-xl font-black text-emerald-900">
                  No pricing fires showing right now.
                </h3>
                <p className="mt-2 text-sm font-semibold text-emerald-800">
                  Either your active cards are close to InstaComp™ market, or the
                  comp history needs fresh scans. Run InstaComp™ on questionable
                  listings and they will show up here automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {priceRadarRows.map((row) => {
                const product = row.product!;
                const tone = priceRadarTone(row.deltaPercent);
                const isHigh = row.deltaPercent > 0;

                return (
                  <div
                    key={`${product.id}-${row.snapshot.id}`}
                    className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[1.2fr_0.55fr_1.15fr_0.75fr]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill
                          label={isHigh ? "priced high" : "priced low"}
                          tone={tone}
                        />
                        <span className="text-xs font-black uppercase text-neutral-500">
                          {row.snapshot.comp_count || 0} comps /{" "}
                          {row.snapshot.recent_comp_count || 0} recent
                        </span>
                      </div>
                      <Link
                        href={adminHref(`/admin/products/${product.id}`)}
                        className="mt-2 block truncate text-xl font-black underline-offset-4 hover:underline"
                      >
                        {product.title || `Product #${product.id}`}
                      </Link>
                      <p className="mt-1 truncate text-sm font-semibold text-neutral-600">
                        Query: {row.snapshot.query || "No query saved"} · Last
                        comped {shortDate(row.snapshot.created_at)}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center xl:grid-cols-1">
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                        <p className="text-[11px] font-black uppercase text-neutral-500">
                          Your price
                        </p>
                        <p className="text-xl font-black">{money(row.currentPrice)}</p>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <p className="text-[11px] font-black uppercase text-blue-700">
                          Market
                        </p>
                        <p className="text-xl font-black text-blue-950">
                          {money(row.marketPrice)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-neutral-200 bg-white p-3">
                        <p className="text-[11px] font-black uppercase text-neutral-500">
                          Gap
                        </p>
                        <p className="text-xl font-black">
                          {signedPercent(row.deltaPercent)}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-neutral-500">
                        Reprice selected card
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {priceAdjustmentMultipliers.map((multiplier) => (
                          <form
                            key={`${product.id}-${multiplier.value}`}
                            action={adminHref("/api/admin/instacomp-price-radar/adjust")}
                            method="post"
                          >
                            <input
                              type="hidden"
                              name="productId"
                              value={product.id}
                            />
                            <input
                              type="hidden"
                              name="multiplier"
                              value={multiplier.value}
                            />
                            <AdminSubmitButton
                              className="w-full rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm font-black hover:bg-neutral-50"
                              pendingChildren="Applying..."
                              title={`Set ${product.title || "card"} to ${
                                multiplier.label
                              }`}
                            >
                              {multiplier.label}
                            </AdminSubmitButton>
                          </form>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-neutral-500">
                        Stop bugging me
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-2 xl:grid-cols-1">
                        {[
                          ["14d", "14 days"],
                          ["30d", "30 days"],
                          ["forever", "forever"],
                        ].map(([duration, labelText]) => (
                          <form
                            key={`${product.id}-${duration}`}
                            action={adminHref("/api/admin/instacomp-price-radar/ignore")}
                            method="post"
                          >
                            <input
                              type="hidden"
                              name="productId"
                              value={product.id}
                            />
                            <input
                              type="hidden"
                              name="duration"
                              value={duration}
                            />
                            <AdminSubmitButton
                              className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 py-2 text-sm font-black hover:bg-white"
                              pendingChildren="Ignoring..."
                            >
                              Ignore {labelText}
                            </AdminSubmitButton>
                          </form>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-[#101418] p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                Admin Playbook
              </p>
              <h2 className="mt-1 text-3xl font-black">
                Big buttons, clear jobs, no maze-like workflows
              </h2>
            </div>
            <p className="max-w-2xl text-sm font-semibold text-neutral-300">
              Each tile goes to one workbench. Sports icons are unique so the
              page can grow without every button looking like the same gray brick.
            </p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {adminCommandTiles.map((tile) => (
              <BaseAdminCommandTile
                key={tile.href}
                href={adminHref(tile.href)}
                icon={tile.icon}
                title={tile.title}
                detail={tile.detail}
                accent={tile.accent}
              />
            ))}
          </div>
        </section>

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
              <BaseQueuePanel
                title="Fulfillment"
                href={adminHref("/admin/orders")}
                empty="No orders waiting to ship."
                rows={addAdminHandoffToRows(
                  readyOrders.slice(0, 5).map((order) => ({
                    key: String(order.id),
                    title: `Order #${order.id}`,
                    meta: order.customer_email || "No customer email",
                    value: money(order.total),
                    href: `/admin/orders/${order.id}`,
                  })),
                  adminHref,
                )}
              />
              <BaseQueuePanel
                title="Order Review"
                href={adminHref("/admin/order-review-cases")}
                empty="No order cases or paid review holds."
                rows={addAdminHandoffToRows(
                  [
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
                  ].slice(0, 5),
                  adminHref,
                )}
              />
              <BaseQueuePanel
                title="Offer Desk"
                href={adminHref("/admin/offers")}
                empty="No pending offers."
                rows={[...pendingOffers, ...counteredOffers].slice(0, 5).map((offer) => ({
                  key: String(offer.id),
                  title: offer.products?.title || "Unknown product",
                  meta: offer.customer_name || offer.customer_email || "No customer",
                  value: money(offer.offer_amount),
                }))}
              />
              <BaseQueuePanel
                title="Inventory Watch"
                href={adminHref("/admin/products")}
                empty="No low-stock products."
                rows={addAdminHandoffToRows(
                  lowInventory.slice(0, 5).map((product) => ({
                    key: String(product.id),
                    title: product.title || `Product #${product.id}`,
                    meta: product.ebay_item_id ? "eBay linked" : "Local only",
                    value: `${Number(product.quantity || 0)} left`,
                    href: `/admin/products/${product.id}`,
                  })),
                  adminHref,
                )}
              />
              <BaseQueuePanel
                title="Money Audit"
                href={adminHref("/admin/financial-reconciliation")}
                empty="No unmatched Stripe money."
                rows={addAdminHandoffToRows(
                  reconciliationAlerts.map((alert) => ({
                    key: alert.id,
                    title: alert.title,
                    meta: `${label(alert.severity)} / ${label(alert.mismatch_type)}`,
                    value: money(alert.difference_amount),
                    href: "/admin/financial-reconciliation",
                  })),
                  adminHref,
                )}
              />
              <BaseQueuePanel
                title="Seller Connect"
                href={adminHref("/admin/seller-payouts")}
                empty={
                  sellerConnectUnavailable
                    ? "Connect readiness table is unavailable."
                    : "No seller onboarding action needed."
                }
                rows={addAdminHandoffToRows(
                  sellerConnectNeedsAction.slice(0, 5).map((account) => {
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
                  }),
                  adminHref,
                )}
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
                <BaseLinkButton
                  href={adminHref("/admin/launch-gate-drill")}
                  label="Gate Drill"
                />
                <BaseLinkButton
                  href={adminHref("/admin/launch-readiness")}
                  label="Readiness"
                />
                <BaseLinkButton
                  href={adminHref("/admin/live-payment-launch")}
                  label="Pay Gate"
                />
                <BaseLinkButton
                  href={adminHref("/admin/live-shipping-launch")}
                  label="Ship Gate"
                />
                <BaseLinkButton
                  href={adminHref("/api/admin/launch-readiness")}
                  label="Brief JSON"
                />
                <BaseLinkButton
                  href={adminHref("/api/admin/launch-readiness?format=markdown")}
                  label="Brief MD"
                />
                <BaseLinkButton
                  href={adminHref("/api/admin/launch-readiness?format=handoff-bundle")}
                  label="Hand-off Bundle"
                />
                <BaseLinkButton
                  href={adminHref("/admin/production-smoke")}
                  label="Smoke Report"
                />
              </div>
            </section>

            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <h2 className="text-xl font-black">Command Links</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <BaseLinkButton href={adminHref("/admin/products")} label="Products" />
                <BaseLinkButton href={adminHref("/admin/inventory")} label="Inventory Control" />
                <BaseLinkButton href={adminHref("/admin/ebay")} label="eBay" />
                <BaseLinkButton href={adminHref("/admin/settings")} label="Settings" />
                <BaseLinkButton href={adminHref("/admin/security")} label="Security" />
                <BaseLinkButton href={adminHref("/admin/accounts")} label="Accounts" />
                <BaseLinkButton
                  href={adminHref("/admin/order-review-cases")}
                  label="Cases"
                />
                <BaseLinkButton href={adminHref("/admin/shipping")} label="Shipping" />
                <BaseLinkButton
                  href={adminHref("/admin/seller-payouts")}
                  label="Payouts"
                />
                <BaseLinkButton
                  href={adminHref("/admin/financial-reconciliation")}
                  label="Money Audit"
                />
                <BaseLinkButton
                  href={adminHref("/admin/market-intel")}
                  label="Market Intel"
                />
                <BaseLinkButton
                  href={adminHref("/admin/payment-simulations")}
                  label="Payment Tests"
                />
                <BaseLinkButton
                  href={adminHref("/admin/production-smoke")}
                  label="Prod Smoke"
                />
                <BaseLinkButton href={adminHref("/admin/orders")} label="Orders" />
                <BaseLinkButton href={adminHref("/admin/offers")} label="Offers" />
                <BaseLinkButton href={adminHref("/admin/files")} label="Files" />
                <BaseLinkButton
                  href={adminHref("/admin/launch-readiness")}
                  label="Launch"
                />
                <BaseLinkButton
                  href={adminHref("/admin/launch-gate-drill")}
                  label="Gate Drill"
                />
                <BaseLinkButton href={adminHref("/shop")} label="Shop" />
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
                checklistHref={adminHref(
                  "/api/admin/shipping/provider-setup?format=operator-checklist",
                )}
              />
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <BaseLinkButton
                  href={adminHref("/admin/shipping")}
                  label="Shipping Ops"
                />
                <BaseLinkButton
                  href={adminHref("/admin/launch-readiness")}
                  label="Readiness"
                />
                <BaseLinkButton
                  href={adminHref("/admin/launch-gate-drill")}
                  label="Gate Drill"
                />
                <BaseLinkButton
                  href={adminHref("/api/admin/shipping/provider-setup")}
                  label="Setup JSON"
                />
                <BaseLinkButton
                  href={adminHref(
                    "/api/admin/shipping/provider-setup?format=env-template",
                  )}
                  label="Env Template"
                />
                <BaseLinkButton
                  href={adminHref(
                    "/api/admin/shipping/provider-setup?format=vercel-commands",
                  )}
                  label="Vercel Commands"
                />
                <BaseLinkButton
                  href={adminHref(
                    "/api/admin/shipping/provider-setup?format=operator-checklist",
                  )}
                  label="Checklist"
                />
              </div>
            </section>
          </aside>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
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
            title="Market Intel"
            rows={
              marketIntelAvailable
                ? [
                    ["Purchase lots", String(marketIntelRows.length)],
                    ["Units remaining", String(marketIntelTotals.remainingUnits)],
                    ["Net proceeds", money(marketIntelTotals.netProceeds)],
                    ["Realized GP", money(marketIntelTotals.grossProfit)],
                    ["Cash break-even", `${marketIntelBreakEven.toFixed(1)}%`],
                  ]
                : [["Status", "Not available"]]
            }
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
                    href={adminHref(`/admin/orders/${order.id}`)}
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
                href={adminHref("/admin/ebay/sync-control")}
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

function BaseAdminCommandTile({
  href,
  icon,
  title,
  detail,
  accent,
}: {
  href: string;
  icon: string;
  title: string;
  detail: string;
  accent: string;
}) {
  return (
    <a
      href={href}
      className={`group rounded-xl border border-white/15 bg-gradient-to-br ${accent} p-4 text-neutral-950 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-16 place-items-center rounded-full border border-neutral-900/10 bg-white text-4xl shadow-sm">
          {icon}
        </span>
        <span className="rounded-full border border-neutral-900/10 bg-white px-2 py-1 text-[11px] font-black uppercase text-neutral-600">
          Open
        </span>
      </div>
      <h3 className="mt-4 text-2xl font-black tracking-tight group-hover:underline">
        {title}
      </h3>
      <p className="mt-1 text-sm font-bold text-neutral-600">{detail}</p>
    </a>
  );
}

function OperatorActionCard({
  href,
  eyebrow,
  title,
  detail,
  cta,
  tone,
}: {
  href: string;
  eyebrow: string;
  title: string;
  detail: string;
  cta: string;
  tone: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[230px] flex-col justify-between rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${tone}`}
    >
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest opacity-70">
          {eyebrow}
        </p>
        <h3 className="mt-2 text-xl font-black tracking-tight">{title}</h3>
        <p className="mt-3 text-sm font-semibold leading-6 opacity-80">
          {detail}
        </p>
      </div>
      <span className="mt-4 w-fit rounded-md border border-current bg-white/70 px-3 py-2 text-sm font-black group-hover:bg-white">
        {cta}
      </span>
    </Link>
  );
}

function AdminToolGroupCard({
  title,
  detail,
  links,
}: {
  title: string;
  detail: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="text-lg font-black tracking-tight">{title}</h3>
      <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">
        {detail}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-black text-neutral-800 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function AttentionPanelCard({
  href,
  eyebrow,
  title,
  detail,
  value,
  tone,
}: {
  href: string;
  eyebrow: string;
  title: string;
  detail: string;
  value: string;
  tone: AdminTone;
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-950"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : "border-emerald-200 bg-emerald-50 text-emerald-950";
  const valueClass =
    tone === "rose"
      ? "bg-rose-700 text-white"
      : tone === "amber"
      ? "bg-amber-400 text-neutral-950"
      : "bg-emerald-700 text-white";

  return (
    <Link
      href={href}
      className={`group flex min-h-[190px] flex-col justify-between rounded-xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-black uppercase tracking-widest opacity-70">
            {eyebrow}
          </p>
          <span
            className={`grid min-w-10 place-items-center rounded-full px-2 py-1 text-sm font-black ${valueClass}`}
            aria-label={`${eyebrow} count ${value}`}
          >
            {value}
          </span>
        </div>
        <h3 className="mt-3 text-lg font-black tracking-tight">{title}</h3>
        <p className="mt-2 text-sm font-semibold leading-6 opacity-85">
          {detail}
        </p>
      </div>
      <span className="mt-4 text-sm font-black underline-offset-4 group-hover:underline">
        Open workbench →
      </span>
    </Link>
  );
}

function ShippingProviderUnlockPlan({
  actionPlan,
  checklistHref,
}: {
  actionPlan: ProviderSetupActionPlanStep[];
  checklistHref: string;
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
          href={checklistHref}
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

function BaseCommandButton({
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

function BaseQueuePanel({
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

function BaseLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-center font-bold hover:bg-white"
    >
      {label}
    </a>
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

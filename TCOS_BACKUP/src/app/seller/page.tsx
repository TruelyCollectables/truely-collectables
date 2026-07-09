"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../account/account-session";

type SellerInventorySummary = {
  totalItems: number;
  draftCount: number;
  draftReadyCount: number;
  draftNeedsWorkCount: number;
  activeCount: number;
  archivedCount: number;
  totalQuantity: number;
  totalDraftValue: number;
};

type SellerInventoryItem = {
  inventoryItemId: string;
  title: string;
  status: string;
  price: number;
  activationReadiness: {
    ready: boolean;
    blockers: string[];
  };
};

type SellerPayoutBalance = {
  heldAmount: number;
  eligibleAmount: number;
  availableToRequestAmount: number;
  openRequestCount: number;
  blockedRequestCount: number;
  paidAmount: number;
};

type SellerPayoutRequest = {
  id: string;
  requestedAmount: number;
  status: string;
  requestedAt: string | null;
  reviewBlocked?: boolean;
  reviewBlockReason?: string | null;
  orderSummaries?: Array<{
    orderId: number;
    amountRequested: number;
    activeCaseCount: number;
    blockedLedgerRowCount: number;
  }>;
};

type SellerOrderSummary = {
  orderCount: number;
  activeCaseCount: number;
  heldOrderCount: number;
  openCashOutRequestCount: number;
  sellerPayableAmount: number;
};

type SellerOrderActivity = {
  orderId: number;
  createdAt: string | null;
  paymentStatus: string;
  fulfillmentStatus: string;
  heldPayoutRowCount: number;
  openCashOutRequestCount: number;
  activeCaseCount: number;
  blockedByReview: boolean;
};

type SellerOrderSignal = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
  occurredAt: string | null;
  orderId: number;
  anchor: string;
};

type SellerMarketplaceStageFilter =
  | "all"
  | "needs_review"
  | "staged"
  | "mapped"
  | "skipped"
  | "blocked"
  | "ready";

type SellerMarketplaceImportSummary = {
  total: number;
  ready: number;
  staged: number;
  needs_review: number;
  mapped: number;
  skipped: number;
  blocked: number;
  promoted: number;
};

type SellerMarketplaceImportJob = {
  id: string;
  status: string;
  row_count: number;
  staged_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  current_summary?: SellerMarketplaceImportSummary | null;
};

type SellerDashboardData = {
  inventorySummary: SellerInventorySummary | null;
  inventoryItems: SellerInventoryItem[];
  payoutBalance: SellerPayoutBalance | null;
  payoutRequests: SellerPayoutRequest[];
  orderSummary: SellerOrderSummary | null;
  orders: SellerOrderActivity[];
  recentSignals: SellerOrderSignal[];
  marketplaceLatestImportJob: SellerMarketplaceImportJob | null;
};

type SellerOrderQueueFilter =
  | "all"
  | "action_required"
  | "shipping"
  | "cash_out"
  | "completed";

type SellerPayoutRequestFilter =
  | "all"
  | "blocked"
  | "open"
  | "paid"
  | "attention";

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
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

function signalTone(tone: SellerOrderSignal["tone"]) {
  if (tone === "positive") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-800";
}

function statusTone(value: string | null | undefined) {
  if (
    value === "paid" ||
    value === "eligible" ||
    value === "completed" ||
    value === "shipped" ||
    value === "active"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    value === "hold_pending_fulfillment" ||
    value === "hold_dispute_or_review" ||
    value === "requested" ||
    value === "approved" ||
    value === "processing" ||
    value === "under_review" ||
    value === "open" ||
    value === "draft" ||
    value === "archived"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (
    value === "cancelled" ||
    value === "reversed" ||
    value === "decided_for_buyer" ||
    value === "failed"
  ) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function readinessBlockerLabel(value: string) {
  if (value === "missing_sku") return "Missing SKU";
  if (value === "missing_price") return "Missing price";
  if (value === "missing_quantity") return "Missing quantity";
  if (value === "missing_image") return "Missing image";
  if (value === "missing_authenticity_disclosure") {
    return "Missing authenticity disclosure";
  }
  if (value === "missing_cert_provider") return "Missing cert provider";
  if (value === "missing_pass_guarantee_authenticator") {
    return "Missing guarantee authenticator";
  }
  if (value === "missing_provenance_evidence") {
    return "Missing provenance evidence";
  }
  return label(value);
}

function sellerOrdersQueueHref(
  queue: SellerOrderQueueFilter,
  search?: string,
) {
  const params = new URLSearchParams();

  if (queue !== "all") {
    params.set("queue", queue);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/orders?${query}` : "/seller/orders";
}

function sellerPayoutRequestHref(
  request: SellerPayoutRequestFilter,
  search?: string,
) {
  const params = new URLSearchParams();

  if (request !== "all") {
    params.set("request", request);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/payouts?${query}` : "/seller/payouts";
}

function sellerMarketplaceHref(stage: SellerMarketplaceStageFilter = "all") {
  if (stage === "all") {
    return "/seller/marketplaces";
  }

  return `/seller/marketplaces?stage=${stage}`;
}

function sellerMarketplaceWorkspaceLink(
  latestImportJob: SellerMarketplaceImportJob | null,
) {
  const summary = latestImportJob?.current_summary;

  if ((summary?.blocked || 0) > 0) {
    return {
      href: sellerMarketplaceHref("blocked"),
      label: "Blocked Marketplace Rows",
      detail: `${summary?.blocked || 0} conflict row(s) need sync review before promotion.`,
    };
  }

  if ((summary?.needs_review || 0) > 0) {
    return {
      href: sellerMarketplaceHref("needs_review"),
      label: "Needs Review",
      detail: `${summary?.needs_review || 0} staged row(s) need seller cleanup before promotion.`,
    };
  }

  if ((summary?.ready || 0) > 0) {
    return {
      href: sellerMarketplaceHref("ready"),
      label: "Ready Marketplace Rows",
      detail: `${summary?.ready || 0} staged row(s) are ready to promote into seller drafts.`,
    };
  }

  if ((summary?.mapped || 0) > 0) {
    return {
      href: sellerMarketplaceHref("mapped"),
      label: "Mapped Marketplace Rows",
      detail: `${summary?.mapped || 0} staged row(s) already turned into seller draft inventory.`,
    };
  }

  return {
    href: sellerMarketplaceHref(),
    label: "Marketplace Rows",
    detail:
      "Review staged imports, promote listings, and watch sync conflicts before they hit the storefront.",
  };
}

function signalQueueHref(signal: SellerOrderSignal) {
  const encodedSearch = encodeURIComponent(`order ${signal.orderId}`);

  if (signal.kind === "shipment_saved") {
    return `/seller/orders?queue=shipping&search=${encodedSearch}`;
  }

  if (signal.kind === "cash_out") {
    return `/seller/orders?queue=cash_out&search=${encodedSearch}`;
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    return `/seller/orders?queue=action_required&search=${encodedSearch}`;
  }

  if (signal.kind === "payment_cleared") {
    return `/seller/orders?queue=completed&search=${encodedSearch}`;
  }

  return `/seller/orders?search=${encodedSearch}`;
}

function signalQueueLabel(signal: SellerOrderSignal) {
  if (signal.kind === "shipment_saved") {
    return "Open Shipping Orders";
  }

  if (signal.kind === "cash_out") {
    return "Open Cash-Out Orders";
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    return "Open Action Orders";
  }

  if (signal.kind === "payment_cleared") {
    return "Open Completed Orders";
  }

  return "Open Seller Orders";
}

function signalDetailHref(signal: SellerOrderSignal) {
  const payoutSearch = `order ${signal.orderId}`;

  if (signal.kind === "cash_out") {
    const params = new URLSearchParams();
    params.set("return", "payouts");
    params.set("request", "open");
    params.set("requestSearch", payoutSearch);
    return `/seller/orders/${signal.orderId}?${params.toString()}#recent-activity`;
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    const params = new URLSearchParams();
    params.set("return", "payouts");
    params.set("request", "blocked");
    params.set("requestSearch", payoutSearch);
    return `/seller/orders/${signal.orderId}?${params.toString()}#recent-activity`;
  }

  const queueHref = signalQueueHref(signal);
  const query = queueHref.split("?")[1];
  return query
    ? `/seller/orders/${signal.orderId}?${query}#recent-activity`
    : `/seller/orders/${signal.orderId}#recent-activity`;
}

function signalPayoutHref(signal: SellerOrderSignal) {
  const encodedSearch = encodeURIComponent(`order ${signal.orderId}`);

  if (signal.kind === "cash_out") {
    return `/seller/payouts?request=open&search=${encodedSearch}`;
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    return `/seller/payouts?request=blocked&search=${encodedSearch}`;
  }

  return null;
}

function signalPayoutLabel(signal: SellerOrderSignal) {
  if (signal.kind === "cash_out") {
    return "Open Cash-Out Payouts";
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    return "Open Blocked Payouts";
  }

  return "Open Seller Payouts";
}

function sellerBlockedPayoutOrderDetailHref(orderId: number, requestId: string) {
  const params = new URLSearchParams();
  params.set("queue", "action_required");
  params.set("search", `order ${orderId}`);
  params.set("return", "payouts");
  params.set("request", "blocked");
  params.set("requestSearch", requestId);
  return `/seller/orders/${orderId}?${params.toString()}#recent-activity`;
}

function sellerActionOrderDetailHref(orderId: number) {
  const params = new URLSearchParams();
  params.set("queue", "action_required");
  params.set("search", `order ${orderId}`);
  return `/seller/orders/${orderId}?${params.toString()}#recent-activity`;
}

function sellerBlockedPayoutOrdersHref(requestId: string) {
  return sellerOrdersQueueHref("action_required", requestId);
}

function sellerBlockedPayoutWorkspaceHref(requestId: string) {
  return sellerPayoutRequestHref("blocked", requestId);
}

function sellerBlockedPayoutOrderWorkspaceHref(orderId: number) {
  return sellerOrdersQueueHref("action_required", `order ${orderId}`);
}

function sellerActionOrderWorkspaceLink(order: SellerOrderActivity) {
  const orderSearch = `order ${order.orderId}`;

  if (
    order.blockedByReview ||
    order.activeCaseCount > 0 ||
    order.heldPayoutRowCount > 0
  ) {
    return {
      href: sellerOrdersQueueHref("action_required", orderSearch),
      label: "Action Orders",
    };
  }

  if (order.fulfillmentStatus !== "shipped") {
    return {
      href: sellerOrdersQueueHref("shipping", orderSearch),
      label: "Shipping Orders",
    };
  }

  if (order.openCashOutRequestCount > 0) {
    return {
      href: sellerOrdersQueueHref("cash_out", orderSearch),
      label: "Cash-Out Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("all", orderSearch),
    label: "Seller Orders",
  };
}

function sellerActionOrderPayoutLink(order: SellerOrderActivity) {
  const orderSearch = `order ${order.orderId}`;

  if (
    order.blockedByReview ||
    order.activeCaseCount > 0 ||
    order.heldPayoutRowCount > 0
  ) {
    return {
      href: sellerPayoutRequestHref("blocked", orderSearch),
      label: "Blocked Payouts",
    };
  }

  if (order.openCashOutRequestCount > 0) {
    return {
      href: sellerPayoutRequestHref("open", orderSearch),
      label: "Cash-Out Payouts",
    };
  }

  return null;
}

function sellerInventoryItemHref(item: SellerInventoryItem) {
  const params = new URLSearchParams();
  params.set("status", item.status === "active" ? "active" : "draft");

  if (item.status !== "active") {
    params.set(
      "readiness",
      item.activationReadiness.ready ? "ready" : "needs_work",
    );
  }

  params.set("search", item.title);
  return `/seller/inventory?${params.toString()}`;
}

function sellerDraftMarketplaceHref(item: SellerInventoryItem) {
  const params = new URLSearchParams();
  params.set("stage", "needs_review");

  if (item.title.trim()) {
    params.set("search", item.title.trim());
  }

  return `/seller/marketplaces?${params.toString()}`;
}

function sellerDraftOrderWorkspaceHref(item: SellerInventoryItem) {
  return sellerOrdersQueueHref("action_required", item.title);
}

export default function SellerPage() {
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [dashboard, setDashboard] = useState<SellerDashboardData>({
    inventorySummary: null,
    inventoryItems: [],
    payoutBalance: null,
    payoutRequests: [],
    orderSummary: null,
    orders: [],
    recentSignals: [],
    marketplaceLatestImportJob: null,
  });
  const [loading, setLoading] = useState(() => Boolean(session?.access_token));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const inventoryNeedsWorkHref = "/seller/inventory?status=draft&readiness=needs_work";
  const inventoryReadyHref = "/seller/inventory?readiness=ready";
  const payoutBlockedHref = "/seller/payouts?request=blocked";
  const payoutOpenHref = "/seller/payouts?request=open";
  const ordersActionHref = "/seller/orders?queue=action_required";
  const ordersShippingHref = "/seller/orders?queue=shipping";

  async function loadMarketplaceLatestImportJob(accessToken: string) {
    try {
      const response = await fetch(
        "/api/account/seller/marketplace-connections/ebay/staged-items?limit=1&importJobLimit=1",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const data = await response.json();

      if (!response.ok) {
        return null;
      }

      return (data.latestImportJob || null) as SellerMarketplaceImportJob | null;
    } catch {
      return null;
    }
  }

  async function loadDashboard(accessToken: string, options?: { silent?: boolean }) {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [
        inventoryResponse,
        payoutResponse,
        ordersResponse,
        marketplaceLatestImportJob,
      ] = await Promise.all([
        fetch("/api/account/seller/inventory", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        fetch("/api/account/seller/payout-requests", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        fetch("/api/account/seller/orders", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
        loadMarketplaceLatestImportJob(accessToken),
      ]);
      const [inventoryData, payoutData, ordersData] = await Promise.all([
        inventoryResponse.json(),
        payoutResponse.json(),
        ordersResponse.json(),
      ]);

      if (!inventoryResponse.ok) {
        throw new Error(inventoryData.error || "Could not load seller inventory.");
      }

      if (!payoutResponse.ok) {
        throw new Error(payoutData.error || "Could not load seller payout data.");
      }

      if (!ordersResponse.ok) {
        throw new Error(ordersData.error || "Could not load seller order data.");
      }

      setDashboard({
        inventorySummary:
          (inventoryData.summary || null) as SellerInventorySummary | null,
        inventoryItems: Array.isArray(inventoryData.items)
          ? (inventoryData.items as SellerInventoryItem[])
          : [],
        payoutBalance: (payoutData.balance || null) as SellerPayoutBalance | null,
        payoutRequests: Array.isArray(payoutData.requests)
          ? (payoutData.requests as SellerPayoutRequest[])
          : [],
        orderSummary: (ordersData.summary || null) as SellerOrderSummary | null,
        orders: Array.isArray(ordersData.orders)
          ? (ordersData.orders as SellerOrderActivity[])
          : [],
        recentSignals: Array.isArray(ordersData.recentSignals)
          ? (ordersData.recentSignals as SellerOrderSignal[])
          : [],
        marketplaceLatestImportJob,
      });
      setError("");
    } catch (nextError: any) {
      setDashboard({
        inventorySummary: null,
        inventoryItems: [],
        payoutBalance: null,
        payoutRequests: [],
        orderSummary: null,
        orders: [],
        recentSignals: [],
        marketplaceLatestImportJob: null,
      });
      setError(
        nextError.message || "Could not load seller command center data.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const [
            inventoryResponse,
            payoutResponse,
            ordersResponse,
            marketplaceLatestImportJob,
          ] =
            await Promise.all([
              fetch("/api/account/seller/inventory", {
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              }),
              fetch("/api/account/seller/payout-requests", {
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              }),
              fetch("/api/account/seller/orders", {
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              }),
              loadMarketplaceLatestImportJob(session.access_token),
            ]);
          const [inventoryData, payoutData, ordersData] = await Promise.all([
            inventoryResponse.json(),
            payoutResponse.json(),
            ordersResponse.json(),
          ]);

          if (!inventoryResponse.ok) {
            throw new Error(
              inventoryData.error || "Could not load seller inventory.",
            );
          }

          if (!payoutResponse.ok) {
            throw new Error(
              payoutData.error || "Could not load seller payout data.",
            );
          }

          if (!ordersResponse.ok) {
            throw new Error(
              ordersData.error || "Could not load seller order data.",
            );
          }

          if (!cancelled) {
            setDashboard({
              inventorySummary:
                (inventoryData.summary || null) as SellerInventorySummary | null,
              inventoryItems: Array.isArray(inventoryData.items)
                ? (inventoryData.items as SellerInventoryItem[])
                : [],
              payoutBalance:
                (payoutData.balance || null) as SellerPayoutBalance | null,
              payoutRequests: Array.isArray(payoutData.requests)
                ? (payoutData.requests as SellerPayoutRequest[])
                : [],
              orderSummary:
                (ordersData.summary || null) as SellerOrderSummary | null,
              orders: Array.isArray(ordersData.orders)
                ? (ordersData.orders as SellerOrderActivity[])
                : [],
              recentSignals: Array.isArray(ordersData.recentSignals)
                ? (ordersData.recentSignals as SellerOrderSignal[])
                : [],
              marketplaceLatestImportJob,
            });
            setError("");
          }
        } catch (nextError: any) {
          if (!cancelled) {
            setDashboard({
              inventorySummary: null,
              inventoryItems: [],
              payoutBalance: null,
              payoutRequests: [],
              orderSummary: null,
              orders: [],
              recentSignals: [],
              marketplaceLatestImportJob: null,
            });
            setError(
              nextError.message || "Could not load seller command center data.",
            );
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [session?.access_token]);

  const marketplaceWorkspaceLink = sellerMarketplaceWorkspaceLink(
    dashboard.marketplaceLatestImportJob,
  );

  const urgentDrafts = useMemo(
    () =>
      dashboard.inventoryItems
        .filter(
          (item) =>
            item.status === "draft" && item.activationReadiness.blockers.length > 0,
        )
        .slice(0, 4),
    [dashboard.inventoryItems],
  );

  const blockedPayoutRequests = useMemo(
    () =>
      dashboard.payoutRequests
        .filter((request) => request.reviewBlocked)
        .slice(0, 4),
    [dashboard.payoutRequests],
  );

  const actionOrders = useMemo(
    () =>
      dashboard.orders
        .filter(
          (order) =>
            order.blockedByReview ||
            order.activeCaseCount > 0 ||
            order.heldPayoutRowCount > 0 ||
            order.openCashOutRequestCount > 0,
        )
        .slice(0, 4),
    [dashboard.orders],
  );
  const inventoryWorkspaceLink =
    (dashboard.inventorySummary?.draftNeedsWorkCount || 0) > 0
      ? {
          href: inventoryNeedsWorkHref,
          label: "Needs Work Drafts",
        }
      : (dashboard.inventorySummary?.draftReadyCount || 0) > 0
        ? {
            href: inventoryReadyHref,
            label: "Ready Drafts",
          }
        : {
            href: "/seller/inventory",
            label: "Seller Inventory",
          };
  const payoutWorkspaceLink =
    (dashboard.payoutBalance?.blockedRequestCount || 0) > 0
      ? {
          href: payoutBlockedHref,
          label: "Blocked Payouts",
        }
      : (dashboard.payoutBalance?.openRequestCount || 0) > 0
        ? {
            href: payoutOpenHref,
            label: "Cash-Out Payouts",
          }
        : {
            href: "/seller/payouts",
            label: "Seller Payouts",
          };
  const ordersWorkspaceLink =
    actionOrders.length > 0
      ? {
          href: ordersActionHref,
          label: "Action Orders",
        }
      : dashboard.orders.some(
            (order) => order.fulfillmentStatus !== "shipped",
          )
        ? {
            href: ordersShippingHref,
            label: "Shipping Orders",
          }
        : {
            href: "/seller/orders",
            label: "Seller Orders",
          };
  const actionCards = useMemo(
    () => [
      {
        title: "Inventory Workspace",
        detail: dashboard.inventorySummary
          ? `${dashboard.inventorySummary.draftReadyCount} ready draft(s), ${dashboard.inventorySummary.activeCount} active listing(s).`
          : "Manage seller drafts, live listings, and description updates.",
        href: inventoryWorkspaceLink.href,
        label: `Open ${inventoryWorkspaceLink.label}`,
      },
      {
        title: "Payout Workspace",
        detail: dashboard.payoutBalance
          ? `${formatCurrency(
              dashboard.payoutBalance.availableToRequestAmount,
            )} available to request right now.`
          : "Review Stripe verification, holds, and cash-out readiness.",
        href: payoutWorkspaceLink.href,
        label: `Open ${payoutWorkspaceLink.label}`,
      },
      {
        title: "Order Activity",
        detail: dashboard.orderSummary
          ? `${dashboard.orderSummary.orderCount} seller order(s), ${dashboard.orderSummary.activeCaseCount} active case(s).`
          : "Track routed orders, payout holds, and recent seller signals.",
        href: ordersWorkspaceLink.href,
        label: `Open ${ordersWorkspaceLink.label}`,
      },
      {
        title: "Marketplace Sync",
        detail: marketplaceWorkspaceLink.detail,
        href: marketplaceWorkspaceLink.href,
        label: `Open ${marketplaceWorkspaceLink.label}`,
      },
    ],
    [
      dashboard.inventorySummary,
      dashboard.orderSummary,
      dashboard.payoutBalance,
      inventoryWorkspaceLink.href,
      inventoryWorkspaceLink.label,
      marketplaceWorkspaceLink.detail,
      marketplaceWorkspaceLink.href,
      marketplaceWorkspaceLink.label,
      ordersWorkspaceLink.href,
      ordersWorkspaceLink.label,
      payoutWorkspaceLink.href,
      payoutWorkspaceLink.label,
    ],
  );
  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] p-6 text-neutral-950">
        <div className="mx-auto max-w-4xl rounded-md border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Seller Command Center</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Log in through your TCOS account first, then come back here to manage
            inventory, orders, marketplaces, and payouts from one place.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/account/login"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white"
            >
              Log In
            </Link>
            <Link
              href="/account"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold"
            >
              Account
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Seller
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Command Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              One place to run seller inventory, payouts, routed orders, and
              marketplace imports without bouncing between disconnected screens.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/account" label="Account" />
            <HeaderLink
              href={inventoryWorkspaceLink.href}
              label={workspaceHeaderLabel(inventoryWorkspaceLink.label)}
            />
            <HeaderLink
              href={payoutWorkspaceLink.href}
              label={workspaceHeaderLabel(payoutWorkspaceLink.label)}
            />
            <HeaderLink
              href={ordersWorkspaceLink.href}
              label={workspaceHeaderLabel(ordersWorkspaceLink.label)}
            />
            <HeaderLink
              href={marketplaceWorkspaceLink.href}
              label={workspaceHeaderLabel(marketplaceWorkspaceLink.label)}
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Metric
            label="Draft Ready"
            value={
              loading
                ? "..."
                : String(dashboard.inventorySummary?.draftReadyCount || 0)
            }
          />
          <Metric
            label="Active Listings"
            value={
              loading
                ? "..."
                : String(dashboard.inventorySummary?.activeCount || 0)
            }
          />
          <Metric
            label="Available Cash-Out"
            value={
              loading
                ? "..."
                : formatCurrency(
                    dashboard.payoutBalance?.availableToRequestAmount || 0,
                  )
            }
          />
          <Metric
            label="Held Funds"
            value={
              loading
                ? "..."
                : formatCurrency(dashboard.payoutBalance?.heldAmount || 0)
            }
          />
          <Metric
            label="Seller Orders"
            value={
              loading ? "..." : String(dashboard.orderSummary?.orderCount || 0)
            }
          />
          <Metric
            label="Active Cases"
            value={
              loading
                ? "..."
                : String(dashboard.orderSummary?.activeCaseCount || 0)
            }
          />
        </section>

        {error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {error}
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          {actionCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="rounded-md border border-neutral-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-sm"
            >
              <h2 className="text-xl font-black">{card.title}</h2>
              <p className="mt-3 text-sm leading-6 text-neutral-600">
                {card.detail}
              </p>
              <span className="mt-5 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold">
                {card.label}
              </span>
            </Link>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <article className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Drafts Needing Work</h2>
              <p className="mt-1 text-sm text-neutral-600">
                The seller drafts most likely to block your next activation push.
              </p>
            </div>

            {loading ? (
              <p className="p-5 text-sm text-neutral-600">Loading draft cleanup...</p>
            ) : urgentDrafts.length === 0 ? (
              <div className="p-5">
                <p className="text-sm text-neutral-600">
                  No urgent draft blockers are showing right now.
                </p>
                <Link
                  href={inventoryWorkspaceLink.href}
                  className="mt-4 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Open {inventoryWorkspaceLink.label}
                </Link>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                {urgentDrafts.map((item) => (
                  <div
                    key={item.inventoryItemId}
                    className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-neutral-950">{item.title}</p>
                        <p className="mt-1 text-sm text-neutral-600">
                          {formatCurrency(item.price)}
                        </p>
                      </div>
                      <span
                        className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                          item.status,
                        )}`}
                      >
                        {label(item.status)}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={sellerInventoryItemHref(item)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                      >
                        Open Seller Inventory
                      </Link>
                      <Link
                        href={sellerDraftOrderWorkspaceHref(item)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                      >
                        Open Action Orders
                      </Link>
                      <Link
                        href={sellerDraftMarketplaceHref(item)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                      >
                        Search Review Rows
                      </Link>
                      {item.activationReadiness.blockers.map((blocker) => (
                        <span
                          key={`${item.inventoryItemId}-${blocker}`}
                          className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                        >
                          {readinessBlockerLabel(blocker)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}

                <Link
                  href={inventoryNeedsWorkHref}
                  className="inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Open Needs Work Drafts
                </Link>
              </div>
            )}
          </article>

          <article className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Blocked Cash-Outs</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Requests currently pinned by active cases or held payout rows.
              </p>
            </div>

            {loading ? (
              <p className="p-5 text-sm text-neutral-600">Loading payout pressure...</p>
            ) : blockedPayoutRequests.length === 0 ? (
              <div className="p-5">
                <p className="text-sm text-neutral-600">
                  No blocked seller cash-out requests are showing right now.
                </p>
                <Link
                  href={payoutWorkspaceLink.href}
                  className="mt-4 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Open {payoutWorkspaceLink.label}
                </Link>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                {blockedPayoutRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-neutral-950">
                          Request {request.id.slice(0, 8)}
                        </p>
                        <p className="mt-1 text-sm text-neutral-600">
                          {formatCurrency(request.requestedAmount)}
                        </p>
                      </div>
                      <span
                        className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                          request.status,
                        )}`}
                      >
                        {label(request.status)}
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-neutral-700">
                      {request.reviewBlockReason || "Cash-out request is blocked."}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={sellerBlockedPayoutOrdersHref(request.id)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                      >
                        Open Action Orders
                      </Link>
                      <Link
                        href={sellerBlockedPayoutWorkspaceHref(request.id)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                      >
                        Open Blocked Payouts
                      </Link>
                    </div>

                    {request.orderSummaries?.length ? (
                      <div className="mt-3 space-y-2">
                        {request.orderSummaries.slice(0, 3).map((order) => (
                          <div
                            key={`${request.id}-order-${order.orderId}`}
                            className="flex flex-wrap gap-2"
                          >
                            <Link
                              href={sellerBlockedPayoutOrderWorkspaceHref(
                                order.orderId,
                              )}
                              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-black hover:bg-neutral-100"
                            >
                              Open Action Order #{order.orderId}
                            </Link>
                            <Link
                              href={sellerBlockedPayoutOrderDetailHref(
                                order.orderId,
                                request.id,
                              )}
                              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-black hover:bg-neutral-100"
                            >
                              Open Order Detail
                            </Link>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}

                <Link
                  href={payoutBlockedHref}
                  className="inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Open Blocked Payouts
                </Link>
              </div>
            )}
          </article>

          <article className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Action Orders</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Routed orders where review pressure, payout holds, or open claims are active.
              </p>
            </div>

            {loading ? (
              <p className="p-5 text-sm text-neutral-600">Loading order pressure...</p>
            ) : actionOrders.length === 0 ? (
              <div className="p-5">
                <p className="text-sm text-neutral-600">
                  No seller orders are asking for immediate attention right now.
                </p>
                <Link
                  href={ordersWorkspaceLink.href}
                  className="mt-4 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Open {ordersWorkspaceLink.label}
                </Link>
              </div>
            ) : (
              <div className="space-y-3 p-5">
                {actionOrders.map((order) => {
                  const orderWorkspaceLink = sellerActionOrderWorkspaceLink(order);
                  const payoutLink = sellerActionOrderPayoutLink(order);

                  return (
                    <article
                      key={order.orderId}
                      className="rounded-md border border-neutral-200 bg-neutral-50 p-4 transition hover:border-neutral-300 hover:bg-neutral-100"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-neutral-950">
                            Order #{order.orderId}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Created {shortDate(order.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                              order.paymentStatus,
                            )}`}
                          >
                            {label(order.paymentStatus)}
                          </span>
                          <span
                            className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                              order.fulfillmentStatus,
                            )}`}
                          >
                            {label(order.fulfillmentStatus)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                        <Info
                          label="Cases"
                          value={String(order.activeCaseCount)}
                        />
                        <Info
                          label="Held Rows"
                          value={String(order.heldPayoutRowCount)}
                        />
                        <Info
                          label="Open Payouts"
                          value={String(order.openCashOutRequestCount)}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={orderWorkspaceLink.href}
                          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                        >
                          {`Open ${orderWorkspaceLink.label}`}
                        </Link>
                        {payoutLink ? (
                          <Link
                            href={payoutLink.href}
                            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                          >
                            {`Open ${payoutLink.label}`}
                          </Link>
                        ) : null}
                        <Link
                          href={sellerActionOrderDetailHref(order.orderId)}
                          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                        >
                          Open Order Detail
                        </Link>
                      </div>
                    </article>
                  );
                })}

                <Link
                  href={ordersActionHref}
                  className="inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Open Action Orders
                </Link>
              </div>
            )}
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <article className="rounded-md border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 p-5">
              <div>
                <h2 className="text-2xl font-black">Recent Seller Signals</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Fresh order, payout, shipping, and review movement across your
                  seller workspace.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  session?.access_token &&
                  loadDashboard(session.access_token, { silent: true })
                }
                disabled={refreshing || !session?.access_token}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {loading ? (
              <p className="p-5 text-sm text-neutral-600">Loading seller signals...</p>
            ) : dashboard.recentSignals.length === 0 ? (
              <p className="p-5 text-sm text-neutral-600">
                No recent seller signals yet.
              </p>
            ) : (
              <div className="grid gap-3 p-5 md:grid-cols-2">
                {dashboard.recentSignals.slice(0, 6).map((signal) => (
                  <article
                    key={`${signal.orderId}-${signal.id}`}
                    className={`rounded-md border p-4 ${signalTone(signal.tone)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.14em]">
                          Order #{signal.orderId}
                        </p>
                        <p className="mt-2 text-base font-black">{signal.title}</p>
                      </div>
                      <span className="text-xs font-semibold">
                        {shortDate(signal.occurredAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm opacity-80">{signal.detail}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={signalQueueHref(signal)}
                        className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                      >
                        {signalQueueLabel(signal)}
                      </Link>
                      {signalPayoutHref(signal) ? (
                        <Link
                          href={signalPayoutHref(signal) || "#"}
                          className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                        >
                          {signalPayoutLabel(signal)}
                        </Link>
                      ) : null}
                      <Link
                        href={signalDetailHref(signal)}
                        className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                      >
                        Open Order Detail
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </article>

          <div className="space-y-6">
            <article className="rounded-md border border-neutral-200 bg-white p-5">
              <h2 className="text-2xl font-black">Inventory Pulse</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Info
                  label="Seller Items"
                  value={String(dashboard.inventorySummary?.totalItems || 0)}
                />
                <Info
                  label="Drafts"
                  value={String(dashboard.inventorySummary?.draftCount || 0)}
                />
                <Info
                  label="Needs Work"
                  value={String(
                    dashboard.inventorySummary?.draftNeedsWorkCount || 0,
                  )}
                />
                <Info
                  label="Units"
                  value={String(dashboard.inventorySummary?.totalQuantity || 0)}
                />
              </div>
              <Link
                href={inventoryWorkspaceLink.href}
                className="mt-4 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
              >
                {`Open ${inventoryWorkspaceLink.label}`}
              </Link>
            </article>

            <article className="rounded-md border border-neutral-200 bg-white p-5">
              <h2 className="text-2xl font-black">Payout Pressure</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Info
                  label="Eligible"
                  value={formatCurrency(dashboard.payoutBalance?.eligibleAmount || 0)}
                />
                <Info
                  label="Open Payouts"
                  value={String(dashboard.payoutBalance?.openRequestCount || 0)}
                />
                <Info
                  label="Blocked Payouts"
                  value={String(dashboard.payoutBalance?.blockedRequestCount || 0)}
                />
                <Info
                  label="Paid Payouts"
                  value={formatCurrency(dashboard.payoutBalance?.paidAmount || 0)}
                />
              </div>
              <Link
                href={payoutWorkspaceLink.href}
                className="mt-4 inline-flex rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
              >
                {`Open ${payoutWorkspaceLink.label}`}
              </Link>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words font-bold text-neutral-900">{value}</dd>
    </div>
  );
}

function HeaderLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
    >
      {label}
    </Link>
  );
}

function workspaceHeaderLabel(label: string) {
  if (
    label.startsWith("Open ") ||
    label.startsWith("Search ") ||
    label.startsWith("Back To ") ||
    label.startsWith("Return To ")
  ) {
    return label;
  }

  return `Open ${label}`;
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../../account/account-session";

type SellerOrderCase = {
  id: string;
  title: string;
  status: string;
  caseType: string;
  severity: string;
  updatedAt: string | null;
};

type SellerOrderSignal = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
  occurredAt: string | null;
};

type SellerOrderItem = {
  id: number;
  title: string;
  quantity: number;
  price: number;
};

type SellerOrderCashOutRequest = {
  id: string;
  status: string;
  amountRequested: number;
  requestTotal: number;
  requestedAt: string | null;
  completedAt: string | null;
  reviewBlocked: boolean;
  reviewBlockReason: string | null;
  linkedOrderIds: number[];
  activeCaseCount: number;
  blockedLedgerRowCount: number;
};

type SellerOrderActivity = {
  orderId: number;
  anchor: string;
  createdAt: string | null;
  orderTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  sellerItemCount: number;
  sellerUnitCount: number;
  sellerGrossAmount: number;
  sellerPayableAmount: number;
  platformFeeAmount: number;
  heldPayoutRowCount: number;
  openCashOutRequestCount: number;
  activeCaseCount: number;
  blockedByReview: boolean;
  payoutStatuses: string[];
  items: SellerOrderItem[];
  cashOutRequests: SellerOrderCashOutRequest[];
  cases: SellerOrderCase[];
  recentSignals: SellerOrderSignal[];
};

type SellerOrderSummary = {
  orderCount: number;
  activeCaseCount: number;
  heldOrderCount: number;
  openCashOutRequestCount: number;
  sellerPayableAmount: number;
};

type SellerQueueSignal = SellerOrderSignal & {
  orderId: number;
  anchor: string;
};

type QueueFilter =
  | "all"
  | "action_required"
  | "shipping"
  | "cash_out"
  | "completed";
type PayoutRequestFilter = "all" | "blocked" | "open" | "paid" | "attention";
type MarketplaceStageFilter = "all" | "needs_review" | "ready";

type QueueShortcut = {
  filter: QueueFilter;
  label: string;
  detail: string;
  count: number;
};

function parseQueueFilter(value: string | null): QueueFilter {
  return value === "action_required" ||
    value === "shipping" ||
    value === "cash_out" ||
    value === "completed"
    ? value
    : "all";
}

function initialOrderFilters() {
  if (typeof window === "undefined") {
    return {
      queue: "all" as QueueFilter,
      search: "",
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    queue: parseQueueFilter(params.get("queue")),
    search: params.get("search") || "",
  };
}

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

function statusTone(value: string | null | undefined) {
  if (
    value === "paid" ||
    value === "eligible" ||
    value === "completed" ||
    value === "shipped"
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
    value === "open"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
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

function signalTone(tone: SellerOrderSignal["tone"]) {
  if (tone === "positive") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-800";
}

function queueFilterForSignalKind(kind: SellerOrderSignal["kind"]): QueueFilter {
  if (kind === "shipment_saved") return "shipping";
  if (kind === "cash_out") return "cash_out";
  if (kind === "payout_hold" || kind === "review_case") {
    return "action_required";
  }
  if (kind === "payment_cleared") return "completed";
  return "all";
}

function queueShortcutButtonLabel(filter: QueueFilter) {
  if (filter === "action_required") return "Open Action Orders";
  if (filter === "shipping") return "Open Shipping Orders";
  if (filter === "cash_out") return "Open Cash-Out Orders";
  if (filter === "completed") return "Open Completed Orders";
  return "Open Seller Orders";
}

function sellerPayoutQueueHref(request: PayoutRequestFilter, search?: string) {
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

function sellerOrdersQueueHref(queue: QueueFilter, search?: string) {
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

function sellerInventoryHref(
  status: "all" | "draft" | "active" | "archived" = "all",
  readiness: "all" | "ready" | "needs_work" = "all",
  search?: string,
) {
  const params = new URLSearchParams();

  if (status !== "all") {
    params.set("status", status);
  }

  if (readiness !== "all") {
    params.set("readiness", readiness);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/inventory?${query}` : "/seller/inventory";
}

function sellerMarketplaceHref(options?: {
  stage?: MarketplaceStageFilter;
  search?: string;
}) {
  const params = new URLSearchParams();

  if (options?.stage && options.stage !== "all") {
    params.set("stage", options.stage);
  }

  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }

  const query = params.toString();
  return query ? `/seller/marketplaces?${query}` : "/seller/marketplaces";
}

function crossWorkspaceOrderSearch(search: string) {
  const trimmed = search.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.toLowerCase().includes("order ") ? trimmed : "";
}

function crossWorkspaceInventorySearch(search: string) {
  const trimmed = search.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.toLowerCase().includes("order ") ? "" : trimmed;
}

function orderInventoryWorkspaceLink(queue: QueueFilter, search: string) {
  const inventorySearch = crossWorkspaceInventorySearch(search);

  if (queue === "action_required") {
    return {
      href: sellerInventoryHref("draft", "needs_work", inventorySearch),
      label: inventorySearch ? "Search Needs Work" : "Needs Work Drafts",
    };
  }

  if (
    queue === "shipping" ||
    queue === "cash_out" ||
    queue === "completed"
  ) {
    return {
      href: sellerInventoryHref("active", "all", inventorySearch),
      label: inventorySearch ? "Search Active Inventory" : "Active Inventory",
    };
  }

  return {
    href: sellerInventoryHref("all", "all", inventorySearch),
    label: inventorySearch ? "Search Seller Inventory" : "Seller Inventory",
  };
}

function orderMarketplaceWorkspaceLink(search: string) {
  const marketplaceSearch = crossWorkspaceInventorySearch(search);

  return {
    href: sellerMarketplaceHref({
      search: marketplaceSearch,
    }),
    label: marketplaceSearch ? "Search Marketplace Rows" : "Marketplace Rows",
  };
}

function orderMarketplaceWorkspaceByQueue(
  queue: QueueFilter,
  search: string,
) {
  const marketplaceSearch = crossWorkspaceInventorySearch(search);

  if (queue === "action_required") {
    return {
      href: sellerMarketplaceHref({
        stage: "needs_review",
        search: marketplaceSearch,
      }),
      label: marketplaceSearch ? "Search Review Rows" : "Open Review Rows",
    };
  }

  return {
    ...orderMarketplaceWorkspaceLink(search),
  };
}

function orderItemInventoryHref(title: string) {
  return sellerInventoryHref("all", "all", title);
}

function orderItemMarketplaceHref(title: string, needsReview: boolean) {
  return sellerMarketplaceHref({
    stage: needsReview ? "needs_review" : "all",
    search: title,
  });
}

function orderQueuePayoutLink(queue: QueueFilter, search: string) {
  const orderSearch = crossWorkspaceOrderSearch(search);

  if (queue === "action_required") {
    return {
      href: sellerPayoutQueueHref("blocked", orderSearch),
      label: "Open Blocked Payouts",
    };
  }

  if (queue === "shipping") {
    return {
      href: sellerPayoutQueueHref("attention", orderSearch),
      label: "Open Attention Payouts",
    };
  }

  if (queue === "cash_out") {
    return {
      href: sellerPayoutQueueHref("open", orderSearch),
      label: "Open Cash-Out Payouts",
    };
  }

  if (queue === "completed") {
    return {
      href: sellerPayoutQueueHref("paid", orderSearch),
      label: "Open Paid Payouts",
    };
  }

  return {
    href: sellerPayoutQueueHref("all", orderSearch),
    label: "Open Seller Payouts",
  };
}

function reviewCaseWorkspaceLinks(
  orderId: number,
  reviewCase: SellerOrderCase,
) {
  const scopedOrderSearch = `order ${orderId}`;

  if (
    reviewCase.status === "decided_for_seller" ||
    reviewCase.status === "closed"
  ) {
      return [
        {
          href: sellerOrdersQueueHref("completed", scopedOrderSearch),
          label: "Open Completed Orders",
        },
      ];
  }

  return [
    {
      href: sellerOrdersQueueHref("action_required", scopedOrderSearch),
      label: "Open Action Orders",
    },
    {
      href: sellerPayoutQueueHref("blocked", scopedOrderSearch),
      label: "Open Blocked Payouts",
    },
  ];
}

function payoutRequestWorkspaceLink(request: SellerOrderCashOutRequest) {
  const params = new URLSearchParams();
  let label = "Open Attention Payouts";

  if (request.reviewBlocked) {
    params.set("request", "blocked");
    label = "Open Blocked Payouts";
  } else if (request.status === "paid") {
    params.set("request", "paid");
    label = "Open Paid Payouts";
  } else if (["requested", "approved", "processing"].includes(request.status)) {
    params.set("request", "open");
    label = "Open Cash-Out Payouts";
  } else {
    params.set("request", "attention");
  }

  params.set("search", request.id);
  return {
    href: `/seller/payouts?${params.toString()}#request-${request.id}`,
    label,
  };
}

function cashOutRequestQueueLink(
  order: SellerOrderActivity,
  request: SellerOrderCashOutRequest,
) {
  if (
    request.reviewBlocked ||
    request.activeCaseCount > 0 ||
    request.blockedLedgerRowCount > 0
  ) {
    return {
      href: `/seller/orders?queue=action_required&search=${encodeURIComponent(request.id)}`,
      label: "Open Action Orders",
    };
  }

  if (order.fulfillmentStatus !== "shipped" && order.sellerUnitCount > 0) {
    return {
      href: `/seller/orders?queue=shipping&search=${encodeURIComponent(request.id)}`,
      label: "Open Shipping Orders",
    };
  }

  if (["requested", "approved", "processing"].includes(request.status)) {
    return {
      href: `/seller/orders?queue=cash_out&search=${encodeURIComponent(request.id)}`,
      label: "Open Cash-Out Orders",
    };
  }

  if (request.status === "paid") {
    return {
      href: `/seller/orders?queue=completed&search=${encodeURIComponent(request.id)}`,
      label: "Open Completed Orders",
    };
  }

  return {
    href: `/seller/orders?search=${encodeURIComponent(request.id)}`,
    label: "Open Seller Orders",
  };
}

function orderSignalQueueAction(
  orderId: number,
  signal: SellerOrderSignal,
) {
  const queue = queueFilterForSignalKind(signal.kind);
  const search = `order ${orderId}`;

  if (queue === "action_required") {
    return {
      href: `/seller/orders?queue=action_required&search=${encodeURIComponent(search)}`,
      label: "Open Action Orders",
    };
  }

  if (queue === "shipping") {
    return {
      href: `/seller/orders?queue=shipping&search=${encodeURIComponent(search)}`,
      label: "Open Shipping Orders",
    };
  }

  if (queue === "cash_out") {
    return {
      href: `/seller/orders?queue=cash_out&search=${encodeURIComponent(search)}`,
      label: "Open Cash-Out Orders",
    };
  }

  if (queue === "completed") {
    return {
      href: `/seller/orders?queue=completed&search=${encodeURIComponent(search)}`,
      label: "Open Completed Orders",
    };
  }

  return {
    href: `/seller/orders?search=${encodeURIComponent(search)}`,
    label: "Open Seller Orders",
  };
}

function orderSignalPayoutAction(orderId: number, signal: SellerOrderSignal) {
  const search = `order ${orderId}`;

  if (signal.kind === "cash_out") {
    return {
      href: sellerPayoutQueueHref("open", search),
      label: "Open Cash-Out Payouts",
    };
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    return {
      href: sellerPayoutQueueHref("blocked", search),
      label: "Open Blocked Payouts",
    };
  }

  return null;
}

function queueSignalPayoutAction(signal: SellerQueueSignal) {
  const search = `order ${signal.orderId}`;

  if (signal.kind === "cash_out") {
    return {
      href: sellerPayoutQueueHref("open", search),
      label: "Open Cash-Out Payouts",
    };
  }

  if (signal.kind === "payout_hold" || signal.kind === "review_case") {
    return {
      href: sellerPayoutQueueHref("blocked", search),
      label: "Open Blocked Payouts",
    };
  }

  return null;
}

function queueSignalQueueAction(signal: SellerQueueSignal) {
  const queue = queueFilterForSignalKind(signal.kind);
  const search = `order ${signal.orderId}`;

  if (queue === "action_required") {
    return {
      filter: "action_required" as QueueFilter,
      search,
      label: "Action Orders",
    };
  }

  if (queue === "shipping") {
    return {
      filter: "shipping" as QueueFilter,
      search,
      label: "Shipping Orders",
    };
  }

  if (queue === "cash_out") {
    return {
      filter: "cash_out" as QueueFilter,
      search,
      label: "Cash-Out Orders",
    };
  }

  if (queue === "completed") {
    return {
      filter: "completed" as QueueFilter,
      search,
      label: "Completed Orders",
    };
  }

  return {
    filter: "all" as QueueFilter,
    search,
    label: "Seller Orders",
  };
}

export default function SellerOrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [initialFilters] = useState(initialOrderFilters);
  const [summary, setSummary] = useState<SellerOrderSummary | null>(null);
  const [orders, setOrders] = useState<SellerOrderActivity[]>([]);
  const [recentSignals, setRecentSignals] = useState<SellerQueueSignal[]>([]);
  const [loading, setLoading] = useState(() => Boolean(session?.access_token));
  const [error, setError] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(
    initialFilters.queue,
  );
  const [search, setSearch] = useState(initialFilters.search);

  function syncOrderUrl(next: { filter?: QueueFilter; search?: string }) {
    const finalFilter = next.filter ?? queueFilter;
    const finalSearch = next.search ?? search;
    const params = new URLSearchParams();

    if (finalFilter !== "all") {
      params.set("queue", finalFilter);
    }

    if (finalSearch.trim()) {
      params.set("search", finalSearch.trim());
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function setOrderQueueView(next: { filter?: QueueFilter; search?: string }) {
    const finalFilter = next.filter ?? queueFilter;
    const finalSearch = next.search ?? search;

    setQueueFilter(finalFilter);
    setSearch(finalSearch);
    syncOrderUrl({ filter: finalFilter, search: finalSearch });
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/account/seller/orders", {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Could not load seller order activity.");
          }

          if (!cancelled) {
            setSummary((data.summary || null) as SellerOrderSummary | null);
            setOrders((data.orders || []) as SellerOrderActivity[]);
            setRecentSignals((data.recentSignals || []) as SellerQueueSignal[]);
            setError("");
          }
        } catch (nextError: any) {
          if (!cancelled) {
            setError(
              nextError.message || "Could not load seller order activity.",
            );
            setSummary(null);
            setOrders([]);
            setRecentSignals([]);
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

  const filteredOrders = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (queueFilter === "action_required") {
        const hasActionPressure =
          order.blockedByReview ||
          order.activeCaseCount > 0 ||
          order.heldPayoutRowCount > 0;

        if (!hasActionPressure) return false;
      }

      if (queueFilter === "shipping") {
        const needsShippingAttention =
          order.fulfillmentStatus !== "shipped" && order.sellerUnitCount > 0;

        if (!needsShippingAttention) return false;
      }

      if (queueFilter === "cash_out" && order.openCashOutRequestCount <= 0) {
        return false;
      }

      if (queueFilter === "completed") {
        const isCompleted =
          order.fulfillmentStatus === "shipped" &&
          order.paymentStatus === "paid" &&
          order.activeCaseCount === 0;

        if (!isCompleted) return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        `order ${order.orderId}`,
        order.paymentStatus,
        order.fulfillmentStatus,
        order.trackingNumber || "",
        order.carrier || "",
        ...order.items.map((item) => item.title),
        ...order.cashOutRequests.flatMap((request) => [
          request.id,
          request.status,
          ...request.linkedOrderIds.map((linkedOrderId) => `order ${linkedOrderId}`),
        ]),
        ...order.cases.map((reviewCase) => reviewCase.title),
        ...order.recentSignals.map((signal) => signal.title),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [orders, queueFilter, search]);

  const queueFilterCounts = useMemo(
    () => ({
      all: orders.length,
      action_required: orders.filter(
        (order) =>
          order.blockedByReview ||
          order.activeCaseCount > 0 ||
          order.heldPayoutRowCount > 0,
      ).length,
      shipping: orders.filter(
        (order) =>
          order.fulfillmentStatus !== "shipped" && order.sellerUnitCount > 0,
      ).length,
      cash_out: orders.filter((order) => order.openCashOutRequestCount > 0).length,
      completed: orders.filter(
        (order) =>
          order.fulfillmentStatus === "shipped" &&
          order.paymentStatus === "paid" &&
          order.activeCaseCount === 0,
      ).length,
    }),
    [orders],
  );
  const queueShortcuts = useMemo<QueueShortcut[]>(
    () => [
      {
        filter: "action_required",
        label: "Action Required",
        detail: "Orders with review pressure, held payout rows, or seller-side case risk.",
        count: queueFilterCounts.action_required,
      },
      {
        filter: "shipping",
        label: "Shipping Needed",
        detail: "Orders that still need shipment or tracking follow-through.",
        count: queueFilterCounts.shipping,
      },
      {
        filter: "cash_out",
        label: "Cash-Out Linked",
        detail: "Orders already tied to active seller cash-out requests.",
        count: queueFilterCounts.cash_out,
      },
      {
        filter: "completed",
        label: "Completed Cleanly",
        detail: "Paid and shipped orders without active seller review pressure.",
        count: queueFilterCounts.completed,
      },
    ],
    [queueFilterCounts],
  );
  const payoutWorkspaceLink = orderQueuePayoutLink(queueFilter, search);
  const inventoryWorkspaceLink = orderInventoryWorkspaceLink(queueFilter, search);
  const marketplaceWorkspaceLink = orderMarketplaceWorkspaceByQueue(
    queueFilter,
    search,
  );

  function focusQueue(filter: QueueFilter, nextSearch = "") {
    setOrderQueueView({ filter, search: nextSearch });
  }

  function orderDetailHref(
    orderId: number,
    filter: QueueFilter = queueFilter,
    searchTerm: string = search,
  ) {
    const params = new URLSearchParams();

    if (filter !== "all") {
      params.set("queue", filter);
    }

    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
    }

    const query = params.toString();
    return query ? `/seller/orders/${orderId}?${query}` : `/seller/orders/${orderId}`;
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] p-6 text-neutral-950">
        <div className="mx-auto max-w-4xl rounded-md border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Seller Order Activity</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Log in through your TCOS account first, then come back here to review
            seller-owned orders, payout holds, and cash-out blockers.
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
              Order And Payout Activity
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Seller-owned order flow, payout status, case pressure, and cash-out
              blockers for your routed items on the active store.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/seller" label="Seller Home" />
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
              href={marketplaceWorkspaceLink.href}
              label={workspaceHeaderLabel(marketplaceWorkspaceLink.label)}
            />
            <HeaderLink href="/seller-terms" label="Seller Terms" primary />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric
            label="Seller Orders"
            value={loading ? "..." : String(summary?.orderCount || 0)}
          />
          <Metric
            label="Active Cases"
            value={loading ? "..." : String(summary?.activeCaseCount || 0)}
          />
          <Metric
            label="Held Orders"
            value={loading ? "..." : String(summary?.heldOrderCount || 0)}
          />
          <Metric
            label="Open Payouts"
            value={loading ? "..." : String(summary?.openCashOutRequestCount || 0)}
          />
          <Metric
            label="Seller Payable"
            value={loading ? "..." : formatCurrency(summary?.sellerPayableAmount || 0)}
          />
        </section>

        {error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {error}
          </section>
        ) : null}

        {!error ? (
          <section className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Fresh Seller Signals</h2>
              <p className="mt-1 text-sm text-neutral-600">
                The most recent order, payout, shipping, and review movement across
                your seller workspace.
              </p>
            </div>

            {loading ? (
              <p className="p-5 text-sm text-neutral-600">Loading recent activity...</p>
            ) : recentSignals.length === 0 ? (
              <p className="p-5 text-sm text-neutral-600">
                No recent seller signals yet.
              </p>
            ) : (
              <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
                {recentSignals.map((signal) => (
                  <article
                    key={`${signal.orderId}-${signal.id}`}
                    className={`rounded-md border p-4 ${signalTone(signal.tone)}`}
                  >
                    {(() => {
                      const payoutAction = queueSignalPayoutAction(signal);
                      const queueAction = queueSignalQueueAction(signal);

                      return (
                        <>
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
                      <button
                        type="button"
                        onClick={() =>
                          focusQueue(queueAction.filter, queueAction.search)
                        }
                        className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                      >
                        {queueAction.label}
                      </button>
                      {payoutAction ? (
                        <Link
                          href={payoutAction.href}
                          className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                        >
                          {payoutAction.label}
                        </Link>
                      ) : null}
                      <Link
                        href={`${orderDetailHref(
                          signal.orderId,
                          queueFilterForSignalKind(signal.kind as SellerOrderSignal["kind"]),
                          `order ${signal.orderId}`,
                        )}#recent-activity`}
                        className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                      >
                        Open Order Detail
                      </Link>
                    </div>
                        </>
                      );
                    })()}
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Seller Order Workspace</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Each row is scoped to your seller-owned items only. Order totals may
              include buyer purchases from other store inventory on the same order.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {queueShortcuts.map((shortcut) => (
                <div
                  key={shortcut.filter}
                  className={`rounded-md border p-4 ${
                    queueFilter === shortcut.filter
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-200 bg-neutral-50 text-neutral-950"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p
                        className={`text-xs font-black uppercase tracking-[0.14em] ${
                          queueFilter === shortcut.filter
                            ? "text-white/70"
                            : "text-neutral-500"
                        }`}
                      >
                        {shortcut.label}
                      </p>
                      <p className="mt-2 text-3xl font-black">{shortcut.count}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => focusQueue(shortcut.filter)}
                        className={`rounded-md px-3 py-2 text-xs font-bold ${
                          queueFilter === shortcut.filter
                            ? "bg-white text-neutral-950 hover:bg-neutral-100"
                            : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100"
                        }`}
                      >
                        {queueShortcutButtonLabel(shortcut.filter)}
                      </button>
                      <Link
                        href={orderQueuePayoutLink(shortcut.filter, "").href}
                        className={`rounded-md px-3 py-2 text-xs font-bold ${
                          queueFilter === shortcut.filter
                            ? "border border-white/30 bg-transparent text-white hover:bg-white/10"
                            : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100"
                        }`}
                      >
                        {orderQueuePayoutLink(shortcut.filter, "").label}
                      </Link>
                    </div>
                  </div>
                  <p
                    className={`mt-3 text-sm ${
                      queueFilter === shortcut.filter
                        ? "text-white/80"
                        : "text-neutral-600"
                    }`}
                  >
                    {shortcut.detail}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Search orders
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) =>
                    setOrderQueueView({ search: event.target.value })
                  }
                  placeholder="Order number, item title, case title, carrier, or tracking"
                  className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
                />
              </label>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Order views
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <FilterChip
                    active={queueFilter === "all"}
                    label={`All (${queueFilterCounts.all})`}
                    onClick={() => setOrderQueueView({ filter: "all" })}
                  />
                  <FilterChip
                    active={queueFilter === "action_required"}
                    label={`Action (${queueFilterCounts.action_required})`}
                    onClick={() =>
                      setOrderQueueView({ filter: "action_required" })
                    }
                  />
                  <FilterChip
                    active={queueFilter === "shipping"}
                    label={`Shipping (${queueFilterCounts.shipping})`}
                    onClick={() => setOrderQueueView({ filter: "shipping" })}
                  />
                  <FilterChip
                    active={queueFilter === "cash_out"}
                    label={`Cash-Out (${queueFilterCounts.cash_out})`}
                    onClick={() => setOrderQueueView({ filter: "cash_out" })}
                  />
                  <FilterChip
                    active={queueFilter === "completed"}
                    label={`Completed (${queueFilterCounts.completed})`}
                    onClick={() => setOrderQueueView({ filter: "completed" })}
                  />
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="p-5 text-sm text-neutral-600">Loading seller order activity...</p>
          ) : orders.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller-owned orders found yet.
            </p>
          ) : filteredOrders.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-neutral-600">
                No seller orders match the current order view.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOrderQueueView({
                      filter: "all",
                      search: "",
                    });
                  }}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Reset Order View
                </button>
                {queueFilter !== "action_required" &&
                queueFilterCounts.action_required > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusQueue("action_required")}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Open Action Orders
                  </button>
                ) : null}
                {queueFilter !== "shipping" && queueFilterCounts.shipping > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusQueue("shipping")}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Open Shipping Orders
                  </button>
                ) : null}
                {queueFilter !== "cash_out" && queueFilterCounts.cash_out > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusQueue("cash_out")}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Open Cash-Out Orders
                  </button>
                ) : null}
                <Link
                  href={payoutWorkspaceLink.href}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  {`Open ${payoutWorkspaceLink.label}`}
                </Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-neutral-200">
              {filteredOrders.map((order) => (
                <article
                  key={order.orderId}
                  id={order.anchor}
                  className="grid gap-5 p-5 xl:grid-cols-[1.2fr_0.95fr_320px]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                          order.fulfillmentStatus,
                        )}`}
                      >
                        {label(order.fulfillmentStatus)}
                      </span>
                      <span
                        className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                          order.paymentStatus,
                        )}`}
                      >
                        {label(order.paymentStatus)}
                      </span>
                      {order.blockedByReview ? (
                        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-800">
                          HOLD CONTEXT
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-3 text-xl font-black">
                      <Link
                        href={orderDetailHref(order.orderId)}
                        className="underline"
                      >
                        Order #{order.orderId}
                      </Link>
                    </h3>
                    <p className="mt-2 text-sm text-neutral-600">
                      Created {shortDate(order.createdAt)} / Shipped{" "}
                      {shortDate(order.shippedAt)}
                    </p>
                    <Link
                      href={orderDetailHref(order.orderId)}
                      className="mt-3 inline-block text-sm font-bold text-neutral-700 underline"
                    >
                      Open Order Detail
                    </Link>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <Info
                        label="Your Items"
                        value={`${order.sellerItemCount} rows / ${order.sellerUnitCount} units`}
                      />
                      <Info
                        label="Seller Gross"
                        value={formatCurrency(order.sellerGrossAmount)}
                      />
                      <Info
                        label="Seller Payable"
                        value={formatCurrency(order.sellerPayableAmount)}
                      />
                    </div>

                    {order.recentSignals.length > 0 ? (
                      <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black text-neutral-950">
                            Latest Movement
                          </p>
                          <span className="text-xs font-semibold uppercase text-neutral-500">
                            {order.recentSignals.length} signal(s)
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {order.recentSignals.slice(0, 3).map((signal) => (
                            <div
                              key={signal.id}
                              className={`rounded-md border px-3 py-3 ${signalTone(
                                signal.tone,
                              )}`}
                            >
                              {(() => {
                                const queueAction = orderSignalQueueAction(
                                  order.orderId,
                                  signal,
                                );
                                const payoutAction = orderSignalPayoutAction(
                                  order.orderId,
                                  signal,
                                );

                                return (
                                  <>
                              <div className="flex items-start justify-between gap-3">
                                <p className="font-black">{signal.title}</p>
                                <span className="text-xs font-semibold">
                                  {shortDate(signal.occurredAt)}
                                </span>
                              </div>
                              <p className="mt-1 text-sm opacity-80">
                                {signal.detail}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Link
                                  href={queueAction.href}
                                  className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                                >
                                  {queueAction.label}
                                </Link>
                                {payoutAction ? (
                                  <Link
                                    href={payoutAction.href}
                                    className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                                  >
                                    {payoutAction.label}
                                  </Link>
                                ) : null}
                                <Link
                                  href={orderDetailHref(
                                    order.orderId,
                                    queueFilterForSignalKind(
                                      signal.kind as SellerOrderSignal["kind"],
                                    ),
                                    `order ${order.orderId}`,
                                  )}
                                  className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                                >
                                  Open Order Detail
                                </Link>
                              </div>
                                  </>
                                );
                              })()}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                      <p className="text-sm font-black text-neutral-900">Item Scope</p>
                      <div className="mt-3 space-y-2 text-sm text-neutral-700">
                        {order.items.map((item) => (
                          <div
                            key={item.id}
                            className="rounded border border-neutral-200 bg-white px-3 py-3"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-neutral-950">
                                  {item.title}
                                </p>
                                <p className="text-xs text-neutral-500">
                                  {item.quantity} unit(s)
                                </p>
                              </div>
                              <span className="font-bold text-neutral-950">
                                {formatCurrency(item.price)}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Link
                                href={orderItemInventoryHref(item.title)}
                                className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                              >
                                Search Seller Inventory
                              </Link>
                              <Link
                                href={orderItemMarketplaceHref(
                                  item.title,
                                  order.blockedByReview ||
                                    order.activeCaseCount > 0 ||
                                    order.heldPayoutRowCount > 0,
                                )}
                                className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                              >
                                {order.blockedByReview ||
                                order.activeCaseCount > 0 ||
                                order.heldPayoutRowCount > 0
                                  ? "Search Review Rows"
                                  : "Search Marketplace Rows"}
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 text-sm">
                    <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                      <h4 className="font-black">Payout State</h4>
                      <dl className="mt-3 grid grid-cols-2 gap-3">
                        <Info
                          label="Order Total"
                          value={formatCurrency(order.orderTotal)}
                        />
                        <Info
                          label="Platform Fee"
                          value={formatCurrency(order.platformFeeAmount)}
                        />
                        <Info
                          label="Held Rows"
                          value={String(order.heldPayoutRowCount)}
                        />
                        <Info
                          label="Open Cash-Out"
                          value={String(order.openCashOutRequestCount)}
                        />
                      </dl>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {order.payoutStatuses.map((status) => (
                          <span
                            key={`${order.orderId}-${status}`}
                            className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                              status,
                            )}`}
                          >
                            {label(status)}
                          </span>
                        ))}
                      </div>

                      {order.cashOutRequests.length > 0 ? (
                        <div className="mt-4 space-y-2">
                          <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                            Cash-Out Payouts
                          </p>
                          {order.cashOutRequests.map((request) => {
                            const otherLinkedOrderIds = request.linkedOrderIds.filter(
                              (linkedOrderId) => linkedOrderId !== order.orderId,
                            );
                            const requestQueueLink = cashOutRequestQueueLink(
                              order,
                              request,
                            );
                            const requestPayoutLink =
                              payoutRequestWorkspaceLink(request);

                            return (
                              <div
                                key={`${order.orderId}-${request.id}`}
                                className="rounded-md border border-neutral-200 bg-white p-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="font-bold text-neutral-950">
                                      Request {request.id.slice(0, 8)}
                                    </p>
                                    <p className="mt-1 text-xs text-neutral-500">
                                      This order:{" "}
                                      {formatCurrency(request.amountRequested)}
                                      {" / "}Request total:{" "}
                                      {formatCurrency(request.requestTotal)}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <span
                                      className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                                        request.status,
                                      )}`}
                                    >
                                      {label(request.status)}
                                    </span>
                                    {request.reviewBlocked ? (
                                      <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900">
                                        BLOCKED
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-3">
                                  <Info
                                    label="Active Cases"
                                    value={String(request.activeCaseCount)}
                                  />
                                  <Info
                                    label="Held Rows"
                                    value={String(request.blockedLedgerRowCount)}
                                  />
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Link
                                    href={requestQueueLink.href}
                                    className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                                  >
                                    {requestQueueLink.label}
                                  </Link>
                                  <Link
                                    href={requestPayoutLink.href}
                                    className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                                  >
                                    {requestPayoutLink.label}
                                  </Link>
                                  {otherLinkedOrderIds.map((linkedOrderId) => (
                                    <Link
                                      key={`${request.id}-${linkedOrderId}`}
                                      href={orderDetailHref(linkedOrderId)}
                                      className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                                    >
                                      Order #{linkedOrderId}
                                    </Link>
                                  ))}
                                </div>

                                <p className="mt-3 text-xs text-neutral-500">
                                  Requested {shortDate(request.requestedAt)} /
                                  Completed {shortDate(request.completedAt)}
                                </p>

                                {request.reviewBlocked ? (
                                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
                                    {request.reviewBlockReason ||
                                      "This seller cash-out request is currently blocked by review or payout hold context."}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </section>

                    <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                      <h4 className="font-black">Shipping</h4>
                      <p className="mt-2 text-neutral-700">
                        {order.trackingNumber ? (
                          <>
                            {order.carrier ? `${order.carrier} ` : ""}
                            {order.trackingNumber}
                          </>
                        ) : (
                          "Tracking not saved yet."
                        )}
                      </p>
                    </section>
                  </div>

                  <aside className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                    <h4 className="font-black">Review Pressure</h4>
                    <p className="mt-2 text-sm text-neutral-600">
                      Active cases: <strong>{order.activeCaseCount}</strong>
                    </p>
                    <p className="mt-1 text-sm text-neutral-600">
                      Hold rows: <strong>{order.heldPayoutRowCount}</strong>
                    </p>
                    <p className="mt-1 text-sm text-neutral-600">
                      Open cash-out claims: <strong>{order.openCashOutRequestCount}</strong>
                    </p>

                    {order.cases.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        {order.cases.map((reviewCase) => (
                          <div
                            key={reviewCase.id}
                            className="rounded-md border border-neutral-200 bg-white p-3"
                          >
                            <div className="flex flex-wrap gap-2">
                              <span
                                className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                                  reviewCase.status,
                                )}`}
                              >
                                {label(reviewCase.status)}
                              </span>
                              <span
                                className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                                  reviewCase.severity,
                                )}`}
                              >
                                {label(reviewCase.severity)}
                              </span>
                            </div>
                            <p className="mt-2 font-bold text-neutral-950">
                              {reviewCase.title}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {label(reviewCase.caseType)} / Updated{" "}
                              {shortDate(reviewCase.updatedAt)}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {reviewCaseWorkspaceLinks(
                                order.orderId,
                                reviewCase,
                              ).map((action) => (
                                <Link
                                  key={`${reviewCase.id}-${action.label}`}
                                  href={action.href}
                                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                                >
                                  {action.label}
                                </Link>
                              ))}
                              <Link
                                href={orderDetailHref(order.orderId)}
                                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                              >
                                Open Order Detail
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-neutral-600">
                        No active seller-scoped review cases on this order.
                      </p>
                    )}
                  </aside>
                </article>
              ))}
            </div>
          )}
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
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link
      href={href}
      className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}
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

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
        active
          ? "border-neutral-950 bg-neutral-950 text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}

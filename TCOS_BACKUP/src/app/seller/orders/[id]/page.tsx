"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../../../account/account-session";

type SellerOrderDetail = {
  orderId: number;
  createdAt: string | null;
  orderTotal: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  shippingName: string | null;
  shippingAmount: number;
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  sellerItemCount: number;
  sellerUnitCount: number;
  sellerGrossAmount: number;
  sellerPayableAmount: number;
  platformFeeAmount: number;
  heldPayoutRowCount: number;
  activeCaseCount: number;
};

type SellerOrderItem = {
  id: number;
  title: string;
  quantity: number;
  price: number;
  lineTotal: number;
};

type SellerOrderPayoutRow = {
  id: string;
  orderItemId: number;
  itemTitle: string;
  grossItemAmount: number;
  shippingAllocatedAmount: number;
  platformFeeAmount: number;
  sellerPayableAmount: number;
  payoutStatus: string;
  createdAt: string | null;
};

type SellerCashOutRequest = {
  id: string;
  status: string;
  amountRequested: number;
  requestTotal: number;
  estimatedNetAmount: number;
  finalNetAmount: number;
  requestedAt: string | null;
  completedAt: string | null;
  reviewBlocked: boolean;
  reviewBlockReason: string | null;
  linkedOrderIds: number[];
  activeCaseCount: number;
  blockedLedgerRowCount: number;
};

type SellerOrderSignal = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  tone: "positive" | "warning" | "neutral";
  occurredAt: string | null;
};

type SellerReviewCase = {
  id: string;
  title: string;
  caseType: string;
  status: string;
  severity: string;
  description: string | null;
  outcomeSummary: string | null;
  updatedAt: string | null;
  sellerScoped: boolean;
};

type QueueFilter =
  | "all"
  | "action_required"
  | "shipping"
  | "cash_out"
  | "completed";

type PayoutReturnFilter = "all" | "blocked" | "open" | "paid" | "attention";
type ReturnTarget = "orders" | "payouts";
type MarketplaceStageFilter = "all" | "needs_review" | "ready";

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

function parseQueueFilter(value: string | null): QueueFilter {
  return value === "action_required" ||
    value === "shipping" ||
    value === "cash_out" ||
    value === "completed"
    ? value
    : "all";
}

function queueLabel(value: QueueFilter) {
  if (value === "action_required") return "Action Orders";
  if (value === "shipping") return "Shipping Orders";
  if (value === "cash_out") return "Cash-Out Orders";
  if (value === "completed") return "Completed Orders";
  return "Seller Orders";
}

function parsePayoutReturnFilter(value: string | null): PayoutReturnFilter {
  return value === "blocked" ||
    value === "open" ||
    value === "paid" ||
    value === "attention"
    ? value
    : "all";
}

function payoutReturnLabel(value: PayoutReturnFilter) {
  if (value === "blocked") return "Blocked Payouts";
  if (value === "open") return "Cash-Out Payouts";
  if (value === "paid") return "Paid Payouts";
  if (value === "attention") return "Attention Payouts";
  return "Payouts";
}

function initialOrderDetailReturnState() {
  if (typeof window === "undefined") {
    return {
      target: "orders" as ReturnTarget,
      queue: "all" as QueueFilter,
      search: "",
      payoutFilter: "all" as PayoutReturnFilter,
      payoutSearch: "",
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    target: params.get("return") === "payouts" ? ("payouts" as ReturnTarget) : ("orders" as ReturnTarget),
    queue: parseQueueFilter(params.get("queue")),
    search: params.get("search") || "",
    payoutFilter: parsePayoutReturnFilter(params.get("request")),
    payoutSearch: params.get("requestSearch") || "",
  };
}

function sellerOrdersQueueHref(queue: QueueFilter, search: string) {
  const params = new URLSearchParams();

  if (queue !== "all") {
    params.set("queue", queue);
  }

  if (search.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/orders?${query}` : "/seller/orders";
}

function sellerPayoutReturnHref(filter: PayoutReturnFilter, search: string) {
  const params = new URLSearchParams();

  if (filter !== "all") {
    params.set("request", filter);
  }

  if (search.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/payouts?${query}` : "/seller/payouts";
}

function sellerPayoutQueueHref(
  filter: "blocked" | "open" | "attention",
  search: string,
) {
  const params = new URLSearchParams();
  params.set("request", filter);

  if (search.trim()) {
    params.set("search", search.trim());
  }

  return `/seller/payouts?${params.toString()}`;
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

function sellerOrderItemInventoryHref(title: string) {
  return sellerInventoryHref("all", "all", title);
}

function sellerOrderItemMarketplaceHref(
  title: string,
  needsReview: boolean,
) {
  return sellerMarketplaceHref({
    stage: needsReview ? "needs_review" : "all",
    search: title,
  });
}

function sellerPayoutRowInventoryHref(title: string) {
  return sellerInventoryHref("all", "all", title);
}

function sellerPayoutRowMarketplaceHref(
  title: string,
  needsReview: boolean,
) {
  return sellerMarketplaceHref({
    stage: needsReview ? "needs_review" : "all",
    search: title,
  });
}

function signalQueueHref(orderId: string, kind: string) {
  const search = `order ${orderId}`;

  if (kind === "shipment_saved") {
    return sellerOrdersQueueHref("shipping", search);
  }

  if (kind === "cash_out") {
    return sellerOrdersQueueHref("cash_out", search);
  }

  if (kind === "payment_cleared") {
    return sellerOrdersQueueHref("completed", search);
  }

  return sellerOrdersQueueHref("action_required", search);
}

function signalQueueLabel(kind: string) {
  if (kind === "shipment_saved") {
    return "Open Shipping Orders";
  }

  if (kind === "cash_out") {
    return "Open Cash-Out Orders";
  }

  if (kind === "payment_cleared") {
    return "Open Completed Orders";
  }

  return "Open Action Orders";
}

function signalPayoutAction(kind: string, blockedHref: string, openHref: string) {
  if (kind === "cash_out") {
    return {
      href: openHref,
      label: "Open Cash-Out Payouts",
    };
  }

  if (kind === "payout_hold" || kind === "review_case") {
    return {
      href: blockedHref,
      label: "Open Blocked Payouts",
    };
  }

  return null;
}

export default function SellerOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params?.id || "";
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [returnContext] = useState(initialOrderDetailReturnState);
  const [order, setOrder] = useState<SellerOrderDetail | null>(null);
  const [items, setItems] = useState<SellerOrderItem[]>([]);
  const [payoutRows, setPayoutRows] = useState<SellerOrderPayoutRow[]>([]);
  const [cashOutRequests, setCashOutRequests] = useState<SellerCashOutRequest[]>(
    [],
  );
  const [reviewCases, setReviewCases] = useState<SellerReviewCase[]>([]);
  const [recentSignals, setRecentSignals] = useState<SellerOrderSignal[]>([]);
  const [loading, setLoading] = useState(() => Boolean(session?.access_token));
  const [error, setError] = useState("");
  const backToQueueHref =
    returnContext.target === "payouts"
      ? sellerPayoutReturnHref(
          returnContext.payoutFilter,
          returnContext.payoutSearch,
        )
      : sellerOrdersQueueHref(returnContext.queue, returnContext.search);
  const backToQueueLabel =
    returnContext.target === "payouts"
      ? `Return To ${payoutReturnLabel(returnContext.payoutFilter)}`
      : returnContext.queue === "all"
        ? "Return To Seller Orders"
        : `Return To ${queueLabel(returnContext.queue)}`;
  const scopedOrderSearch = `order ${orderId}`;
  const actionQueueHref = sellerOrdersQueueHref(
    "action_required",
    scopedOrderSearch,
  );
  const shippingQueueHref = sellerOrdersQueueHref(
    "shipping",
    scopedOrderSearch,
  );
  const payoutBlockedHref = sellerPayoutQueueHref(
    "blocked",
    scopedOrderSearch,
  );
  const payoutOpenHref = sellerPayoutQueueHref("open", scopedOrderSearch);
  const hasBlockedMarketplacePressure =
    (order?.activeCaseCount || 0) > 0 ||
    (order?.heldPayoutRowCount || 0) > 0 ||
    cashOutRequests.some((request) => request.reviewBlocked) ||
    payoutRows.some((row) => row.payoutStatus === "hold_dispute_or_review");
  const payoutWorkspaceLink = (() => {
    if (hasBlockedMarketplacePressure) {
      return {
        href: sellerPayoutReturnHref("blocked", scopedOrderSearch),
        label: "Blocked Payouts",
      };
    }

    const hasAttentionPressure =
      (order?.fulfillmentStatus || "") !== "shipped" ||
      payoutRows.some((row) => row.payoutStatus === "hold_pending_fulfillment");

    if (hasAttentionPressure) {
      return {
        href: sellerPayoutReturnHref("attention", scopedOrderSearch),
        label: "Attention Payouts",
      };
    }

    const hasOpenPayoutWork =
      cashOutRequests.length > 0 ||
      payoutRows.some((row) =>
        ["eligible", "requested", "approved", "processing"].includes(
          row.payoutStatus,
        ),
      );

    if (hasOpenPayoutWork) {
      return {
        href: sellerPayoutReturnHref("open", scopedOrderSearch),
        label: "Cash-Out Payouts",
      };
    }

    const hasPaidPayoutHistory =
      payoutRows.length > 0 &&
      payoutRows.every((row) => row.payoutStatus === "paid");

    if (hasPaidPayoutHistory) {
      return {
        href: sellerPayoutReturnHref("paid", scopedOrderSearch),
        label: "Paid Payouts",
      };
    }

    return {
      href: sellerPayoutReturnHref("all", scopedOrderSearch),
      label: "Seller Payouts",
    };
  })();
  const inventoryWorkspaceLink = (() => {
    const inventorySearch = items.length === 1 ? items[0]?.title || "" : "";

    if ((order?.fulfillmentStatus || "") === "shipped") {
      return {
        href: sellerInventoryHref("active", "all", inventorySearch),
        label: inventorySearch ? "Search Active Inventory" : "Active Inventory",
      };
    }

    return {
      href: sellerInventoryHref("all", "all", inventorySearch),
      label: inventorySearch ? "Search Seller Inventory" : "Seller Inventory",
    };
  })();
  const marketplaceWorkspaceLink = (() => {
    const marketplaceSearch = items.length === 1 ? items[0]?.title || "" : "";

    if (hasBlockedMarketplacePressure) {
      return {
        href: sellerMarketplaceHref({
          stage: "needs_review",
          search: marketplaceSearch,
        }),
        label: marketplaceSearch ? "Search Review Rows" : "Open Review Rows",
      };
    }

    return {
      href: sellerMarketplaceHref({
        search: marketplaceSearch,
      }),
      label: marketplaceSearch ? "Search Marketplace Rows" : "Marketplace Rows",
    };
  })();

  function payoutRowWorkflowLink(payoutStatus: string | null | undefined) {
    if (payoutStatus === "hold_pending_fulfillment") {
      return {
        href: shippingQueueHref,
        label: "Open Shipping Orders",
      };
    }

    if (payoutStatus === "hold_dispute_or_review") {
      return {
        href: payoutBlockedHref,
        label: "Open Blocked Payouts",
      };
    }

    if (payoutStatus === "eligible") {
      return {
        href: payoutOpenHref,
        label: "Open Cash-Out Payouts",
      };
    }

    if (payoutStatus === "paid") {
      return {
        href: sellerOrdersQueueHref("completed", scopedOrderSearch),
        label: "Open Completed Orders",
      };
    }

    return {
      href: actionQueueHref,
      label: "Open Action Orders",
    };
  }

  function reviewCaseWorkflowLinks(reviewCase: SellerReviewCase) {
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
        href: actionQueueHref,
        label: "Open Action Orders",
      },
      {
        href: payoutBlockedHref,
        label: "Open Blocked Payouts",
      },
    ];
  }

  function cashOutRequestWorkflowLink(cashOutRequest: SellerCashOutRequest) {
    if (
      cashOutRequest.reviewBlocked ||
      cashOutRequest.activeCaseCount > 0 ||
      cashOutRequest.blockedLedgerRowCount > 0
    ) {
      return {
        href: actionQueueHref,
        label: "Open Action Orders",
      };
    }

    if (order?.fulfillmentStatus !== "shipped") {
      return {
        href: shippingQueueHref,
        label: "Open Shipping Orders",
      };
    }

    if (
      cashOutRequest.status === "requested" ||
      cashOutRequest.status === "approved" ||
      cashOutRequest.status === "processing"
    ) {
      return {
        href: sellerOrdersQueueHref("cash_out", scopedOrderSearch),
        label: "Open Cash-Out Orders",
      };
    }

    if (cashOutRequest.status === "paid") {
      return {
        href: sellerOrdersQueueHref("completed", scopedOrderSearch),
        label: "Open Completed Orders",
      };
    }

    return {
      href: backToQueueHref,
      label: backToQueueLabel,
    };
  }

  function cashOutRequestPayoutLink(cashOutRequest: SellerCashOutRequest) {
    if (cashOutRequest.reviewBlocked) {
      return {
        href: `/seller/payouts?request=blocked&search=${encodeURIComponent(cashOutRequest.id)}#request-${cashOutRequest.id}`,
        label: "Open Blocked Payouts",
      };
    }

    if (
      cashOutRequest.status === "requested" ||
      cashOutRequest.status === "approved" ||
      cashOutRequest.status === "processing"
    ) {
      return {
        href: `/seller/payouts?request=open&search=${encodeURIComponent(cashOutRequest.id)}#request-${cashOutRequest.id}`,
        label: "Open Cash-Out Payouts",
      };
    }

    if (cashOutRequest.status === "paid") {
      return {
        href: `/seller/payouts?request=paid&search=${encodeURIComponent(cashOutRequest.id)}#request-${cashOutRequest.id}`,
        label: "Open Paid Payouts",
      };
    }

    return {
      href: `/seller/payouts?request=attention&search=${encodeURIComponent(cashOutRequest.id)}#request-${cashOutRequest.id}`,
      label: "Open Attention Payouts",
    };
  }

  useEffect(() => {
    if (!session?.access_token || !orderId) return;

    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/account/seller/orders/${orderId}`, {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Could not load seller order detail.");
          }

          if (!cancelled) {
            setOrder((data.order || null) as SellerOrderDetail | null);
            setItems((data.items || []) as SellerOrderItem[]);
            setPayoutRows((data.payoutRows || []) as SellerOrderPayoutRow[]);
            setCashOutRequests(
              (data.cashOutRequests || []) as SellerCashOutRequest[],
            );
            setReviewCases((data.reviewCases || []) as SellerReviewCase[]);
            setRecentSignals((data.recentSignals || []) as SellerOrderSignal[]);
            setError("");
          }
        } catch (nextError: any) {
          if (!cancelled) {
            setError(nextError.message || "Could not load seller order detail.");
            setOrder(null);
            setItems([]);
            setPayoutRows([]);
            setCashOutRequests([]);
            setReviewCases([]);
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
  }, [orderId, session?.access_token]);

  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] p-6 text-neutral-950">
        <div className="mx-auto max-w-4xl rounded-md border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Seller Order Detail</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Log in through your TCOS account first, then come back here to review
            seller-owned order activity.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/account/login"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white"
            >
              Log In
            </Link>
            <Link
              href={backToQueueHref}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold"
            >
              {backToQueueLabel}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Seller
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Seller Order Detail
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Seller-scoped payout, shipping, and review context for your routed
              items only.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/seller" label="Seller Home" />
            <HeaderLink href={backToQueueHref} label={backToQueueLabel} />
            <HeaderLink
              href={inventoryWorkspaceLink.href}
              label={workspaceHeaderLabel(inventoryWorkspaceLink.label)}
            />
            <HeaderLink
              href={payoutWorkspaceLink.href}
              label={workspaceHeaderLabel(payoutWorkspaceLink.label)}
            />
            <HeaderLink href="/account" label="Account" />
            <HeaderLink
              href={marketplaceWorkspaceLink.href}
              label={workspaceHeaderLabel(marketplaceWorkspaceLink.label)}
              primary
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {error}
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-md border border-neutral-200 bg-white p-5 text-sm text-neutral-600">
            Loading seller order detail...
          </section>
        ) : order ? (
          <>
            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-3xl font-black">Order #{order.orderId}</h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Created {shortDate(order.createdAt)} / Shipped{" "}
                    {shortDate(order.shippedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                      order.paymentStatus,
                    )}`}
                  >
                    {label(order.paymentStatus)}
                  </span>
                  <span
                    className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                      order.fulfillmentStatus,
                    )}`}
                  >
                    {label(order.fulfillmentStatus)}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Metric label="Your Items" value={String(order.sellerItemCount)} />
                <Metric label="Units" value={String(order.sellerUnitCount)} />
                <Metric
                  label="Seller Gross"
                  value={formatCurrency(order.sellerGrossAmount)}
                />
                <Metric
                  label="Seller Payable"
                  value={formatCurrency(order.sellerPayableAmount)}
                />
                <Metric
                  label="Held Rows"
                  value={String(order.heldPayoutRowCount)}
                />
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ActionCard
                  title="Return View"
                  detail="Jump back to the seller order or payout view that opened this order detail."
                  href={backToQueueHref}
                  label={backToQueueLabel}
                />
                <ActionCard
                  title="Order Pressure"
                  detail={
                    order.activeCaseCount > 0 || order.heldPayoutRowCount > 0
                      ? "This routed order is carrying seller review or payout pressure."
                      : "Open the action orders view if you need surrounding seller pressure context."
                  }
                  href={actionQueueHref}
                  label="Open Action Orders"
                />
                <ActionCard
                  title="Shipping Orders"
                  detail={
                    order.fulfillmentStatus === "shipped"
                      ? "Shipping is already recorded for this routed order."
                      : "Open the shipping orders view for this order if fulfillment still needs follow-through."
                  }
                  href={shippingQueueHref}
                  label="Open Shipping Orders"
                />
                <ActionCard
                  title="Cash-Out Payouts"
                  detail={
                    cashOutRequests.some((request) => request.reviewBlocked)
                      ? "Blocked seller cash-out payouts are already tied to this order."
                      : cashOutRequests.length > 0
                        ? "This order is already linked to seller cash-out payouts."
                        : "Open the payout workspace to check payout views for this order."
                  }
                  href={
                    cashOutRequests.some((request) => request.reviewBlocked)
                      ? payoutBlockedHref
                      : payoutOpenHref
                  }
                  label={
                    cashOutRequests.some((request) => request.reviewBlocked)
                      ? "Open Blocked Payouts"
                      : "Open Cash-Out Payouts"
                  }
                />
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.2fr_0.9fr]">
              <div className="space-y-6">
                <section
                  id="recent-activity"
                  className="rounded-md border border-neutral-200 bg-white"
                >
                  <div className="border-b border-neutral-200 p-5">
                    <h2 className="text-2xl font-black">Recent Activity Timeline</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                      The latest seller-visible movement on this routed order.
                    </p>
                  </div>

                  {recentSignals.length === 0 ? (
                    <p className="p-5 text-sm text-neutral-600">
                      No recent seller-visible changes have been recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-3 p-5">
                      {recentSignals.map((signal) => (
                        <div
                          key={signal.id}
                          className={`rounded-md border p-4 ${signalTone(signal.tone)}`}
                        >
                          {(() => {
                            const payoutAction = signalPayoutAction(
                              signal.kind,
                              payoutBlockedHref,
                              payoutOpenHref,
                            );

                            return (
                              <>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
                                {label(signal.kind)}
                              </p>
                              <p className="mt-1 text-lg font-black">
                                {signal.title}
                              </p>
                            </div>
                            <span className="text-xs font-semibold">
                              {shortDate(signal.occurredAt)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm opacity-80">{signal.detail}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Link
                              href={signalQueueHref(orderId, signal.kind)}
                              className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                            >
                              {signalQueueLabel(signal.kind)}
                            </Link>
                            {payoutAction ? (
                              <Link
                                href={payoutAction.href}
                                className="rounded-md border border-white/40 bg-white/70 px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-white"
                              >
                                {payoutAction.label}
                              </Link>
                            ) : null}
                          </div>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-md border border-neutral-200 bg-white">
                  <div className="border-b border-neutral-200 p-5">
                    <h2 className="text-2xl font-black">Seller Item Scope</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                      Only the items owned by your seller account on this order.
                    </p>
                  </div>

                  <div className="divide-y divide-neutral-200">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto]"
                      >
                        <div>
                          <p className="font-black">{item.title}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Order Item #{item.id}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href={sellerOrderItemInventoryHref(item.title)}
                              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                            >
                              Search Seller Inventory
                            </Link>
                            <Link
                              href={sellerOrderItemMarketplaceHref(
                                item.title,
                                hasBlockedMarketplacePressure,
                              )}
                              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                            >
                              {hasBlockedMarketplacePressure
                                ? "Search Review Rows"
                                : "Search Marketplace Rows"}
                            </Link>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-neutral-700">
                          Qty {item.quantity}
                        </p>
                        <p className="text-sm font-black text-neutral-950">
                          {formatCurrency(item.lineTotal)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-md border border-neutral-200 bg-white">
                  <div className="border-b border-neutral-200 p-5">
                    <h2 className="text-2xl font-black">Payout Rows</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                      Seller payout ledger rows tied to your items on this order.
                    </p>
                  </div>

                  <div className="divide-y divide-neutral-200">
                    {payoutRows.map((row) => (
                      <div
                        key={row.id}
                        className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_auto]"
                      >
                        <div>
                          <p className="font-black">{row.itemTitle}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Order Item #{row.orderItemId}
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <Info
                              label="Gross"
                              value={formatCurrency(row.grossItemAmount)}
                            />
                            <Info
                              label="Ship Basis"
                              value={formatCurrency(row.shippingAllocatedAmount)}
                            />
                            <Info
                              label="Platform Fee"
                              value={formatCurrency(row.platformFeeAmount)}
                            />
                            <Info
                              label="Seller Payable"
                              value={formatCurrency(row.sellerPayableAmount)}
                            />
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-neutral-500">
                            Created
                          </p>
                          <p className="mt-1 text-sm font-semibold text-neutral-700">
                            {shortDate(row.createdAt)}
                          </p>
                        </div>
                        <span
                          className={`h-fit w-fit rounded border px-2 py-1 text-xs font-black ${statusTone(
                            row.payoutStatus,
                          )}`}
                        >
                          {label(row.payoutStatus)}
                        </span>
                        <div className="md:col-span-3">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={payoutRowWorkflowLink(row.payoutStatus).href}
                              className="inline-flex rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                            >
                              {payoutRowWorkflowLink(row.payoutStatus).label}
                            </Link>
                            <Link
                              href={sellerPayoutRowInventoryHref(row.itemTitle)}
                              className="inline-flex rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                            >
                              Search Seller Inventory
                            </Link>
                            <Link
                              href={sellerPayoutRowMarketplaceHref(
                                row.itemTitle,
                                hasBlockedMarketplacePressure,
                              )}
                              className="inline-flex rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                            >
                              {hasBlockedMarketplacePressure
                                ? "Search Review Rows"
                                : "Search Marketplace Rows"}
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-md border border-neutral-200 bg-white p-5">
                  <h2 className="text-2xl font-black">Shipping State</h2>
                  <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
                    <Info
                      label="Method"
                      value={order.shippingName || "Not saved"}
                    />
                    <Info
                      label="Shipping Paid"
                      value={formatCurrency(order.shippingAmount)}
                    />
                    <Info
                      label="Carrier"
                      value={order.carrier || "Not saved"}
                    />
                    <Info
                      label="Tracking"
                      value={order.trackingNumber || "Not saved"}
                    />
                  </dl>
                </section>

                <section className="rounded-md border border-neutral-200 bg-white p-5">
                  <h2 className="text-2xl font-black">Cash-Out Payouts</h2>
                  {cashOutRequests.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral-600">
                      No seller cash-out payouts are currently tied to this order.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {cashOutRequests.map((cashOutRequest) => {
                        const otherLinkedOrderIds = cashOutRequest.linkedOrderIds.filter(
                          (linkedOrderId) => linkedOrderId !== order.orderId,
                        );
                        const requestWorkflowLink =
                          cashOutRequestWorkflowLink(cashOutRequest);
                        const requestPayoutLink =
                          cashOutRequestPayoutLink(cashOutRequest);

                        return (
                          <div
                            key={cashOutRequest.id}
                            className="rounded-md border border-neutral-200 bg-neutral-50 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-black text-neutral-950">
                                  Request {cashOutRequest.id.slice(0, 8)}
                                </p>
                                <p className="mt-1 text-xs text-neutral-500">
                                  Linked to {cashOutRequest.linkedOrderIds.length} routed
                                  order
                                  {cashOutRequest.linkedOrderIds.length === 1
                                    ? ""
                                    : "s"}
                                  .
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span
                                  className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                                    cashOutRequest.status,
                                  )}`}
                                >
                                  {label(cashOutRequest.status)}
                                </span>
                                {cashOutRequest.reviewBlocked ? (
                                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900">
                                    REVIEW BLOCKED
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                              <Info
                                label="This Order"
                                value={formatCurrency(cashOutRequest.amountRequested)}
                              />
                              <Info
                                label="Request Total"
                                value={formatCurrency(cashOutRequest.requestTotal)}
                              />
                              <Info
                                label="Est. Net"
                                value={formatCurrency(cashOutRequest.estimatedNetAmount)}
                              />
                              <Info
                                label="Final Net"
                                value={formatCurrency(cashOutRequest.finalNetAmount)}
                              />
                              <Info
                                label="Active Cases"
                                value={String(cashOutRequest.activeCaseCount)}
                              />
                              <Info
                                label="Held Rows"
                                value={String(cashOutRequest.blockedLedgerRowCount)}
                              />
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <Link
                                href={requestWorkflowLink.href}
                                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                              >
                                {requestWorkflowLink.label}
                              </Link>
                              <Link
                                href={requestPayoutLink.href}
                                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                              >
                                {requestPayoutLink.label}
                              </Link>
                              {otherLinkedOrderIds.map((linkedOrderId) => (
                                <Link
                                  key={`${cashOutRequest.id}-linked-${linkedOrderId}`}
                                  href={`/seller/orders/${linkedOrderId}?${
                                    returnContext.target === "payouts"
                                      ? `return=payouts&request=${returnContext.payoutFilter}${
                                          returnContext.payoutSearch.trim()
                                            ? `&requestSearch=${encodeURIComponent(returnContext.payoutSearch.trim())}`
                                            : ""
                                        }`
                                      : `queue=${returnContext.queue}${
                                          returnContext.search.trim()
                                            ? `&search=${encodeURIComponent(returnContext.search.trim())}`
                                            : ""
                                        }`
                                  }`}
                                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-100"
                                >
                                  Order #{linkedOrderId}
                                </Link>
                              ))}
                            </div>

                            {cashOutRequest.reviewBlocked ? (
                              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                                {cashOutRequest.reviewBlockReason ||
                                  "This cash-out request is currently blocked by review or payout hold context."}
                              </p>
                            ) : null}

                            <p className="mt-3 text-xs text-neutral-500">
                              Requested {shortDate(cashOutRequest.requestedAt)} /
                              Completed {shortDate(cashOutRequest.completedAt)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-md border border-neutral-200 bg-white p-5">
                  <h2 className="text-2xl font-black">Review Cases</h2>
                  {reviewCases.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral-600">
                      No seller-scoped review cases are linked to this order.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {reviewCases.map((reviewCase) => (
                        <div
                          key={reviewCase.id}
                          className="rounded-md border border-neutral-200 bg-neutral-50 p-3"
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
                            {reviewCase.sellerScoped ? (
                              <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] font-black text-neutral-700">
                                SELLER-SCOPED
                              </span>
                            ) : (
                              <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] font-black text-neutral-700">
                                ORDER-WIDE
                              </span>
                            )}
                          </div>
                          <p className="mt-2 font-black text-neutral-950">
                            {reviewCase.title}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {label(reviewCase.caseType)} / Updated{" "}
                            {shortDate(reviewCase.updatedAt)}
                          </p>
                          {reviewCase.description ? (
                            <p className="mt-2 text-sm text-neutral-700">
                              {reviewCase.description}
                            </p>
                          ) : null}
                          {reviewCase.outcomeSummary ? (
                            <p className="mt-2 rounded-md border border-neutral-200 bg-white p-2 text-sm text-neutral-700">
                              <strong>Outcome:</strong> {reviewCase.outcomeSummary}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {reviewCaseWorkflowLinks(reviewCase).map((action) => (
                              <Link
                                key={`${reviewCase.id}-${action.label}`}
                                href={action.href}
                                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                              >
                                {action.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function ActionCard({
  title,
  detail,
  href,
  label,
}: {
  title: string;
  detail: string;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-md border border-neutral-200 bg-neutral-50 p-4 transition hover:border-neutral-300 hover:bg-white"
    >
      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
        {title}
      </p>
      <p className="mt-2 text-sm text-neutral-700">{detail}</p>
      <span className="mt-4 inline-flex rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900">
        {label}
      </span>
    </Link>
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

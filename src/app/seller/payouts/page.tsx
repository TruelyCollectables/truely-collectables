"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SELLER_TERMS_OF_SERVICE_VERSION } from "../../../lib/legal";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../../account/account-session";

type SellerPayout = {
  provider: string;
  onboardingStatus: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  sellerTosAccepted: boolean;
  disabledReason?: string | null;
  requirementsCurrentlyDue?: string[];
  requirementsPastDue?: string[];
  updatedAt: string | null;
};

type SellerPayoutBalance = {
  heldAmount: number;
  pendingFulfillmentAmount: number;
  pendingFulfillmentCount: number;
  disputeHoldAmount: number;
  disputeHoldCount: number;
  cancelledOrReversedAmount: number;
  cancelledOrReversedCount: number;
  eligibleAmount: number;
  eligibleCount: number;
  openRequestAmount: number;
  openRequestCount: number;
  availableToRequestAmount: number;
  paidAmount: number;
  requestCount: number;
  blockedRequestCount: number;
  reviewGuardUnavailable?: boolean;
};

type SellerPayoutRequest = {
  id: string;
  requestedAmount: number;
  estimatedProcessorFeeRate: number;
  estimatedProcessorFeeAmount: number;
  estimatedNetAmount: number;
  finalProcessorFeeAmount: number;
  finalNetAmount: number;
  providerPayoutReference: string | null;
  providerPayoutStatus: string | null;
  status: string;
  requestNote: string | null;
  adminNote: string | null;
  requestedAt: string | null;
  reviewedAt?: string | null;
  completedAt?: string | null;
  createdAt: string | null;
  reviewBlocked?: boolean;
  reviewBlockReason?: string | null;
  affectedOrderIds?: number[];
  activeCaseCount?: number;
  blockedLedgerRowCount?: number;
  orderSummaries?: Array<{
    orderId: number;
    createdAt: string | null;
    shippedAt: string | null;
    orderTotal: number;
    paymentStatus: string;
    fulfillmentStatus: string;
    amountRequested: number;
    activeCaseCount: number;
    blockedLedgerRowCount: number;
  }>;
};

type SellerHoldContextSummary = {
  orderId: number;
  requestIds: string[];
  requestCount: number;
  activeCaseCount: number;
  blockedLedgerRowCount: number;
};

type RequestFilter =
  | "all"
  | "blocked"
  | "open"
  | "paid"
  | "attention";

type RequestShortcut = {
  filter: RequestFilter;
  label: string;
  detail: string;
  count: number;
};

type OrderQueueFilter =
  | "all"
  | "action_required"
  | "shipping"
  | "cash_out"
  | "completed";
type MarketplaceStageFilter = "all" | "needs_review" | "ready";

function parseRequestFilter(value: string | null): RequestFilter {
  return value === "blocked" ||
    value === "open" ||
    value === "paid" ||
    value === "attention"
    ? value
    : "all";
}

function payoutShortcutButtonLabel(filter: RequestFilter) {
  if (filter === "blocked") return "Open Blocked Payouts";
  if (filter === "open") return "Open Cash-Out Payouts";
  if (filter === "paid") return "Open Paid Payouts";
  if (filter === "attention") return "Open Attention Payouts";
  return "Open Seller Payouts";
}

function initialPayoutFilters() {
  if (typeof window === "undefined") {
    return {
      request: "all" as RequestFilter,
      search: "",
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    request: parseRequestFilter(params.get("request")),
    search: params.get("search") || "",
  };
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

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function sellerPayoutLabel(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

function sellerOrdersQueueHref(queue: OrderQueueFilter, search?: string) {
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

function payoutInventoryWorkspaceLink(filter: RequestFilter, search: string) {
  const inventorySearch = crossWorkspaceInventorySearch(search);

  if (filter === "blocked" || filter === "attention") {
    return {
      href: sellerInventoryHref("draft", "needs_work", inventorySearch),
      label: inventorySearch ? "Search Needs Work" : "Needs Work Drafts",
    };
  }

  if (filter === "open" || filter === "paid") {
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

function payoutMarketplaceWorkspaceLink(search: string) {
  const marketplaceSearch = crossWorkspaceInventorySearch(search);

  return {
    href: sellerMarketplaceHref({
      search: marketplaceSearch,
    }),
    label: marketplaceSearch ? "Search Marketplace Rows" : "Marketplace Rows",
  };
}

function payoutMarketplaceWorkspaceByFilter(
  filter: RequestFilter,
  search: string,
) {
  const marketplaceSearch = crossWorkspaceInventorySearch(search);

  if (filter === "blocked" || filter === "attention") {
    return {
      href: sellerMarketplaceHref({
        stage: "needs_review",
        search: marketplaceSearch,
      }),
      label: marketplaceSearch ? "Search Review Rows" : "Open Review Rows",
    };
  }

  return {
    ...payoutMarketplaceWorkspaceLink(search),
  };
}

function payoutOrdersWorkspaceLink(filter: RequestFilter, search: string) {
  const orderSearch = crossWorkspaceOrderSearch(search);

  if (filter === "blocked" || filter === "attention") {
    return {
      href: sellerOrdersQueueHref("action_required", orderSearch),
      label: "Open Action Orders",
    };
  }

  if (filter === "open") {
    return {
      href: sellerOrdersQueueHref("cash_out", orderSearch),
      label: "Open Cash-Out Orders",
    };
  }

  if (filter === "paid") {
    return {
      href: sellerOrdersQueueHref("completed", orderSearch),
      label: "Open Completed Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("all", orderSearch),
    label: "Open Seller Orders",
  };
}

function payoutOrderQueueFilter(filter: RequestFilter): OrderQueueFilter {
  if (filter === "blocked" || filter === "attention") {
    return "action_required";
  }

  if (filter === "open") {
    return "cash_out";
  }

  if (filter === "paid") {
    return "completed";
  }

  return "all";
}

function payoutRequestOrderWorkspaceLink(request: SellerPayoutRequest) {
  const hasActionPressure =
    Boolean(request.reviewBlocked) ||
    (request.activeCaseCount || 0) > 0 ||
    (request.blockedLedgerRowCount || 0) > 0 ||
    Boolean(
      request.orderSummaries?.some(
        (order) =>
          order.activeCaseCount > 0 || order.blockedLedgerRowCount > 0,
      ),
    );

  if (hasActionPressure) {
    return {
      href: sellerOrdersQueueHref("action_required", request.id),
      label: "Open Action Orders",
    };
  }

  const hasShippingPressure = Boolean(
    request.orderSummaries?.some((order) => order.fulfillmentStatus !== "shipped"),
  );

  if (hasShippingPressure) {
    return {
      href: sellerOrdersQueueHref("shipping", request.id),
      label: "Open Shipping Orders",
    };
  }

  if (["requested", "approved", "processing"].includes(request.status)) {
    return {
      href: sellerOrdersQueueHref("cash_out", request.id),
      label: "Open Cash-Out Orders",
    };
  }

  if (request.status === "paid") {
    return {
      href: sellerOrdersQueueHref("completed", request.id),
      label: "Open Completed Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("all", request.id),
    label: "Open Seller Orders",
  };
}

function blockedHoldOrderWorkspaceLink(summary: SellerHoldContextSummary) {
  return {
    href: sellerOrdersQueueHref("action_required", `order ${summary.orderId}`),
    label: "Action Orders",
  };
}

function blockedHoldPayoutWorkspaceLink(summary: SellerHoldContextSummary) {
  const params = new URLSearchParams();
  params.set("request", "blocked");
  params.set("search", `order ${summary.orderId}`);

  return {
    href: `/seller/payouts?${params.toString()}`,
    label: "Blocked Payouts",
  };
}

function blockedPayoutAffectedOrderWorkspaceHref(orderId: number) {
  return sellerOrdersQueueHref("action_required", `order ${orderId}`);
}

function blockedPayoutAffectedOrderDetailHref(orderId: number, requestId: string) {
  const params = new URLSearchParams();
  params.set("queue", "action_required");
  params.set("search", `order ${orderId}`);
  params.set("return", "payouts");
  params.set("request", "blocked");
  params.set("requestSearch", requestId);
  return `/seller/orders/${orderId}?${params.toString()}#recent-activity`;
}

function payoutLinkedOrderWorkspaceLink(
  request: SellerPayoutRequest,
  order: NonNullable<SellerPayoutRequest["orderSummaries"]>[number],
) {
  const orderSearch = `order ${order.orderId}`;

  if (
    request.reviewBlocked ||
    order.activeCaseCount > 0 ||
    order.blockedLedgerRowCount > 0
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

  if (["requested", "approved", "processing"].includes(request.status)) {
    return {
      href: sellerOrdersQueueHref("cash_out", orderSearch),
      label: "Cash-Out Orders",
    };
  }

  if (request.status === "paid") {
    return {
      href: sellerOrdersQueueHref("completed", orderSearch),
      label: "Completed Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("all", orderSearch),
    label: "Seller Orders",
  };
}

function statusTone(value: string | null | undefined) {
  if (
    value === "active" ||
    value === "paid" ||
    value === "enabled" ||
    value === "completed"
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    value === "requested" ||
    value === "approved" ||
    value === "processing" ||
    value === "pending" ||
    value === "not_started" ||
    value === "pending_requirements"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (value === "rejected" || value === "cancelled" || value === "blocked") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

export default function SellerPayoutsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [initialFilters] = useState(initialPayoutFilters);
  const [sellerPayout, setSellerPayout] = useState<SellerPayout | null>(null);
  const [sellerPayoutBalance, setSellerPayoutBalance] =
    useState<SellerPayoutBalance | null>(null);
  const [sellerPayoutRequests, setSellerPayoutRequests] = useState<
    SellerPayoutRequest[]
  >([]);
  const [sellerTosAccepted, setSellerTosAccepted] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(session?.access_token));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [providerRefreshWarning, setProviderRefreshWarning] = useState("");
  const [isStartingSellerPayout, setIsStartingSellerPayout] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState("");
  const [cashOutNote, setCashOutNote] = useState("");
  const [isRequestingCashOut, setIsRequestingCashOut] = useState(false);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>(
    initialFilters.request,
  );
  const [search, setSearch] = useState(initialFilters.search);

  function syncPayoutUrl(next: { filter?: RequestFilter; search?: string }) {
    const finalFilter = next.filter ?? requestFilter;
    const finalSearch = next.search ?? search;
    const params = new URLSearchParams();

    if (finalFilter !== "all") {
      params.set("request", finalFilter);
    }

    if (finalSearch.trim()) {
      params.set("search", finalSearch.trim());
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function setPayoutRequestView(next: {
    filter?: RequestFilter;
    search?: string;
  }) {
    const finalFilter = next.filter ?? requestFilter;
    const finalSearch = next.search ?? search;

    setRequestFilter(finalFilter);
    setSearch(finalSearch);
    syncPayoutUrl({ filter: finalFilter, search: finalSearch });
  }

  const sellerHoldContextSummaries = useMemo(() => {
    const byOrderId = new Map<number, SellerHoldContextSummary>();

    for (const request of sellerPayoutRequests) {
      if (!request.reviewBlocked || !request.affectedOrderIds?.length) continue;

      for (const orderId of request.affectedOrderIds) {
        const existing = byOrderId.get(orderId) || {
          orderId,
          requestIds: [],
          requestCount: 0,
          activeCaseCount: 0,
          blockedLedgerRowCount: 0,
        };

        existing.requestCount += 1;
        existing.requestIds.push(request.id);
        existing.activeCaseCount += request.activeCaseCount || 0;
        existing.blockedLedgerRowCount += request.blockedLedgerRowCount || 0;
        byOrderId.set(orderId, existing);
      }
    }

    return Array.from(byOrderId.values()).sort((a, b) => a.orderId - b.orderId);
  }, [sellerPayoutRequests]);

  const filteredRequests = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return sellerPayoutRequests.filter((request) => {
      if (requestFilter === "blocked" && !request.reviewBlocked) {
        return false;
      }

      if (
        requestFilter === "open" &&
        !["requested", "approved", "processing"].includes(request.status)
      ) {
        return false;
      }

      if (requestFilter === "paid" && request.status !== "paid") {
        return false;
      }

      if (requestFilter === "attention") {
        const needsAttention =
          request.reviewBlocked ||
          request.status === "rejected" ||
          request.status === "cancelled" ||
          request.status === "processing";

        if (!needsAttention) {
          return false;
        }
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        request.id,
        request.status,
        request.requestNote || "",
        request.adminNote || "",
        request.providerPayoutReference || "",
        request.providerPayoutStatus || "",
        ...(request.affectedOrderIds || []).map((orderId) => `order ${orderId}`),
        ...(request.orderSummaries || []).flatMap((order) => [
          `order ${order.orderId}`,
          order.paymentStatus,
          order.fulfillmentStatus,
        ]),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [requestFilter, search, sellerPayoutRequests]);

  const requestFilterCounts = useMemo(
    () => ({
      all: sellerPayoutRequests.length,
      blocked: sellerPayoutRequests.filter((request) => request.reviewBlocked).length,
      open: sellerPayoutRequests.filter((request) =>
        ["requested", "approved", "processing"].includes(request.status),
      ).length,
      paid: sellerPayoutRequests.filter((request) => request.status === "paid")
        .length,
      attention: sellerPayoutRequests.filter(
        (request) =>
          request.reviewBlocked ||
          request.status === "rejected" ||
          request.status === "cancelled" ||
          request.status === "processing",
      ).length,
    }),
    [sellerPayoutRequests],
  );
  const requestShortcuts = useMemo<RequestShortcut[]>(
    () => [
      {
        filter: "blocked",
        label: "Blocked Payouts",
        detail: "Payouts tied to active cases, held payout rows, or review guardrails.",
        count: requestFilterCounts.blocked,
      },
      {
        filter: "open",
        label: "Cash-Out Payouts",
        detail: "Cash-out payouts still waiting on approval, processing, or completion.",
        count: requestFilterCounts.open,
      },
      {
        filter: "attention",
        label: "Attention Payouts",
        detail: "Payouts that need review because they are blocked, rejected, cancelled, or still processing.",
        count: requestFilterCounts.attention,
      },
      {
        filter: "paid",
        label: "Paid Payouts",
        detail: "Completed seller cash-out payouts already moved through payout delivery.",
        count: requestFilterCounts.paid,
      },
    ],
    [requestFilterCounts],
  );
  const ordersWorkspaceLink = payoutOrdersWorkspaceLink(requestFilter, search);
  const inventoryWorkspaceLink = payoutInventoryWorkspaceLink(
    requestFilter,
    search,
  );
  const marketplaceWorkspaceLink = payoutMarketplaceWorkspaceByFilter(
    requestFilter,
    search,
  );
  const sellerPayoutCashOutReady =
    sellerPayout?.onboardingStatus === "active" &&
    sellerPayout.payoutsEnabled === true &&
    sellerPayout.detailsSubmitted === true &&
    !sellerPayout.disabledReason &&
    (sellerPayout.requirementsCurrentlyDue || []).length === 0 &&
    (sellerPayout.requirementsPastDue || []).length === 0;

  function focusRequestView(filter: RequestFilter, nextSearch = "") {
    setPayoutRequestView({ filter, search: nextSearch });
  }

  function orderDetailHref(orderId: number) {
    const params = new URLSearchParams();
    const queue = payoutOrderQueueFilter(requestFilter);

    if (queue !== "all") {
      params.set("queue", queue);
    }
    params.set("search", `order ${orderId}`);
    params.set("return", "payouts");
    if (requestFilter !== "all") {
      params.set("request", requestFilter);
    }
    if (search.trim()) {
      params.set("requestSearch", search.trim());
    }
    return `/seller/orders/${orderId}?${params.toString()}`;
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const [payoutResponse, requestsResponse] = await Promise.all([
            fetch("/api/account/seller/payout-onboarding", {
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
            }),
            fetch("/api/account/seller/payout-requests", {
              headers: {
                Authorization: `Bearer ${session.access_token}`,
              },
            }),
          ]);
          const [payoutData, requestData] = await Promise.all([
            payoutResponse.json(),
            requestsResponse.json(),
          ]);

          if (!payoutResponse.ok) {
            throw new Error(
              payoutData.error || "Could not load seller payout status.",
            );
          }

          if (!requestsResponse.ok) {
            throw new Error(
              requestData.error || "Could not load seller cash-out data.",
            );
          }

          if (!cancelled) {
            setSellerPayout((payoutData.sellerPayout || null) as SellerPayout | null);
            setSellerTosAccepted(
              payoutData.sellerPayout?.sellerTosAccepted === true,
            );
            setSellerPayoutBalance(
              (requestData.balance || null) as SellerPayoutBalance | null,
            );
            setSellerPayoutRequests(
              Array.isArray(requestData.requests) ? requestData.requests : [],
            );
            setProviderRefreshWarning(
              payoutData.providerRefreshError
                ? `Stripe status refresh could not complete. Showing the latest stored payout status. ${payoutData.providerRefreshError}`
                : "",
            );
            setError("");
          }
        } catch (nextError: any) {
          if (!cancelled) {
            setSellerPayout(null);
            setSellerPayoutBalance(null);
            setSellerPayoutRequests([]);
            setProviderRefreshWarning("");
            setError(
              nextError.message ||
                "Could not load seller payout verification and cash-out data.",
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

  async function refreshSellerPayoutWorkspace() {
    if (!session?.access_token) return;

    setRefreshing(true);

    try {
      const [payoutResponse, requestsResponse] = await Promise.all([
        fetch("/api/account/seller/payout-onboarding", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch("/api/account/seller/payout-requests", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
      ]);
      const [payoutData, requestData] = await Promise.all([
        payoutResponse.json(),
        requestsResponse.json(),
      ]);

      if (!payoutResponse.ok) {
        throw new Error(payoutData.error || "Could not load seller payout status.");
      }

      if (!requestsResponse.ok) {
        throw new Error(requestData.error || "Could not load seller cash-out data.");
      }

      setSellerPayout((payoutData.sellerPayout || null) as SellerPayout | null);
      setSellerTosAccepted(payoutData.sellerPayout?.sellerTosAccepted === true);
      setSellerPayoutBalance(
        (requestData.balance || null) as SellerPayoutBalance | null,
      );
      setSellerPayoutRequests(
        Array.isArray(requestData.requests) ? requestData.requests : [],
      );
      setProviderRefreshWarning(
        payoutData.providerRefreshError
          ? `Stripe status refresh could not complete. Showing the latest stored payout status. ${payoutData.providerRefreshError}`
          : "",
      );
      setError("");
    } catch (nextError: any) {
      setError(
        nextError.message ||
          "Could not refresh seller payout verification and cash-out data.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function startSellerPayoutOnboarding() {
    if (!session?.access_token) return;

    setIsStartingSellerPayout(true);
    setError("");

    try {
      const response = await fetch("/api/account/seller/payout-onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          sellerTosAccepted,
          sellerTosVersion: SELLER_TERMS_OF_SERVICE_VERSION,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not start seller verification.");
      }

      if (!data.onboardingUrl) {
        throw new Error("Seller verification link was not returned.");
      }

      window.location.href = data.onboardingUrl;
    } catch (nextError: any) {
      setError(nextError.message || "Could not start seller verification.");
    } finally {
      setIsStartingSellerPayout(false);
    }
  }

  async function requestSellerCashOut() {
    if (!session?.access_token) return;

    setIsRequestingCashOut(true);
    setError("");

    try {
      const response = await fetch("/api/account/seller/payout-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          amount: Number(cashOutAmount || 0),
          note: cashOutNote,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not request cash-out.");
      }

      setCashOutAmount("");
      setCashOutNote("");
      await refreshSellerPayoutWorkspace();
    } catch (nextError: any) {
      setError(nextError.message || "Could not request cash-out.");
    } finally {
      setIsRequestingCashOut(false);
    }
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] p-6 text-neutral-950">
        <div className="mx-auto max-w-4xl rounded-md border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Seller Payouts</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Log in through your TCOS account first, then come back here to review
            payout verification, cash-out readiness, and seller hold context.
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
              Payout Workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Stripe verification, seller cash-out readiness, blocked hold context,
              and payout request history for your routed items on the active store.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/seller" label="Seller Home" />
            <HeaderLink href="/account" label="Account" />
            <HeaderLink
              href={marketplaceWorkspaceLink.href}
              label={workspaceHeaderLabel(marketplaceWorkspaceLink.label)}
            />
            <HeaderLink
              href={inventoryWorkspaceLink.href}
              label={workspaceHeaderLabel(inventoryWorkspaceLink.label)}
            />
            <HeaderLink
              href={ordersWorkspaceLink.href}
              label={workspaceHeaderLabel(ordersWorkspaceLink.label)}
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Metric
            label="Available Now"
            value={
              loading
                ? "..."
                : formatCurrency(sellerPayoutBalance?.availableToRequestAmount || 0)
            }
          />
          <Metric
            label="Eligible"
            value={
              loading
                ? "..."
                : formatCurrency(sellerPayoutBalance?.eligibleAmount || 0)
            }
          />
          <Metric
            label="Held"
            value={
              loading
                ? "..."
                : formatCurrency(sellerPayoutBalance?.heldAmount || 0)
            }
          />
          <Metric
            label="Open Payouts"
            value={loading ? "..." : String(sellerPayoutBalance?.openRequestCount || 0)}
          />
          <Metric
            label="Blocked Payouts"
            value={
              loading ? "..." : String(sellerPayoutBalance?.blockedRequestCount || 0)
            }
          />
          <Metric
            label="Paid To Seller"
            value={
              loading ? "..." : formatCurrency(sellerPayoutBalance?.paidAmount || 0)
            }
          />
        </section>

        {error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {error}
          </section>
        ) : null}

        {providerRefreshWarning ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {providerRefreshWarning}
          </section>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <article className="rounded-md border border-neutral-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Seller Verification</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-600">
                  Bank and payout verification is handled by Stripe. TCOS does not
                  store raw bank account or routing numbers.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshSellerPayoutWorkspace()}
                disabled={refreshing || loading}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Info
                label="Status"
                value={sellerPayoutLabel(sellerPayout?.onboardingStatus || "not_started")}
              />
              <Info
                label="Payouts"
                value={sellerPayout?.payoutsEnabled ? "Enabled" : "Not enabled"}
              />
              <Info
                label="Details"
                value={sellerPayout?.detailsSubmitted ? "Submitted" : "Not submitted"}
              />
              <Info label="Updated" value={shortDate(sellerPayout?.updatedAt)} />
            </div>

            {sellerPayout?.disabledReason ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                Stripe disabled reason: {sellerPayout.disabledReason}
              </p>
            ) : null}

            {sellerPayout?.requirementsCurrentlyDue?.length ? (
              <div className="mt-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Requirements Due
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sellerPayout.requirementsCurrentlyDue.map((requirement) => (
                    <span
                      key={requirement}
                      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                    >
                      {label(requirement)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {sellerPayout?.requirementsPastDue?.length ? (
              <div className="mt-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Past Due
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sellerPayout.requirementsPastDue.map((requirement) => (
                    <span
                      key={requirement}
                      className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-800"
                    >
                      {label(requirement)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="mt-5 flex items-start gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-700">
              <input
                type="checkbox"
                checked={sellerTosAccepted}
                onChange={(event) => setSellerTosAccepted(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-neutral-950"
              />
              <span>
                I accept the Seller Terms of Service and understand TCOS records
                seller payout onboarding acceptance for audit and payment routing.
              </span>
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startSellerPayoutOnboarding}
                disabled={isStartingSellerPayout || !sellerTosAccepted}
                className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
              >
                {sellerPayout?.onboardingStatus === "active"
                  ? "Refresh Stripe Verification"
                  : isStartingSellerPayout
                    ? "Opening Stripe..."
                    : "Verify Seller Payouts"}
              </button>
              <Link
                href="/seller-terms"
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
              >
                Seller Terms
              </Link>
            </div>
          </article>

          <article className="rounded-md border border-neutral-200 bg-white p-5">
            <h2 className="text-2xl font-black">Cash-Out Readiness</h2>
            <p className="mt-1 text-sm leading-6 text-neutral-600">
              Only funds marked eligible can be requested. Processor fees are
              separate from the Dag Danky Holdings LLC 8% rake.
            </p>

            {sellerPayoutBalance?.reviewGuardUnavailable ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                Dispute review checks are temporarily unavailable. Active case holds
                may still affect payout processing.
              </p>
            ) : null}

            {!sellerPayoutCashOutReady ? (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                Stripe payout verification must be active before cash-out
                requests can be submitted.
              </p>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <BreakdownCard
                label="Pending Fulfillment"
                value={formatCurrency(
                  sellerPayoutBalance?.pendingFulfillmentAmount || 0,
                )}
                detail={`${
                  sellerPayoutBalance?.pendingFulfillmentCount || 0
                } row(s) still waiting to ship or clear fulfillment review.`}
              />
              <BreakdownCard
                label="Dispute Hold"
                value={formatCurrency(sellerPayoutBalance?.disputeHoldAmount || 0)}
                detail={`${
                  sellerPayoutBalance?.disputeHoldCount || 0
                } row(s) tied to active returns, chargebacks, or review cases.`}
              />
              <BreakdownCard
                label="Reserved By Requests"
                value={formatCurrency(sellerPayoutBalance?.openRequestAmount || 0)}
                detail={`${
                  sellerPayoutBalance?.openRequestCount || 0
                } open cash-out request(s) already claiming eligible funds.`}
              />
              <BreakdownCard
                label="Cancelled Or Reversed"
                value={formatCurrency(
                  sellerPayoutBalance?.cancelledOrReversedAmount || 0,
                )}
                detail={`${
                  sellerPayoutBalance?.cancelledOrReversedCount || 0
                } row(s) cancelled or reversed after review outcome.`}
              />
            </div>

            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-sm text-neutral-700">
                Cash-out ready now:{" "}
                <strong className="text-neutral-950">
                  {formatCurrency(
                    sellerPayoutBalance?.availableToRequestAmount || 0,
                  )}
                </strong>
              </p>
              <p className="mt-1 text-sm text-neutral-700">
                Eligible rows:{" "}
                <strong className="text-neutral-950">
                  {sellerPayoutBalance?.eligibleCount || 0}
                </strong>
                {" / "}Total requests on file:{" "}
                <strong className="text-neutral-950">
                  {sellerPayoutBalance?.requestCount || 0}
                </strong>
              </p>
            </div>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void requestSellerCashOut();
              }}
            >
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Cash-out amount
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashOutAmount}
                  onChange={(event) => setCashOutAmount(event.target.value)}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="0.00"
                />
              </label>

              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Request note
                </span>
                <input
                  type="text"
                  value={cashOutNote}
                  onChange={(event) => setCashOutNote(event.target.value)}
                  className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="Optional payout note"
                />
              </label>

              <button
                type="submit"
                disabled={
                  isRequestingCashOut ||
                  !sellerPayoutCashOutReady ||
                  Number(cashOutAmount || 0) <= 0 ||
                  Number(cashOutAmount || 0) >
                    Number(sellerPayoutBalance?.availableToRequestAmount || 0)
                }
                className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
              >
                {isRequestingCashOut ? "Requesting..." : "Request Cash-Out"}
              </button>
            </form>
          </article>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Cash-Out Request History</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Recent seller payout requests, processor status, admin notes, and
                  review blockers.
                </p>
              </div>

              <p className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
                {filteredRequests.length} showing
              </p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {requestShortcuts.map((shortcut) => (
                <div
                  key={shortcut.filter}
                  className={`rounded-md border p-4 ${
                    requestFilter === shortcut.filter
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-200 bg-neutral-50 text-neutral-950"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p
                        className={`text-xs font-black uppercase tracking-[0.14em] ${
                          requestFilter === shortcut.filter
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
                        onClick={() => focusRequestView(shortcut.filter)}
                        className={`rounded-md px-3 py-2 text-xs font-bold ${
                          requestFilter === shortcut.filter
                            ? "bg-white text-neutral-950 hover:bg-neutral-100"
                            : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100"
                        }`}
                      >
                        {payoutShortcutButtonLabel(shortcut.filter)}
                      </button>
                      <Link
                        href={payoutOrdersWorkspaceLink(shortcut.filter, "").href}
                        className={`rounded-md px-3 py-2 text-xs font-bold ${
                          requestFilter === shortcut.filter
                            ? "border border-white/30 bg-transparent text-white hover:bg-white/10"
                            : "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100"
                        }`}
                      >
                        {payoutOrdersWorkspaceLink(shortcut.filter, "").label}
                      </Link>
                    </div>
                  </div>
                  <p
                    className={`mt-3 text-sm ${
                      requestFilter === shortcut.filter
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
                  Search requests
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) =>
                    setPayoutRequestView({ search: event.target.value })
                  }
                  placeholder="Request ID, order, note, provider status, or reference"
                  className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
                />
              </label>

              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Request views
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <FilterChip
                    active={requestFilter === "all"}
                    label={`All (${requestFilterCounts.all})`}
                    onClick={() => setPayoutRequestView({ filter: "all" })}
                  />
                  <FilterChip
                    active={requestFilter === "blocked"}
                    label={`Blocked (${requestFilterCounts.blocked})`}
                    onClick={() => setPayoutRequestView({ filter: "blocked" })}
                  />
                  <FilterChip
                    active={requestFilter === "open"}
                    label={`Open (${requestFilterCounts.open})`}
                    onClick={() => setPayoutRequestView({ filter: "open" })}
                  />
                  <FilterChip
                    active={requestFilter === "paid"}
                    label={`Paid (${requestFilterCounts.paid})`}
                    onClick={() => setPayoutRequestView({ filter: "paid" })}
                  />
                  <FilterChip
                    active={requestFilter === "attention"}
                    label={`Attention (${requestFilterCounts.attention})`}
                    onClick={() => setPayoutRequestView({ filter: "attention" })}
                  />
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <p className="p-5 text-sm text-neutral-600">
              Loading seller payout requests...
            </p>
          ) : sellerPayoutRequests.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller cash-out requests have been submitted yet.
            </p>
          ) : filteredRequests.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-neutral-600">
                No seller payout requests match the current request view.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPayoutRequestView({
                      filter: "all",
                      search: "",
                    });
                  }}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Reset Request View
                </button>
                {requestFilter !== "blocked" && requestFilterCounts.blocked > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusRequestView("blocked")}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Open Blocked Payouts
                  </button>
                ) : null}
                {requestFilter !== "open" && requestFilterCounts.open > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusRequestView("open")}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Open Cash-Out Payouts
                  </button>
                ) : null}
                {requestFilter !== "attention" &&
                requestFilterCounts.attention > 0 ? (
                  <button
                    type="button"
                    onClick={() => focusRequestView("attention")}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                  >
                    Open Attention Payouts
                  </button>
                ) : null}
                <Link
                  href={ordersWorkspaceLink.href}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  {`Open ${ordersWorkspaceLink.label}`}
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 xl:grid-cols-2">
              {filteredRequests.map((request) => (
                <article
                  key={request.id}
                  id={`request-${request.id}`}
                  className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                >
                  {(() => {
                    const requestOrdersLink = payoutRequestOrderWorkspaceLink(request);

                    return (
                      <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                        Request {request.id.slice(0, 8)}
                      </p>
                      <h3 className="mt-2 text-lg font-black">
                        {formatCurrency(request.requestedAmount)}
                      </h3>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                          request.status,
                        )}`}
                      >
                        {sellerPayoutLabel(request.status)}
                      </span>
                      {request.reviewBlocked ? (
                        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900">
                          REVIEW BLOCKED
                        </span>
                      ) : null}
                      <Link
                        href={requestOrdersLink.href}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 hover:bg-neutral-100"
                      >
                        {requestOrdersLink.label}
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Info label="Requested" value={shortDate(request.requestedAt)} />
                    <Info label="Reviewed" value={shortDate(request.reviewedAt)} />
                    <Info
                      label="Estimated Net"
                      value={formatCurrency(request.estimatedNetAmount)}
                    />
                    <Info
                      label="Provider Status"
                      value={label(request.providerPayoutStatus || "not_set")}
                    />
                  </div>

                  {request.providerPayoutReference ? (
                    <p className="mt-4 text-sm text-neutral-700">
                      Provider reference:{" "}
                      <strong className="text-neutral-950">
                        {request.providerPayoutReference}
                      </strong>
                    </p>
                  ) : null}

                  {request.requestNote ? (
                    <p className="mt-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                      <strong>Seller note:</strong> {request.requestNote}
                    </p>
                  ) : null}

                  {request.adminNote ? (
                    <p className="mt-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                      <strong>Admin note:</strong> {request.adminNote}
                    </p>
                  ) : null}

                  {request.orderSummaries?.length ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                          Linked Orders
                        </p>
                        <span className="text-xs font-semibold text-neutral-500">
                          {request.orderSummaries.length} order(s)
                        </span>
                      </div>

                      <div className="mt-2 space-y-2">
                        {request.orderSummaries.map((order) => {
                          const orderWorkspaceLink = payoutLinkedOrderWorkspaceLink(
                            request,
                            order,
                          );

                          return (
                            <div
                              key={`${request.id}-order-${order.orderId}`}
                              className="rounded-md border border-neutral-200 bg-white px-3 py-3"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-black text-neutral-950">
                                    Order #{order.orderId}
                                  </p>
                                  <p className="mt-1 text-xs text-neutral-500">
                                    Created {shortDate(order.createdAt)} / Shipped{" "}
                                    {shortDate(order.shippedAt)}
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

                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                                <Info
                                  label="Request Amount"
                                  value={formatCurrency(order.amountRequested)}
                                />
                                <Info
                                  label="Order Total"
                                  value={formatCurrency(order.orderTotal)}
                                />
                                <Info
                                  label="Active Cases"
                                  value={String(order.activeCaseCount)}
                                />
                                <Info
                                  label="Held Rows"
                                  value={String(order.blockedLedgerRowCount)}
                                />
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Link
                                  href={orderWorkspaceLink.href}
                                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                                >
                                  {`Open ${orderWorkspaceLink.label}`}
                                </Link>
                                <Link
                                  href={orderDetailHref(order.orderId)}
                                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                                >
                                  Open Order Detail
                                </Link>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {request.reviewBlocked ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      <p className="font-bold">
                        {request.reviewBlockReason || "Cash-out review is blocked."}
                      </p>
                      {request.affectedOrderIds?.length ? (
                        <div className="mt-2 space-y-2">
                          {request.affectedOrderIds.map((orderId) => (
                            <div
                              key={`${request.id}-${orderId}`}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <Link
                                href={blockedPayoutAffectedOrderWorkspaceHref(orderId)}
                                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-black text-amber-900 hover:bg-amber-100"
                              >
                                Open Action Order #{orderId}
                              </Link>
                              <Link
                                href={blockedPayoutAffectedOrderDetailHref(
                                  orderId,
                                  request.id,
                                )}
                                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-black text-amber-900 hover:bg-amber-100"
                              >
                                Open Order Detail
                              </Link>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
          )}
        </section>

        {sellerHoldContextSummaries.length > 0 ? (
          <section className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Blocked Hold Context</h2>
              <p className="mt-1 text-sm text-neutral-600">
                These orders are currently tied to blocked seller cash-out requests.
              </p>
            </div>

            <div className="grid gap-4 p-5 xl:grid-cols-2">
              {sellerHoldContextSummaries.map((summary) => (
                <article
                  key={summary.orderId}
                  id={`seller-hold-order-${summary.orderId}`}
                  className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                >
                  {(() => {
                    const holdOrderWorkspaceLink =
                      blockedHoldOrderWorkspaceLink(summary);
                    const holdPayoutWorkspaceLink =
                      blockedHoldPayoutWorkspaceLink(summary);

                    return (
                      <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">Order #{summary.orderId}</h3>
                      <p className="mt-1 text-sm text-neutral-600">
                        Cash-out on this order stays blocked until fulfillment
                        clears, dispute review resolves, or admin releases the
                        related payout rows.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={holdPayoutWorkspaceLink.href}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                      >
                        {`Open ${holdPayoutWorkspaceLink.label}`}
                      </Link>
                      <Link
                        href={holdOrderWorkspaceLink.href}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                      >
                        {`Open ${holdOrderWorkspaceLink.label}`}
                      </Link>
                      <Link
                        href={`${orderDetailHref(summary.orderId)}#recent-activity`}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                      >
                        Open Order Detail
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <Info
                      label="Blocked Payouts"
                      value={String(summary.requestCount)}
                    />
                    <Info
                      label="Active Cases"
                      value={String(summary.activeCaseCount)}
                    />
                    <Info
                      label="Held Rows"
                      value={String(summary.blockedLedgerRowCount)}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        focusRequestView("blocked", `order ${summary.orderId}`)
                      }
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                    >
                      Focus Blocked Payouts
                    </button>
                    <Link
                      href={holdPayoutWorkspaceLink.href}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                    >
                      {`Open ${holdPayoutWorkspaceLink.label}`}
                    </Link>
                    <Link
                      href={holdOrderWorkspaceLink.href}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                    >
                      {`Open ${holdOrderWorkspaceLink.label}`}
                    </Link>
                    <Link
                      href={`${orderDetailHref(summary.orderId)}#recent-activity`}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold hover:bg-neutral-50"
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
          </section>
        ) : null}
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

function BreakdownCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className="font-black text-neutral-900">{label}</p>
      <p className="mt-1 text-sm font-bold text-neutral-950">{value}</p>
      <p className="mt-1 text-xs leading-5 text-neutral-500">{detail}</p>
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

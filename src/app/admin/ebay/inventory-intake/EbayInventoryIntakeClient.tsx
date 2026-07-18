"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type IntakeRow = {
  productId: number;
  inventoryItemId: string | null;
  sku: string | null;
  title: string;
  price: number;
  quantity: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  inventoryStatus: string;
  inventoryQuantity: number | null;
  inventoryPrice: number | null;
  category: string | null;
  promoDiscountPercent: number;
  promoOriginalPrice: number;
  promoFreeShipping: boolean;
  instaCompSuggestedPrice: number;
  instaCompPreviousPrice: number;
  instaCompCompCount: number;
  instaCompRepricedAt: string | null;
  isReady: boolean;
  isLive: boolean;
  problems: string[];
};

type IntakeSummary = {
  total: number;
  ready: number;
  live: number;
  needsHelp: number;
  quantity: number;
  value: number;
};

type PriceProposal = {
  productId: number;
  title: string;
  previousPrice: number;
  suggestedPrice: number | null;
  compCount: number;
  message: string;
};

type FilterMode = "all" | "needs_help" | "ready" | "live";
type ActionNoticeTone = "success" | "error" | "info";

const filters: Array<{ value: FilterMode; label: string }> = [
  { value: "all", label: "All for sale" },
  { value: "needs_help", label: "Needs help" },
  { value: "ready", label: "Ready to push" },
  { value: "live", label: "Live" },
];

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function shortDate(value: string | null) {
  if (!value) return "Not synced";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function rowTone(row: IntakeRow) {
  if (!row.isReady) return "border-amber-200 bg-amber-50 text-amber-900";
  if (row.isLive) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function rowStatus(row: IntakeRow) {
  if (!row.isReady) return "Needs help";
  if (row.isLive) return "Live";
  return "Ready";
}

function adminHref(href: string, handoff: string) {
  if (!handoff || !href.startsWith("/admin")) return href;

  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("admin_handoff", handoff);
  return `${path}?${params.toString()}`;
}

export default function EbayInventoryIntakeClient({
  adminHandoff,
}: {
  adminHandoff: string;
}) {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [summary, setSummary] = useState<IntakeSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [promoWorking, setPromoWorking] = useState(false);
  const [repriceWorkingIds, setRepriceWorkingIds] = useState<number[]>([]);
  const [priceProposals, setPriceProposals] = useState<PriceProposal[]>([]);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<number[]>([]);
  const [discountPercent, setDiscountPercent] = useState("10");
  const [freeShipping, setFreeShipping] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setError("");
  }, []);

  const showError = useCallback((message: string) => {
    setError(message);
    setNotice("");
  }, []);

  const clearMessages = useCallback(() => {
    setNotice("");
    setError("");
  }, []);

  const loadRows = useCallback(async (options?: { preserveMessages?: boolean }) => {
    setLoading(true);
    if (!options?.preserveMessages) {
      clearMessages();
    }

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not load eBay inventory intake.");
      }

      setRows((data.rows || []) as IntakeRow[]);
      setSummary((data.summary || null) as IntakeSummary | null);
      setSelectedIds((current) => {
        const available = new Set(
          ((data.rows || []) as IntakeRow[]).map((row) => row.productId),
        );

        return current.filter((id) => available.has(id));
      });
    } catch (nextError: any) {
      showError(nextError.message || "Could not load eBay inventory intake.");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [clearMessages, showError]);

  useEffect(() => {
    // Initial data loading is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (filter === "needs_help" && row.isReady) return false;
      if (filter === "ready" && (!row.isReady || row.isLive)) return false;
      if (filter === "live" && !row.isLive) return false;

      if (!term) return true;

      return [
        row.title,
        row.sku || "",
        row.ebayItemId || "",
        row.problems.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [filter, rows, search]);

  const visibleIds = useMemo(
    () => filteredRows.map((row) => row.productId),
    [filteredRows],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(row.productId)),
    [rows, selectedSet],
  );
  const selectedReadyIds = selectedRows
    .filter((row) => row.isReady)
    .map((row) => row.productId);
  const selectedPushableIds = selectedRows
    .filter(
      (row) =>
        row.isReady ||
        (row.ebayItemId &&
          row.title.trim().length > 0 &&
          row.price > 0 &&
          row.quantity > 0),
    )
    .map((row) => row.productId);
  const selectedEbayIds = selectedRows
    .filter((row) => Boolean(row.ebayItemId))
    .map((row) => row.productId);
  const selectedNeedsHelpRows = selectedRows.filter((row) => !row.isReady);

  function toggleRow(productId: number) {
    setSelectedIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function selectVisible() {
    setSelectedIds(visibleIds);
  }

  function selectVisibleReady() {
    setSelectedIds(
      filteredRows.filter((row) => row.isReady).map((row) => row.productId),
    );
  }

  function selectVisibleNeedsHelp() {
    setSelectedIds(
      filteredRows.filter((row) => !row.isReady).map((row) => row.productId),
    );
  }

  async function pushSelectedLive() {
    setWorking(true);
    clearMessages();

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push-live",
          productIds: selectedPushableIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not push selected listings live.");
      }

      showNotice(data.message || "Selected listings pushed live.");
      await loadRows({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not push selected listings live.");
    } finally {
      setWorking(false);
    }
  }

  async function refreshSelectedFromEbay() {
    setWorking(true);
    clearMessages();

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "refresh-ebay-data",
          productIds: selectedEbayIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not refresh selected eBay data.");
      }

      showNotice(data.message || "Selected listings refreshed from eBay.");
      await loadRows({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not refresh selected eBay data.");
    } finally {
      setWorking(false);
    }
  }

  async function copySelectedForInstaComp() {
    const text = selectedRows
      .map((row) => `${row.title} | SKU ${row.sku || "missing"} | eBay ${row.ebayItemId || "missing"}`)
      .join("\n");

    if (!text.trim()) {
      showError("Select at least one row first.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showNotice(`Copied ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"} for InstaComp™ cleanup.`);
    } catch {
      showError(
        "Chrome blocked clipboard access. Select the rows again and use your browser copy shortcut, or open InstaComp™ and paste the titles manually.",
      );
    }
  }

  async function instacompPreview(productIds: number[]) {
    const uniqueIds = Array.from(new Set(productIds)).filter((id) => id > 0);

    if (uniqueIds.length === 0) {
      showError("Select at least one row first.");
      return;
    }

    setRepriceWorkingIds((current) =>
      Array.from(new Set([...current, ...uniqueIds])),
    );
    clearMessages();

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "instacomp-preview",
          productIds: uniqueIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not run InstaComp™ price preview.");
      }

      const repriced = Array.isArray(data.repriced) ? data.repriced : [];
      const proposals = repriced
        .filter((item: any) => Number(item?.suggestedPrice || 0) > 0)
        .map((item: any) => ({
          productId: Number(item.productId),
          title: String(item.title || "Untitled listing"),
          previousPrice: Number(item.previousPrice || 0),
          suggestedPrice: Number(item.suggestedPrice || 0),
          compCount: Number(item.compCount || 0),
          message: String(item.message || ""),
        })) as PriceProposal[];

      setPriceProposals(proposals);
      setAcceptedProposalIds(proposals.map((proposal) => proposal.productId));
      showNotice(
        proposals.length > 0
          ? `${data.message || "InstaComp™ price proposals ready."} Review below, uncheck anything you do not want, then accept selected prices.`
          : data.message ||
              "InstaComp™ did not find enough reliable comps to propose a price.",
      );
      await loadRows({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not run InstaComp™ price preview.");
    } finally {
      setRepriceWorkingIds((current) =>
        current.filter((id) => !uniqueIds.includes(id)),
      );
    }
  }

  async function acceptSelectedInstaCompPrices() {
    const productIds = acceptedProposalIds.filter((id) =>
      priceProposals.some((proposal) => proposal.productId === id),
    );

    if (productIds.length === 0) {
      showError("Select at least one InstaComp™ price proposal to accept.");
      return;
    }

    setRepriceWorkingIds(productIds);
    clearMessages();

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "instacomp-apply-reprice",
          productIds,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not apply InstaComp™ prices.");
      }

      const appliedIds = (Array.isArray(data.repriced) ? data.repriced : [])
        .filter((item: any) => item?.updated === true)
        .map((item: any) => Number(item.productId))
        .filter((id: number) => Number.isInteger(id) && id > 0);

      showNotice(data.message || "Accepted selected InstaComp™ prices.");
      setPriceProposals((current) =>
        current.filter((proposal) => !appliedIds.includes(proposal.productId)),
      );
      setAcceptedProposalIds((current) =>
        current.filter((id) => !appliedIds.includes(id)),
      );
      await loadRows({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not apply InstaComp™ prices.");
    } finally {
      setRepriceWorkingIds([]);
    }
  }

  function toggleProposal(productId: number) {
    setAcceptedProposalIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function declineAllInstaCompPrices() {
    setPriceProposals([]);
    setAcceptedProposalIds([]);
    showNotice("Declined current InstaComp™ price proposals. No prices were changed.");
  }

  async function applyPromo(action: "apply-promo" | "clear-promo") {
    setPromoWorking(true);
    clearMessages();

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          productIds: selectedIds,
          discountPercent: Number(discountPercent || 0),
          freeShipping,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not update selected promos.");
      }

      showNotice(data.message || "Selected promos updated.");
      await loadRows({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not update selected promos.");
    } finally {
      setPromoWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <section className="rounded-xl border-4 border-emerald-400 bg-emerald-50 p-5 text-emerald-950">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-black">
              Truely Collectables website inventory
            </h2>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6">
              Sold/zero-quantity items are hidden here. This is the working list
              for inventory TCOS knows can appear on Truely Collectables, with
              eBay-linked rows clearly marked when an outside listing exists.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={adminHref("/admin/ebay/import-runner", adminHandoff)}
              className="rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-black text-emerald-950 hover:bg-emerald-100"
            >
              Import / Resume eBay
            </Link>
            <Link
              href={adminHref("/admin/instacomp", adminHandoff)}
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Open InstaComp™
            </Link>
          </div>
        </div>
      </section>

      {summary ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Website Rows" value={String(summary.total)} />
          <Metric label="Needs Help" value={String(summary.needsHelp)} tone="amber" />
          <Metric label="Ready To Push" value={String(summary.ready)} tone="sky" />
          <Metric label="Live" value={String(summary.live)} tone="green" />
          <Metric label="Units" value={String(summary.quantity)} />
          <Metric label="Value" value={money(summary.value)} />
        </section>
      ) : null}

      {error ? (
        <ActionNotice tone="error">
          {error}
        </ActionNotice>
      ) : null}

      {notice ? (
        <ActionNotice
          tone={
            working || promoWorking || repriceWorkingIds.length > 0
              ? "info"
              : "success"
          }
        >
          {notice}
        </ActionNotice>
      ) : null}

      <section className="rounded-md border border-neutral-200 bg-white">
        <div className="space-y-4 border-b border-neutral-200 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-2xl font-black">Simple Working Table</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Select everything that looks good, preview InstaComp™ pricing,
                accept only the prices you want, and leave messy rows for manual
                cleanup.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectVisible}
                disabled={filteredRows.length === 0}
                className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black hover:bg-neutral-50 disabled:opacity-50"
              >
                Select All Showing
              </button>
              <button
                type="button"
                onClick={selectVisibleReady}
                disabled={filteredRows.every((row) => !row.isReady)}
                className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-black text-sky-900 hover:bg-sky-100 disabled:opacity-50"
              >
                Select Ready
              </button>
              <button
                type="button"
                onClick={selectVisibleNeedsHelp}
                disabled={filteredRows.every((row) => row.isReady)}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Select Needs Help
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0}
                className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black hover:bg-neutral-50 disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, SKU, or eBay item ID"
              className="rounded-md border border-neutral-300 px-4 py-3 text-sm font-semibold outline-none focus:border-neutral-500"
            />

            <div className="flex flex-wrap gap-2">
              {filters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={`rounded-md border px-3 py-2 text-xs font-black ${
                    filter === option.value
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm font-bold text-neutral-700">
                {selectedIds.length} selected. {selectedReadyIds.length} ready,
                {" "}
                {selectedPushableIds.length - selectedReadyIds.length} repairable
                from source data, {selectedNeedsHelpRows.length} need InstaComp™/manual help.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void pushSelectedLive()}
                  disabled={working || selectedPushableIds.length === 0}
                  aria-busy={working}
                  className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
                >
                  {working
                    ? "Pushing..."
                    : `Repair + Push Selected Live (${selectedPushableIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshSelectedFromEbay()}
                  disabled={working || selectedEbayIds.length === 0}
                  aria-busy={working}
                  className="rounded-md border border-emerald-300 bg-white px-4 py-3 text-sm font-black text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {working
                    ? "Refreshing..."
                    : `Refresh Current eBay Price + Pictures (${selectedEbayIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => void copySelectedForInstaComp()}
                  disabled={working || selectedIds.length === 0}
                  className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-sm font-black hover:bg-neutral-50 disabled:opacity-50"
                >
                  Copy Selected For InstaComp™
                </button>
                <button
                  type="button"
                  onClick={() => void instacompPreview(selectedIds)}
                  disabled={selectedIds.length === 0 || repriceWorkingIds.length > 0}
                  aria-busy={repriceWorkingIds.length > 0}
                  className="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm font-black text-blue-900 hover:bg-blue-100 disabled:opacity-50"
                >
                  {repriceWorkingIds.length > 0
                    ? "InstaComp™ repricing..."
                    : `Preview InstaComp™ Prices (${selectedIds.length})`}
                </button>
                <Link
                  href={adminHref("/admin/instacomp", adminHandoff)}
                  className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-sm font-black hover:bg-neutral-50"
                >
                  Open InstaComp™
                </Link>
              </div>
            </div>
          </div>

          {priceProposals.length > 0 ? (
            <div className="rounded-md border-2 border-blue-300 bg-blue-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-lg font-black text-blue-950">
                    InstaComp™ price proposals
                  </h3>
                  <p className="mt-1 text-sm font-bold text-blue-900">
                    Nothing has changed yet. Uncheck any proposal you do not
                    want, then accept selected prices.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setAcceptedProposalIds(
                        priceProposals.map((proposal) => proposal.productId),
                      )
                    }
                    className="rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-black text-blue-900"
                  >
                    Select All Proposals
                  </button>
                  <button
                    type="button"
                    onClick={() => setAcceptedProposalIds([])}
                    className="rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-black text-blue-900"
                  >
                    Unselect All
                  </button>
                  <button
                    type="button"
                    onClick={() => void acceptSelectedInstaCompPrices()}
                    disabled={
                      acceptedProposalIds.length === 0 ||
                      repriceWorkingIds.length > 0
                    }
                    aria-busy={repriceWorkingIds.length > 0}
                    className="rounded-md bg-blue-700 px-4 py-2 text-xs font-black text-white disabled:bg-neutral-500"
                  >
                    {repriceWorkingIds.length > 0
                      ? "Applying..."
                      : `Accept Selected Prices (${acceptedProposalIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={declineAllInstaCompPrices}
                    disabled={repriceWorkingIds.length > 0}
                    className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-xs font-black text-neutral-800 disabled:opacity-50"
                  >
                    Decline All
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                {priceProposals.map((proposal) => (
                  <label
                    key={proposal.productId}
                    className="flex flex-col gap-2 rounded border border-blue-200 bg-white p-3 md:flex-row md:items-center md:justify-between"
                  >
                    <span className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={acceptedProposalIds.includes(proposal.productId)}
                        onChange={() => toggleProposal(proposal.productId)}
                        className="mt-1 h-5 w-5 accent-blue-700"
                      />
                      <span>
                        <span className="block font-black">
                          {proposal.title}
                        </span>
                        <span className="text-xs font-bold text-neutral-600">
                          {proposal.compCount} comps · current{" "}
                          {money(proposal.previousPrice)} → suggested{" "}
                          {money(proposal.suggestedPrice)}
                        </span>
                      </span>
                    </span>
                    <span className="text-xl font-black text-blue-900">
                      {money(proposal.suggestedPrice)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-sm font-black uppercase tracking-[0.08em] text-amber-950">
                  Bulk sale controls
                </h3>
                <p className="mt-1 text-xs font-bold text-amber-900">
                  Select products above, then apply a percentage sale and/or
                  free-shipping flag. Clear promo restores the saved original
                  price.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-950">
                  <span>% off</span>
                  <input
                    type="number"
                    min="0"
                    max="95"
                    step="1"
                    value={discountPercent}
                    onChange={(event) => setDiscountPercent(event.target.value)}
                    className="w-16 rounded border border-amber-200 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-950">
                  <input
                    type="checkbox"
                    checked={freeShipping}
                    onChange={(event) => setFreeShipping(event.target.checked)}
                    className="h-4 w-4 accent-amber-600"
                  />
                  Free shipping
                </label>
                <button
                  type="button"
                  onClick={() => void applyPromo("apply-promo")}
                  disabled={promoWorking || selectedIds.length === 0}
                  aria-busy={promoWorking}
                  className="rounded-md bg-amber-500 px-4 py-3 text-sm font-black text-neutral-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-neutral-400"
                >
                  {promoWorking ? "Updating..." : `Apply Promo (${selectedIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => void applyPromo("clear-promo")}
                  disabled={promoWorking || selectedIds.length === 0}
                  aria-busy={promoWorking}
                  className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-sm font-black hover:bg-neutral-50 disabled:opacity-50"
                >
                  {promoWorking ? "Clearing..." : "Clear Promo"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Price / Qty</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Needs</th>
                <th className="px-4 py-3">Links</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-neutral-600" colSpan={6}>
                    Loading Truely Collectables inventory...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-neutral-600" colSpan={6}>
                    No Truely Collectables inventory rows match this view.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr key={row.productId} className="align-top">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(row.productId)}
                        onChange={() => toggleRow(row.productId)}
                        className="h-5 w-5 accent-neutral-950"
                        aria-label={`Select ${row.title}`}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-3">
                        <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
                          <Image
                            src={row.imageUrl || "/placeholder.png"}
                            alt={row.title}
                            fill
                            sizes="64px"
                            unoptimized
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="line-clamp-2 font-black leading-6">
                            {row.title}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-neutral-500">
                            SKU {row.sku || "missing"} · eBay{" "}
                            {row.ebayItemId || "missing"}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            Last eBay sync: {shortDate(row.lastSeenAt)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-lg font-black">{money(row.price)}</p>
                      <p className="mt-1 text-xs font-bold text-neutral-500">
                        Qty {row.quantity}
                      </p>
                      {row.promoDiscountPercent > 0 || row.promoFreeShipping ? (
                        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900">
                          {row.promoDiscountPercent > 0
                            ? `${row.promoDiscountPercent}% off`
                            : "Promo"}{" "}
                          {row.promoOriginalPrice > 0
                            ? `from ${money(row.promoOriginalPrice)}`
                            : ""}
                          {row.promoFreeShipping ? " · free shipping" : ""}
                        </p>
                      ) : null}
                      {row.instaCompSuggestedPrice > 0 ? (
                        <p className="mt-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-900">
                          InstaComp™ {money(row.instaCompSuggestedPrice)}
                          {row.instaCompCompCount > 0
                            ? ` · ${row.instaCompCompCount} comps`
                            : ""}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded border px-2 py-1 text-xs font-black ${rowTone(
                          row,
                        )}`}
                      >
                        {rowStatus(row)}
                      </span>
                      <p className="mt-2 text-xs text-neutral-500">
                        V2: {row.inventoryStatus}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      {row.problems.length === 0 ? (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-800">
                          Good
                        </span>
                      ) : (
                        <div className="flex max-w-[280px] flex-wrap gap-1.5">
                          {row.problems.map((problem) => (
                            <span
                              key={`${row.productId}-${problem}`}
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                            >
                              {problem}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={adminHref(
                            `/admin/products/${row.productId}`,
                            adminHandoff,
                          )}
                          className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black hover:bg-neutral-50"
                        >
                          Edit
                        </Link>
                        {row.ebayItemId ? (
                          <a
                            href={`https://www.ebay.com/itm/${row.ebayItemId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black hover:bg-neutral-50"
                          >
                            eBay
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void instacompPreview([row.productId])}
                          disabled={repriceWorkingIds.includes(row.productId)}
                          aria-busy={repriceWorkingIds.includes(row.productId)}
                          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                        >
                          {repriceWorkingIds.includes(row.productId)
                            ? "Checking..."
                            : "Preview InstaComp™"}
                        </button>
                        <Link
                          href={adminHref(
                            `/admin/instacomp?source=ebay-intake&product=${row.productId}`,
                            adminHandoff,
                          )}
                          className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black hover:bg-neutral-50"
                        >
                          Open
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ActionNotice({
  tone,
  children,
}: {
  tone: ActionNoticeTone;
  children: string;
}) {
  const toneClass =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "info"
        ? "border-blue-200 bg-blue-50 text-blue-900"
        : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <section
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded-md border px-4 py-3 text-sm font-black ${toneClass}`}
    >
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "sky";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50"
        : tone === "sky"
          ? "border-sky-200 bg-sky-50"
          : "border-neutral-200 bg-white";

  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

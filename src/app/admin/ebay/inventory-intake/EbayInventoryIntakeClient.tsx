"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

type FilterMode = "all" | "needs_help" | "ready" | "live";

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

export default function EbayInventoryIntakeClient() {
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [summary, setSummary] = useState<IntakeSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadRows() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        cache: "no-store",
      });
      const data = await response.json();

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
      setError(nextError.message || "Could not load eBay inventory intake.");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, []);

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
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/admin/ebay-inventory-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "push-live",
          productIds: selectedIds,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not push selected listings live.");
      }

      setNotice(data.message || "Selected listings pushed live.");
      await loadRows();
    } catch (nextError: any) {
      setError(nextError.message || "Could not push selected listings live.");
    } finally {
      setWorking(false);
    }
  }

  async function copySelectedForInstaComp() {
    const text = selectedRows
      .map((row) => `${row.title} | SKU ${row.sku || "missing"} | eBay ${row.ebayItemId || "missing"}`)
      .join("\n");

    if (!text.trim()) {
      setError("Select at least one row first.");
      return;
    }

    await navigator.clipboard.writeText(text);
    setNotice(`Copied ${selectedRows.length} selected row${selectedRows.length === 1 ? "" : "s"} for InstaComp™ cleanup.`);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <section className="rounded-xl border-4 border-emerald-400 bg-emerald-50 p-5 text-emerald-950">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-black">Your eBay inventory for sale</h2>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6">
              Sold/zero-quantity items are hidden here. This is the working list
              for cards/items you can actually sell on Truely Collectables.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/ebay/import-runner"
              className="rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-black text-emerald-950 hover:bg-emerald-100"
            >
              Import / Resume eBay
            </Link>
            <Link
              href="/admin/instacomp"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Open InstaComp™
            </Link>
          </div>
        </div>
      </section>

      {summary ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="For Sale Rows" value={String(summary.total)} />
          <Metric label="Needs Help" value={String(summary.needsHelp)} tone="amber" />
          <Metric label="Ready To Push" value={String(summary.ready)} tone="sky" />
          <Metric label="Live" value={String(summary.live)} tone="green" />
          <Metric label="Units" value={String(summary.quantity)} />
          <Metric label="Value" value={money(summary.value)} />
        </section>
      ) : null}

      {error ? (
        <section className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-800">
          {error}
        </section>
      ) : null}

      {notice ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-800">
          {notice}
        </section>
      ) : null}

      <section className="rounded-md border border-neutral-200 bg-white">
        <div className="space-y-4 border-b border-neutral-200 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-2xl font-black">Simple Working Table</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Select everything that looks good, push it live, and leave the
                messy rows for InstaComp™ cleanup.
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
                {selectedIds.length} selected. {selectedReadyIds.length} ready
                to push. {selectedNeedsHelpRows.length} need InstaComp™/manual help.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void pushSelectedLive()}
                  disabled={working || selectedReadyIds.length === 0}
                  className="rounded-md bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
                >
                  {working
                    ? "Pushing..."
                    : `Push Selected Live (${selectedReadyIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => void copySelectedForInstaComp()}
                  disabled={selectedIds.length === 0}
                  className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-sm font-black hover:bg-neutral-50 disabled:opacity-50"
                >
                  Copy Selected For InstaComp™
                </button>
                <Link
                  href="/admin/instacomp"
                  className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-sm font-black hover:bg-neutral-50"
                >
                  Open InstaComp™
                </Link>
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
                    Loading eBay inventory...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-neutral-600" colSpan={6}>
                    No eBay inventory rows match this view.
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
                          href={`/admin/products/${row.productId}`}
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
                        <Link
                          href={`/admin/instacomp?source=ebay-intake&product=${row.productId}`}
                          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800 hover:bg-blue-100"
                        >
                          InstaComp™
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

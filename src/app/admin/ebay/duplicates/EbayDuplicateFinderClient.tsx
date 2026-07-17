"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type DuplicateRow = {
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
};

type DuplicateGroup = {
  key: string;
  title: string;
  price: number;
  count: number;
  totalQuantity: number;
  recommendedKeeperProductId: number | null;
  rows: DuplicateRow[];
};

type Summary = {
  groups: number;
  duplicateRows: number;
  totalRowsInGroups: number;
};

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

export default function EbayDuplicateFinderClient() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const [duplicates, setDuplicates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function fetchGroups() {
    try {
      const response = await fetch("/api/admin/ebay-duplicates", {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not load duplicate groups.");
      }

      const nextGroups = (data.groups || []) as DuplicateGroup[];
      setGroups(nextGroups);
      setSummary((data.summary || null) as Summary | null);
      setKeepers((current) => {
        const next = { ...current };

        for (const group of nextGroups) {
          if (!next[group.key] && group.recommendedKeeperProductId) {
            next[group.key] = group.recommendedKeeperProductId;
          }
        }

        return next;
      });
      setDuplicates((current) => {
        const next = { ...current };

        for (const group of nextGroups) {
          const keeperId = next[group.key] || group.recommendedKeeperProductId;
          const duplicate = group.rows.find((row) => row.productId !== keeperId);

          if (!next[group.key] && duplicate) {
            next[group.key] = duplicate.productId;
          }
        }

        return next;
      });
    } catch (nextError: any) {
      setError(nextError.message || "Could not load duplicate groups.");
      setGroups([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadGroups() {
    setLoading(true);
    setError("");
    await fetchGroups();
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void fetchGroups();
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, []);

  const hasGroups = groups.length > 0;
  const totalDuplicateRows = useMemo(
    () => groups.reduce((sum, group) => sum + Math.max(0, group.count - 1), 0),
    [groups],
  );

  function chooseKeeper(group: DuplicateGroup, productId: number) {
    setKeepers((current) => ({ ...current, [group.key]: productId }));
    setDuplicates((current) => {
      if (current[group.key] !== productId) return current;

      const nextDuplicate = group.rows.find((row) => row.productId !== productId);
      return {
        ...current,
        [group.key]: nextDuplicate?.productId || 0,
      };
    });
  }

  async function mergeGroup(group: DuplicateGroup) {
    const keeperProductId = keepers[group.key] || group.recommendedKeeperProductId || 0;
    const duplicateProductId =
      duplicates[group.key] ||
      group.rows.find((row) => row.productId !== keeperProductId)?.productId ||
      0;

    if (!keeperProductId || !duplicateProductId || keeperProductId === duplicateProductId) {
      setError("Pick one keeper and one different duplicate row first.");
      return;
    }

    setWorkingKey(group.key);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge-duplicate",
          keeperProductId,
          duplicateProductId,
          confirm: "MERGE_DUPLICATE",
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not merge duplicate.");
      }

      const result = data.result || {};
      const ebayWarnings = Array.isArray(result.ebayActions)
        ? result.ebayActions
            .filter((action: any) => action && action.ok === false)
            .map((action: any) => action.message)
            .filter(Boolean)
        : [];

      setNotice(
        `${data.message || "Duplicate merged."}${
          ebayWarnings.length ? ` eBay warning: ${ebayWarnings.join(" | ")}` : ""
        }`,
      );
      await loadGroups();
    } catch (nextError: any) {
      setError(nextError.message || "Could not merge duplicate.");
    } finally {
      setWorkingKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <section className="rounded-xl border-4 border-amber-300 bg-amber-50 p-5 text-amber-950">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-black">Duplicate cleanup queue</h2>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6">
              This finder only flags exact same-title/same-price active eBay rows.
              Pick the row to keep, pick the duplicate to end/archive, then merge.
              TCOS rolls quantity into the keeper and attempts the matching eBay
              offer cleanup.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadGroups()}
            disabled={loading || Boolean(workingKey)}
            className="rounded-md bg-neutral-950 px-5 py-3 text-sm font-black text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Scanning..." : "Rescan Duplicates"}
          </button>
        </div>
      </section>

      {summary ? (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Duplicate Groups" value={String(summary.groups)} />
          <Metric label="Rows To Clean" value={String(totalDuplicateRows)} tone="amber" />
          <Metric
            label="Rows In Groups"
            value={String(summary.totalRowsInGroups)}
            tone="sky"
          />
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

      <section className="space-y-4">
        {loading ? (
          <div className="rounded-md border border-neutral-200 bg-white p-8 text-sm font-bold text-neutral-600">
            Scanning active eBay rows for duplicates...
          </div>
        ) : !hasGroups ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-8 text-sm font-black text-emerald-900">
            No exact duplicate groups found right now.
          </div>
        ) : (
          groups.map((group) => {
            const keeperProductId =
              keepers[group.key] || group.recommendedKeeperProductId || 0;
            const duplicateProductId =
              duplicates[group.key] ||
              group.rows.find((row) => row.productId !== keeperProductId)?.productId ||
              0;

            return (
              <article
                key={group.key}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.1em] text-amber-700">
                      {group.count} matching listings · {group.totalQuantity} total qty ·{" "}
                      {money(group.price)}
                    </p>
                    <h3 className="mt-1 text-2xl font-black">{group.title}</h3>
                    <p className="mt-1 text-xs font-bold text-neutral-500">
                      Exact match rule: normalized title + same price.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void mergeGroup(group)}
                    disabled={
                      workingKey === group.key ||
                      !keeperProductId ||
                      !duplicateProductId ||
                      keeperProductId === duplicateProductId
                    }
                    className="rounded-md bg-rose-700 px-5 py-3 text-sm font-black text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                  >
                    {workingKey === group.key
                      ? "Merging..."
                      : "Merge Selected Duplicate"}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {group.rows.map((row) => {
                    const isKeeper = keeperProductId === row.productId;
                    const isDuplicate = duplicateProductId === row.productId;

                    return (
                      <div
                        key={row.productId}
                        className={`rounded-lg border p-4 ${
                          isKeeper
                            ? "border-emerald-300 bg-emerald-50"
                            : isDuplicate
                              ? "border-rose-300 bg-rose-50"
                              : "border-neutral-200 bg-neutral-50"
                        }`}
                      >
                        <div className="flex gap-3">
                          <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
                            <Image
                              src={row.imageUrl || "/placeholder.png"}
                              alt={row.title}
                              fill
                              sizes="80px"
                              unoptimized
                              className="object-cover"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-black leading-5">
                              {row.title}
                            </p>
                            <p className="mt-1 text-xs font-bold text-neutral-600">
                              SKU {row.sku || "missing"} · eBay{" "}
                              {row.ebayItemId || "missing"}
                            </p>
                            <p className="mt-1 text-xs font-bold text-neutral-600">
                              {money(row.price)} · Qty {row.quantity} · V2{" "}
                              {row.inventoryStatus}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              Last sync: {shortDate(row.lastSeenAt)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => chooseKeeper(group, row.productId)}
                            className={`rounded-md border px-3 py-2 text-xs font-black ${
                              isKeeper
                                ? "border-emerald-700 bg-emerald-700 text-white"
                                : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50"
                            }`}
                          >
                            Keep this listing
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDuplicates((current) => ({
                                ...current,
                                [group.key]: row.productId,
                              }))
                            }
                            disabled={isKeeper}
                            className={`rounded-md border px-3 py-2 text-xs font-black ${
                              isDuplicate
                                ? "border-rose-700 bg-rose-700 text-white"
                                : "border-rose-300 bg-white text-rose-900 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                            }`}
                          >
                            End/archive this duplicate
                          </button>
                          {row.ebayItemId ? (
                            <a
                              href={`https://www.ebay.com/itm/${row.ebayItemId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-black hover:bg-neutral-50"
                            >
                              eBay
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })
        )}
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
  tone?: "amber" | "sky";
}) {
  const toneClass =
    tone === "amber"
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

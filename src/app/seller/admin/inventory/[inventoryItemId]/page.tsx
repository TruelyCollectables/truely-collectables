"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAccountSession, getFreshAccountSession } from "../../../../account/account-session";

type InventoryAdminItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  ownershipScope: "seller" | "store";
  canEdit: boolean;
  title: string;
  player: string | null;
  sport: string | null;
  sku: string | null;
  description: string | null;
  category: string;
  condition: string;
  status: string;
  quantity: number;
  price: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : date.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export default function SellerInventoryAdminItemPage({
  params,
}: {
  params: { inventoryItemId: string };
}) {
  const router = useRouter();
  const inventoryItemId = params.inventoryItemId;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [item, setItem] = useState<InventoryAdminItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await getFreshAccountSession(5 * 60, true);
        if (!session) throw new Error("Log in before opening the master listing.");
        const response = await fetchWithAccountSession("/api/account/seller/inventory-admin");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Could not load inventory administration.");
        }
        const match = Array.isArray(data.items)
          ? (data.items as InventoryAdminItem[]).find(
              (entry) => entry.inventoryItemId === inventoryItemId,
            )
          : null;
        if (!cancelled) {
          setItem(match || null);
          setError(match ? "" : "That master listing was not found.");
        }
      } catch (nextError: any) {
        if (!cancelled) {
          setError(nextError.message || "Could not load the master listing.");
          setItem(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inventoryItemId]);

  const headerTone = useMemo(() => {
    if (!item) return "bg-neutral-900";
    if (item.status === "active") return "bg-emerald-950";
    if (item.status === "draft") return "bg-amber-950";
    return "bg-slate-950";
  }, [item]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_30%),linear-gradient(180deg,_#faf7ef,_#f4f1ea)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className={`rounded-[2rem] border border-neutral-900 p-6 text-white ${headerTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">
                Master listing
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">
                {loading ? "Loading listing..." : item?.title || "Listing not found"}
              </h1>
              <p className="mt-2 text-sm font-semibold text-neutral-300">
                {inventoryItemId}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/seller/admin/inventory"
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-black hover:bg-white/10"
              >
                Back to master listing workspace
              </Link>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="rounded-full bg-yellow-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-yellow-200"
              >
                Refresh
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-900">
            {error}
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-3xl border border-neutral-200 bg-white p-8 text-center font-bold text-neutral-600">
            Loading master listing...
          </section>
        ) : item ? (
          <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-3">
                <p className="text-sm font-black uppercase tracking-[0.16em] text-neutral-500">
                  Exact match
                </p>
                <h2 className="text-2xl font-black">{item.title}</h2>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Info label="Product" value={item.legacyProductId ? `#${item.legacyProductId}` : "Not linked"} />
                  <Info label="SKU" value={item.sku || "Not set"} />
                  <Info label="Status" value={item.status} />
                  <Info label="Quantity" value={String(item.quantity)} />
                  <Info label="Price" value={money(item.price)} />
                  <Info label="Category" value={item.category} />
                  <Info label="Condition" value={item.condition} />
                  <Info label="Updated" value={dateLabel(item.updatedAt)} />
                </dl>
                {item.description ? (
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                      Description
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-neutral-800">
                      {item.description}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  {item.legacyProductId ? (
                    <Link
                      href={`/product/${item.legacyProductId}`}
                      className="rounded-xl border border-neutral-300 px-4 py-2 font-black hover:bg-neutral-50"
                    >
                      Open storefront product
                    </Link>
                  ) : null}
                  {item.ebayItemId ? (
                    <a
                      href={`https://www.ebay.com/itm/${encodeURIComponent(item.ebayItemId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-neutral-300 px-4 py-2 font-black hover:bg-neutral-50"
                    >
                      Open eBay
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Record details
                </p>
                <div className="mt-3 space-y-3 text-sm font-semibold text-neutral-800">
                  <Info label="Ownership" value={item.ownershipScope.toUpperCase()} />
                  <Info label="Can edit" value={item.canEdit ? "Yes" : "No"} />
                  <Info label="Player" value={item.player || "Not set"} />
                  <Info label="Sport" value={item.sport || "Not set"} />
                  <Info label="Created" value={dateLabel(item.createdAt)} />
                  <Info label="Inventory ID" value={item.inventoryItemId} />
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <dt className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-neutral-900">
        {value}
      </dd>
    </div>
  );
}

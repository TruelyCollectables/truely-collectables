"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AUTHENTICITY_STATUSES,
  AUTOGRAPH_SOURCES,
  authenticityStatusLabel,
  autographSourceLabel,
  type AuthenticityProfile,
} from "../../../../lib/authenticity";
import {
  fetchWithAccountSession,
  getFreshAccountSession,
  type StoredAccountSession,
} from "../../../account/account-session";

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
  authenticity: AuthenticityProfile;
  under20SellerProtectionOptIn: boolean;
  updatedAt: string | null;
  createdAt: string | null;
};

type InventorySummary = {
  totalItems: number;
  totalQuantity: number;
  activeCount: number;
  draftCount: number;
  archivedCount: number;
  storeOwnedCount: number;
};

type SaveResult = {
  inventoryItemId: string;
  legacyProductId: number | null;
  success: boolean;
  status: number;
  message: string;
};

type StatusFilter = "all" | "draft" | "active" | "archived" | "ended";

const PAGE_SIZE = 40;
const editableStatuses = ["draft", "active", "archived"];

function cloneItem(item: InventoryAdminItem): InventoryAdminItem {
  return {
    ...item,
    authenticity: {
      ...item.authenticity,
      guaranteedAuthenticators: [
        ...(item.authenticity.guaranteedAuthenticators || []),
      ],
    },
  };
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isEditableItem(item: InventoryAdminItem) {
  return item.canEdit && !["sold", "reserved"].includes(item.status);
}

function statusTone(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "archived" || status === "sold") {
    return "border-neutral-200 bg-neutral-100 text-neutral-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-900";
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

export default function SellerInventoryAdminPage() {
  const [session, setSession] = useState<StoredAccountSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [items, setItems] = useState<InventoryAdminItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, InventoryAdminItem>>({});
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [isStoreOwner, setIsStoreOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<SaveResult[]>([]);
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");

  async function loadInventory(options?: { preserveSelection?: boolean }) {
    setLoading(true);
    setError("");

    try {
      const response = await fetchWithAccountSession(
        "/api/account/seller/inventory-admin",
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not load inventory administration.");
      }

      const nextItems = Array.isArray(data.items)
        ? (data.items as InventoryAdminItem[])
        : [];
      setItems(nextItems);
      setDrafts(
        Object.fromEntries(
          nextItems.map((item) => [item.inventoryItemId, cloneItem(item)]),
        ),
      );
      setSummary((data.summary || null) as InventorySummary | null);
      setIsStoreOwner(data.account?.isStoreOwner === true);
      if (!options?.preserveSelection) setSelectedIds([]);
    } catch (nextError: any) {
      setItems([]);
      setDrafts({});
      setSummary(null);
      setError(nextError.message || "Could not load inventory administration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const freshSession = await getFreshAccountSession(5 * 60, true);
      if (cancelled) return;
      setSession(freshSession);
      setAuthChecked(true);
      if (freshSession) await loadInventory();
      else setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();

    return items.filter((item) => {
      if (statusFilter === "ended") {
        if (!["sold", "reserved"].includes(item.status)) return false;
      } else if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (!term) return true;

      return [
        item.title,
        item.player || "",
        item.sport || "",
        item.sku || "",
        item.category,
        item.condition,
        item.ebayItemId || "",
        String(item.legacyProductId || ""),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [items, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredItems.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectablePageIds = pageItems
    .filter(isEditableItem)
    .map((item) => item.inventoryItemId);
  const allPageSelected =
    selectablePageIds.length > 0 &&
    selectablePageIds.every((id) => selectedIdSet.has(id));

  function updateDraft(
    inventoryItemId: string,
    patch: Partial<InventoryAdminItem>,
  ) {
    setDrafts((current) => {
      const existing = current[inventoryItemId];
      if (!existing) return current;
      return {
        ...current,
        [inventoryItemId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  function updateAuthenticity(
    inventoryItemId: string,
    patch: Partial<AuthenticityProfile>,
  ) {
    setDrafts((current) => {
      const existing = current[inventoryItemId];
      if (!existing) return current;
      return {
        ...current,
        [inventoryItemId]: {
          ...existing,
          authenticity: {
            ...existing.authenticity,
            ...patch,
          },
        },
      };
    });
  }

  function toggleSelection(inventoryItemId: string) {
    setSelectedIds((current) =>
      current.includes(inventoryItemId)
        ? current.filter((id) => id !== inventoryItemId)
        : [...current, inventoryItemId],
    );
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const currentSet = new Set(current);
      if (allPageSelected) {
        selectablePageIds.forEach((id) => currentSet.delete(id));
      } else {
        selectablePageIds.forEach((id) => currentSet.add(id));
      }
      return Array.from(currentSet);
    });
  }

  function applyBulkValues() {
    if (selectedIds.length === 0) {
      setNotice("Select at least one editable listing first.");
      setError("");
      return;
    }

    if (
      !bulkQuantity &&
      !bulkPrice &&
      !bulkStatus &&
      !bulkCategory.trim() &&
      !bulkCondition.trim()
    ) {
      setNotice("Enter at least one bulk value before applying it.");
      setError("");
      return;
    }

    setDrafts((current) => {
      const next = { ...current };
      for (const id of selectedIds) {
        const item = next[id];
        if (!item || !isEditableItem(item)) continue;
        const status = bulkStatus || item.status;
        next[id] = {
          ...item,
          quantity:
            status === "archived"
              ? 0
              : bulkQuantity
                ? Math.max(0, Math.floor(Number(bulkQuantity)))
                : item.quantity,
          price: bulkPrice
            ? Math.max(0, Math.round(Number(bulkPrice) * 100) / 100)
            : item.price,
          status,
          category: bulkCategory.trim() || item.category,
          condition: bulkCondition.trim() || item.condition,
        };
      }
      return next;
    });
    setNotice(
      `Applied the bulk values to ${selectedIds.length} selected listing${
        selectedIds.length === 1 ? "" : "s"
      }. Review them, then save selected edits.`,
    );
    setError("");
  }

  async function saveSelected(ids = selectedIds) {
    const editableIds = ids.filter((id) => {
      const item = drafts[id];
      return item && isEditableItem(item);
    });

    if (editableIds.length === 0) {
      setNotice("Select at least one editable listing before saving.");
      setError("");
      return;
    }

    setSaving(true);
    setNotice("");
    setError("");
    setResults([]);

    try {
      const response = await fetchWithAccountSession(
        "/api/account/seller/inventory-admin",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: editableIds.map((id) => drafts[id]),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Could not save inventory edits.");
      }

      const nextResults = Array.isArray(data.results)
        ? (data.results as SaveResult[])
        : [];
      const successCount = Number(data.summary?.successCount || 0);
      const failureCount = Number(data.summary?.failureCount || 0);
      const failedIds = nextResults
        .filter((result) => !result.success)
        .map((result) => result.inventoryItemId);

      setResults(nextResults);
      setNotice(
        `${successCount} listing${successCount === 1 ? "" : "s"} saved${
          failureCount
            ? `; ${failureCount} need${failureCount === 1 ? "s" : ""} attention.`
            : "."
        }`,
      );
      await loadInventory({ preserveSelection: true });
      setSelectedIds(failedIds);
    } catch (nextError: any) {
      setError(nextError.message || "Could not save inventory edits.");
    } finally {
      setSaving(false);
    }
  }

  function resetDraft(inventoryItemId: string) {
    const original = items.find((item) => item.inventoryItemId === inventoryItemId);
    if (!original) return;
    setDrafts((current) => ({
      ...current,
      [inventoryItemId]: cloneItem(original),
    }));
  }

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] px-4 py-8 text-neutral-950">
        <div className="mx-auto max-w-5xl rounded-3xl border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Inventory Admin</h1>
          <p className="mt-3 font-semibold text-neutral-600">
            Refreshing your seller session...
          </p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] px-4 py-8 text-neutral-950">
        <div className="mx-auto max-w-5xl rounded-3xl border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Inventory Admin</h1>
          <p className="mt-3 font-semibold text-neutral-600">
            Log in to your TCOS account before opening seller inventory.
          </p>
          <Link
            href="/account/login?next=/seller/admin/inventory"
            className="mt-5 inline-flex rounded-xl bg-neutral-950 px-5 py-3 font-black text-white"
          >
            Log In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_30%),linear-gradient(180deg,_#faf7ef,_#f4f1ea)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl">
          <div className="bg-[radial-gradient(circle_at_top_right,_rgba(250,204,21,0.28),_transparent_35%)] p-6 lg:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">
                  Seller administration
                </p>
                <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                  Inventory Admin
                </h1>
                <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-neutral-300">
                  Edit complete TCOS listings, change quantity and price, and save
                  multiple selected listings in one guarded operation.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/account" className="rounded-full border border-white/20 px-4 py-2 text-sm font-black hover:bg-white/10">
                  Account
                </Link>
                <Link href="/account/orders" className="rounded-full border border-white/20 px-4 py-2 text-sm font-black hover:bg-white/10">
                  Orders
                </Link>
                <Link href="/seller/inventory" className="rounded-full border border-white/20 px-4 py-2 text-sm font-black hover:bg-white/10">
                  Seller Workspace
                </Link>
                <Link href="/shop" className="rounded-full bg-yellow-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-yellow-200">
                  View Store
                </Link>
              </div>
            </div>
          </div>
          <div className="grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-6">
            <HeaderStat label="Listings" value={String(summary?.totalItems || 0)} />
            <HeaderStat label="Active" value={String(summary?.activeCount || 0)} />
            <HeaderStat label="Drafts" value={String(summary?.draftCount || 0)} />
            <HeaderStat label="Archived" value={String(summary?.archivedCount || 0)} />
            <HeaderStat label="On hand" value={String(summary?.totalQuantity || 0)} />
            <HeaderStat label="Selected" value={String(selectedIds.length)} />
          </div>
        </section>

        <section className="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-950">
          These controls update TCOS and the Truely Collectables storefront. They do
          not silently revise an external eBay listing, buy postage, or create an
          order. Open the direct eBay link when a marketplace-side revision is also
          required.
          {isStoreOwner ? (
            <strong className="ml-1">
              Your owner account can also manage store-owned inventory rows.
            </strong>
          ) : null}
        </section>

        {error ? (
          <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-900">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div role="status" className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">
            {notice}
          </div>
        ) : null}
        {results.some((result) => !result.success) ? (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <h2 className="font-black text-amber-950">Listings needing attention</h2>
            <div className="mt-3 space-y-2 text-sm font-semibold text-amber-950">
              {results
                .filter((result) => !result.success)
                .map((result) => (
                  <p key={result.inventoryItemId}>
                    Product {result.legacyProductId || result.inventoryItemId}: {result.message}
                  </p>
                ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-[minmax(260px,1fr)_220px]">
              <label className="text-sm font-black">
                Search inventory
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Title, player, SKU, eBay item, product ID"
                  className="mt-2 w-full rounded-xl border border-neutral-300 px-4 py-3 font-semibold"
                />
              </label>
              <label className="text-sm font-black">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                  className="mt-2 w-full rounded-xl border border-neutral-300 px-4 py-3 font-semibold"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                  <option value="ended">Sold / reserved</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={togglePageSelection} className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-black hover:bg-neutral-50">
                {allPageSelected ? "Clear Page" : "Select Page"}
              </button>
              <button type="button" onClick={() => void loadInventory()} disabled={loading || saving} className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-black hover:bg-neutral-50 disabled:opacity-50">
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" onClick={() => void saveSelected()} disabled={saving || selectedIds.length === 0} className="rounded-xl bg-neutral-950 px-5 py-3 text-sm font-black text-white hover:bg-neutral-800 disabled:bg-neutral-500">
                {saving ? "Saving..." : `Save Selected Edits (${selectedIds.length})`}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-yellow-300 bg-yellow-50 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-yellow-800">Multi-edit tools</p>
          <h2 className="mt-2 text-2xl font-black">Apply common values to selected listings</h2>
          <p className="mt-2 text-sm font-semibold text-neutral-700">
            Leave a field blank to keep each listing’s current value. Apply first,
            review the individual cards below, then use Save Selected Edits.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <BulkField label="Quantity" value={bulkQuantity} setValue={setBulkQuantity} type="number" />
            <BulkField label="Price" value={bulkPrice} setValue={setBulkPrice} type="number" step="0.01" />
            <label className="text-sm font-black">
              Status
              <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} className="mt-2 w-full rounded-xl border border-yellow-300 bg-white px-3 py-3 font-semibold">
                <option value="">Keep current</option>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived / qty 0</option>
              </select>
            </label>
            <BulkField label="Category" value={bulkCategory} setValue={setBulkCategory} />
            <BulkField label="Condition" value={bulkCondition} setValue={setBulkCondition} />
          </div>
          <button type="button" onClick={applyBulkValues} disabled={selectedIds.length === 0} className="mt-4 rounded-xl bg-yellow-300 px-5 py-3 font-black text-neutral-950 hover:bg-yellow-200 disabled:bg-neutral-300">
            Apply Values to {selectedIds.length} Selected
          </button>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">Listing records</h2>
              <p className="mt-1 text-sm font-semibold text-neutral-600">
                Showing {pageItems.length} of {filteredItems.length} matching listings.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-black disabled:opacity-40">
                Previous
              </button>
              <span className="font-black">Page {safePage} of {totalPages}</span>
              <button type="button" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-black disabled:opacity-40">
                Next
              </button>
            </div>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center font-bold text-neutral-600">
              Loading inventory...
            </div>
          ) : pageItems.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-8 text-center">
              <h3 className="text-xl font-black">No matching listings</h3>
              <p className="mt-2 font-semibold text-neutral-600">Change the search or status filter.</p>
            </div>
          ) : (
            pageItems.map((item) => {
              const draft = drafts[item.inventoryItemId] || item;
              const editable = isEditableItem(item);
              const selected = selectedIdSet.has(item.inventoryItemId);

              return (
                <article key={item.inventoryItemId} className={`rounded-3xl border bg-white p-5 shadow-sm ${selected ? "border-yellow-400 ring-2 ring-yellow-200" : "border-neutral-200"}`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!editable}
                        onChange={() => toggleSelection(item.inventoryItemId)}
                        aria-label={`Select ${item.title}`}
                        className="mt-2 h-5 w-5 shrink-0"
                      />
                      {draft.imageUrl ? (
                        <Image src={draft.imageUrl} alt={draft.title} width={112} height={112} unoptimized className="h-28 w-28 shrink-0 rounded-xl border border-neutral-200 object-contain" />
                      ) : (
                        <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-center text-xs font-bold text-neutral-500">No image</div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words text-xl font-black">{item.title}</h3>
                          <span className={`rounded-full border px-2 py-1 text-xs font-black ${statusTone(item.status)}`}>{statusLabel(item.status)}</span>
                          <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-1 text-xs font-black text-neutral-700">{item.ownershipScope === "store" ? "STORE OWNED" : "SELLER OWNED"}</span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm font-semibold text-neutral-700 sm:grid-cols-2 xl:grid-cols-5">
                          <Fact label="Product" value={item.legacyProductId ? `#${item.legacyProductId}` : "Not linked"} />
                          <Fact label="SKU" value={item.sku || "Not set"} />
                          <Fact label="Price" value={money(item.price)} />
                          <Fact label="Quantity" value={String(item.quantity)} />
                          <Fact label="Updated" value={dateLabel(item.updatedAt)} />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.legacyProductId && item.status === "active" && item.quantity > 0 && item.imageUrl ? (
                        <Link href={`/product/${item.legacyProductId}`} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-black hover:bg-neutral-50">Storefront</Link>
                      ) : null}
                      {item.ebayItemId ? (
                        <a href={`https://www.ebay.com/itm/${encodeURIComponent(item.ebayItemId)}`} target="_blank" rel="noreferrer" className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-black hover:bg-neutral-50">Open eBay</a>
                      ) : null}
                      <button type="button" onClick={() => resetDraft(item.inventoryItemId)} disabled={!editable} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-black hover:bg-neutral-50 disabled:opacity-40">Reset</button>
                      <button type="button" onClick={() => void saveSelected([item.inventoryItemId])} disabled={!editable || saving} className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800 disabled:bg-neutral-500">Save Listing</button>
                    </div>
                  </div>

                  {!editable ? (
                    <p className="mt-4 rounded-xl border border-neutral-200 bg-neutral-100 p-3 text-sm font-bold text-neutral-700">
                      Sold and reserved listings are locked here to preserve order and inventory history.
                    </p>
                  ) : (
                    <details className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4" open={selected}>
                      <summary className="cursor-pointer text-lg font-black">Edit complete listing</summary>
                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <EditorField label="Title" value={draft.title} onChange={(value) => updateDraft(item.inventoryItemId, { title: value })} />
                        <EditorField label="Player" value={draft.player || ""} onChange={(value) => updateDraft(item.inventoryItemId, { player: value || null })} />
                        <EditorField label="Sport" value={draft.sport || ""} onChange={(value) => updateDraft(item.inventoryItemId, { sport: value || null })} />
                        <EditorField label="Image URL" value={draft.imageUrl || ""} onChange={(value) => updateDraft(item.inventoryItemId, { imageUrl: value || null })} type="url" />
                        <EditorField label="Price" value={String(draft.price)} onChange={(value) => updateDraft(item.inventoryItemId, { price: Number(value || 0) })} type="number" step="0.01" />
                        <EditorField label="Quantity" value={String(draft.quantity)} onChange={(value) => updateDraft(item.inventoryItemId, { quantity: Math.max(0, Math.floor(Number(value || 0))) })} type="number" />
                        <label className="text-sm font-black">
                          Status
                          <select value={draft.status} onChange={(event) => updateDraft(item.inventoryItemId, { status: event.target.value, quantity: event.target.value === "archived" ? 0 : draft.quantity })} className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-semibold">
                            {editableStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                          </select>
                        </label>
                        <EditorField label="Category" value={draft.category} onChange={(value) => updateDraft(item.inventoryItemId, { category: value })} />
                        <EditorField label="Condition" value={draft.condition} onChange={(value) => updateDraft(item.inventoryItemId, { condition: value })} />
                        <label className="text-sm font-black lg:col-span-2">
                          Description
                          <textarea value={draft.description || ""} onChange={(event) => updateDraft(item.inventoryItemId, { description: event.target.value || null })} rows={6} className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-semibold" />
                        </label>
                      </div>

                      <section className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4">
                        <h4 className="text-lg font-black">Authenticity and provenance</h4>
                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <label className="text-sm font-black">
                            Authenticity status
                            <select value={draft.authenticity.status} onChange={(event) => updateAuthenticity(item.inventoryItemId, { status: event.target.value as AuthenticityProfile["status"] })} className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-3 font-semibold">
                              {AUTHENTICITY_STATUSES.map((status) => <option key={status} value={status}>{authenticityStatusLabel(status)}</option>)}
                            </select>
                          </label>
                          <label className="text-sm font-black">
                            Autograph source
                            <select value={draft.authenticity.autographSource} onChange={(event) => updateAuthenticity(item.inventoryItemId, { autographSource: event.target.value as AuthenticityProfile["autographSource"] })} className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-3 font-semibold">
                              {AUTOGRAPH_SOURCES.map((source) => <option key={source} value={source}>{autographSourceLabel(source)}</option>)}
                            </select>
                          </label>
                          <EditorField label="Certification provider" value={draft.authenticity.certProvider || ""} onChange={(value) => updateAuthenticity(item.inventoryItemId, { certProvider: value || null })} />
                          <EditorField label="Certification number" value={draft.authenticity.certNumber || ""} onChange={(value) => updateAuthenticity(item.inventoryItemId, { certNumber: value || null })} />
                          <EditorField label="Guaranteed authenticators" value={(draft.authenticity.guaranteedAuthenticators || []).join(", ")} onChange={(value) => updateAuthenticity(item.inventoryItemId, { guaranteedAuthenticators: value.split(",").map((entry) => entry.trim()).filter(Boolean) })} />
                          <EditorField label="Provenance evidence" value={draft.authenticity.provenanceEvidence || ""} onChange={(value) => updateAuthenticity(item.inventoryItemId, { provenanceEvidence: value || null })} />
                          <label className="text-sm font-black lg:col-span-2">
                            Authenticity notes
                            <textarea value={draft.authenticity.authenticityNotes || ""} onChange={(event) => updateAuthenticity(item.inventoryItemId, { authenticityNotes: event.target.value || null })} rows={3} className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-3 font-semibold" />
                          </label>
                          <label className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm font-bold lg:col-span-2">
                            <input type="checkbox" checked={draft.under20SellerProtectionOptIn} onChange={(event) => updateDraft(item.inventoryItemId, { under20SellerProtectionOptIn: event.target.checked })} className="mt-1 h-4 w-4" />
                            Opt this listing into TCOS Under-$20 Seller Protection when otherwise eligible. This is an internal seller program, not insurance, and shipping is excluded from reimbursement.
                          </label>
                        </div>
                      </section>
                    </details>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/20 p-4 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-400">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-black uppercase tracking-[0.12em] text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function EditorField({
  label,
  onChange,
  step,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input type={type} step={step} min={type === "number" ? "0" : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-semibold" />
    </label>
  );
}

function BulkField({
  label,
  setValue,
  step,
  type = "text",
  value,
}: {
  label: string;
  setValue: (value: string) => void;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input type={type} step={step} min={type === "number" ? "0" : undefined} value={value} onChange={(event) => setValue(event.target.value)} placeholder="Keep current" className="mt-2 w-full rounded-xl border border-yellow-300 bg-white px-3 py-3 font-semibold" />
    </label>
  );
}

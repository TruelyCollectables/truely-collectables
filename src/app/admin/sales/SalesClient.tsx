"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  percent_off: number;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  scope_type: "all" | "filter" | "products";
  status: "live" | "scheduled" | "ended" | "inactive";
  scope: {
    search?: string;
    sections?: string[];
    players?: string[];
    productIds?: number[];
    minPrice?: number | null;
    maxPrice?: number | null;
  };
};

type InventoryItem = {
  id: number;
  title: string;
  player: string | null;
  section: string;
  price: number;
  quantity: number;
};

type Preview = {
  affectedCount: number;
  items: Array<{
    id: number;
    title: string;
    player: string | null;
    section: string;
    quantity: number;
    originalPrice: number;
    salePrice: number;
  }>;
};

function localDateTime(value: string | null) {
  if (!value) return "No end date";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function csvList(value: FormDataEntryValue | null) {
  return String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
}

export default function SalesClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [scopeType, setScopeType] = useState<Campaign["scope_type"]>("all");
  const [inventorySearch, setInventorySearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/sales", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Sales could not be loaded.");
    setCampaigns(data.campaigns || []);
    setInventory(data.inventory || []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    if (!q) return inventory.slice(0, 120);
    return inventory.filter((item) =>
      [item.title, item.player, item.section, String(item.id)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    ).slice(0, 120);
  }, [inventory, inventorySearch]);

  function scopeFromForm(form: FormData) {
    return {
      search: String(form.get("search") || "").trim() || undefined,
      sections: csvList(form.get("sections")),
      players: csvList(form.get("players")),
      productIds: selectedIds,
      minPrice: form.get("minPrice") ? Number(form.get("minPrice")) : null,
      maxPrice: form.get("maxPrice") ? Number(form.get("maxPrice")) : null,
    };
  }

  async function previewSale(formElement: HTMLFormElement) {
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/admin/sales/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          percentOff: Number(form.get("percentOff")),
          scopeType,
          scope: scopeFromForm(form),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Preview failed.");
      setPreview(data as Preview);
      setMessage(`Preview: ${data.affectedCount} active item${data.affectedCount === 1 ? "" : "s"} affected.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/admin/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          percentOff: Number(form.get("percentOff")),
          startsAt: form.get("startsAt")
            ? new Date(String(form.get("startsAt"))).toISOString()
            : null,
          endsAt: form.get("endsAt")
            ? new Date(String(form.get("endsAt"))).toISOString()
            : null,
          scopeType,
          scope: scopeFromForm(form),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sale could not be created.");
      setMessage("Sale campaign created. Website pricing will follow its schedule automatically.");
      setSelectedIds([]);
      setPreview(null);
      formElement.reset();
      setScopeType("all");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function campaignAction(id: string, action: "set-active" | "delete", active?: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/sales", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, active }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sale could not be updated.");
      setMessage(action === "delete" ? "Sale deleted." : "Sale status updated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Website pricing</p>
      <h1 className="mt-2 text-4xl font-black">Sales & Automatic Discounts</h1>
      <p className="mt-3 max-w-4xl text-neutral-600">
        Put the whole store or selected inventory on sale without a coupon code. Sales are website-only: base inventory and eBay listing prices are not changed.
      </p>

      {message ? <div className="mt-5 rounded border border-amber-300 bg-amber-50 p-4 font-bold">{message}</div> : null}

      <form onSubmit={createSale} className="mt-7 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="font-bold">Sale name<input name="name" required placeholder="Weekend WNBA Sale" className="mt-2 min-h-12 w-full rounded border px-3" /></label>
          <label className="font-bold">Percent off<input name="percentOff" type="number" min="1" max="90" step="0.01" defaultValue="10" required className="mt-2 min-h-12 w-full rounded border px-3" /></label>
          <label className="font-bold">Starts<input name="startsAt" type="datetime-local" className="mt-2 min-h-12 w-full rounded border px-3" /></label>
          <label className="font-bold">Ends (optional)<input name="endsAt" type="datetime-local" className="mt-2 min-h-12 w-full rounded border px-3" /></label>
        </div>

        <div className="mt-5">
          <label className="font-bold">What goes on sale?
            <select value={scopeType} onChange={(event) => { setScopeType(event.target.value as Campaign["scope_type"]); setPreview(null); }} className="mt-2 min-h-12 w-full rounded border px-3 md:max-w-md">
              <option value="all">Entire store</option>
              <option value="filter">Inventory matching filters</option>
              <option value="products">Specific selected inventory</option>
            </select>
          </label>
        </div>

        {scopeType === "filter" ? (
          <div className="mt-5 grid gap-4 rounded-xl border bg-neutral-50 p-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="font-bold">Title contains<input name="search" placeholder="Prizm, WNBA, Caitlin..." className="mt-2 min-h-12 w-full rounded border bg-white px-3" /></label>
            <label className="font-bold">Category / section<input name="sections" placeholder="WNBA, NBA, Baseball" className="mt-2 min-h-12 w-full rounded border bg-white px-3" /><span className="mt-1 block text-xs text-neutral-500">Comma-separate multiple exact sections.</span></label>
            <label className="font-bold">Player / subject<input name="players" placeholder="Caitlin Clark, Kiki Iriafen" className="mt-2 min-h-12 w-full rounded border bg-white px-3" /><span className="mt-1 block text-xs text-neutral-500">Comma-separate multiple exact names.</span></label>
            <label className="font-bold">Minimum price<input name="minPrice" type="number" min="0" step="0.01" className="mt-2 min-h-12 w-full rounded border bg-white px-3" /></label>
            <label className="font-bold">Maximum price<input name="maxPrice" type="number" min="0" step="0.01" className="mt-2 min-h-12 w-full rounded border bg-white px-3" /></label>
          </div>
        ) : null}

        {scopeType === "products" ? (
          <div className="mt-5 rounded-xl border bg-neutral-50 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="w-full max-w-xl font-bold">Find inventory<input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Player, title, category, or product ID" className="mt-2 min-h-12 w-full rounded border bg-white px-3" /></label>
              <p className="font-black">{selectedIds.length} selected</p>
            </div>
            <div className="mt-4 max-h-96 overflow-auto rounded border bg-white">
              {filteredInventory.map((item) => (
                <label key={item.id} className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-b-0 hover:bg-neutral-50">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                  <span className="min-w-0 flex-1"><strong className="block">{item.title}</strong><span className="text-sm text-neutral-600">#{item.id} · {item.section}{item.player ? ` · ${item.player}` : ""} · ${item.price.toFixed(2)} · Qty {item.quantity}</span></span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={(event) => void previewSale(event.currentTarget.form!)} className="min-h-12 rounded border-2 border-neutral-950 px-5 font-black disabled:opacity-50">Preview affected inventory</button>
          <button type="submit" disabled={busy} className="min-h-12 rounded bg-red-700 px-6 font-black text-white disabled:opacity-50">{busy ? "Working..." : "Create sale"}</button>
        </div>
      </form>

      {preview ? (
        <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-2xl font-black">Preview — {preview.affectedCount} active items</h2>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {preview.items.slice(0, 20).map((item) => (
              <div key={item.id} className="rounded border bg-white p-3 text-sm"><strong>{item.title}</strong><div className="mt-1 text-neutral-600">{item.section} · ${item.originalPrice.toFixed(2)} → <span className="font-black text-red-700">${item.salePrice.toFixed(2)}</span></div></div>
            ))}
          </div>
          {preview.affectedCount > 20 ? <p className="mt-3 text-sm font-bold">Showing the first 20 affected items.</p> : null}
        </section>
      ) : null}

      <section className="mt-8 space-y-4">
        <div><p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">Campaigns</p><h2 className="mt-1 text-2xl font-black">Current and scheduled sales</h2></div>
        {campaigns.length === 0 ? <div className="rounded-2xl border bg-white p-6 font-semibold text-neutral-600">No sale campaigns yet.</div> : null}
        {campaigns.map((campaign) => {
          const live = campaign.status === "live";
          const scheduled = campaign.status === "scheduled";
          const scopeLabel = campaign.scope_type === "all" ? "Entire store" : campaign.scope_type === "products" ? `${campaign.scope.productIds?.length || 0} selected items` : "Filtered inventory";
          return (
            <article key={campaign.id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><h3 className="text-2xl font-black">{campaign.name}</h3><p className="mt-1 font-semibold text-neutral-600">{campaign.percent_off}% off · {scopeLabel}</p><p className="mt-2 text-sm text-neutral-500">Starts {localDateTime(campaign.starts_at)} · Ends {localDateTime(campaign.ends_at)}</p></div>
                <span className={`rounded-full px-3 py-1 text-sm font-black ${live ? "bg-red-100 text-red-800" : scheduled ? "bg-amber-100 text-amber-900" : campaign.active ? "bg-neutral-200" : "bg-neutral-900 text-white"}`}>{live ? "LIVE" : scheduled ? "SCHEDULED" : campaign.active ? "ENDED" : "INACTIVE"}</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" disabled={busy} onClick={() => void campaignAction(campaign.id, "set-active", !campaign.active)} className="min-h-11 rounded border px-4 font-bold">{campaign.active ? "Deactivate" : "Activate"}</button>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete sale “${campaign.name}”?`)) void campaignAction(campaign.id, "delete"); }} className="min-h-11 rounded border border-red-300 px-4 font-bold text-red-700">Delete</button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

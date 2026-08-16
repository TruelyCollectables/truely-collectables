"use client";

import { useEffect, useMemo, useState } from "react";
import {
  deriveListingChannel,
  directPriceAdvantage,
  listingChannelLabel,
  recommendedEbayPrice,
  type ListingChannel,
} from "../../../../lib/listing-channels";

type Policy = { id: string; name: string; description: string | null };
type Location = {
  merchantLocationKey: string;
  name: string;
  city: string | null;
  stateOrProvince: string | null;
  postalCode: string | null;
  country: string | null;
};
type Setup = {
  connected: true;
  environment: string;
  marketplaceId: string;
  policies: { fulfillment: Policy[]; payment: Policy[]; return: Policy[] };
  locations: Location[];
  suggestions: {
    fulfillmentPolicyId: string | null;
    auctionPaymentPolicyId: string | null;
    fixedPaymentPolicyId: string | null;
    returnPolicyId: string | null;
    merchantLocationKey: string | null;
  };
};

type ServerRow = {
  legacyProductId: number;
  inventoryItemId: string | null;
  sku: string | null;
  title: string;
  ebayTitle: string;
  siteDescription: string;
  ebayDescriptionOverride: string;
  player: string | null;
  sport: string | null;
  sitePrice: number;
  ebayPrice: number;
  quantity: number;
  status: string;
  ebayItemId: string | null;
  ebayOfferId: string | null;
  ebayState: string | null;
  preparedForEbay: boolean;
  format: "AUCTION" | "FIXED_PRICE";
  categoryId: string;
  aspects: Record<string, string[]>;
  imageUrls: string[];
  hasFrontAndBack: boolean;
  channel: ListingChannel;
  lastEbayActionAt: string | null;
  lastEbayError: string | null;
};

type EditableRow = Omit<ServerRow, "sitePrice" | "ebayPrice"> & {
  sitePriceInput: string;
  ebayPriceInput: string;
  actionState: "idle" | "saving" | "drafting" | "publishing" | "site" | "error";
  message: string | null;
  listingUrl: string | null;
};

type ChannelFilter = "all" | ListingChannel | "prepared";

function optionLabel(item: Policy) {
  return item.description ? `${item.name} — ${item.description}` : item.name;
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function rowFromServer(row: ServerRow): EditableRow {
  return {
    ...row,
    sitePriceInput: Number(row.sitePrice || 0).toFixed(2),
    ebayPriceInput: Number(
      row.ebayPrice || recommendedEbayPrice(row.sitePrice),
    ).toFixed(2),
    actionState: "idle",
    message: null,
    listingUrl: row.ebayItemId
      ? `https://www.ebay.com/itm/${encodeURIComponent(row.ebayItemId)}`
      : null,
  };
}

function channelTone(channel: ListingChannel) {
  if (channel === "site_and_ebay") return "bg-emerald-100 text-emerald-950";
  if (channel === "site_only") return "bg-sky-100 text-sky-950";
  if (channel === "ebay_only") return "bg-violet-100 text-violet-950";
  if (channel === "off_market") return "bg-neutral-200 text-neutral-700";
  return "bg-amber-100 text-amber-950";
}

export default function InventoryEbayPublisher() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [loading, setLoading] = useState(true);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState("");
  const [auctionPayment, setAuctionPayment] = useState("");
  const [fixedPayment, setFixedPayment] = useState("");
  const [returns, setReturns] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGlobalError(null);
      try {
        const [setupResponse, inventoryResponse] = await Promise.all([
          fetch("/api/ebay/publish", { cache: "no-store" }),
          fetch("/api/admin/ebay/inventory-listings", { cache: "no-store" }),
        ]);
        const setupData = await setupResponse.json().catch(() => ({}));
        const inventoryData = await inventoryResponse.json().catch(() => ({}));
        if (!setupResponse.ok || !setupData?.connected) {
          throw new Error(setupData?.error || "Unable to load eBay policies.");
        }
        if (!inventoryResponse.ok || !inventoryData?.ok) {
          throw new Error(
            inventoryData?.error || "Unable to load inventory listing rows.",
          );
        }
        if (cancelled) return;

        const nextSetup = setupData as Setup;
        const nextRows = (inventoryData.rows as ServerRow[]).map(rowFromServer);
        setSetup(nextSetup);
        setRows(nextRows);
        setFulfillment(nextSetup.suggestions.fulfillmentPolicyId || "");
        setAuctionPayment(nextSetup.suggestions.auctionPaymentPolicyId || "");
        setFixedPayment(nextSetup.suggestions.fixedPaymentPolicyId || "");
        setReturns(nextSetup.suggestions.returnPolicyId || "");
        setLocation(nextSetup.suggestions.merchantLocationKey || "");

        const requested = Number(
          new URLSearchParams(window.location.search).get("product") || 0,
        );
        if (requested > 0 && nextRows.some((row) => row.legacyProductId === requested)) {
          setSelected(new Set([requested]));
          const match = nextRows.find((row) => row.legacyProductId === requested);
          if (match) setQuery(match.title);
        }
      } catch (error) {
        if (!cancelled) {
          setGlobalError(
            error instanceof Error ? error.message : "Unable to load eBay listing manager.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const policiesReady = Boolean(
    setup && fulfillment && auctionPayment && fixedPayment && returns && location,
  );

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        channelFilter !== "all" &&
        !(channelFilter === "prepared"
          ? row.preparedForEbay
          : row.channel === channelFilter)
      ) {
        return false;
      }
      if (!search) return true;
      return [row.title, row.ebayTitle, row.sku, row.player, row.sport]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [channelFilter, query, rows]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      site: rows.filter((row) => row.channel === "site_only").length,
      ebay: rows.filter((row) => row.channel === "ebay_only").length,
      both: rows.filter((row) => row.channel === "site_and_ebay").length,
      prepared: rows.filter((row) => row.preparedForEbay).length,
    }),
    [rows],
  );

  function patchRow(id: number, patch: Partial<EditableRow>) {
    setRows((current) =>
      current.map((row) =>
        row.legacyProductId === id ? { ...row, ...patch } : row,
      ),
    );
  }

  function toggleSelected(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible() {
    setSelected(new Set(filteredRows.map((row) => row.legacyProductId)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function updateSitePrice(row: EditableRow, value: string) {
    const previous = Number(row.sitePriceInput);
    const previousEbay = Number(row.ebayPriceInput);
    const nextSite = Number(value);
    const wasAuto =
      Number.isFinite(previous) &&
      Number.isFinite(previousEbay) &&
      Math.abs(previousEbay - recommendedEbayPrice(previous)) < 0.011;

    patchRow(row.legacyProductId, {
      sitePriceInput: value,
      ebayPriceInput:
        wasAuto && Number.isFinite(nextSite) && nextSite > 0
          ? recommendedEbayPrice(nextSite).toFixed(2)
          : row.ebayPriceInput,
      message: null,
      actionState: "idle",
    });
  }

  function commonPayload(row: EditableRow) {
    return {
      legacyProductId: row.legacyProductId,
      preparedForEbay: row.preparedForEbay,
      sitePrice: Number(row.sitePriceInput),
      ebayPrice: Number(row.ebayPriceInput),
      ebayTitle: row.ebayTitle,
      ebayDescriptionOverride: row.ebayDescriptionOverride,
      categoryId: row.categoryId,
      format: row.format,
      aspects: row.aspects,
      merchantLocationKey: location,
      policies: {
        fulfillmentPolicyId: fulfillment,
        paymentPolicyId:
          row.format === "AUCTION" ? auctionPayment : fixedPayment,
        returnPolicyId: returns,
      },
    };
  }

  async function postRow(row: EditableRow, body: Record<string, unknown>) {
    const response = await fetch("/api/admin/ebay/inventory-listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legacyProductId: row.legacyProductId, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "Listing action failed.");
    }
    return data;
  }

  async function saveSettings(row: EditableRow) {
    patchRow(row.legacyProductId, {
      actionState: "saving",
      message: "Saving channel prices and eBay overrides…",
    });
    try {
      await postRow(row, { ...commonPayload(row), action: "save_settings" });
      patchRow(row.legacyProductId, {
        actionState: "idle",
        preparedForEbay: true,
        message: "Saved. The site and eBay values can now move independently.",
      });
    } catch (error) {
      patchRow(row.legacyProductId, {
        actionState: "error",
        message: error instanceof Error ? error.message : "Unable to save settings.",
      });
    }
  }

  async function setSiteLive(row: EditableRow, live: boolean) {
    patchRow(row.legacyProductId, {
      actionState: "site",
      message: live ? "Listing on TruelyCollectables…" : "Removing from site buyers…",
    });
    try {
      const data = await postRow(row, {
        action: live ? "set_site_active" : "set_site_draft",
      });
      const status = String(data.status || (live ? "active" : "draft"));
      patchRow(row.legacyProductId, {
        status,
        channel: deriveListingChannel({
          status,
          quantity: row.quantity,
          ebayItemId: row.ebayItemId,
        }),
        actionState: "idle",
        message: live
          ? "Live on TruelyCollectables."
          : "Hidden from the site; eBay state was left unchanged.",
      });
    } catch (error) {
      patchRow(row.legacyProductId, {
        actionState: "error",
        message: error instanceof Error ? error.message : "Unable to change site status.",
      });
    }
  }

  async function runEbayAction(
    row: EditableRow,
    action: "draft" | "publish",
    alreadyConfirmed = false,
  ) {
    if (!policiesReady) {
      patchRow(row.legacyProductId, {
        actionState: "error",
        message: "Choose all eBay policies and an inventory location first.",
      });
      return false;
    }

    if (!row.inventoryItemId) {
      patchRow(row.legacyProductId, {
        actionState: "error",
        message: "This product needs an inventory bridge before eBay publishing.",
      });
      return false;
    }

    if (!row.hasFrontAndBack) {
      patchRow(row.legacyProductId, {
        actionState: "error",
        message: "Front and back images are required before eBay publishing.",
      });
      return false;
    }

    if (
      action === "publish" &&
      !alreadyConfirmed &&
      !window.confirm(
        `Publish “${row.ebayTitle}” live on eBay now? This is a real marketplace listing.`,
      )
    ) {
      return false;
    }

    patchRow(row.legacyProductId, {
      actionState: action === "publish" ? "publishing" : "drafting",
      message: action === "publish" ? "Publishing live on eBay…" : "Creating eBay draft…",
    });

    try {
      const data = await postRow(row, {
        ...commonPayload(row),
        action,
        confirmation: action === "publish" ? "PUBLISH_LIVE" : undefined,
      });
      const ebayItemId = data.listingId || row.ebayItemId;
      patchRow(row.legacyProductId, {
        actionState: "idle",
        preparedForEbay: true,
        ebayState: action === "publish" ? "published" : "draft",
        ebayOfferId: data.offerId || row.ebayOfferId,
        ebayItemId,
        listingUrl: data.listingUrl || row.listingUrl,
        channel: deriveListingChannel({
          status: row.status,
          quantity: row.quantity,
          ebayItemId,
        }),
        message:
          action === "publish"
            ? data.alreadyPublished
              ? "Already live on eBay; no duplicate was created."
              : "Published live on eBay and linked back to this inventory record."
            : "eBay draft created. Nothing was published live.",
      });
      return true;
    } catch (error) {
      patchRow(row.legacyProductId, {
        actionState: "error",
        message: error instanceof Error ? error.message : "eBay listing action failed.",
      });
      return false;
    }
  }

  async function runSelected(action: "draft" | "publish") {
    const targets = rows.filter((row) => selected.has(row.legacyProductId));
    if (!targets.length) {
      setGlobalError("Select at least one card first.");
      return;
    }
    if (
      action === "publish" &&
      !window.confirm(
        `Publish ${targets.length} selected card${targets.length === 1 ? "" : "s"} live on eBay? Only the checked rows will be sent.`,
      )
    ) {
      return;
    }

    setBulkRunning(true);
    setGlobalError(null);
    setNotice(
      `${action === "publish" ? "Publishing" : "Drafting"} ${targets.length} selected card${targets.length === 1 ? "" : "s"}…`,
    );
    let succeeded = 0;
    for (const row of targets) {
      if (await runEbayAction(row, action, action === "publish")) succeeded += 1;
    }
    setNotice(
      `${succeeded}/${targets.length} selected card${targets.length === 1 ? "" : "s"} ${action === "publish" ? "published" : "drafted"}. Review any red row messages before retrying.`,
    );
    setBulkRunning(false);
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-neutral-200 bg-white p-8 font-bold shadow-sm">
        Loading inventory, channel state, and eBay policies…
      </div>
    );
  }

  if (globalError && !setup) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950">
        <h2 className="text-xl font-black">eBay listing manager is not ready</h2>
        <p className="mt-2 text-sm font-bold">{globalError}</p>
        <a
          href="/api/ebay/auth"
          className="mt-4 inline-flex rounded-xl bg-neutral-950 px-4 py-3 text-sm font-black text-white"
        >
          Reconnect eBay
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              Real inventory · {setup?.marketplaceId} · {setup?.environment}
            </p>
            <h2 className="mt-2 text-2xl font-black">Channel + eBay listing manager</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-neutral-600">
              The site price and eBay price are separate. For fixed-price cards that are live on both channels, eBay must stay higher than TruelyCollectables. Leave the eBay description override blank to reuse the site description.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <MiniStat label="All" value={counts.all} />
            <MiniStat label="Site" value={counts.site} />
            <MiniStat label="eBay" value={counts.ebay} />
            <MiniStat label="Both" value={counts.both} />
            <MiniStat label="Prepared" value={counts.prepared} />
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Select
            label="Fulfillment / shipping"
            value={fulfillment}
            setValue={setFulfillment}
            options={(setup?.policies.fulfillment || []).map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Return policy"
            value={returns}
            setValue={setReturns}
            options={(setup?.policies.return || []).map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Auction payment"
            value={auctionPayment}
            setValue={setAuctionPayment}
            options={(setup?.policies.payment || []).map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Buy It Now payment"
            value={fixedPayment}
            setValue={setFixedPayment}
            options={(setup?.policies.payment || []).map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Inventory location"
            value={location}
            setValue={setLocation}
            options={(setup?.locations || []).map((item) => [
              item.merchantLocationKey,
              `${item.name} — ${[
                item.city,
                item.stateOrProvince,
                item.postalCode,
                item.country,
              ]
                .filter(Boolean)
                .join(", ")}`,
            ])}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, player, SKU, sport…"
            className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-bold"
          />
          <select
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}
            className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-black"
          >
            <option value="all">All channels</option>
            <option value="site_only">Site only</option>
            <option value="ebay_only">eBay only</option>
            <option value="site_and_ebay">Site + eBay</option>
            <option value="draft">Draft / unlisted</option>
            <option value="off_market">Off market</option>
            <option value="prepared">Prepared for eBay</option>
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectVisible}
              className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-black"
            >
              Select visible
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-black"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-black">{selected.size} selected</span>
          <button
            type="button"
            disabled={bulkRunning || !selected.size || !policiesReady}
            onClick={() => void runSelected("draft")}
            className="rounded-xl border border-neutral-300 bg-white px-5 py-3 text-sm font-black disabled:opacity-40"
          >
            Create eBay drafts for selected
          </button>
          <button
            type="button"
            disabled={bulkRunning || !selected.size || !policiesReady}
            onClick={() => void runSelected("publish")}
            className="rounded-xl bg-neutral-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            Publish selected live on eBay
          </button>
        </div>
        {notice ? (
          <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {notice}
          </p>
        ) : null}
        {globalError ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
            {globalError}
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        {filteredRows.map((row) => {
          const sitePrice = Number(row.sitePriceInput);
          const ebayPrice = Number(row.ebayPriceInput);
          const advantage = directPriceAdvantage(sitePrice, ebayPrice);
          const siteLive = row.status === "active" && row.quantity > 0;
          const busy = row.actionState !== "idle" && row.actionState !== "error";

          return (
            <article
              key={row.legacyProductId}
              className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="grid gap-5 xl:grid-cols-[180px_minmax(0,1fr)_330px]">
                <div>
                  <label className="flex items-center gap-2 text-sm font-black">
                    <input
                      type="checkbox"
                      checked={selected.has(row.legacyProductId)}
                      onChange={() => toggleSelected(row.legacyProductId)}
                    />
                    Select card
                  </label>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <ImageSlot url={row.imageUrls[0]} label="Front" />
                    <ImageSlot url={row.imageUrls[1]} label="Back" />
                  </div>
                  <p className="mt-2 text-xs font-bold text-neutral-500">
                    {row.hasFrontAndBack ? "Front + back ready" : "Needs front + back"}
                  </p>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${channelTone(row.channel)}`}>
                      {listingChannelLabel(row.channel)}
                    </span>
                    {row.preparedForEbay ? (
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-950">
                        eBay prepared
                      </span>
                    ) : null}
                    {row.ebayState ? (
                      <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black text-neutral-700">
                        eBay {row.ebayState}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-xl font-black">{row.title}</h3>
                  <p className="mt-1 text-xs font-bold text-neutral-500">
                    Product #{row.legacyProductId} · SKU {row.sku || "missing"} · Qty {row.quantity}
                  </p>

                  <label className="mt-4 block text-xs font-black uppercase tracking-wide text-neutral-500">
                    eBay title
                    <input
                      value={row.ebayTitle}
                      maxLength={80}
                      onChange={(event) =>
                        patchRow(row.legacyProductId, {
                          ebayTitle: event.target.value,
                          message: null,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-sm font-bold normal-case tracking-normal"
                    />
                  </label>
                  <p className="mt-1 text-right text-xs font-bold text-neutral-500">
                    {row.ebayTitle.length}/80
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-black uppercase tracking-wide text-neutral-500">
                      Listing format
                      <select
                        value={row.format}
                        onChange={(event) =>
                          patchRow(row.legacyProductId, {
                            format: event.target.value as EditableRow["format"],
                            message: null,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-3 text-sm font-black normal-case tracking-normal"
                      >
                        <option value="FIXED_PRICE">Buy It Now / GTC</option>
                        <option value="AUCTION">3-day auction</option>
                      </select>
                    </label>
                    <label className="text-xs font-black uppercase tracking-wide text-neutral-500">
                      eBay category ID
                      <input
                        value={row.categoryId}
                        inputMode="numeric"
                        onChange={(event) =>
                          patchRow(row.legacyProductId, {
                            categoryId: event.target.value.replace(/\D/g, "").slice(0, 20),
                            message: null,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-3 text-sm font-black normal-case tracking-normal"
                      />
                    </label>
                  </div>

                  <details className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                    <summary className="cursor-pointer text-sm font-black">
                      eBay-only description override
                    </summary>
                    <p className="mt-2 text-xs font-semibold text-neutral-600">
                      Leave blank to send the current TruelyCollectables description to eBay. Put text here only when eBay needs different wording.
                    </p>
                    <textarea
                      rows={7}
                      value={row.ebayDescriptionOverride}
                      onChange={(event) =>
                        patchRow(row.legacyProductId, {
                          ebayDescriptionOverride: event.target.value,
                          message: null,
                        })
                      }
                      placeholder={row.siteDescription || "Site description will be used."}
                      className="mt-3 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold leading-6"
                    />
                  </details>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                    Channel pricing
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="text-xs font-black text-neutral-600">
                      TruelyCollectables
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.sitePriceInput}
                        onChange={(event) => updateSitePrice(row, event.target.value)}
                        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-lg font-black"
                      />
                    </label>
                    <label className="text-xs font-black text-neutral-600">
                      {row.format === "AUCTION" ? "eBay start" : "eBay price"}
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.ebayPriceInput}
                        onChange={(event) =>
                          patchRow(row.legacyProductId, {
                            ebayPriceInput: event.target.value,
                            message: null,
                          })
                        }
                        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-lg font-black"
                      />
                    </label>
                  </div>

                  {row.format === "FIXED_PRICE" && advantage ? (
                    <p
                      className={`mt-3 rounded-xl border px-3 py-2 text-xs font-black ${
                        advantage.isAdvantaged
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                          : "border-red-200 bg-red-50 text-red-950"
                      }`}
                    >
                      {advantage.isAdvantaged
                        ? `Direct site is ${money(advantage.dollars)} (${advantage.percent.toFixed(1)}%) cheaper than eBay.`
                        : "Raise the eBay price or lower the site price before listing on both channels."}
                    </p>
                  ) : null}

                  <label className="mt-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-black text-blue-950">
                    <input
                      type="checkbox"
                      checked={row.preparedForEbay}
                      onChange={(event) =>
                        patchRow(row.legacyProductId, {
                          preparedForEbay: event.target.checked,
                          message: null,
                        })
                      }
                    />
                    Keep this card in the prepared-for-eBay queue
                  </label>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void setSiteLive(row, !siteLive)}
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-40"
                    >
                      {siteLive ? "Hide from site" : "List on site"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveSettings(row)}
                      className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                    >
                      {row.actionState === "saving" ? "Saving…" : "Save prices/settings"}
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busy || !policiesReady || !row.hasFrontAndBack}
                      onClick={() => void runEbayAction(row, "draft")}
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-40"
                    >
                      {row.actionState === "drafting" ? "Drafting…" : "Create eBay draft"}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !policiesReady || !row.hasFrontAndBack}
                      onClick={() => void runEbayAction(row, "publish")}
                      className="rounded-xl bg-neutral-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                    >
                      {row.actionState === "publishing" ? "Publishing…" : "Publish live"}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={`/admin/products/${row.legacyProductId}`}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-black"
                    >
                      Edit inventory
                    </a>
                    {row.listingUrl ? (
                      <a
                        href={row.listingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-black text-violet-950"
                      >
                        Open eBay
                      </a>
                    ) : null}
                  </div>

                  {row.message ? (
                    <p
                      className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold ${
                        row.actionState === "error"
                          ? "border-red-200 bg-red-50 text-red-950"
                          : "border-blue-200 bg-blue-50 text-blue-950"
                      }`}
                    >
                      {row.message}
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}

        {!filteredRows.length ? (
          <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-10 text-center">
            <p className="text-lg font-black">No inventory rows match this filter.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ImageSlot({ url, label }: { url?: string | null; label: string }) {
  return (
    <div className="relative aspect-[5/7] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
      {url ? (
        // Inventory URLs can be signed Supabase URLs, so next/image optimization is intentionally skipped.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center p-2 text-center text-xs font-black text-neutral-500">
          {label} missing
        </div>
      )}
      <span className="absolute bottom-1 left-1 rounded bg-black/75 px-2 py-1 text-[10px] font-black uppercase text-white">
        {label}
      </span>
    </div>
  );
}

function Select({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="text-xs font-black uppercase tracking-wide text-neutral-500">
      {label}
      <select
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm font-bold normal-case tracking-normal text-neutral-950"
      >
        <option value="">Select…</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
      <p className="text-lg font-black">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
    </div>
  );
}

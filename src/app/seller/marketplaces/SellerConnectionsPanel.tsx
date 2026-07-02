"use client";

import { useEffect, useState } from "react";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../../account/account-session";
import type {
  PublicSellerMarketplaceConnection,
  SellerMarketplaceProvider,
} from "../../../lib/seller-marketplace-connections";
import type {
  SellerEbayInventoryPreview,
  SellerEbayPreviewItem,
} from "../../../lib/seller-ebay";

type SellerStagedItem = {
  id: string;
  provider: string;
  source_item_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  price: number | null;
  currency: string;
  offer_status: string | null;
  listing_status: string | null;
  item_condition: string | null;
  image_url: string | null;
  stage_status: string;
  metadata?: Record<string, unknown> | null;
  updated_at: string;
};

type SellerImportJob = {
  id: string;
  status: string;
  row_count: number;
  staged_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

const requestableProviders: Array<{
  provider: SellerMarketplaceProvider;
  label: string;
  note: string;
}> = [
  {
    provider: "ebay",
    label: "Connect eBay OAuth",
    note: "Start seller-safe eBay account linking for this store account.",
  },
  {
    provider: "shopify",
    label: "Queue Shopify",
    note: "Save interest for future TCOS to Shopify seller sync.",
  },
];

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(value: string | null | undefined) {
  if (value === "connected" || value === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    value === "connect_requested" ||
    value === "needs_reauth" ||
    value === "syncing" ||
    value === "queued" ||
    value === "completed_with_errors"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (value === "error" || value === "failed" || value === "revoked") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

async function fetchSellerConnections(accessToken: string) {
  const response = await fetch("/api/account/seller/marketplace-connections", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Could not load seller marketplace connections.",
    );
  }

  return (data.connections || []) as PublicSellerMarketplaceConnection[];
}

async function fetchSellerEbayPreview(accessToken: string) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/import-preview?limit=5",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load seller eBay import preview.");
  }

  return data.preview as SellerEbayInventoryPreview;
}

async function fetchSellerStagedItems(accessToken: string) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load seller staged listings.");
  }

  return {
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    latestImportJob: (data.latestImportJob || null) as SellerImportJob | null,
  };
}

async function stageSellerItems(accessToken: string) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ limit: 25 }),
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not stage seller eBay listings.");
  }

  return data.result as {
    stagedCount: number;
    skippedCount: number;
    sampleItems: SellerEbayPreviewItem[];
  };
}

async function updateSellerStagedItemStatus(params: {
  accessToken: string;
  stagedItemId: string;
  stageStatus: "staged" | "needs_review" | "mapped" | "skipped";
}) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        stagedItemId: params.stagedItemId,
        stageStatus: params.stageStatus,
      }),
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not update seller staged item.");
  }

  return data.stagedItem as SellerStagedItem;
}

async function promoteSellerStagedItem(params: {
  accessToken: string;
  stagedItemId: string;
}) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items/promote",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        stagedItemId: params.stagedItemId,
      }),
    },
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not promote seller staged item.");
  }

  return {
    stagedItem: data.stagedItem as SellerStagedItem,
    promotedItem: data.promotedItem as {
      legacyProductId: number;
      inventoryItemId: string | null;
    },
  };
}

export default function SellerConnectionsPanel({
  ebaySyncEnabled,
}: {
  ebaySyncEnabled: boolean;
}) {
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [connections, setConnections] = useState<
    PublicSellerMarketplaceConnection[]
  >([]);
  const [stagedItems, setStagedItems] = useState<SellerStagedItem[]>([]);
  const [latestImportJob, setLatestImportJob] = useState<SellerImportJob | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(
    () => Boolean(session?.access_token),
  );
  const [isSavingProvider, setIsSavingProvider] = useState("");
  const [preview, setPreview] = useState<SellerEbayInventoryPreview | null>(
    null,
  );
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isLoadingStaged, setIsLoadingStaged] = useState(false);
  const [isStagingItems, setIsStagingItems] = useState(false);
  const [updatingStageItemId, setUpdatingStageItemId] = useState("");
  const [promotingStageItemId, setPromotingStageItemId] = useState("");
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return "";

    const params = new URLSearchParams(window.location.search);
    const ebayStatus = params.get("ebay");
    const ebayMessage = params.get("message");

    if (ebayMessage) return ebayMessage;
    if (ebayStatus === "connected") return "eBay seller connection saved.";
    if (ebayStatus === "error") return "eBay seller connection failed.";
    return "";
  });

  async function refreshSellerStageState(
    accessToken: string,
    options?: { silent?: boolean },
  ) {
    setIsLoadingStaged(true);

    try {
      const data = await fetchSellerStagedItems(accessToken);
      setStagedItems(data.stagedItems);
      setLatestImportJob(data.latestImportJob);
    } catch (error: any) {
      if (!options?.silent) {
        setMessage(error.message || "Could not load seller staged listings.");
      }
    } finally {
      setIsLoadingStaged(false);
    }
  }

  useEffect(() => {
    if (!session?.access_token) return;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const nextConnections = await fetchSellerConnections(
            session.access_token,
          );
          setConnections(nextConnections);
          setMessage("");
          await refreshSellerStageState(session.access_token, { silent: true });
        } catch (error: any) {
          setMessage(
            error.message || "Could not load seller marketplace connections.",
          );
          setConnections([]);
        } finally {
          setIsLoading(false);
        }
      })();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [session?.access_token]);

  async function requestConnection(provider: SellerMarketplaceProvider) {
    if (!session?.access_token) return;
    if (provider === "ebay" && !ebaySyncEnabled) {
      setMessage(
        "eBay sync is disabled for this store. Ask a store admin to enable it before connecting seller eBay accounts.",
      );
      return;
    }

    setIsSavingProvider(provider);
    setMessage("");

    try {
      const endpoint =
        provider === "ebay"
          ? "/api/account/seller/marketplace-connections/ebay/auth"
          : "/api/account/seller/marketplace-connections";
      const payload = provider === "ebay" ? {} : { provider };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not save seller marketplace connection.",
        );
      }

      if (provider === "ebay" && data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }

      setMessage(`${label(provider)} connection request saved.`);
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
      setMessage(
        error.message || "Could not save seller marketplace connection.",
      );
    } finally {
      setIsSavingProvider("");
    }
  }

  async function refreshEbayStatus() {
    if (!session?.access_token) return;

    setIsSavingProvider("ebay-status");
    setMessage("");

    try {
      const response = await fetch(
        "/api/account/seller/marketplace-connections/ebay/status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not refresh seller eBay status.");
      }

      setMessage("Seller eBay status refreshed.");
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
      setMessage(error.message || "Could not refresh seller eBay status.");
    } finally {
      setIsSavingProvider("");
    }
  }

  async function loadPreview() {
    if (!session?.access_token || !ebaySyncEnabled) return;

    setIsLoadingPreview(true);
    setMessage("");

    try {
      const nextPreview = await fetchSellerEbayPreview(session.access_token);
      setPreview(nextPreview);
      setMessage("Seller eBay preview loaded.");
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
      setMessage(error.message || "Could not load seller eBay import preview.");
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function stagePreviewBatch() {
    if (!session?.access_token || !ebaySyncEnabled) return;

    setIsStagingItems(true);
    setMessage("");

    try {
      const result = await stageSellerItems(session.access_token);
      setMessage(
        `Seller eBay batch staged. ${result.stagedCount} items captured, ${result.skippedCount} skipped.`,
      );
      await refreshSellerStageState(session.access_token);

      if (preview) {
        setPreview({
          ...preview,
          sampleItems: result.sampleItems,
        });
      }

      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
      setMessage(error.message || "Could not stage seller eBay listings.");
    } finally {
      setIsStagingItems(false);
    }
  }

  async function setStageStatus(
    stagedItemId: string,
    stageStatus: "staged" | "needs_review" | "mapped" | "skipped",
  ) {
    if (!session?.access_token) return;

    setUpdatingStageItemId(stagedItemId);
    setMessage("");

    try {
      const updated = await updateSellerStagedItemStatus({
        accessToken: session.access_token,
        stagedItemId,
        stageStatus,
      });
      setStagedItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMessage(`Staged item moved to ${label(stageStatus)}.`);
    } catch (error: any) {
      setMessage(error.message || "Could not update seller staged item.");
    } finally {
      setUpdatingStageItemId("");
    }
  }

  async function promoteStageItem(stagedItemId: string) {
    if (!session?.access_token) return;

    setPromotingStageItemId(stagedItemId);
    setMessage("");

    try {
      const result = await promoteSellerStagedItem({
        accessToken: session.access_token,
        stagedItemId,
      });
      setStagedItems((current) =>
        current.map((item) =>
          item.id === result.stagedItem.id ? result.stagedItem : item,
        ),
      );
      setMessage(
        `Created seller draft product #${result.promotedItem.legacyProductId}.`,
      );
    } catch (error: any) {
      setMessage(error.message || "Could not promote seller staged item.");
    } finally {
      setPromotingStageItemId("");
    }
  }

  const ebayConnection = connections.find(
    (connection) => connection.provider === "ebay",
  );
  const canUseSellerEbayTools =
    Boolean(session?.access_token) &&
    ebaySyncEnabled &&
    ebayConnection?.connectionStatus === "connected";

  if (!session) {
    return (
      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-2xl font-black">Your Connections</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Log in from the account page to view seller-specific marketplace
          connections. Store #1 foundation stats remain visible above.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
        <div>
          <h2 className="text-2xl font-black">Your Connections</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Seller-scoped marketplace connection records for the active TCOS
            store.
          </p>
        </div>
        {isLoading ? (
          <span className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
            Loading
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 border-b border-neutral-200 bg-neutral-50 p-5 md:grid-cols-2">
        {requestableProviders.map((provider) => (
          <button
            key={provider.provider}
            type="button"
            onClick={() => requestConnection(provider.provider)}
            disabled={
              isSavingProvider.length > 0 ||
              (provider.provider === "ebay" && !ebaySyncEnabled)
            }
            className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <p className="font-black">{provider.label}</p>
            <p className="mt-1 text-sm text-neutral-600">
              {provider.provider === "ebay" && !ebaySyncEnabled
                ? "This store currently has eBay sync turned off, so seller eBay connect is paused."
                : provider.note}
            </p>
          </button>
        ))}
      </div>

      {message ? (
        <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {message}
        </div>
      ) : null}

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Seller eBay Import Preview</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Pull a live sample from the connected seller eBay account before
              TCOS writes anything into shared store inventory.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadPreview()}
              disabled={
                !canUseSellerEbayTools ||
                isLoadingPreview ||
                isSavingProvider.length > 0 ||
                isStagingItems
              }
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingPreview ? "Loading Preview..." : "Preview eBay Import"}
            </button>
            <button
              type="button"
              onClick={() => stagePreviewBatch()}
              disabled={
                !canUseSellerEbayTools ||
                isLoadingPreview ||
                isSavingProvider.length > 0 ||
                isStagingItems
              }
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStagingItems ? "Staging Batch..." : "Stage Seller Batch"}
            </button>
          </div>
        </div>

        {!ebaySyncEnabled ? (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            Store sync is disabled, so seller eBay preview and staging are
            paused.
          </p>
        ) : ebayConnection?.connectionStatus !== "connected" ? (
          <p className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-700">
            Connect a seller eBay account first, then preview and stage remote
            listings before inventory mapping is enabled.
          </p>
        ) : null}

        {preview ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <PreviewMetric
                label="Remote Listings"
                value={
                  typeof preview.totalAvailable === "number"
                    ? preview.totalAvailable.toLocaleString()
                    : "Review"
                }
              />
              <PreviewMetric label="Sampled" value={String(preview.sampled)} />
              <PreviewMetric
                label="Environment"
                value={label(preview.ebayEnvironment)}
              />
              <PreviewMetric
                label="Write Mode"
                value={preview.writeBlocked ? "Preview Only" : "Enabled"}
              />
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              {preview.writeBlockReason}
            </div>

            <PreviewItemsTable items={preview.sampleItems} />

            <p className="text-xs font-semibold uppercase text-neutral-500">
              Preview fetched {shortDate(preview.fetchedAt)}
              {preview.hasMore ? " | more remote listings available" : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Staged Seller Listings</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Seller-private staging captures eBay listings for review before
              TCOS maps ownership and writes them into store inventory.
            </p>
          </div>
          {isLoadingStaged ? (
            <span className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
              Refreshing
            </span>
          ) : null}
        </div>

        {latestImportJob ? (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
            <PreviewMetric
              label="Last Job"
              value={label(latestImportJob.status)}
            />
            <PreviewMetric
              label="Rows"
              value={String(latestImportJob.row_count || 0)}
            />
            <PreviewMetric
              label="Staged"
              value={String(latestImportJob.staged_count || 0)}
            />
            <PreviewMetric
              label="Skipped"
              value={String(latestImportJob.skipped_count || 0)}
            />
            <PreviewMetric
              label="Completed"
              value={shortDate(latestImportJob.completed_at)}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">
            No seller staging jobs have run yet.
          </p>
        )}

        {stagedItems.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white">
                {stagedItems.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-4">
                      <p className="font-bold">{item.title}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {item.source_item_id}
                      </p>
                    </td>
                    <td className="px-4 py-4 font-semibold">
                      {item.sku || "Missing SKU"}
                    </td>
                    <td className="px-4 py-4">{item.quantity}</td>
                    <td className="px-4 py-4">
                      {typeof item.price === "number"
                        ? formatCurrency(item.price)
                        : "No active price"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                          item.stage_status,
                        )}`}
                      >
                        {label(item.stage_status)}
                      </span>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setStageStatus(item.id, "staged")}
                          disabled={
                            updatingStageItemId === item.id ||
                            promotingStageItemId === item.id
                          }
                          className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-bold hover:bg-neutral-50 disabled:opacity-60"
                        >
                          Stage
                        </button>
                        <button
                          type="button"
                          onClick={() => setStageStatus(item.id, "needs_review")}
                          disabled={
                            updatingStageItemId === item.id ||
                            promotingStageItemId === item.id
                          }
                          className="rounded border border-amber-300 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => setStageStatus(item.id, "skipped")}
                          disabled={
                            updatingStageItemId === item.id ||
                            promotingStageItemId === item.id
                          }
                          className="rounded border border-rose-300 px-2 py-1 text-[11px] font-bold text-rose-800 hover:bg-rose-50 disabled:opacity-60"
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          onClick={() => promoteStageItem(item.id)}
                          disabled={
                            updatingStageItemId === item.id ||
                            promotingStageItemId === item.id
                          }
                          className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          {promotingStageItemId === item.id
                            ? "Promoting..."
                            : "Promote Draft"}
                        </button>
                      </div>
                      {typeof item.metadata?.promoted_legacy_product_id === "number" ? (
                        <p className="mt-2 text-xs font-semibold text-emerald-700">
                          Draft product #{item.metadata.promoted_legacy_product_id}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">{shortDate(item.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">
            No staged seller listings yet.
          </p>
        )}
      </div>

      {connections.length === 0 ? (
        <div className="p-5 text-sm leading-6 text-neutral-600">
          {ebaySyncEnabled
            ? "No seller marketplace connections are saved yet. Use the request actions above to create seller-scoped connection records and start seller-safe eBay OAuth without touching the Store #1 eBay sync token."
            : "No seller marketplace connections are saved yet. eBay connect actions stay paused until a store admin re-enables eBay sync for this store."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Marketplace</th>
                <th className="px-4 py-3">Connection</th>
                <th className="px-4 py-3">Sync</th>
                <th className="px-4 py-3">Last Sync</th>
                <th className="px-4 py-3">Token Rotation</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {connections.map((connection) => (
                <tr key={connection.id} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-bold">{label(connection.provider)}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {connection.providerAccountLabel ||
                        connection.providerAccountId ||
                        "No provider account label"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                        connection.connectionStatus,
                      )}`}
                    >
                      {label(connection.connectionStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                        connection.syncStatus,
                      )}`}
                    >
                      {label(connection.syncStatus)}
                    </span>
                    {connection.lastSyncError ? (
                      <p className="mt-2 max-w-xs text-xs font-semibold text-rose-700">
                        {connection.lastSyncError}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    {shortDate(connection.lastSyncCompletedAt)}
                  </td>
                  <td className="px-4 py-4">
                    <p>{shortDate(connection.tokenLastRotatedAt)}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Access expires {shortDate(connection.accessTokenExpiresAt)}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    {connection.provider === "ebay" && !ebaySyncEnabled ? (
                      <span className="text-xs font-semibold text-rose-700">
                        Store sync disabled
                      </span>
                    ) : connection.provider === "ebay" &&
                      connection.connectionStatus === "connected" ? (
                      <button
                        type="button"
                        onClick={() => refreshEbayStatus()}
                        disabled={isSavingProvider.length > 0}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Refresh Status
                      </button>
                    ) : connection.provider === "ebay" ? (
                      <button
                        type="button"
                        onClick={() => requestConnection("ebay")}
                        disabled={isSavingProvider.length > 0}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reconnect eBay
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-neutral-500">
                        Pending provider build
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PreviewItemsTable({ items }: { items: SellerEbayPreviewItem[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Item</th>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Qty</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Offer</th>
            <th className="px-4 py-3">Condition</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 bg-white">
          {items.map((item) => (
            <tr key={item.sku || item.listingId || item.title}>
              <td className="px-4 py-4">
                <p className="font-bold">{item.title}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {item.listingId
                    ? `Listing ${item.listingId}`
                    : "No listing ID returned"}
                </p>
              </td>
              <td className="px-4 py-4 font-semibold">
                {item.sku || "Missing SKU"}
              </td>
              <td className="px-4 py-4">{item.quantity}</td>
              <td className="px-4 py-4">
                {typeof item.price === "number"
                  ? formatCurrency(item.price)
                  : "No active price"}
              </td>
              <td className="px-4 py-4">
                <p>{item.offerStatus ? label(item.offerStatus) : "No offer"}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {item.listingStatus
                    ? label(item.listingStatus)
                    : "No listing status"}
                </p>
              </td>
              <td className="px-4 py-4">{item.condition || "Not set"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

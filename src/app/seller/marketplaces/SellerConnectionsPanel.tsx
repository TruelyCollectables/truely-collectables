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

export default function SellerConnectionsPanel() {
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [connections, setConnections] = useState<
    PublicSellerMarketplaceConnection[]
  >([]);
  const [isLoading, setIsLoading] = useState(() => Boolean(session?.access_token));
  const [isSavingProvider, setIsSavingProvider] = useState("");
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

    setIsSavingProvider(provider);
    setMessage("");

    try {
      const endpoint =
        provider === "ebay"
          ? "/api/account/seller/marketplace-connections/ebay/auth"
          : "/api/account/seller/marketplace-connections";
      const payload =
        provider === "ebay"
          ? {}
          : {
              provider,
            };
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
            disabled={isSavingProvider.length > 0}
            className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <p className="font-black">{provider.label}</p>
            <p className="mt-1 text-sm text-neutral-600">{provider.note}</p>
          </button>
        ))}
      </div>

      {message ? (
        <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {message}
        </div>
      ) : null}

      {connections.length === 0 ? (
        <div className="p-5 text-sm leading-6 text-neutral-600">
          No seller marketplace connections are saved yet. Use the request
          actions above to create seller-scoped connection records and start
          seller-safe eBay OAuth without touching the Store #1 eBay sync token.
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
                    {connection.provider === "ebay" &&
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

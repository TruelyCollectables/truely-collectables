"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearAccountSession,
  getAccountSession,
  type StoredAccountSession,
} from "./account-session";

type AccountOrder = {
  id: string;
  created_at: string | null;
  total: number | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  tracking_number: string | null;
  carrier: string | null;
  item_count: number | null;
};

type SportsFavorite = {
  id: string;
  sport_key: string;
  league_key: string;
  team_name: string;
  team_abbreviation: string | null;
  include_news: boolean;
  include_scores: boolean;
  include_schedule: boolean;
  include_odds: boolean;
};

type MarketWatchlistItem = {
  id: string;
  asset_type: string;
  symbol: string;
  display_name: string | null;
  exchange_key: string | null;
  include_price: boolean;
  include_news: boolean;
  include_alerts: boolean;
};

export default function AccountPage() {
  const [session, setSession] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [ordersError, setOrdersError] = useState("");
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [sportsFavorites, setSportsFavorites] = useState<SportsFavorite[]>([]);
  const [marketWatchlist, setMarketWatchlist] = useState<MarketWatchlistItem[]>(
    [],
  );
  const [dashboardError, setDashboardError] = useState("");
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [sportKey, setSportKey] = useState("football");
  const [leagueKey, setLeagueKey] = useState("nfl");
  const [teamAbbreviation, setTeamAbbreviation] = useState("");
  const [includeOdds, setIncludeOdds] = useState(false);
  const [assetType, setAssetType] = useState("stock");
  const [symbol, setSymbol] = useState("");
  const [assetName, setAssetName] = useState("");
  const [exchangeKey, setExchangeKey] = useState("");
  const [isSavingPreference, setIsSavingPreference] = useState(false);
  const accessToken = session?.access_token || "";

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadOrders() {
      setIsLoadingOrders(true);
      setOrdersError("");

      try {
        const response = await fetch("/api/account/orders", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load orders");
        }

        if (!isCancelled) {
          setOrders(Array.isArray(data.orders) ? data.orders : []);
        }
      } catch (error: any) {
        if (!isCancelled) {
          setOrdersError(error.message || "Could not load orders");
          setOrders([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingOrders(false);
        }
      }
    }

    loadOrders();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadDashboardPreferences() {
      setIsLoadingDashboard(true);
      setDashboardError("");

      try {
        const response = await fetch("/api/account/dashboard/preferences", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load dashboard preferences");
        }

        if (!isCancelled) {
          setSportsFavorites(
            Array.isArray(data.sportsFavorites) ? data.sportsFavorites : [],
          );
          setMarketWatchlist(
            Array.isArray(data.marketWatchlist) ? data.marketWatchlist : [],
          );
        }
      } catch (error: any) {
        if (!isCancelled) {
          setDashboardError(
            error.message || "Could not load dashboard preferences",
          );
          setSportsFavorites([]);
          setMarketWatchlist([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDashboard(false);
        }
      }
    }

    loadDashboardPreferences();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  function logout() {
    clearAccountSession();
    setSession(null);
    setOrders([]);
    setOrdersError("");
    setSportsFavorites([]);
    setMarketWatchlist([]);
    setDashboardError("");
  }

  async function saveDashboardPreference(payload: Record<string, unknown>) {
    if (!accessToken) return;

    setIsSavingPreference(true);
    setDashboardError("");

    try {
      const response = await fetch("/api/account/dashboard/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save preference");
      }

      if (payload.kind === "sports_favorite" && data.sportsFavorite) {
        setSportsFavorites((current) => [
          data.sportsFavorite as SportsFavorite,
          ...current,
        ]);
        setTeamName("");
        setTeamAbbreviation("");
        setIncludeOdds(false);
      }

      if (payload.kind === "market_watchlist" && data.marketWatchlistItem) {
        setMarketWatchlist((current) => [
          data.marketWatchlistItem as MarketWatchlistItem,
          ...current,
        ]);
        setSymbol("");
        setAssetName("");
        setExchangeKey("");
      }
    } catch (error: any) {
      setDashboardError(error.message || "Could not save preference");
    } finally {
      setIsSavingPreference(false);
    }
  }

  async function removeDashboardPreference(kind: string, id: string) {
    if (!accessToken) return;

    setDashboardError("");

    try {
      const response = await fetch("/api/account/dashboard/preferences", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ kind, id }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not remove preference");
      }

      if (kind === "sports_favorite") {
        setSportsFavorites((current) => current.filter((item) => item.id !== id));
      }

      if (kind === "market_watchlist") {
        setMarketWatchlist((current) => current.filter((item) => item.id !== id));
      }
    } catch (error: any) {
      setDashboardError(error.message || "Could not remove preference");
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <section className="border-b border-neutral-200 pb-6">
        <p className="text-sm font-bold uppercase text-neutral-500">
          TCOS Account
        </p>
        <h1 className="mt-2 text-4xl font-black">Collector Account</h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          Customer accounts are the foundation for future collections,
          wishlists, want ads, trades, brag sessions, and order history.
        </p>
      </section>

      {!session ? (
        <section className="mt-8 rounded-md border border-neutral-200 bg-white p-6">
          <h2 className="text-2xl font-black">Not Logged In</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Create or log into a buyer account. Seller and platform admin
            accounts stay separate.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/account/login"
              className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800"
            >
              Log In
            </Link>
            <Link
              href="/account/signup"
              className="rounded border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
            >
              Create Account
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.65fr_0.35fr]">
          <div className="rounded-md border border-neutral-200 bg-white p-6">
            <h2 className="text-2xl font-black">Account Ready</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <Info label="Email" value={session.user?.email || "Signed in"} />
              <Info label="User ID" value={session.user?.id || "Not shown"} />
              <Info
                label="Session"
                value={session.expires_at ? "Active with expiration" : "Active"}
              />
            </dl>

            <button
              type="button"
              onClick={logout}
              className="mt-6 rounded border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
            >
              Log Out
            </button>
          </div>

          <aside className="rounded-md border border-neutral-200 bg-white p-6">
            <h2 className="text-xl font-black">Coming Next</h2>
            <ul className="mt-4 space-y-2 text-sm text-neutral-600">
              <li>Saved collection items</li>
              <li>Wishlists and want ads</li>
              <li>Seller account separation</li>
              <li>Optional MFA path</li>
            </ul>
          </aside>

          <div className="lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
              <div>
                <h2 className="text-2xl font-black">Dashboard Watchlist</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Teams, markets, and collector signals saved to this account.
                </p>
              </div>
              {isLoadingDashboard ? (
                <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                  Loading
                </span>
              ) : null}
            </div>

            {dashboardError ? (
              <p className="mt-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {dashboardError}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">Favorite Teams</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveDashboardPreference({
                      kind: "sports_favorite",
                      sportKey,
                      leagueKey,
                      teamName,
                      teamAbbreviation,
                      includeOdds,
                    });
                  }}
                  className="mt-4 grid grid-cols-1 gap-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Sport
                      <input
                        value={sportKey}
                        onChange={(event) => setSportKey(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="football"
                        required
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      League
                      <input
                        value={leagueKey}
                        onChange={(event) => setLeagueKey(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="nfl"
                        required
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
                    <label className="text-sm font-bold text-neutral-700">
                      Team
                      <input
                        value={teamName}
                        onChange={(event) => setTeamName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Denver Broncos"
                        required
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Code
                      <input
                        value={teamAbbreviation}
                        onChange={(event) =>
                          setTeamAbbreviation(event.target.value.toUpperCase())
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="DEN"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                    <input
                      type="checkbox"
                      checked={includeOdds}
                      onChange={(event) => setIncludeOdds(event.target.checked)}
                    />
                    Include odds when legal/provider data is enabled
                  </label>
                  <button
                    type="submit"
                    disabled={isSavingPreference}
                    className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                  >
                    Add Team
                  </button>
                </form>

                <div className="mt-5 space-y-2">
                  {sportsFavorites.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No favorite teams saved.
                    </p>
                  ) : (
                    sportsFavorites.map((favorite) => (
                      <WatchlistRow
                        key={favorite.id}
                        title={favorite.team_name}
                        detail={`${favorite.league_key.toUpperCase()} / ${favorite.sport_key}`}
                        badges={[
                          favorite.include_news ? "News" : "",
                          favorite.include_scores ? "Scores" : "",
                          favorite.include_schedule ? "Schedule" : "",
                          favorite.include_odds ? "Odds" : "",
                        ]}
                        onRemove={() =>
                          removeDashboardPreference(
                            "sports_favorite",
                            favorite.id,
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">Market Watchlist</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveDashboardPreference({
                      kind: "market_watchlist",
                      assetType,
                      symbol,
                      displayName: assetName,
                      exchangeKey,
                    });
                  }}
                  className="mt-4 grid grid-cols-1 gap-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Type
                      <select
                        value={assetType}
                        onChange={(event) => setAssetType(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      >
                        <option value="stock">Stock</option>
                        <option value="etf">ETF</option>
                        <option value="index">Index</option>
                        <option value="crypto">Crypto</option>
                        <option value="nft">NFT</option>
                        <option value="commodity">Commodity</option>
                        <option value="collectable_index">Collectable Index</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Symbol
                      <input
                        value={symbol}
                        onChange={(event) =>
                          setSymbol(event.target.value.toUpperCase())
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="AAPL, BTC, ETH"
                        required
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Name
                      <input
                        value={assetName}
                        onChange={(event) => setAssetName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Apple"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Exchange
                      <input
                        value={exchangeKey}
                        onChange={(event) =>
                          setExchangeKey(event.target.value.toUpperCase())
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="NASDAQ"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingPreference}
                    className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                  >
                    Add Asset
                  </button>
                </form>

                <div className="mt-5 space-y-2">
                  {marketWatchlist.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No market assets saved.
                    </p>
                  ) : (
                    marketWatchlist.map((item) => (
                      <WatchlistRow
                        key={item.id}
                        title={item.display_name || item.symbol}
                        detail={`${item.asset_type.toUpperCase()} / ${item.symbol}${
                          item.exchange_key ? ` / ${item.exchange_key}` : ""
                        }`}
                        badges={[
                          item.include_price ? "Price" : "",
                          item.include_news ? "News" : "",
                          item.include_alerts ? "Alerts" : "",
                        ]}
                        onRemove={() =>
                          removeDashboardPreference(
                            "market_watchlist",
                            item.id,
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 bg-white p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Order History</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Purchases made while logged in will appear here.
                </p>
              </div>
              {isLoadingOrders ? (
                <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                  Loading
                </span>
              ) : null}
            </div>

            {ordersError ? (
              <p className="mt-5 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {ordersError}
              </p>
            ) : null}

            {!isLoadingOrders && !ordersError && orders.length === 0 ? (
              <div className="mt-5 rounded border border-dashed border-neutral-300 bg-neutral-50 p-5">
                <p className="text-sm font-semibold text-neutral-700">
                  No linked orders yet.
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Guest checkout still works, but logged-in checkout links
                  future purchases to this account.
                </p>
              </div>
            ) : null}

            {orders.length > 0 ? (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                    <tr>
                      <th className="py-3 pr-4">Order</th>
                      <th className="py-3 pr-4">Date</th>
                      <th className="py-3 pr-4">Items</th>
                      <th className="py-3 pr-4">Total</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4">Tracking</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-3 pr-4 font-bold text-neutral-950">
                          #{order.id}
                        </td>
                        <td className="py-3 pr-4 text-neutral-600">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="py-3 pr-4 text-neutral-600">
                          {order.item_count ?? 0}
                        </td>
                        <td className="py-3 pr-4 font-semibold text-neutral-950">
                          {formatCurrency(order.total)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-bold uppercase text-neutral-700">
                            {order.fulfillment_status || order.status || "new"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-neutral-600">
                          {order.tracking_number ? (
                            <span>
                              {order.carrier ? `${order.carrier} ` : ""}
                              {order.tracking_number}
                            </span>
                          ) : (
                            <span className="text-neutral-400">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3">
      <dt className="font-bold text-neutral-500">{label}</dt>
      <dd className="break-words font-semibold text-neutral-950">{value}</dd>
    </div>
  );
}

function WatchlistRow({
  title,
  detail,
  badges,
  onRemove,
}: {
  title: string;
  detail: string;
  badges: string[];
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="min-w-0">
        <p className="break-words font-black">{title}</p>
        <p className="mt-1 text-xs font-semibold uppercase text-neutral-500">
          {detail}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.filter(Boolean).map((badge) => (
            <span
              key={badge}
              className="rounded bg-neutral-100 px-2 py-1 text-[11px] font-bold uppercase text-neutral-600"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
      >
        Remove
      </button>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Pending";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatCurrency(value: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

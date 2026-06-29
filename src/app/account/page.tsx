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

export default function AccountPage() {
  const [session, setSession] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [ordersError, setOrdersError] = useState("");
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
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

  function logout() {
    clearAccountSession();
    setSession(null);
    setOrders([]);
    setOrdersError("");
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
              <li>Order history</li>
              <li>Saved collection items</li>
              <li>Wishlists and want ads</li>
              <li>Seller account separation</li>
              <li>Optional MFA path</li>
            </ul>
          </aside>

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

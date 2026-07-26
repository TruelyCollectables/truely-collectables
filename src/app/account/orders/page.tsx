"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STORE_SUPPORT_EMAIL } from "../../../lib/legal";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../account-session";

type AccountOrderItem = {
  product_id: number | null;
  title: string | null;
  price: number | null;
  quantity: number | null;
};

type AccountOrder = {
  id: string;
  created_at: string | null;
  total: number | null;
  status: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  tracking_number: string | null;
  carrier: string | null;
  item_count: number | null;
  items: AccountOrderItem[];
};

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function statusLabel(order: AccountOrder) {
  return String(order.fulfillment_status || order.status || "new").replaceAll(
    "_",
    " ",
  );
}

export default function BuyerOrdersPage() {
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedTracking, setCopiedTracking] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.access_token) return;

    const controller = new AbortController();

    fetch("/api/account/orders", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Could not load your orders.");
        }
        return payload;
      })
      .then((payload) => {
        setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(
          caught instanceof Error ? caught.message : "Could not load your orders.",
        );
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [session]);

  async function copyTracking(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTracking(value);
      window.setTimeout(() => setCopiedTracking(null), 2000);
    } catch {
      setCopiedTracking(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="border-b border-neutral-200 pb-6">
        <p className="text-sm font-black uppercase tracking-wide text-neutral-500">
          Buyer Account
        </p>
        <h1 className="mt-2 text-4xl font-black sm:text-5xl">Your Orders</h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          Purchases made while logged in appear here with payment, fulfillment,
          item, and tracking status.
        </p>
      </section>

      {!session ? (
        <section className="mt-8 rounded border bg-white p-5 sm:p-6">
          <h2 className="text-2xl font-black">Log in to view linked orders</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Guest checkout remains available, but only purchases made while logged
            in are linked to an account automatically.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/account/login"
              className="inline-flex min-h-12 items-center justify-center rounded bg-neutral-950 px-5 font-black text-white"
            >
              Log In
            </Link>
            <Link
              href="/account/signup"
              className="inline-flex min-h-12 items-center justify-center rounded border border-neutral-300 px-5 font-black"
            >
              Create Account
            </Link>
          </div>
        </section>
      ) : null}

      {session && loading ? (
        <p className="mt-8 rounded border bg-white p-5 font-semibold text-neutral-600">
          Loading your orders…
        </p>
      ) : null}

      {session && error ? (
        <div className="mt-8 rounded border border-red-200 bg-red-50 p-5 text-red-900">
          <p className="font-black">Orders could not be loaded</p>
          <p className="mt-2 text-sm leading-6">{error}</p>
          <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="mt-4 inline-flex min-h-11 items-center font-black underline"
          >
            Contact order support
          </a>
        </div>
      ) : null}

      {session && !loading && !error && orders.length === 0 ? (
        <section className="mt-8 rounded border border-dashed bg-white p-6">
          <h2 className="text-xl font-black">No linked orders yet</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Stay logged in during checkout and future purchases will appear here.
          </p>
          <Link
            href="/shop"
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded bg-neutral-950 px-5 font-black text-white"
          >
            Shop Sports Cards
          </Link>
        </section>
      ) : null}

      {session && orders.length > 0 ? (
        <div className="mt-8 space-y-5">
          {orders.map((order) => (
            <article key={order.id} className="rounded border bg-white p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
                    Order #{order.id}
                  </p>
                  <h2 className="mt-1 text-2xl font-black">
                    {formatCurrency(order.total)}
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    {formatDate(order.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-800">
                    {order.payment_status || "paid"}
                  </span>
                  <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
                    {statusLabel(order)}
                  </span>
                </div>
              </div>

              <div className="mt-5 rounded bg-neutral-50 p-4">
                <h3 className="font-black">Items</h3>
                <div className="mt-3 space-y-3">
                  {(order.items || []).length > 0 ? (
                    order.items.map((item, index) => (
                      <div
                        key={`${order.id}-${item.product_id || index}`}
                        className="flex items-start justify-between gap-4 border-b border-neutral-200 pb-3 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="break-words font-bold">
                            {item.title || "Sports card"}
                          </p>
                          <p className="mt-1 text-sm text-neutral-600">
                            Quantity {Number(item.quantity || 0)}
                          </p>
                        </div>
                        <p className="shrink-0 font-black">
                          {formatCurrency(
                            Number(item.price || 0) * Number(item.quantity || 0),
                          )}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-neutral-600">
                      {order.item_count || 0} item(s) in this order.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded border p-4">
                <h3 className="font-black">Shipping & tracking</h3>
                <p className="mt-1 text-sm text-neutral-600">
                  {order.shipping_name || "Shipping method recorded at checkout"}
                </p>
                {order.tracking_number ? (
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="break-all font-bold">
                      {order.carrier ? `${order.carrier}: ` : ""}
                      {order.tracking_number}
                    </p>
                    <button
                      type="button"
                      onClick={() => copyTracking(order.tracking_number!)}
                      className="min-h-11 rounded border px-4 font-black"
                    >
                      {copiedTracking === order.tracking_number
                        ? "Copied"
                        : "Copy Tracking"}
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                    Tracking is pending and will appear after the order is packed.
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/account"
          className="inline-flex min-h-12 items-center justify-center rounded border px-5 font-black"
        >
          Back to Account
        </Link>
        <Link
          href="/shop"
          className="inline-flex min-h-12 items-center justify-center rounded bg-neutral-950 px-5 font-black text-white"
        >
          Keep Collecting
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";
import {
  getAccountProfilesByIds,
  type AccountProfileSummary,
} from "../../../lib/account-profiles";
import { supabase } from "../../../lib/supabase";
import { getActiveStoreId } from "../../../lib/stores";
import {
  isOrderReviewStatus,
  isPaidOrderStatus,
  isReadyToShipStatus,
} from "../../../lib/order-status";
import { isDryRunShippingReference } from "../../../lib/shipping-dry-run";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderItem = {
  id: number;
  seller_account_id?: string | null;
  title: string;
  quantity: number;
  price: number;
};

type Order = {
  id: number;
  account_id?: string | null;
  created_at: string;
  customer_email: string | null;
  total: number;
  status: string | null;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | null;
  subtotal: number | null;
  item_count: number | null;
  contains_seller_items?: boolean | null;
  seller_item_count?: number | null;
  store_item_count?: number | null;
  fulfillment_status: string | null;
  tracking_number: string | null;
  carrier: string | null;
  order_items?: OrderItem[];
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function statusLabel(status: string | null | undefined) {
  if (!status) return "Pending";
  return status.replaceAll("_", " ").toUpperCase();
}

function safeTab(value: string | undefined) {
  return value === "ready" ||
    value === "shipped" ||
    value === "review" ||
    value === "all"
    ? value
    : "ready";
}

function statusTone(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "paid" || normalized === "succeeded" || normalized === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (normalized.includes("review") || normalized.includes("hold")) {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (normalized === "shipped" || normalized === "fulfilled") {
    return "border-sky-200 bg-sky-50 text-sky-950";
  }

  if (normalized === "cancelled" || normalized === "failed" || normalized === "refunded") {
    return "border-red-200 bg-red-50 text-red-950";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function isReadyToShip(order: Order) {
  return isReadyToShipStatus(order.status, order.fulfillment_status);
}

function isReview(order: Order) {
  return isOrderReviewStatus(order.status, order.fulfillment_status);
}

function isShipped(order: Order) {
  return order.fulfillment_status === "shipped";
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const activeTab = safeTab(params?.tab);
  const storeId = getActiveStoreId();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      order_items (
        id,
        seller_account_id,
        title,
        quantity,
        price
      )
    `
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="bg-neutral-50 px-6 py-8 text-neutral-950">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Fulfillment center
          </p>
          <h1 className="mt-2 text-3xl font-black">Error loading orders</h1>
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-950">
            {error.message}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/orders"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white"
            >
              Retry
            </Link>
            <Link
              href="/admin"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
            >
              Admin dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const typedOrders = (orders || []) as Order[];
  const accountProfiles = await getAccountProfilesByIds(
    typedOrders.map((order) => order.account_id),
  );

  const readyToShip = typedOrders.filter(isReadyToShip);
  const reviewOrders = typedOrders.filter(isReview);
  const shipped = typedOrders.filter(isShipped);
  const allOrders = typedOrders;
  const paidRevenue = typedOrders
    .filter((order) => isPaidOrderStatus(order.status))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  const visibleOrders =
    activeTab === "shipped"
      ? shipped
      : activeTab === "review"
      ? reviewOrders
      : activeTab === "all"
      ? allOrders
      : readyToShip;

  return (
    <main className="space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">
            Orders and shipping
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">
            Fulfillment center
          </h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
            Manage paid orders, packing slips, tracking, and shipping.
          </p>
          <p className="mt-2 text-xs font-bold text-neutral-400">
            Last refreshed: {new Date().toLocaleString()}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/products"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Products
          </Link>
          <Link
            href="/admin/offers"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Offers
          </Link>
          <Link
            href="/admin/files"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Files
          </Link>
          <Link
            href="/admin/logout"
            className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
          >
            Logout
          </Link>
        </div>
      </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <DashboardCard label="Total orders" value={String(typedOrders.length)} />
        <DashboardCard
          label="Ready to ship"
          value={String(readyToShip.length)}
          tone="emerald"
        />
        <DashboardCard
          label="Needs review"
          value={String(reviewOrders.length)}
          tone="amber"
        />
        <DashboardCard label="Shipped" value={String(shipped.length)} tone="sky" />
        <DashboardCard
          label="Revenue"
          value={money(paidRevenue)}
        />
      </section>

      <nav className="flex flex-wrap gap-3 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
        <TabLink
          href="/admin/orders?tab=ready"
          active={activeTab === "ready"}
          label={`Ready to ship (${readyToShip.length})`}
        />

        <TabLink
          href="/admin/orders?tab=shipped"
          active={activeTab === "shipped"}
          label={`Shipped (${shipped.length})`}
        />

        <TabLink
          href="/admin/orders?tab=review"
          active={activeTab === "review"}
          label={`Needs Review (${reviewOrders.length})`}
        />

        <TabLink
          href="/admin/orders?tab=all"
          active={activeTab === "all"}
          label={`All Orders (${allOrders.length})`}
        />
      </nav>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            Current queue
          </p>
          <h2 className="mt-2 text-2xl font-black">
          {activeTab === "shipped"
            ? `Shipped (${shipped.length})`
            : activeTab === "review"
            ? `Needs review (${reviewOrders.length})`
            : activeTab === "all"
            ? `All orders (${allOrders.length})`
            : `Ready to ship (${readyToShip.length})`}
          </h2>
        </div>
        <p className="text-sm font-bold text-neutral-600">
          Showing {visibleOrders.length} of {typedOrders.length}
        </p>
        </div>

        {visibleOrders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
            <h3 className="text-xl font-black">No orders in this queue</h3>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              This queue is clear. Switch tabs to review shipped, held, or all
              orders.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                accountProfile={
                  order.account_id
                    ? accountProfiles.get(order.account_id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function DashboardCard({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "emerald" | "amber" | "sky";
  value: string;
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : tone === "sky"
          ? "border-sky-200 bg-sky-50 text-sky-950"
          : "border-neutral-200 bg-white text-neutral-950";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md border border-neutral-950 bg-neutral-950 px-4 py-2 text-sm font-black text-white"
          : "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
      }
    >
      {label}
    </Link>
  );
}

function OrderCard({
  order,
  accountProfile,
}: {
  order: Order;
  accountProfile?: AccountProfileSummary;
}) {
  const needsReview = isReview(order);
  const dryRunShipping = isDryRunShippingReference(order.tracking_number);
  const totalItems =
    order.item_count ||
    order.order_items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) ||
    0;

  return (
    <article className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
      {needsReview ? (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Review hold: verify the order, inventory, and shipping evidence before
          printing a packing slip or marking shipped.
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-black">Order #{order.id}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-black ${statusTone(
                order.fulfillment_status || order.status,
              )}`}
            >
              {statusLabel(order.fulfillment_status || order.status)}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-neutral-600">
            {order.customer_email || "No email"}
          </p>
          {order.contains_seller_items ? (
            <p className="mt-1 text-xs font-semibold text-amber-700">
              Seller-routed items: {order.seller_item_count || 0} seller /{" "}
              {order.store_item_count || 0} store
            </p>
          ) : null}
          <p className="mt-1 text-sm font-semibold text-neutral-700">
            Account:{" "}
            {accountProfile
              ? accountProfile.email ||
                accountProfile.display_name ||
                accountProfile.id
              : order.account_id
                ? "Linked account profile unavailable"
                : "Guest checkout"}
          </p>
          <p className="text-sm text-neutral-500">
            {new Date(order.created_at).toLocaleString()}
          </p>
        </div>

        <div className="text-right">
          <p className="text-lg font-black">{money(order.total)}</p>
          <p className="text-sm">
            Payment: <strong>{statusLabel(order.status)}</strong>
          </p>
          <p className="text-sm">
            Fulfillment:{" "}
            <strong>{statusLabel(order.fulfillment_status)}</strong>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <h4 className="mb-2 font-black">Items</h4>

          {!order.order_items || order.order_items.length === 0 ? (
            <p className="text-sm font-semibold text-neutral-500">No order items found.</p>
          ) : (
            <ul className="space-y-2">
              {order.order_items.map((item) => (
                <li key={item.id} className="text-sm">
                  <span className="font-medium">{item.quantity}×</span>{" "}
                  {item.title}
                  <br />
                  <span className="text-neutral-500">
                    {money(Number(item.price) * Number(item.quantity))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="mb-2 font-black">Shipping</h4>
          <p className="text-sm">
            Method: {order.shipping_name || order.shipping_method || "Not set"}
          </p>
          <p className="text-sm">
            Shipping Paid: {money(order.shipping_amount)}
          </p>
          <p className="text-sm">Subtotal: {money(order.subtotal)}</p>
          <p className="text-sm">Items: {totalItems}</p>

          {dryRunShipping ? (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-900">
              Dry-run shipping reference hidden. Record a real label/tracking
              before treating this order as shipped.
            </div>
          ) : (
            <>
              {order.tracking_number && (
                <p className="text-sm mt-2">
                  Tracking: <strong>{order.tracking_number}</strong>
                </p>
              )}

              {order.carrier && (
                <p className="text-sm">
                  Carrier: <strong>{order.carrier}</strong>
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <h4 className="mb-2 font-black">Actions</h4>

          <div className="flex flex-col gap-2">
            <Link
              href="/admin/files"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black hover:bg-neutral-50"
            >
              Evidence files
            </Link>

            <Link
              href={`/admin/orders/${order.id}`}
              className="rounded-md bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white hover:bg-neutral-800"
            >
              View order
            </Link>

            {!needsReview ? (
              <Link
                href={`/admin/orders/${order.id}/packing-slip`}
                className="rounded-md border border-sky-300 bg-sky-50 px-4 py-2 text-center text-sm font-black text-sky-950 hover:bg-sky-100"
              >
                Print packing slip
              </Link>
            ) : null}

            <Link
              href={`/admin/orders/${order.id}`}
              className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-center text-sm font-black text-emerald-950 hover:bg-emerald-100"
            >
              Add tracking / mark shipped
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

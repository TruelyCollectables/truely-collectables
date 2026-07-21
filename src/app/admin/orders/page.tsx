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

function safeErrorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message || "Unknown database error.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
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

type OrderCardTone = "amber" | "emerald" | "neutral" | "red" | "sky";

const adminPrimaryActionClass =
  "rounded-full bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
const adminSecondaryActionClass =
  "rounded-full border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black text-neutral-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";

const orderCardToneClasses: Record<
  OrderCardTone,
  { card: string; detail: string; label: string; pill: string }
> = {
  amber: {
    card: "border-amber-200 bg-amber-50 text-amber-950 ring-amber-900/10",
    detail: "text-amber-950",
    label: "text-amber-700",
    pill: "border-amber-200 bg-white text-amber-950",
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50 text-emerald-950 ring-emerald-900/10",
    detail: "text-emerald-950",
    label: "text-emerald-700",
    pill: "border-emerald-200 bg-white text-emerald-950",
  },
  neutral: {
    card: "border-neutral-200 bg-white text-neutral-950 ring-black/[0.02]",
    detail: "text-neutral-500",
    label: "text-neutral-400",
    pill: "border-neutral-200 bg-neutral-100 text-neutral-700",
  },
  red: {
    card: "border-red-200 bg-red-50 text-red-950 ring-red-900/10",
    detail: "text-red-950",
    label: "text-red-700",
    pill: "border-red-200 bg-white text-red-950",
  },
  sky: {
    card: "border-sky-200 bg-sky-50 text-sky-950 ring-sky-900/10",
    detail: "text-sky-950",
    label: "text-sky-700",
    pill: "border-sky-200 bg-white text-sky-950",
  },
};

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
    const orderLoadErrorMessage = safeErrorMessage(error);

    return (
      <main className="bg-neutral-50 px-6 py-8 text-neutral-950">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Fulfillment center
          </p>
          <h1 className="mt-2 text-3xl font-black">Error loading orders</h1>
          <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-950">
            {orderLoadErrorMessage}
          </p>
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950">
            <h2 className="text-lg font-black">Fulfillment queues unavailable</h2>
            <p className="mt-2 text-sm font-semibold leading-6">
              Order storage did not load, so this page cannot prove whether
              paid orders, review holds, shipped orders, or ready-to-ship work
              exists. Retry after the database warning is cleared before
              treating the queue as empty.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-red-200 bg-white p-3">
                <dt className="font-black uppercase tracking-[0.12em] text-red-700">
                  Queue counts
                </dt>
                <dd className="mt-1 font-black">Unavailable</dd>
              </div>
              <div className="rounded-xl border border-red-200 bg-white p-3">
                <dt className="font-black uppercase tracking-[0.12em] text-red-700">
                  Operator action
                </dt>
                <dd className="mt-1 font-semibold">
                  Retry orders or open the dashboard; do not ship from stale
                  memory.
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/orders"
              className={adminPrimaryActionClass}
            >
              Retry
            </Link>
            <Link
              href="/admin"
              className={adminSecondaryActionClass}
            >
              Admin dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const typedOrders = (orders || []) as Order[];
  let accountProfiles = new Map<string, AccountProfileSummary>();
  let accountProfilesError: { message?: string } | null = null;

  try {
    accountProfiles = await getAccountProfilesByIds(
      typedOrders.map((order) => order.account_id),
    );
  } catch (error) {
    accountProfilesError =
      error && typeof error === "object" && "message" in error
        ? { message: String(error.message || "Unknown account profile error.") }
        : { message: "Unknown account profile error." };
  }

  const accountProfilesUnavailable = Boolean(accountProfilesError);

  const readyToShip = typedOrders.filter(isReadyToShip);
  const reviewOrders = typedOrders.filter(isReview);
  const shipped = typedOrders.filter(isShipped);
  const allOrders = typedOrders;
  const dryRunShippingReferences = typedOrders.filter((order) =>
    isDryRunShippingReference(order.tracking_number),
  ).length;
  const paidRevenue = typedOrders
    .filter((order) => isPaidOrderStatus(order.status))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const fulfillmentPosture = accountProfilesUnavailable
    ? "PARTIAL DATA"
    : reviewOrders.length > 0
      ? "REVIEW HOLDS"
      : readyToShip.length > 0
        ? "READY TO SHIP"
        : "QUEUE CLEAR";
  const fulfillmentTone: OrderCardTone = accountProfilesUnavailable
    ? "amber"
    : reviewOrders.length > 0
      ? "red"
      : readyToShip.length > 0
        ? "emerald"
        : "sky";
  const primaryOrderAction =
    reviewOrders.length > 0
      ? {
          cta: "Open Review Holds",
          detail:
            "Resolve order holds before printing packing slips or marking anything shipped.",
          href: "/admin/orders?tab=review",
        }
      : readyToShip.length > 0
        ? {
            cta: "Pack Ready Orders",
            detail:
              "Paid orders are ready for packing slips, label evidence, and tracking updates.",
            href: "/admin/orders?tab=ready",
          }
        : {
            cta: "Review All Orders",
            detail:
              "No ready-to-ship or held orders are currently in the active queues.",
            href: "/admin/orders?tab=all",
          };

  const visibleOrders =
    activeTab === "shipped"
      ? shipped
      : activeTab === "review"
      ? reviewOrders
      : activeTab === "all"
      ? allOrders
      : readyToShip;

  return (
    <main className="min-h-screen space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-black/[0.02]">
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
            <Link href="/admin/products" className={adminSecondaryActionClass}>
              Products
            </Link>
            <Link href="/admin/offers" className={adminSecondaryActionClass}>
              Offers
            </Link>
            <Link href="/admin/files" className={adminSecondaryActionClass}>
              Files
            </Link>
            <Link href="/admin/logout" className={adminPrimaryActionClass}>
              Logout
            </Link>
          </div>
        </div>
      </section>

      {accountProfilesUnavailable ? (
        <section
          aria-live="polite"
          role="status"
          className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-900/10"
        >
          <h2 className="text-xl font-black">
            Linked account profiles unavailable
          </h2>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6">
            Orders loaded, but buyer account enrichment did not. The fulfillment
            queue remains usable; rows with linked buyers will show that profile
            details are unavailable instead of hiding the order.
          </p>
          <p className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold">
            {safeErrorMessage(accountProfilesError)}
          </p>
        </section>
      ) : null}

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

      <section className="grid gap-4 lg:grid-cols-3">
        <OrderPostureCard
          cta={primaryOrderAction.cta}
          detail={primaryOrderAction.detail}
          href={primaryOrderAction.href}
          label="Fulfillment posture"
          status={fulfillmentPosture}
          tone={fulfillmentTone}
        />
        <OrderPostureCard
          cta="Open Accounts"
          detail={
            accountProfilesUnavailable
              ? "Orders loaded, but buyer enrichment is partial. Fulfillment can continue with inline buyer lookup warnings."
              : "Buyer enrichment loaded cleanly; linked account labels are available where orders have account IDs."
          }
          href="/admin/accounts"
          label="Buyer enrichment"
          status={accountProfilesUnavailable ? "PARTIAL DATA" : "LINKED DATA LIVE"}
          tone={accountProfilesUnavailable ? "amber" : "emerald"}
        />
        <OrderPostureCard
          cta="Open Shipping Desk"
          detail={`${dryRunShippingReferences} dry-run shipping reference(s) are visible as warnings; use real labels and tracking before closing shipped work.`}
          href="/admin/shipping"
          label="Operator next action"
          status={primaryOrderAction.cta.toUpperCase()}
          tone={dryRunShippingReferences > 0 ? "amber" : "sky"}
        />
      </section>

      <nav className="flex flex-wrap gap-3 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm ring-1 ring-black/[0.02]">
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

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm ring-1 ring-black/[0.02]">
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
                accountProfilesUnavailable={accountProfilesUnavailable}
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
  tone?: OrderCardTone;
  value: string;
}) {
  const classes = orderCardToneClasses[tone];

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ring-1 ${classes.card}`}
    >
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function OrderPostureCard({
  cta,
  detail,
  href,
  label,
  status,
  tone,
}: {
  cta: string;
  detail: string;
  href: string;
  label: string;
  status: string;
  tone: OrderCardTone;
}) {
  const classes = orderCardToneClasses[tone];

  return (
    <article
      className={`flex h-full flex-col justify-between rounded-3xl border p-5 shadow-sm ring-1 ${classes.card}`}
    >
      <div>
        <p
          className={`text-xs font-black uppercase tracking-[0.16em] ${classes.label}`}
        >
          {label}
        </p>
        <span
          className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-black ${classes.pill}`}
        >
          {status}
        </span>
        <p className={`mt-4 text-sm font-semibold leading-6 ${classes.detail}`}>
          {detail}
        </p>
      </div>
      <Link href={href} className={`mt-5 inline-flex w-fit ${adminSecondaryActionClass}`}>
        {cta} →
      </Link>
    </article>
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
          ? adminPrimaryActionClass
          : adminSecondaryActionClass
      }
    >
      {label}
    </Link>
  );
}

function OrderCard({
  order,
  accountProfile,
  accountProfilesUnavailable,
}: {
  order: Order;
  accountProfile?: AccountProfileSummary;
  accountProfilesUnavailable?: boolean;
}) {
  const needsReview = isReview(order);
  const dryRunShipping = isDryRunShippingReference(order.tracking_number);
  const totalItems =
    order.item_count ||
    order.order_items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) ||
    0;

  return (
    <article className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 shadow-sm ring-1 ring-black/[0.02] transition hover:bg-white">
      {needsReview ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
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
                ? accountProfilesUnavailable
                  ? "Linked account profile lookup unavailable"
                  : "Linked account profile unavailable"
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <h4 className="mb-2 font-black">Items</h4>

          {!order.order_items || order.order_items.length === 0 ? (
            <p className="text-sm font-semibold text-neutral-500">
              No order items found.
            </p>
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
            <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              Dry-run shipping reference hidden. Record a real label/tracking
              before treating this order as shipped.
            </div>
          ) : (
            <>
              {order.tracking_number && (
                <p className="mt-2 text-sm">
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
              className={adminSecondaryActionClass}
            >
              Evidence files
            </Link>

            <Link
              href={`/admin/orders/${order.id}`}
              className={adminPrimaryActionClass}
            >
              View order
            </Link>

            {!needsReview ? (
              <Link
                href={`/admin/orders/${order.id}/packing-slip`}
                className="rounded-full border border-sky-300 bg-sky-50 px-4 py-2 text-center text-sm font-black text-sky-950 shadow-sm transition hover:-translate-y-0.5 hover:bg-sky-100 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
              >
                Print packing slip
              </Link>
            ) : null}

            <Link
              href={`/admin/orders/${order.id}`}
              className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-center text-sm font-black text-emerald-950 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-100 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              Add tracking / mark shipped
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

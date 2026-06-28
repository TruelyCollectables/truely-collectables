import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { getStoreSettings } from "../../lib/store-settings";
import { getActiveStoreId } from "../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductRow = {
  id: number;
  title: string | null;
  price: number | null;
  quantity: number | null;
  sport: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
  created_at: string;
};

type OfferRow = {
  id: number;
  status: string | null;
  offer_amount: number | null;
  customer_name: string | null;
  customer_email: string | null;
  created_at: string;
  products?: { title?: string | null; price?: number | null } | null;
};

type OrderRow = {
  id: number;
  customer_email: string | null;
  total: number | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  tracking_number: string | null;
  carrier: string | null;
  item_count: number | null;
  created_at: string;
};

type EvidenceRow = {
  id: string;
  order_id: number;
  status: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function percent(part: number, whole: number) {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function isPaid(order: OrderRow) {
  return order.status === "paid";
}

function isReadyToShip(order: OrderRow) {
  return (
    order.status === "paid" &&
    (order.fulfillment_status === "ready_to_ship" || !order.fulfillment_status)
  );
}

function isShipped(order: OrderRow) {
  return order.fulfillment_status === "shipped";
}

function statusTone(status: string | null | undefined) {
  if (status === "paid" || status === "active" || status === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "pending" || status === "countered" || status === "ready_to_ship") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "declined" || status === "sold" || status === "blocked") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

export default async function AdminDashboard() {
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [productsResult, offersResult, ordersResult, evidenceResult] =
    await Promise.all([
      supabase
        .from("products")
        .select("id,title,price,quantity,sport,ebay_item_id,last_seen_at,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("offers")
        .select(
          "id,status,offer_amount,customer_name,customer_email,created_at,products(title,price)",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("orders")
        .select(
          "id,customer_email,total,status,fulfillment_status,shipping_name,tracking_number,carrier,item_count,created_at",
        )
        .eq("store_id", storeId)
        .order("created_at", { ascending: false }),
      supabase
        .from("transaction_evidence_reports")
        .select("id,order_id,status,email_sent_at,email_error,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  const products = (productsResult.data || []) as ProductRow[];
  const offers = (offersResult.data || []) as OfferRow[];
  const orders = (ordersResult.data || []) as OrderRow[];
  const evidenceReports = (evidenceResult.data || []) as EvidenceRow[];

  const paidOrders = orders.filter(isPaid);
  const readyOrders = orders.filter(isReadyToShip);
  const shippedOrders = orders.filter(isShipped);
  const pendingOffers = offers.filter((offer) => offer.status === "pending");
  const counteredOffers = offers.filter((offer) => offer.status === "countered");
  const activeProducts = products.filter((product) => Number(product.quantity || 0) > 0);
  const soldOutProducts = products.filter((product) => Number(product.quantity || 0) <= 0);
  const lowInventory = activeProducts.filter(
    (product) => Number(product.quantity || 0) <= 1,
  );
  const ebayLinked = products.filter((product) => product.ebay_item_id);
  const evidenceErrors = evidenceReports.filter((report) => report.email_error);

  const revenueToday = paidOrders
    .filter((order) => new Date(order.created_at) >= today)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const revenueMonth = paidOrders
    .filter((order) => new Date(order.created_at) >= monthStart)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const allTimeRevenue = paidOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0,
  );
  const averageOrder =
    paidOrders.length > 0 ? allTimeRevenue / paidOrders.length : 0;
  const inventoryValue = activeProducts.reduce(
    (sum, product) =>
      sum + Number(product.price || 0) * Number(product.quantity || 0),
    0,
  );

  const latestEbaySeen = ebayLinked
    .map((product) => product.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  const opsAlerts = [
    readyOrders.length > 0
      ? `${readyOrders.length} paid order${readyOrders.length === 1 ? "" : "s"} ready to ship`
      : "No paid orders waiting on fulfillment",
    pendingOffers.length > 0
      ? `${pendingOffers.length} offer${pendingOffers.length === 1 ? "" : "s"} need review`
      : "Offer queue is clear",
    lowInventory.length > 0
      ? `${lowInventory.length} product${lowInventory.length === 1 ? "" : "s"} at one unit`
      : "No low-stock warnings",
    evidenceErrors.length > 0
      ? `${evidenceErrors.length} evidence email issue${evidenceErrors.length === 1 ? "" : "s"}`
      : "Evidence packet emails show no recent errors",
  ];

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Totally Collectibles OS
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              {storeSettings.displayName} Command Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Store #{storeSettings.storeId.slice(-4)} operational control for
              inventory, payments, offers, fulfillment, evidence, and launch
              readiness.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandButton href="/admin/products/new" label="Add Product" primary />
            <CommandButton href="/admin/inventory" label="Inventory V2" />
            <CommandButton href="/admin/ebay" label="eBay Health" />
            <CommandButton href="/admin/settings" label="Settings" />
            <CommandButton href="/api/ebay/import-listings?offset=0&limit=50" label="Sync eBay" />
            <CommandButton href="/admin/launch-readiness" label="Readiness" />
            <CommandButton href="/admin/logout" label="Logout" danger />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="Revenue Today" value={money(revenueToday)} detail="Paid orders since midnight" />
          <MetricTile label="Revenue Month" value={money(revenueMonth)} detail="Paid orders this month" />
          <MetricTile label="Inventory Value" value={money(inventoryValue)} detail={`${activeProducts.length} active products`} />
          <MetricTile label="Average Order" value={money(averageOrder)} detail={`${paidOrders.length} paid orders tracked`} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 p-5">
              <div>
                <h2 className="text-2xl font-black">Operations Board</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Live queues that need attention before money, inventory, or
                  customer trust gets messy.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Pill label={`${readyOrders.length} ready`} tone="amber" />
                <Pill label={`${pendingOffers.length} offers`} tone="amber" />
                <Pill label={`${lowInventory.length} low stock`} tone="rose" />
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-neutral-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
              <QueuePanel
                title="Fulfillment"
                href="/admin/orders"
                empty="No orders waiting to ship."
                rows={readyOrders.slice(0, 5).map((order) => ({
                  key: String(order.id),
                  title: `Order #${order.id}`,
                  meta: order.customer_email || "No customer email",
                  value: money(order.total),
                  href: `/admin/orders/${order.id}`,
                }))}
              />
              <QueuePanel
                title="Offer Desk"
                href="/admin/offers"
                empty="No pending offers."
                rows={[...pendingOffers, ...counteredOffers].slice(0, 5).map((offer) => ({
                  key: String(offer.id),
                  title: offer.products?.title || "Unknown product",
                  meta: offer.customer_name || offer.customer_email || "No customer",
                  value: money(offer.offer_amount),
                }))}
              />
              <QueuePanel
                title="Inventory Watch"
                href="/admin/products"
                empty="No low-stock products."
                rows={lowInventory.slice(0, 5).map((product) => ({
                  key: String(product.id),
                  title: product.title || `Product #${product.id}`,
                  meta: product.ebay_item_id ? "eBay linked" : "Local only",
                  value: `${Number(product.quantity || 0)} left`,
                  href: `/admin/products/${product.id}`,
                }))}
              />
            </div>
          </div>

          <aside className="space-y-6">
            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Store Stack</h2>
                  <p className="mt-1 text-sm text-neutral-600">
                    Active TCOS store context.
                  </p>
                </div>
                <Pill
                  label={storeSettings.source === "database" ? "DB settings" : "fallback"}
                  tone={storeSettings.source === "database" ? "green" : "amber"}
                />
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <InfoLine label="Legal" value={storeSettings.legalName || "Not set"} />
                <InfoLine label="Status" value={label(storeSettings.status)} />
                <InfoLine label="eBay" value={storeSettings.ebayEnvironment} />
                <InfoLine label="Stripe" value={storeSettings.stripeMode} />
                <InfoLine label="Support" value={storeSettings.supportEmail} />
                <InfoLine
                  label="Commission"
                  value={`${(storeSettings.sellerCommissionRate * 100).toFixed(2)}%`}
                />
              </dl>
            </section>

            <section className="rounded-md border border-neutral-200 bg-white p-5">
              <h2 className="text-xl font-black">Command Links</h2>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <LinkButton href="/admin/products" label="Products" />
                <LinkButton href="/admin/inventory" label="Inventory V2" />
                <LinkButton href="/admin/ebay" label="eBay" />
                <LinkButton href="/admin/settings" label="Settings" />
                <LinkButton href="/admin/orders" label="Orders" />
                <LinkButton href="/admin/offers" label="Offers" />
                <LinkButton href="/admin/files" label="Files" />
                <LinkButton href="/admin/launch-readiness" label="Launch" />
                <LinkButton href="/shop" label="Shop" />
              </div>
            </section>
          </aside>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <StatusPanel
            title="Sales Pulse"
            rows={[
              ["Paid orders", String(paidOrders.length)],
              ["Ready to ship", String(readyOrders.length)],
              ["Shipped", String(shippedOrders.length)],
              ["Fulfillment rate", percent(shippedOrders.length, paidOrders.length)],
            ]}
          />
          <StatusPanel
            title="Inventory Pulse"
            rows={[
              ["Active products", String(activeProducts.length)],
              ["Sold out / zero", String(soldOutProducts.length)],
              ["eBay linked", `${ebayLinked.length} (${percent(ebayLinked.length, products.length)})`],
              ["Last eBay seen", shortDate(latestEbaySeen || null)],
            ]}
          />
          <StatusPanel
            title="Trust And Evidence"
            rows={[
              ["Evidence reports", String(evidenceReports.length)],
              ["Recent email errors", String(evidenceErrors.length)],
              ["Evidence inbox", storeSettings.evidenceEmail || "Not configured"],
              ["Settings source", storeSettings.source],
            ]}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md border border-neutral-200 bg-white p-5">
            <h2 className="text-xl font-black">Operator Alerts</h2>
            <div className="mt-4 space-y-3">
              {opsAlerts.map((alert) => (
                <div
                  key={alert}
                  className="border-l-4 border-neutral-900 bg-neutral-50 px-4 py-3 text-sm font-semibold"
                >
                  {alert}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-xl font-black">Latest Orders</h2>
            </div>
            <div className="divide-y divide-neutral-200">
              {orders.slice(0, 6).length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">No orders yet.</p>
              ) : (
                orders.slice(0, 6).map((order) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="grid gap-2 p-4 text-sm hover:bg-neutral-50 md:grid-cols-[1fr_auto_auto]"
                  >
                    <div>
                      <p className="font-bold">Order #{order.id}</p>
                      <p className="text-neutral-600">
                        {order.customer_email || "No customer email"}
                      </p>
                    </div>
                    <span className={`w-fit rounded border px-2 py-1 text-xs font-bold ${statusTone(order.fulfillment_status || order.status)}`}>
                      {label(order.fulfillment_status || order.status)}
                    </span>
                    <p className="font-black">{money(order.total)}</p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-neutral-600">{detail}</p>
    </div>
  );
}

function CommandButton({
  href,
  label,
  primary,
  danger,
}: {
  href: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : danger
    ? "border border-rose-400 text-rose-200 hover:bg-rose-950"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link href={href} className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}>
      {label}
    </Link>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "rose";
}) {
  const className =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-rose-200 bg-rose-50 text-rose-800";

  return (
    <span className={`rounded border px-2.5 py-1 text-xs font-black ${className}`}>
      {label}
    </span>
  );
}

function QueuePanel({
  title,
  href,
  empty,
  rows,
}: {
  title: string;
  href: string;
  empty: string;
  rows: Array<{
    key: string;
    title: string;
    meta: string;
    value: string;
    href?: string;
  }>;
}) {
  return (
    <div className="min-h-[320px] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-black">{title}</h3>
        <Link href={href} className="text-sm font-bold underline">
          Open
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{empty}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const content = (
              <>
                <div className="min-w-0">
                  <p className="truncate font-bold">{row.title}</p>
                  <p className="truncate text-xs text-neutral-600">{row.meta}</p>
                </div>
                <p className="shrink-0 text-sm font-black">{row.value}</p>
              </>
            );

            return row.href ? (
              <Link
                key={row.key}
                href={row.href}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3 hover:bg-neutral-50"
              >
                {content}
              </Link>
            ) : (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 p-3"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3">
      <dt className="font-bold text-neutral-500">{label}</dt>
      <dd className="break-words font-semibold">{value}</dd>
    </div>
  );
}

function LinkButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-center font-bold hover:bg-white"
    >
      {label}
    </Link>
  );
}

function StatusPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-5">
      <h2 className="text-xl font-black">{title}</h2>
      <dl className="mt-4 divide-y divide-neutral-200 text-sm">
        {rows.map(([labelText, value]) => (
          <div key={labelText} className="flex items-center justify-between gap-4 py-3">
            <dt className="font-semibold text-neutral-600">{labelText}</dt>
            <dd className="break-words text-right font-black">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

import { supabase } from "../../../lib/supabase";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrderItem = {
  id: number;
  title: string;
  quantity: number;
  price: number;
};

type Order = {
  id: number;
  created_at: string;
  customer_email: string | null;
  total: number;
  status: string | null;
  shipping_method: string | null;
  shipping_name: string | null;
  shipping_amount: number | null;
  subtotal: number | null;
  item_count: number | null;
  fulfillment_status: string | null;
  tracking_number: string | null;
  carrier: string | null;
  order_items?: OrderItem[];
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function statusLabel(status: string | null | undefined) {
  if (!status) return "Pending";
  return status.replaceAll("_", " ").toUpperCase();
}

function isReadyToShip(order: Order) {
  return (
    order.status === "paid" &&
    (order.fulfillment_status === "ready_to_ship" || !order.fulfillment_status)
  );
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
  const activeTab = params?.tab || "ready";
  const storeId = getActiveStoreId();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      *,
      order_items (
        id,
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
      <main className="p-8">
        <h1>Error Loading Orders</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  const typedOrders = (orders || []) as Order[];

  const readyToShip = typedOrders.filter(isReadyToShip);
  const shipped = typedOrders.filter(isShipped);
  const allOrders = typedOrders;

  const visibleOrders =
    activeTab === "shipped"
      ? shipped
      : activeTab === "all"
      ? allOrders
      : readyToShip;

  return (
    <main className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-4xl font-bold">Fulfillment Center</h1>
          <p className="text-gray-600 mt-2">
            Manage paid orders, packing slips, tracking, and shipping.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Last refreshed: {new Date().toLocaleString()}
          </p>
        </div>

        <div className="flex gap-3">
          <a href="/admin/products" className="border rounded px-4 py-2">
            Products
          </a>
          <a href="/admin/offers" className="border rounded px-4 py-2">
            Offers
          </a>
          <a href="/admin/files" className="border rounded px-4 py-2">
            Files
          </a>
          <a href="/admin/logout" className="border rounded px-4 py-2">
            Logout
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <DashboardCard label="Total Orders" value={String(typedOrders.length)} />
        <DashboardCard label="Ready to Ship" value={String(readyToShip.length)} />
        <DashboardCard label="Shipped" value={String(shipped.length)} />
        <DashboardCard
          label="Revenue"
          value={money(
            typedOrders
              .filter((order) => order.status === "paid")
              .reduce((sum, order) => sum + Number(order.total || 0), 0)
          )}
        />
      </div>

      <div className="flex flex-wrap gap-3 mb-8 border-b pb-4">
        <TabLink
          href="/admin/orders?tab=ready"
          active={activeTab === "ready"}
          label={`Ready to Ship (${readyToShip.length})`}
        />

        <TabLink
          href="/admin/orders?tab=shipped"
          active={activeTab === "shipped"}
          label={`Shipped (${shipped.length})`}
        />

        <TabLink
          href="/admin/orders?tab=all"
          active={activeTab === "all"}
          label={`All Orders (${allOrders.length})`}
        />
      </div>

      <section>
        <h2 className="text-2xl font-bold mb-4">
          {activeTab === "shipped"
            ? `Shipped (${shipped.length})`
            : activeTab === "all"
            ? `All Orders (${allOrders.length})`
            : `Ready to Ship (${readyToShip.length})`}
        </h2>

        {visibleOrders.length === 0 ? (
          <p className="text-gray-600">No orders in this queue.</p>
        ) : (
          <div className="space-y-4">
            {visibleOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function DashboardCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-4 bg-white">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
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
    <a
      href={href}
      className={
        active
          ? "bg-black text-white border border-black rounded px-4 py-2 font-bold"
          : "border rounded px-4 py-2"
      }
    >
      {label}
    </a>
  );
}

function OrderCard({ order }: { order: Order }) {
  return (
    <div className="border rounded-lg p-5 bg-white">
      <div className="flex flex-wrap justify-between gap-4 border-b pb-4 mb-4">
        <div>
          <h3 className="text-xl font-bold">Order #{order.id}</h3>
          <p className="text-gray-600">{order.customer_email || "No email"}</p>
          <p className="text-sm text-gray-500">
            {new Date(order.created_at).toLocaleString()}
          </p>
        </div>

        <div className="text-right">
          <p className="font-bold text-lg">{money(order.total)}</p>
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
          <h4 className="font-bold mb-2">Items</h4>

          {!order.order_items || order.order_items.length === 0 ? (
            <p className="text-sm text-gray-500">No order items found.</p>
          ) : (
            <ul className="space-y-2">
              {order.order_items.map((item) => (
                <li key={item.id} className="text-sm">
                  <span className="font-medium">{item.quantity}×</span>{" "}
                  {item.title}
                  <br />
                  <span className="text-gray-500">
                    {money(Number(item.price) * Number(item.quantity))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="font-bold mb-2">Shipping</h4>
          <p className="text-sm">
            Method: {order.shipping_name || order.shipping_method || "Not set"}
          </p>
          <p className="text-sm">
            Shipping Paid: {money(order.shipping_amount)}
          </p>
          <p className="text-sm">Subtotal: {money(order.subtotal)}</p>
          <p className="text-sm">Items: {order.item_count || 0}</p>

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
        </div>

        <div>
          <h4 className="font-bold mb-2">Actions</h4>

          <div className="flex flex-col gap-2">
            <a
              href="/admin/files"
              className="border rounded px-4 py-2 text-center"
            >
              Evidence Files
            </a>

            <a
              href={`/admin/orders/${order.id}`}
              className="border rounded px-4 py-2 text-center"
            >
              View Order
            </a>

            <a
              href={`/admin/orders/${order.id}/packing-slip`}
              className="border rounded px-4 py-2 text-center"
            >
              Print Packing Slip
            </a>

            <a
              href={`/admin/orders/${order.id}`}
              className="border rounded px-4 py-2 text-center"
            >
              Add Tracking / Mark Shipped
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

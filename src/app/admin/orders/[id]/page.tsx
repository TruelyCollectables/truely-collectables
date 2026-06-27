import { supabase } from "../../../../lib/supabase";
import Link from "next/link";

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
  shipped_at: string | null;
  order_items?: OrderItem[];
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: order, error } = await supabase
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
    .eq("id", id)
    .single();

  if (error || !order) {
    return (
      <main className="p-8">
        <h1 className="text-3xl font-bold">Order Not Found</h1>
        <pre>{error?.message}</pre>
        <Link href="/admin/orders" className="underline">
          Back to Fulfillment Center
        </Link>
      </main>
    );
  }

  const typedOrder = order as Order;

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <Link href="/admin/orders" className="underline">
          ← Back to Fulfillment Center
        </Link>

        <h1 className="text-4xl font-bold mt-4">Order #{typedOrder.id}</h1>

        <p className="text-gray-600">
          Created {new Date(typedOrder.created_at).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Payment</p>
          <p className="text-2xl font-bold">{label(typedOrder.status)}</p>
        </div>

        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Fulfillment</p>
          <p className="text-2xl font-bold">
            {label(typedOrder.fulfillment_status)}
          </p>
        </div>

        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Total</p>
          <p className="text-2xl font-bold">{money(typedOrder.total)}</p>
        </div>
      </div>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Customer</h2>
        <p>Email: {typedOrder.customer_email || "No email"}</p>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Items</h2>

        {!typedOrder.order_items || typedOrder.order_items.length === 0 ? (
          <p>No order items found.</p>
        ) : (
          <div className="space-y-3">
            {typedOrder.order_items.map((item) => (
              <div
                key={item.id}
                className="flex justify-between border-b pb-3"
              >
                <div>
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-gray-600">
                    Quantity: {item.quantity}
                  </p>
                </div>

                <p className="font-bold">
                  {money(Number(item.price) * Number(item.quantity))}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Shipping</h2>

        <p>Method: {typedOrder.shipping_name || typedOrder.shipping_method}</p>
        <p>Shipping Paid: {money(typedOrder.shipping_amount)}</p>
        <p>Subtotal: {money(typedOrder.subtotal)}</p>
        <p>Items: {typedOrder.item_count || 0}</p>

        <div className="mt-4">
          <p>Carrier: {typedOrder.carrier || "Not added"}</p>
          <p>Tracking: {typedOrder.tracking_number || "Not added"}</p>
          <p>
            Shipped At:{" "}
            {typedOrder.shipped_at
              ? new Date(typedOrder.shipped_at).toLocaleString()
              : "Not shipped"}
          </p>
        </div>
      </section>

      <section className="border rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Actions</h2>

        <div className="flex flex-wrap gap-4">
          <Link
            href={`/admin/orders/${typedOrder.id}/packing-slip`}
            className="border rounded px-4 py-2"
          >
            Print Packing Slip
          </Link>

          <button
            disabled
            className="border rounded px-4 py-2 text-gray-400 cursor-not-allowed"
          >
            Add Tracking
          </button>

          <button
            disabled
            className="border rounded px-4 py-2 text-gray-400 cursor-not-allowed"
          >
            Mark Shipped
          </button>
        </div>
      </section>
    </main>
  );
}
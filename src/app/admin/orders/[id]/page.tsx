import { supabase } from "../../../../lib/supabase";
import Link from "next/link";
import TrackingForm from "./TrackingForm";

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
  customer_name?: string | null;
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
  discount_amount?: number | null;
  discount_code?: string | null;
  customer_notes?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
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

  const itemsTotal =
    typedOrder.order_items?.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    ) || Number(typedOrder.subtotal || 0);

  const discountAmount = Number(typedOrder.discount_amount || 0);
  const shippingPaid = Number(typedOrder.shipping_amount || 0);
  const totalPaid = Number(typedOrder.total || 0);

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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
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
          <p className="text-sm text-gray-500">Items Total</p>
          <p className="text-2xl font-bold">{money(itemsTotal)}</p>
        </div>

        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500">Total Paid</p>
          <p className="text-2xl font-bold">{money(totalPaid)}</p>
        </div>
      </div>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Customer</h2>
        <p>Name: {typedOrder.customer_name || "Not saved"}</p>
        <p>Email: {typedOrder.customer_email || "No email"}</p>

        <div className="mt-4">
          <h3 className="font-bold">Customer Notes</h3>
          <p className="mt-1 whitespace-pre-wrap">
            {typedOrder.customer_notes?.trim() || "No customer notes."}
          </p>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Ship To</h2>

        {typedOrder.shipping_address_line1 ? (
          <div>
            <p>{typedOrder.customer_name || typedOrder.customer_email}</p>
            <p>{typedOrder.shipping_address_line1}</p>
            {typedOrder.shipping_address_line2 && (
              <p>{typedOrder.shipping_address_line2}</p>
            )}
            <p>
              {typedOrder.shipping_city}
              {typedOrder.shipping_city && typedOrder.shipping_state ? ", " : ""}
              {typedOrder.shipping_state} {typedOrder.shipping_postal_code}
            </p>
            <p>{typedOrder.shipping_country}</p>
          </div>
        ) : (
          <p className="text-gray-600">Shipping address not saved.</p>
        )}
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Items</h2>

        {!typedOrder.order_items || typedOrder.order_items.length === 0 ? (
          <p>No order items found.</p>
        ) : (
          <div className="space-y-3">
            {typedOrder.order_items.map((item) => (
              <div key={item.id} className="flex justify-between border-b pb-3">
                <div>
                  <p className="font-bold">{item.title}</p>
                  <p className="text-sm text-gray-600">
                    Quantity: {item.quantity} × {money(item.price)}
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
        <h2 className="text-2xl font-bold mb-4">Order Totals</h2>

        <div className="max-w-md space-y-2">
          <div className="flex justify-between">
            <span>Items Total</span>
            <strong>{money(itemsTotal)}</strong>
          </div>

          <div className="flex justify-between">
            <span>
              Discount
              {typedOrder.discount_code ? ` (${typedOrder.discount_code})` : ""}
            </span>
            <strong>-{money(discountAmount)}</strong>
          </div>

          <div className="flex justify-between">
            <span>Shipping Paid</span>
            <strong>{money(shippingPaid)}</strong>
          </div>

          <div className="flex justify-between border-t pt-3 text-xl">
            <span>Total Paid</span>
            <strong>{money(totalPaid)}</strong>
          </div>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Shipping</h2>

        <p>Method: {typedOrder.shipping_name || typedOrder.shipping_method}</p>
        <p>Shipping Paid: {money(typedOrder.shipping_amount)}</p>
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

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Add Tracking</h2>

        <TrackingForm
          orderId={typedOrder.id}
          currentCarrier={typedOrder.carrier || ""}
          currentTrackingNumber={typedOrder.tracking_number || ""}
        />
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
            Mark Shipped
          </button>
        </div>
      </section>
    </main>
  );
}
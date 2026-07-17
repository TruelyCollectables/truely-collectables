import Link from "next/link";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
} from "../../../../../lib/shipping-dry-run";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getStoreSettings } from "../../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../../lib/stores";

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
  customer_name: string | null;
  total: number;
  status: string | null;
  shipping_name: string | null;
  shipping_method: string | null;
  shipping_amount: number | null;
  subtotal: number | null;
  item_count: number | null;
  discount_amount?: number | null;
  discount_code?: string | null;
  customer_notes?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_postal_code?: string | null;
  shipping_country?: string | null;
  tracking_number?: string | null;
  carrier?: string | null;
  order_items?: OrderItem[];
};

type ShippingLabelRow = {
  id: string;
  label_status: string | null;
  metadata: Record<string, unknown> | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  coverage_policy_id: string | null;
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function storeMark(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .map((part) => part.trim().charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "TC";
}

export default async function PackingSlipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const storeSettings = await getStoreSettings(supabase, storeId);

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
    `,
    )
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (error || !order) {
    return (
      <main className="p-8">
        <h1 className="text-3xl font-bold">Packing Slip Not Found</h1>
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
      0,
    ) || Number(typedOrder.subtotal || 0);
  const discountAmount = Number(typedOrder.discount_amount || 0);
  const shippingPaid = Number(typedOrder.shipping_amount || 0);
  const totalPaid = Number(typedOrder.total || 0);
  const { data: activeLabel } = await supabase
    .from("order_shipping_labels")
    .select(
      "id,label_status,metadata,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id",
    )
    .eq("store_id", storeId)
    .eq("order_id", typedOrder.id)
    .not("label_status", "in", "(voided,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const dryRunShipping = Boolean(
    isDryRunShippingReference(typedOrder.tracking_number) ||
      isDryRunShippingLabel((activeLabel || null) as ShippingLabelRow | null),
  );

  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-black print:p-0">
      <div className="mb-6 flex justify-between print:hidden">
        <Link href={`/admin/orders/${typedOrder.id}`} className="underline">
          {"<-"} Back to Order
        </Link>

        {dryRunShipping ? (
          <span className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm font-black text-red-950">
            Printing blocked: dry-run shipping
          </span>
        ) : (
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded border px-4 py-2"
          >
            Print Packing Slip
          </button>
        )}
      </div>

      <section className="rounded-lg border p-8 print:border-0">
        {dryRunShipping ? (
          <div className="mb-6 rounded border-4 border-red-700 bg-red-50 p-5 text-center text-red-950 print:block">
            <p className="text-3xl font-black">DRY-RUN / DO NOT SHIP</p>
            <p className="mt-2 text-sm font-bold">
              This order has simulated TCOS shipping data. Do not mail this
              package until a real external label and Coverage policy are
              recorded.
            </p>
          </div>
        ) : null}

        <div className="mb-6 border-b pb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-black text-xl font-bold text-white">
            {storeMark(storeSettings.displayName)}
          </div>

          <h1 className="text-3xl font-bold">{storeSettings.displayName}</h1>
          <p className="mt-2 text-lg">Packing Slip</p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-6 border-b pb-6">
          <div>
            <h2 className="mb-2 text-lg font-bold">Order</h2>
            <p>Order #{typedOrder.id}</p>
            <p>{new Date(typedOrder.created_at).toLocaleString()}</p>
            <p>Status: {typedOrder.status || "paid"}</p>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-bold">Customer</h2>
            <p>{typedOrder.customer_name || "Customer name not saved"}</p>
            <p>{typedOrder.customer_email || "No email"}</p>
          </div>
        </div>

        <div className="mb-6 border-b pb-6">
          <h2 className="mb-2 text-lg font-bold">Ship To</h2>

          {typedOrder.shipping_address_line1 ? (
            <div>
              <p>{typedOrder.customer_name || typedOrder.customer_email}</p>
              <p>{typedOrder.shipping_address_line1}</p>
              {typedOrder.shipping_address_line2 ? (
                <p>{typedOrder.shipping_address_line2}</p>
              ) : null}
              <p>
                {typedOrder.shipping_city}
                {typedOrder.shipping_city && typedOrder.shipping_state ? ", " : ""}
                {typedOrder.shipping_state} {typedOrder.shipping_postal_code}
              </p>
              <p>{typedOrder.shipping_country}</p>
            </div>
          ) : (
            <p className="text-gray-600">
              Shipping address not saved on this order.
            </p>
          )}
        </div>

        <div className="mb-6 border-b pb-6">
          <h2 className="mb-4 text-lg font-bold">Items</h2>

          {!typedOrder.order_items || typedOrder.order_items.length === 0 ? (
            <p>No order items found.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">Item</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>

              <tbody>
                {typedOrder.order_items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-3">{item.title}</td>
                    <td className="py-3 text-center">{item.quantity}</td>
                    <td className="py-3 text-right">
                      {money(Number(item.price) * Number(item.quantity))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-8 border-b pb-6">
          <div>
            <h2 className="mb-3 text-lg font-bold">Packing Checklist</h2>

            <ul className="space-y-2">
              <li>[ ] Item inspected</li>
              <li>[ ] Item protected</li>
              <li>[ ] Packing slip included</li>
              <li>[ ] Package sealed</li>
              <li>[ ] Tracking added</li>
              {dryRunShipping ? (
                <li className="font-black text-red-700">
                  [ ] REAL label/Coverage required before shipment
                </li>
              ) : null}
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-bold">Totals</h2>

            <div className="space-y-2">
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
          </div>
        </div>

        <div className="mb-6 border-b pb-6">
          <h2 className="mb-2 text-lg font-bold">Customer Notes</h2>
          <p className="whitespace-pre-wrap">
            {typedOrder.customer_notes?.trim() || "No customer notes."}
          </p>
        </div>

        <div className="text-center">
          <p className="text-lg font-bold">Thank you for your purchase!</p>
          <p>{storeSettings.displayName}</p>
        </div>
      </section>
    </main>
  );
}

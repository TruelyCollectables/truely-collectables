import Link from "next/link";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
} from "../../../../../lib/shipping-dry-run";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getStoreSettings } from "../../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../../lib/stores";
import PrintPackingSlipButton from "./PrintPackingSlipButton";

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
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
}

function statusLabel(value: string | null | undefined) {
  if (!value) return "PAID";
  return value.replaceAll("_", " ").toUpperCase();
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
      <main className="bg-neutral-50 px-6 py-8 text-neutral-950">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Packing slip
          </p>
          <h1 className="mt-2 text-3xl font-black">Packing slip not found</h1>
          {error?.message ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
              {error.message}
            </p>
          ) : null}
          <Link
            href="/admin/orders"
            className="mt-5 inline-flex rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
          >
            Back to fulfillment center
          </Link>
        </section>
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
    <main className="min-h-screen bg-neutral-100 px-6 py-8 text-black print:bg-white print:p-0">
      <div className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm print:hidden">
        <Link
          href={`/admin/orders/${typedOrder.id}`}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-950 hover:bg-neutral-50"
        >
          Back to Order #{typedOrder.id}
        </Link>

        {dryRunShipping ? (
          <span className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-black text-red-950">
            Printing blocked: dry-run shipping
          </span>
        ) : (
          <PrintPackingSlipButton />
        )}
      </div>

      <section className="mx-auto max-w-4xl rounded-3xl border border-neutral-300 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
        {dryRunShipping ? (
          <div className="mb-6 rounded-2xl border-4 border-red-700 bg-red-50 p-5 text-center text-red-950 print:block">
            <p className="text-3xl font-black">DRY-RUN / DO NOT SHIP</p>
            <p className="mt-2 text-sm font-bold">
              This order has simulated TCOS shipping data. Do not mail this
              package until a real external label and Coverage policy are
              recorded.
            </p>
          </div>
        ) : null}

        <div className="mb-6 border-b border-neutral-300 pb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-black text-xl font-black text-white">
            {storeMark(storeSettings.displayName)}
          </div>

          <h1 className="text-3xl font-black">{storeSettings.displayName}</h1>
          <p className="mt-2 text-lg font-semibold">Packing Slip</p>
          <p className="mt-1 text-sm font-bold text-neutral-500">
            Order #{typedOrder.id}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 border-b border-neutral-300 pb-6 md:grid-cols-2">
          <div>
            <h2 className="mb-2 text-lg font-black">Order</h2>
            <p>Order #{typedOrder.id}</p>
            <p>{dateLabel(typedOrder.created_at)}</p>
            <p>Status: {statusLabel(typedOrder.status)}</p>
            {typedOrder.shipping_method ? (
              <p>Shipping: {typedOrder.shipping_method}</p>
            ) : null}
            {typedOrder.tracking_number ? (
              <p>
                Tracking: {typedOrder.carrier ? `${typedOrder.carrier} ` : ""}
                {typedOrder.tracking_number}
              </p>
            ) : null}
          </div>

          <div>
            <h2 className="mb-2 text-lg font-black">Customer</h2>
            <p>{typedOrder.customer_name || "Customer name not saved"}</p>
            <p>{typedOrder.customer_email || "No email"}</p>
          </div>
        </div>

        <div className="mb-6 border-b border-neutral-300 pb-6">
          <h2 className="mb-2 text-lg font-black">Ship To</h2>

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
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
              Shipping address not saved on this order.
            </p>
          )}
        </div>

        <div className="mb-6 border-b border-neutral-300 pb-6">
          <h2 className="mb-4 text-lg font-black">Items</h2>

          {!typedOrder.order_items || typedOrder.order_items.length === 0 ? (
            <p>No order items found.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th className="py-2 text-left">Item</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>

              <tbody>
                {typedOrder.order_items.map((item) => (
                  <tr key={item.id} className="border-b border-neutral-200">
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

        <div className="mb-6 grid grid-cols-1 gap-8 border-b border-neutral-300 pb-6 md:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-black">Packing Checklist</h2>

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
            <h2 className="mb-3 text-lg font-black">Totals</h2>

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

        <div className="mb-6 border-b border-neutral-300 pb-6">
          <h2 className="mb-2 text-lg font-black">Customer Notes</h2>
          <p className="whitespace-pre-wrap">
            {typedOrder.customer_notes?.trim() || "No customer notes."}
          </p>
        </div>

        <div className="text-center">
          <p className="text-lg font-black">Thank you for your purchase!</p>
          <p>{storeSettings.displayName}</p>
        </div>
      </section>
    </main>
  );
}

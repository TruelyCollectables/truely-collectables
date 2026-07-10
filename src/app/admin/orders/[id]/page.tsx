import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { getAccountProfilesByIds } from "../../../../lib/account-profiles";
import { isOrderReviewStatus } from "../../../../lib/order-status";
import Link from "next/link";
import PayoutLedgerActions from "../../seller-payouts/PayoutLedgerActions";
import OrderReviewCasesPanel, {
  type AdminOrderReviewCase,
  type AdminOrderReviewCaseEvent,
  type SellerCaseOption,
} from "./OrderReviewCasesPanel";
import TrackingForm from "./TrackingForm";

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
  customer_name?: string | null;
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
  tos_accepted?: boolean | null;
  tos_version?: string | null;
  tos_accepted_at?: string | null;
  tos_acceptance_event_id?: string | null;
  tos_ip_address?: string | null;
  tos_user_agent?: string | null;
  tos_ip_risk?: string | null;
  tos_ip_block_reason?: string | null;
  order_items?: OrderItem[];
};

type EvidenceReport = {
  id: string;
  status: string | null;
  emailed_to: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
  updated_at: string | null;
};

type SellerPayoutLedgerEntry = {
  id: string;
  seller_account_id: string;
  order_item_id: number;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
  created_at: string;
};

type PlatformFeeLedgerEntry = {
  id: string;
  order_item_id: number;
  seller_account_id: string | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  fee_status: string | null;
  created_at: string;
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
  const supabase = createSupabaseServerClient({ admin: true });
  const { id } = await params;
  const storeId = getActiveStoreId();

  const { data: order, error } = await supabase
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
    .eq("id", id)
    .eq("store_id", storeId)
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
  const sellerAccountIds = Array.from(
    new Set(
      (typedOrder.order_items || [])
        .map((item) => item.seller_account_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const accountProfiles = await getAccountProfilesByIds([
    typedOrder.account_id,
    ...sellerAccountIds,
  ]);
  const accountProfile = typedOrder.account_id
    ? accountProfiles.get(typedOrder.account_id)
    : undefined;
  const sellerOptions: SellerCaseOption[] = sellerAccountIds.map((sellerId) => {
    const profile = accountProfiles.get(sellerId);

    return {
      id: sellerId,
      label: profile?.email || profile?.display_name || sellerId,
    };
  });
  const { data: orderReviewCasesData, error: orderReviewCasesError } =
    await supabase
      .from("order_review_cases")
      .select(
        `
        id,
        seller_account_id,
        case_type,
        status,
        severity,
        title,
        description,
        hold_seller_payouts,
        hold_order_fulfillment,
        outcome_summary,
        opened_at,
        closed_at,
        updated_at
      `,
      )
      .eq("order_id", typedOrder.id)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
  const orderReviewCases = orderReviewCasesError
    ? []
    : ((orderReviewCasesData || []) as AdminOrderReviewCase[]);
  const orderReviewCaseIds = orderReviewCases.map((reviewCase) => reviewCase.id);
  const { data: orderReviewCaseEventsData, error: orderReviewCaseEventsError } =
    orderReviewCaseIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("order_review_case_events")
          .select(
            `
            id,
            case_id,
            event_type,
            previous_status,
            new_status,
            note,
            ip_address,
            identity_risk,
            created_at
          `,
          )
          .in("case_id", orderReviewCaseIds)
          .eq("store_id", storeId)
          .order("created_at", { ascending: false });
  const orderReviewCaseEvents =
    (orderReviewCaseEventsData || []) as AdminOrderReviewCaseEvent[];
  const { data: evidenceReports, error: evidenceError } = await supabase
    .from("transaction_evidence_reports")
    .select(
      `
      id,
      status,
      emailed_to,
      email_sent_at,
      email_error,
      created_at,
      updated_at
    `
    )
    .eq("order_id", typedOrder.id)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  const latestEvidence = ((evidenceReports || []) as EvidenceReport[])[0];
  const { data: payoutLedgerEntries, error: payoutLedgerError } = await supabase
    .from("seller_payout_ledger_entries")
    .select(
      `
      id,
      seller_account_id,
      order_item_id,
      gross_item_amount,
      shipping_allocated_amount,
      total_basis_amount,
      platform_fee_rate,
      platform_fee_amount,
      seller_payable_amount,
      payout_status,
      created_at
    `,
    )
    .eq("order_id", typedOrder.id)
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });
  const sellerPayoutLedger =
    (payoutLedgerEntries || []) as SellerPayoutLedgerEntry[];
  const sellerPayoutTotal = sellerPayoutLedger.reduce(
    (sum, entry) => sum + Number(entry.seller_payable_amount || 0),
    0,
  );
  const platformFeeTotal = sellerPayoutLedger.reduce(
    (sum, entry) => sum + Number(entry.platform_fee_amount || 0),
    0,
  );
  const { data: platformFeeLedgerEntries } = await supabase
    .from("platform_fee_ledger_entries")
    .select(
      `
      id,
      order_item_id,
      seller_account_id,
      gross_item_amount,
      shipping_allocated_amount,
      total_basis_amount,
      platform_fee_rate,
      platform_fee_amount,
      fee_status,
      created_at
    `,
    )
    .eq("order_id", typedOrder.id)
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });
  const platformFeeLedger =
    (platformFeeLedgerEntries || []) as PlatformFeeLedgerEntry[];
  const allSiteRakeTotal = platformFeeLedger.reduce(
    (sum, entry) => sum + Number(entry.platform_fee_amount || 0),
    0,
  );

  const itemsTotal =
    typedOrder.order_items?.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    ) || Number(typedOrder.subtotal || 0);

  const discountAmount = Number(typedOrder.discount_amount || 0);
  const shippingPaid = Number(typedOrder.shipping_amount || 0);
  const totalPaid = Number(typedOrder.total || 0);
  const needsReview = isOrderReviewStatus(
    typedOrder.status,
    typedOrder.fulfillment_status,
  );
  const reviewMessage =
    "Review hold: verify shipping evidence, inventory, and payment details before marking this order shipped.";

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

      {needsReview ? (
        <section className="mb-6 rounded border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <h2 className="text-xl font-bold">Order Needs Review</h2>
          <p className="mt-2 text-sm font-semibold">{reviewMessage}</p>
        </section>
      ) : null}

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

      {platformFeeLedger.length > 0 ? (
        <section className="border rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">
            Dag Danky Holdings LLC Rake
          </h2>

          <div className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-500">
              8% Platform Rake Total
            </p>
            <p className="text-2xl font-bold">{money(allSiteRakeTotal)}</p>
            <p className="mt-1 text-sm text-gray-600">
              Calculated from this TCOS website checkout order only, using each
              order item plus allocated buyer-paid shipping.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {platformFeeLedger.map((entry) => (
              <div key={entry.id} className="rounded border p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-bold">
                      Order Item #{entry.order_item_id}
                    </p>
                    <p className="text-sm text-gray-600">
                      {entry.seller_account_id
                        ? `Outside seller ${entry.seller_account_id}`
                        : "Store inventory"}
                    </p>
                  </div>

                  <p className="text-sm font-bold">
                    Rate{" "}
                    {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}%
                  </p>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <dt className="font-semibold text-gray-500">Gross</dt>
                    <dd>{money(Number(entry.gross_item_amount || 0))}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Shipping Basis
                    </dt>
                    <dd>
                      {money(Number(entry.shipping_allocated_amount || 0))}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Total Basis
                    </dt>
                    <dd>{money(Number(entry.total_basis_amount || 0))}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-gray-500">
                      Dag Danky Holdings LLC Fee
                    </dt>
                    <dd>{money(Number(entry.platform_fee_amount || 0))}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {typedOrder.contains_seller_items ? (
        <section className="border rounded-lg p-4 mb-6 bg-amber-50 border-amber-200">
          <h2 className="text-lg font-bold">Seller Routing</h2>
          <p className="mt-2 text-sm font-semibold text-amber-900">
            This order contains {typedOrder.seller_item_count || 0} seller-routed item(s) and {typedOrder.store_item_count || 0} store-owned item(s).
          </p>
        </section>
      ) : null}

      {typedOrder.contains_seller_items ? (
        <section className="border rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Seller Payout Ledger</h2>

          {payoutLedgerError ? (
            <p className="text-red-600">
              Payout ledger unavailable: {payoutLedgerError.message}
            </p>
          ) : sellerPayoutLedger.length === 0 ? (
            <p className="text-gray-600">
              No seller payout ledger entries have been created for this order yet.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-500">
                    Dag Danky Holdings LLC Fee Total
                  </p>
                  <p className="text-2xl font-bold">
                    {money(platformFeeTotal)}
                  </p>
                </div>

                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-500">
                    Seller Payable Total
                  </p>
                  <p className="text-2xl font-bold">
                    {money(sellerPayoutTotal)}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {sellerPayoutLedger.map((entry) => (
                  <div key={entry.id} className="rounded border p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-bold">
                          Seller {entry.seller_account_id}
                        </p>
                        <p className="text-sm text-gray-600">
                          Order Item #{entry.order_item_id} -{" "}
                          {label(entry.payout_status)}
                        </p>
                      </div>

                      <p className="text-sm font-bold">
                        Rate{" "}
                        {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}
                        %
                      </p>
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                      <div>
                        <dt className="font-semibold text-gray-500">Gross</dt>
                        <dd>{money(Number(entry.gross_item_amount || 0))}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-500">
                          Shipping Basis
                        </dt>
                        <dd>
                          {money(Number(entry.shipping_allocated_amount || 0))}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-500">
                          Dag Danky Holdings LLC Fee
                        </dt>
                        <dd>{money(Number(entry.platform_fee_amount || 0))}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-gray-500">
                          Seller Payable
                        </dt>
                        <dd>
                          {money(Number(entry.seller_payable_amount || 0))}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 max-w-xs">
                      <PayoutLedgerActions
                        ledgerEntryId={entry.id}
                        status={entry.payout_status}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ) : null}

      <OrderReviewCasesPanel
        orderId={typedOrder.id}
        cases={orderReviewCases}
        sellerOptions={sellerOptions}
        payoutRows={sellerPayoutLedger}
        tableError={orderReviewCasesError?.message || null}
        caseEvents={orderReviewCaseEvents}
        eventsError={orderReviewCaseEventsError?.message || null}
      />

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Customer</h2>
        <p>Name: {typedOrder.customer_name || "Not saved"}</p>
        <p>Email: {typedOrder.customer_email || "No email"}</p>
        <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
          <h3 className="font-bold">Linked TCOS Account</h3>
          {accountProfile ? (
            <dl className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div>
                <dt className="font-semibold text-gray-500">Account Email</dt>
                <dd className="break-words">
                  {accountProfile.email || "Not saved"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Display Name</dt>
                <dd>{accountProfile.display_name || "Not saved"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Status</dt>
                <dd>{label(accountProfile.account_status)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Account Type</dt>
                <dd>{label(accountProfile.default_account_type)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="font-semibold text-gray-500">Account ID</dt>
                <dd className="break-all">{accountProfile.id}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              {typedOrder.account_id
                ? "This order has an account ID, but the account profile could not be loaded."
                : "Guest checkout. No TCOS account was linked to this order."}
            </p>
          )}
        </div>

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
                  <p className="text-xs font-semibold text-gray-500">
                    Owner: {item.seller_account_id || "Store inventory"}
                  </p>
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
        <h2 className="text-2xl font-bold mb-4">Chargeback Evidence</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-bold mb-2">Terms And Identity</h3>
            <p>TOS Accepted: {typedOrder.tos_accepted ? "Yes" : "No"}</p>
            <p>Version: {typedOrder.tos_version || "Not saved"}</p>
            <p>
              Accepted At:{" "}
              {typedOrder.tos_accepted_at
                ? new Date(typedOrder.tos_accepted_at).toLocaleString()
                : "Not saved"}
            </p>
            <p>IP Address: {typedOrder.tos_ip_address || "Not saved"}</p>
            <p>IP Risk: {typedOrder.tos_ip_risk || "Not saved"}</p>
            <p>
              Block Reason: {typedOrder.tos_ip_block_reason || "None saved"}
            </p>
            <p className="break-all">
              Acceptance Event:{" "}
              {typedOrder.tos_acceptance_event_id || "Not saved"}
            </p>
          </div>

          <div>
            <h3 className="font-bold mb-2">Evidence Packet</h3>

            {evidenceError ? (
              <p className="text-red-600">
                Evidence table unavailable: {evidenceError.message}
              </p>
            ) : latestEvidence ? (
              <>
                <p>Status: {latestEvidence.status || "ready"}</p>
                <p>
                  Created:{" "}
                  {new Date(latestEvidence.created_at).toLocaleString()}
                </p>
                <p>
                  Last Updated:{" "}
                  {latestEvidence.updated_at
                    ? new Date(latestEvidence.updated_at).toLocaleString()
                    : "Not saved"}
                </p>
                <p>
                  Email:{" "}
                  {latestEvidence.email_sent_at
                    ? `Sent to ${latestEvidence.emailed_to}`
                    : latestEvidence.email_error || "Not sent"}
                </p>

                <a
                  href={`/api/admin/files/${latestEvidence.id}/download`}
                  className="inline-block mt-4 border rounded px-4 py-2"
                >
                  Download Evidence PDF
                </a>
              </>
            ) : (
              <p className="text-gray-600">
                No evidence packet has been created for this order yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="border rounded-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Add Tracking</h2>

        <TrackingForm
          orderId={typedOrder.id}
          currentCarrier={typedOrder.carrier || ""}
          currentTrackingNumber={typedOrder.tracking_number || ""}
          canMarkShipped={!needsReview}
          reviewMessage={needsReview ? reviewMessage : undefined}
        />
      </section>

      <section className="border rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Actions</h2>

        <div className="flex flex-wrap gap-4">
          <Link
            href="/admin/files"
            className="border rounded px-4 py-2"
          >
            Evidence Files
          </Link>

          <Link
            href={`/admin/orders/${typedOrder.id}/packing-slip`}
            className="border rounded px-4 py-2"
          >
            Print Packing Slip
          </Link>
        </div>
      </section>
    </main>
  );
}

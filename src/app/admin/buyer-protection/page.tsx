import Link from "next/link";
import ClaimActions from "./ClaimActions";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function label(value: string | null | undefined) {
  return String(value || "not_set").replaceAll("_", " ").toUpperCase();
}

export default async function AdminBuyerProtectionPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data: claims, error } = await supabase
    .from("buyer_protection_claims")
    .select(
      "id,protection_id,order_id,account_id,status,reason,buyer_statement,submitted_at,reviewed_at,decision_note,reimbursement_amount,stripe_refund_id,reimbursed_at,metadata,created_at",
    )
    .eq("store_id", storeId)
    .order("submitted_at", { ascending: true });

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-black">Buyer Protection Claims</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 font-bold text-red-950">
          {error.message}
        </p>
      </main>
    );
  }

  const claimRows = claims || [];
  const protectionIds = claimRows.map((claim) => String(claim.protection_id));
  const orderIds = claimRows.map((claim) => Number(claim.order_id));
  const [protectionsResult, ordersResult] = await Promise.all([
    protectionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("order_buyer_protections")
          .select(
            "id,status,fee_amount,covered_item_amount,policy_version,terms_accepted_at,consent_source,preference_mode,shipped_at,earliest_claim_at,claim_deadline_at",
          )
          .eq("store_id", storeId)
          .in("id", protectionIds),
    orderIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("orders")
          .select(
            "id,customer_email,customer_name,total,subtotal,shipping_amount,shipping_name,tracking_number,carrier,shipped_at,is_test,stripe_payment_intent_id",
          )
          .eq("store_id", storeId)
          .in("id", orderIds),
  ]);

  const protectionsById = new Map(
    (protectionsResult.data || []).map((row) => [String(row.id), row]),
  );
  const ordersById = new Map(
    (ordersResult.data || []).map((row) => [Number(row.id), row]),
  );
  const openCount = claimRows.filter((claim) =>
    ["submitted", "under_review", "approved"].includes(claim.status),
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-violet-700">
            Truely Collectables reimbursement program
          </p>
          <h1 className="mt-2 text-4xl font-black">Buyer Protection Claims</h1>
          <p className="mt-2 text-neutral-600">
            {openCount} open claim{openCount === 1 ? "" : "s"}. Reimburse only the
            protected item amount; shipping and the $0.75 fee remain excluded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/orders"
            className="rounded border border-neutral-300 px-4 py-3 font-black"
          >
            Orders
          </Link>
          <Link
            href="/admin/shipping"
            className="rounded bg-neutral-950 px-4 py-3 font-black text-white"
          >
            Shipping Evidence
          </Link>
        </div>
      </section>

      {claimRows.length === 0 ? (
        <p className="mt-6 rounded border bg-white p-6 text-neutral-600">
          No Buyer Protection claims have been submitted.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          {claimRows.map((claim) => {
            const protection = protectionsById.get(String(claim.protection_id));
            const order = ordersById.get(Number(claim.order_id));

            return (
              <article key={claim.id} className="rounded border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
                      Claim {claim.id}
                    </p>
                    <h2 className="mt-1 text-2xl font-black">
                      Order #{claim.order_id} · {label(claim.status)}
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-neutral-600">
                      {order?.customer_name || order?.customer_email || "Buyer"} ·
                      Submitted {dateLabel(claim.submitted_at)}
                    </p>
                  </div>
                  <Link
                    href={`/admin/orders/${claim.order_id}`}
                    className="rounded border border-neutral-300 px-3 py-2 text-sm font-black"
                  >
                    Open Order
                  </Link>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded bg-neutral-50 p-3">
                    <p className="text-xs font-black uppercase text-neutral-500">Protected</p>
                    <p className="mt-1 text-xl font-black">
                      {money(protection?.covered_item_amount)}
                    </p>
                  </div>
                  <div className="rounded bg-neutral-50 p-3">
                    <p className="text-xs font-black uppercase text-neutral-500">Shipped</p>
                    <p className="mt-1 font-bold">{dateLabel(protection?.shipped_at)}</p>
                  </div>
                  <div className="rounded bg-neutral-50 p-3">
                    <p className="text-xs font-black uppercase text-neutral-500">Earliest</p>
                    <p className="mt-1 font-bold">
                      {dateLabel(protection?.earliest_claim_at)}
                    </p>
                  </div>
                  <div className="rounded bg-neutral-50 p-3">
                    <p className="text-xs font-black uppercase text-neutral-500">Deadline</p>
                    <p className="mt-1 font-bold">
                      {dateLabel(protection?.claim_deadline_at)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4">
                  <p className="font-black">Buyer statement</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {claim.buyer_statement || "No statement saved."}
                  </p>
                </div>

                {order?.tracking_number ? (
                  <p className="mt-4 text-sm font-semibold text-neutral-700">
                    {order.carrier || "Carrier"}: {order.tracking_number}
                  </p>
                ) : null}

                {claim.decision_note ? (
                  <p className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-950">
                    Decision note: {claim.decision_note}
                  </p>
                ) : null}

                {claim.stripe_refund_id ? (
                  <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-950">
                    Reimbursed {money(claim.reimbursement_amount)} · Stripe refund {claim.stripe_refund_id}
                  </p>
                ) : null}

                <ClaimActions claimId={String(claim.id)} status={claim.status} />
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

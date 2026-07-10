import Link from "next/link";
import type { ReactNode } from "react";
import { getShippingProviderReadiness } from "../../../lib/shipping-provider-readiness";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import ShippingClaimActions from "./ShippingClaimActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShippingLabelRow = {
  id: string;
  order_id: number;
  provider: string | null;
  provider_service: string | null;
  service_level: string | null;
  carrier: string | null;
  tracking_number: string | null;
  label_status: string | null;
  requested_shipping_method: string | null;
  resolved_shipping_method: string | null;
  coverage_provider: string | null;
  coverage_status: string | null;
  coverage_amount: number | string | null;
  coverage_policy_id: string | null;
  postage_amount: number | string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

type OrderRow = {
  id: number;
  customer_email: string | null;
  total: number | string | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  shipping_method: string | null;
  tracking_number: string | null;
  carrier: string | null;
  created_at: string;
};

type TrackingEventRow = {
  id: string;
  order_id: number;
  shipping_label_id: string | null;
  provider: string | null;
  carrier: string | null;
  tracking_number: string | null;
  event_type: string | null;
  event_code: string | null;
  event_status: string | null;
  message: string | null;
  location: string | null;
  occurred_at: string;
};

type CoverageClaimRow = {
  id: string;
  order_id: number;
  shipping_label_id: string | null;
  provider: string | null;
  provider_claim_id: string | null;
  claim_status: string | null;
  claim_type: string | null;
  claim_amount: number | string | null;
  reason: string | null;
  created_at: string;
};

function money(value: number | string | null | undefined) {
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

function statusTone(status: string | null | undefined) {
  if (
    status === "ready" ||
    status === "covered" ||
    status === "purchased" ||
    status === "printed" ||
    status === "shipped" ||
    status === "delivered"
  ) {
    return "border-green-200 bg-green-50 text-green-900";
  }

  if (
    status === "planned" ||
    status === "purchase_pending" ||
    status === "required_at_label_purchase" ||
    status === "rate_selected" ||
    status === "submitted" ||
    status === "under_review"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (
    status === "blocked" ||
    status === "failed" ||
    status === "claim_denied" ||
    status === "denied" ||
    status === "voided"
  ) {
    return "border-red-200 bg-red-50 text-red-900";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-800";
}

function orderFor(
  ordersById: Map<number, OrderRow>,
  labelRow: Pick<ShippingLabelRow, "order_id">,
) {
  return ordersById.get(labelRow.order_id) || null;
}

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function standardEnvelopePolicyNote(row: ShippingLabelRow) {
  const reason =
    metadataText(row.metadata, "shipping_policy_reason") ||
    metadataText(row.metadata, "standard_envelope_reason");
  const estimatedOz = metadataNumber(row.metadata, "standard_envelope_estimated_oz");

  if (!reason && row.requested_shipping_method === row.resolved_shipping_method) {
    return null;
  }

  const transition =
    row.requested_shipping_method && row.resolved_shipping_method
      ? `${label(row.requested_shipping_method)} -> ${label(row.resolved_shipping_method)}`
      : null;

  return [transition, estimatedOz ? `${estimatedOz} estimated oz` : null, reason]
    .filter(Boolean)
    .join(" / ");
}

export default async function AdminShippingPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const providerReadiness = getShippingProviderReadiness();

  const [labelsResult, eventsResult, claimsResult] = await Promise.all([
    supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,provider,provider_service,service_level,carrier,tracking_number,label_status,requested_shipping_method,resolved_shipping_method,coverage_provider,coverage_status,coverage_amount,coverage_policy_id,postage_amount,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("order_shipping_tracking_events")
      .select(
        "id,order_id,shipping_label_id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at",
      )
      .eq("store_id", storeId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("order_shipping_coverage_claims")
      .select(
        "id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,claim_type,claim_amount,reason,created_at",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const labels = labelsResult.error
    ? []
    : ((labelsResult.data || []) as ShippingLabelRow[]);
  const events = eventsResult.error
    ? []
    : ((eventsResult.data || []) as TrackingEventRow[]);
  const claims = claimsResult.error
    ? []
    : ((claimsResult.data || []) as CoverageClaimRow[]);
  const orderIds = Array.from(
    new Set([
      ...labels.map((row) => row.order_id),
      ...events.map((row) => row.order_id),
      ...claims.map((row) => row.order_id),
    ]),
  );
  const ordersResult =
    orderIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("orders")
          .select(
            "id,customer_email,total,status,fulfillment_status,shipping_name,shipping_method,tracking_number,carrier,created_at",
          )
          .eq("store_id", storeId)
          .in("id", orderIds);
  const ordersById = new Map(
    ((ordersResult.data || []) as OrderRow[]).map((order) => [order.id, order]),
  );

  const plannedLabels = labels.filter((row) => row.label_status === "planned");
  const pendingPurchases = labels.filter((row) =>
    ["purchase_pending", "rate_selected"].includes(row.label_status || ""),
  );
  const purchasedLabels = labels.filter((row) =>
    ["purchased", "printed"].includes(row.label_status || ""),
  );
  const voidedLabels = labels.filter((row) => row.label_status === "voided");
  const coveragePending = labels.filter((row) =>
    ["required_at_label_purchase", "purchase_pending"].includes(
      row.coverage_status || "",
    ),
  );
  const blockedEvents = events.filter(
    (event) => event.event_type === "provider_purchase_blocked",
  );
  const manualRecordEvents = events.filter((event) =>
    ["manual_label_purchase_recorded", "manual_label_void_recorded"].includes(
      event.event_type || "",
    ),
  );
  const replacementNeededLabels = voidedLabels.filter((row) => {
    const hasNewerActiveLabel = labels.some(
      (candidate) =>
        candidate.order_id === row.order_id &&
        candidate.id !== row.id &&
        candidate.created_at > row.created_at &&
        !["voided", "failed"].includes(candidate.label_status || ""),
    );

    return !hasNewerActiveLabel;
  });
  const openClaims = claims.filter(
    (claim) =>
      !["paid", "denied", "cancelled"].includes(claim.claim_status || "draft"),
  );

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              Shipping operations
            </p>
            <h1 className="mt-2 text-4xl font-black">
              Label + Coverage Control
            </h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              One queue for Standard Envelope, Ground Advantage, Priority labels,
              Coverage protection, tracking events, and shipping claims.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin" className="rounded border bg-white px-4 py-2">
              Command Center
            </Link>
            <Link href="/admin/orders" className="rounded border bg-white px-4 py-2">
              Fulfillment
            </Link>
            <Link
              href="/admin/launch-readiness"
              className="rounded border bg-white px-4 py-2"
            >
              Readiness
            </Link>
          </div>
        </div>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <Metric label="Planned Labels" value={plannedLabels.length} />
          <Metric label="Purchase Pending" value={pendingPurchases.length} />
          <Metric label="Purchased / Printed" value={purchasedLabels.length} />
          <Metric label="Voided Labels" value={voidedLabels.length} />
          <Metric label="Coverage Pending" value={coveragePending.length} />
          <Metric label="Open Claims" value={openClaims.length} />
        </section>

        <section className="rounded border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Provider Readiness</h2>
              <p className="mt-1 text-sm text-neutral-600">
                These determine whether the order cockpit can move from audit
                record to real label/coverage purchase.
              </p>
            </div>
            <span
              className={`rounded border px-3 py-1 text-sm font-black ${
                providerReadiness.every((item) => item.status === "ready")
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {providerReadiness.filter((item) => item.status === "ready").length}
              /{providerReadiness.length} ready
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {providerReadiness.map((item) => (
              <article
                key={item.key}
                className={`rounded border p-4 ${statusTone(item.status)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-black">{item.label}</h3>
                  <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
                    {label(item.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold">{item.detail}</p>
                <p className="mt-2 text-xs font-bold">{item.action}</p>
              </article>
            ))}
          </div>
        </section>

        {(labelsResult.error || eventsResult.error || claimsResult.error) ? (
          <section className="rounded border border-red-200 bg-red-50 p-5 text-red-950">
            <h2 className="font-black">Shipping tables need attention</h2>
            <p className="mt-2 text-sm font-semibold">
              {labelsResult.error?.message ||
                eventsResult.error?.message ||
                claimsResult.error?.message}
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded border bg-white">
            <div className="border-b p-5">
              <h2 className="text-2xl font-black">Label Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Latest prepared or provider-attempted label records.
              </p>
            </div>

            <div className="divide-y">
              {labels.length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">
                  No shipping label records have been prepared yet.
                </p>
              ) : (
                labels.map((row) => {
                  const order = orderFor(ordersById, row);
                  const policyNote = standardEnvelopePolicyNote(row);

                  return (
                    <article
                      key={row.id}
                      className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/orders/${row.order_id}`}
                            className="text-lg font-black underline"
                          >
                            Order #{row.order_id}
                          </Link>
                          <span
                            className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                              row.label_status,
                            )}`}
                          >
                            {label(row.label_status)}
                          </span>
                          <span
                            className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                              row.coverage_status,
                            )}`}
                          >
                            Coverage {label(row.coverage_status)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-neutral-600">
                          {order?.customer_email || "No customer email"} /{" "}
                          {row.provider_service || order?.shipping_name || "Shipping"}
                        </p>
                        {policyNote ? (
                          <p className="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-sm font-semibold text-blue-950">
                            {policyNote}
                          </p>
                        ) : null}
                        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-4">
                          <Info label="Provider" value={row.provider || "Pending"} />
                          <Info
                            label="Requested"
                            value={label(row.requested_shipping_method)}
                          />
                          <Info
                            label="Resolved"
                            value={label(row.resolved_shipping_method)}
                          />
                          <Info
                            label="Carrier"
                            value={row.carrier || order?.carrier || "Pending"}
                          />
                          <Info
                            label="Tracking"
                            value={
                              row.tracking_number ||
                              order?.tracking_number ||
                              "Pending"
                            }
                          />
                          <Info label="Postage" value={money(row.postage_amount)} />
                          <Info
                            label="Coverage"
                            value={`${row.coverage_provider || "Coverage"} ${money(
                              row.coverage_amount,
                            )}`}
                          />
                          <Info
                            label="Policy"
                            value={row.coverage_policy_id || "Pending"}
                          />
                          <Info label="Order Total" value={money(order?.total)} />
                          <Info label="Updated" value={shortDate(row.updated_at || row.created_at)} />
                        </dl>
                      </div>

                      <div className="flex items-start lg:justify-end">
                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <a
                            href={`/api/admin/shipping-labels/${row.id}/packet`}
                            className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-950"
                          >
                            Label Packet
                          </a>
                          <Link
                            href={`/admin/orders/${row.order_id}`}
                            className="rounded bg-neutral-950 px-4 py-2 text-sm font-black text-white"
                          >
                            Open Order
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <Panel title="Blocked Purchase Attempts">
              {blockedEvents.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No blocked provider-purchase attempts recorded.
                </p>
              ) : (
                blockedEvents.slice(0, 8).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))
              )}
            </Panel>

            <Panel title="Manual Shipping Records">
              {manualRecordEvents.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No manual label purchases or external voids recorded.
                </p>
              ) : (
                manualRecordEvents.slice(0, 8).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))
              )}
            </Panel>

            <Panel title="Replacement Needed">
              {replacementNeededLabels.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No voided labels are waiting for a replacement.
                </p>
              ) : (
                replacementNeededLabels.slice(0, 8).map((row) => {
                  const order = orderFor(ordersById, row);

                  return (
                    <div key={row.id} className="border-b py-3 last:border-b-0">
                      <Link
                        href={`/admin/orders/${row.order_id}`}
                        className="font-bold underline"
                      >
                        Order #{row.order_id}
                      </Link>
                      <p className="mt-1 text-sm text-neutral-600">
                        {order?.customer_email || "No customer email"} /{" "}
                        {row.provider_service || order?.shipping_name || "Shipping"}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-red-900">
                        Label was voided and no newer active label is recorded.
                      </p>
                      <p className="mt-1 text-xs font-bold text-neutral-500">
                        Voided record updated {shortDate(row.updated_at || row.created_at)}
                      </p>
                    </div>
                  );
                })
              )}
            </Panel>

            <Panel title="Coverage Claims">
              {claims.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  No coverage claims opened.
                </p>
              ) : (
                claims.slice(0, 8).map((claim) => (
                  <div key={claim.id} className="border-b py-3 last:border-b-0">
                    <Link
                      href={`/admin/orders/${claim.order_id}`}
                      className="font-bold underline"
                    >
                      Order #{claim.order_id}
                    </Link>
                    <p className="mt-1 text-sm text-neutral-600">
                      {label(claim.claim_type)} / {money(claim.claim_amount)}
                    </p>
                    <p
                      className={`mt-2 inline-block rounded border px-2 py-1 text-xs font-black ${statusTone(
                        claim.claim_status,
                      )}`}
                    >
                      {label(claim.claim_status)}
                    </p>
                    {claim.reason ? (
                      <p className="mt-2 text-sm">{claim.reason}</p>
                    ) : null}
                    <ShippingClaimActions
                      claimId={claim.id}
                      claimStatus={claim.claim_status}
                      providerClaimId={claim.provider_claim_id}
                    />
                  </div>
                ))
              )}
            </Panel>
          </aside>
        </section>

        <section className="rounded border bg-white">
          <div className="border-b p-5">
            <h2 className="text-2xl font-black">Recent Tracking Events</h2>
          </div>
          <div className="grid grid-cols-1 gap-0 divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="divide-y">
              {events.slice(0, 12).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
              {events.length === 0 ? (
                <p className="p-5 text-sm text-neutral-600">
                  No shipping tracking events yet.
                </p>
              ) : null}
            </div>
            <div className="p-5">
              <h3 className="font-black">What this page is for</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-700">
                <li>Find labels stuck at planned or purchase pending.</li>
                <li>See when provider purchase is blocked by missing secrets.</li>
                <li>Audit manually purchased labels and externally voided labels.</li>
                <li>Spot voided shipments that still need replacement labels.</li>
                <li>Watch Coverage claim work without opening each order.</li>
                <li>Jump straight into the order cockpit to resolve shipping.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border bg-white p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-neutral-500">{label}</dt>
      <dd className="break-words font-bold">{value}</dd>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border bg-white p-5">
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EventCard({ event }: { event: TrackingEventRow }) {
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/admin/orders/${event.order_id}`} className="font-bold underline">
          Order #{event.order_id}
        </Link>
        <span
          className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
            event.event_status,
          )}`}
        >
          {label(event.event_status)}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold">{label(event.event_type)}</p>
      <p className="mt-1 text-sm text-neutral-600">
        {event.message || event.event_code || "Tracking update"}
      </p>
      <p className="mt-2 text-xs font-bold text-neutral-500">
        {shortDate(event.occurred_at)}
        {event.location ? ` / ${event.location}` : ""}
      </p>
    </div>
  );
}

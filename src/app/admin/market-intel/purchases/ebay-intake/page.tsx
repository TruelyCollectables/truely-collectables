import Link from "next/link";
import AdminSubmitButton from "../../../AdminSubmitButton";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../lib/admin-session";
import { getEbayPurchaseInbox } from "../../../../../lib/market-intel-ebay-purchase-inbox";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    added?: string;
    order?: string;
    moved?: string;
    skipped?: string;
    reconnect?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function bucketLabel(value: string) {
  if (value === "hold") return "HOLD / INVESTMENT";
  if (value === "resale") return "RESALE";
  return value.toUpperCase();
}

export default async function EbayPurchaseIntakePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM] || (await createAdminSessionValue());
  const adminHref = (href: string) => addAdminHandoff(href, handoff);
  let rows = [] as Awaited<ReturnType<typeof getEbayPurchaseInbox>>;
  let loadError: string | null = null;

  try {
    rows = await getEbayPurchaseInbox();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load Purchase Inbox.";
  }

  const pending = rows.filter((row) => row.status === "pending");
  const moved = rows.filter((row) => row.status === "moved_to_review");
  const recorded = rows.filter((row) => row.status === "recorded");
  const addedCount = Math.max(0, Number(query?.added || 0));

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={adminHref("/admin/market-intel/purchases")}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Purchase Ledger
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-lime-300">
            TCOS Market Intel™
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">eBay Purchase Inbox</h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Paste an eBay order-details link and TCOS imports the purchased line items and
            receipt totals from the connected buyer account before exact-card review.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {addedCount > 0 ? (
          <Notice>
            Added {addedCount} eBay purchase {addedCount === 1 ? "item" : "items"}
            {query?.order ? ` from order ${query.order}` : ""} to the inbox.
          </Notice>
        ) : null}
        {query?.moved ? (
          <Notice>
            {query.moved} purchase row(s) moved to exact-card review. {" "}
            <Link href="#moved-to-review" className="underline">
              Open moved purchases
            </Link>
            .
          </Notice>
        ) : null}
        {query?.skipped ? <Notice>{query.skipped} row(s) skipped.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        {query?.reconnect ? (
          <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-2xl font-black">Reconnect the eBay buying account</h2>
            <p className="mt-2 font-semibold leading-6">
              The saved eBay authorization does not include buyer-order access yet. Reconnect
              once, approve the updated permission, then return here and paste the same order
              link again.
            </p>
            <Link
              href={adminHref("/api/ebay/auth")}
              className="mt-4 inline-flex rounded-md bg-black px-4 py-3 font-black text-white"
            >
              Connect / Reconnect eBay
            </Link>
          </section>
        ) : null}

        {loadError ? (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-2xl font-black">Purchase Inbox database setup required</h2>
            <p className="mt-2 font-semibold">{loadError}</p>
            <p className="mt-3 text-sm font-bold">
              Run <code>supabase/migrations/20260718_tcos_market_intel_ebay_purchase_inbox.sql</code>
              once in the Supabase SQL Editor, then reload this page. The import button stays
              disabled until the table exists.
            </p>
          </section>
        ) : null}

        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
          <h2 className="text-2xl font-black">One link for a private eBay order</h2>
          <p className="mt-2 font-semibold leading-6">
            Paste an <code>order.ebay.com/ord/show?orderId=...</code> link or the order number.
            TCOS uses the connected eBay buyer authorization to retrieve the item ID, title,
            quantity, purchase date, subtotal, shipping, tax, and amount paid. Public listing
            URLs still work as a manual receipt fallback.
          </p>
          <div className="mt-3">
            <Link href={adminHref("/api/ebay/auth")} className="font-black underline">
              Connect or refresh eBay buyer access
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-800">
            Add purchase
          </p>
          <h2 className="mt-1 text-3xl font-black">Paste the eBay order link</h2>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            For an order-details link, the receipt fields below are filled from eBay and their
            typed defaults are ignored. Use them only when entering a public listing URL.
          </p>
          <form
            method="post"
            action={adminHref("/api/admin/market-intel/purchases/ebay-intake")}
            className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          >
            <input type="hidden" name="action" value="add" />
            <Field
              name="ebayItem"
              label="eBay order link, order number, listing URL, or item number"
              required
              placeholder="https://order.ebay.com/ord/show?orderId=14-14906-11959..."
              className="md:col-span-2 xl:col-span-2"
            />
            <Field
              name="playerName"
              label="Player correction (optional — TCOS auto-detects)"
            />
            <label className="text-sm font-black">
              Sport/category
              <select name="sportOrCategory" defaultValue="Baseball" className={inputClass}>
                <option>Baseball</option>
                <option>Basketball</option>
                <option>Football</option>
                <option>Hockey</option>
                <option>Other Sports Card</option>
              </select>
            </label>
            <Field name="externalOrderId" label="Order number override (optional)" />
            <Field
              name="purchaseDate"
              label="Purchase date — listing fallback"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
            <Field
              name="quantity"
              label="Quantity — listing fallback"
              type="number"
              required
              defaultValue="1"
              min="1"
            />
            <label className="text-sm font-black">
              Initial bucket
              <select name="targetBucket" defaultValue="resale" className={inputClass}>
                <option value="resale">Resale</option>
                <option value="hold">Hold / Investment</option>
                <option value="skip">Skip</option>
              </select>
            </label>
            <Field name="itemSubtotal" label="Item subtotal — fallback" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="inboundShipping" label="Shipping — fallback" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="salesTax" label="Sales tax — fallback" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="buyerFees" label="Buyer fees — fallback" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="otherCost" label="Other cost — fallback" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <AdminSubmitButton
              className="rounded-md bg-lime-700 px-4 py-3 font-black text-white md:col-span-2 xl:col-span-3"
              pendingChildren="Importing eBay purchase..."
              disabled={Boolean(loadError)}
              disabledReason={loadError ? "Install the Purchase Inbox database migration first." : undefined}
              title="Import the eBay order into Purchase Inbox only; exact-card review and ledger recording happen after this step."
            >
              Import eBay Purchase
            </AdminSubmitButton>
            <p className="text-xs font-bold text-neutral-600 md:col-span-2 xl:col-span-3">
              Import creates pending inbox rows from the receipt. Nothing reaches the Purchase Ledger
              until exact identity is confirmed and Record as Purchased is used.
            </p>
          </form>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="Pending Review" value={String(pending.length)} />
          <Metric label="Moved to Exact Review" value={String(moved.length)} href="#moved-to-review" />
          <Metric label="Recorded Purchases" value={String(recorded.length)} />
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Pending Purchase Inbox</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Select purchases, then move them to Resale or Hold/Investment exact-card review.
            </p>
          </div>

          {pending.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No pending eBay purchases.</p>
          ) : (
            <form method="post" action={adminHref("/api/admin/market-intel/purchases/ebay-intake")}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Select</th>
                      <th className="px-4 py-3">Purchase</th>
                      <th className="px-4 py-3">Player</th>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3">Shipping</th>
                      <th className="px-4 py-3">Tax</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Current bucket</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {pending.map((row) => (
                      <tr key={row.id} className="align-top hover:bg-amber-50/40">
                        <td className="px-4 py-4">
                          <input type="checkbox" name="inboxIds" value={row.id} className="h-5 w-5" />
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-black">{new Date(row.purchased_at).toLocaleDateString()}</p>
                          <p className="mt-1 text-xs text-neutral-500">Qty {row.quantity}</p>
                          {row.external_order_id ? (
                            <p className="mt-1 text-xs font-bold text-neutral-600">Order {row.external_order_id}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 font-black">{row.player_name}</td>
                        <td className="max-w-md px-4 py-4">
                          <a
                            href={row.direct_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-blue-700 hover:underline"
                          >
                            {row.title}
                          </a>
                        </td>
                        <td className="px-4 py-4">{money(row.inbound_shipping)}</td>
                        <td className="px-4 py-4">{money(row.sales_tax)}</td>
                        <td className="px-4 py-4 font-black">{money(row.total_paid)}</td>
                        <td className="px-4 py-4 font-bold">{bucketLabel(row.target_bucket)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 border-t border-neutral-200 bg-neutral-50 p-4">
                <AdminSubmitButton
                  name="action"
                  value="move_resale"
                  className="rounded-md bg-blue-700 px-4 py-3 font-black text-white"
                  pendingChildren="Moving to resale..."
                  title="Move selected pending purchase rows into Resale exact-card review without recording them in the ledger yet."
                >
                  Move Selected to Resale Review
                </AdminSubmitButton>
                <AdminSubmitButton
                  name="action"
                  value="move_hold"
                  className="rounded-md bg-fuchsia-800 px-4 py-3 font-black text-white"
                  pendingChildren="Moving to hold review..."
                  title="Move selected pending purchase rows into Hold / Investment exact-card review without recording them in the ledger yet."
                >
                  Move Selected to Hold / Investment Review
                </AdminSubmitButton>
                <AdminSubmitButton
                  name="action"
                  value="skip"
                  className="rounded-md border border-neutral-400 bg-white px-4 py-3 font-black"
                  pendingChildren="Skipping selected..."
                  title="Skip selected pending purchase rows so they leave the active review queue without creating ledger records."
                >
                  Skip Selected
                </AdminSubmitButton>
                <p className="w-full text-xs font-bold text-neutral-600">
                  Select at least one row. Moving sends rows to exact-card review; skipping removes
                  them from pending review without creating Purchase Ledger entries.
                </p>
              </div>
            </form>
          )}
        </section>

        <section
          id="moved-to-review"
          className="overflow-hidden rounded-xl border border-fuchsia-300 bg-white shadow-sm scroll-mt-6"
        >
          <div className="flex flex-col gap-3 border-b border-fuchsia-200 bg-fuchsia-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-800">
                Exact-card queue
              </p>
              <h2 className="mt-1 text-2xl font-black">Ready for Exact Review</h2>
              <p className="mt-1 text-sm font-semibold text-neutral-700">
                These purchases have not reached the Purchase Ledger yet. Open each card,
                confirm its exact identity, then use Record as Purchased.
              </p>
            </div>
            <Link
              href={adminHref("/admin/market-intel/discovery?from=purchase-inbox")}
              className="inline-flex rounded-md border border-fuchsia-800 bg-white px-4 py-3 text-center font-black text-fuchsia-900"
            >
              Open Full Exact Review Queue
            </Link>
          </div>

          {moved.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No purchases are waiting in exact review.</p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {moved.map((row) => (
                <article
                  key={row.id}
                  className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-fuchsia-300 bg-fuchsia-100 px-3 py-1 text-xs font-black text-fuchsia-950">
                        {bucketLabel(row.target_bucket)}
                      </span>
                      <span className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1 text-xs font-black">
                        {money(row.total_paid)} total
                      </span>
                      {row.external_order_id ? (
                        <span className="text-xs font-bold text-neutral-600">Order {row.external_order_id}</span>
                      ) : null}
                    </div>
                    <h3 className="mt-3 text-xl font-black">{row.player_name}</h3>
                    <a
                      href={row.direct_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate font-bold text-blue-700 hover:underline"
                    >
                      {row.title}
                    </a>
                  </div>

                  {row.identity_candidate_id ? (
                    <Link
                      href={adminHref(
                        `/admin/market-intel/discovery?from=purchase-inbox#candidate-${row.identity_candidate_id}`,
                      )}
                      className="inline-flex min-w-[190px] justify-center rounded-md bg-fuchsia-900 px-4 py-3 font-black text-white"
                    >
                      Open Exact Review
                    </Link>
                  ) : (
                    <span className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-center text-sm font-black text-rose-950">
                      Review link missing — move again or report this row
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 font-semibold outline-none focus:border-black";

function Field({
  name,
  label,
  required = false,
  type = "text",
  defaultValue,
  placeholder,
  step,
  min,
  className = "",
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  step?: string;
  min?: string;
  className?: string;
}) {
  return (
    <label className={`text-sm font-black ${className}`}>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        step={step}
        min={min}
        className={inputClass}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </>
  );

  return href ? (
    <Link
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-fuchsia-400 hover:bg-fuchsia-50"
    >
      {content}
    </Link>
  ) : (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">{content}</div>
  );
}

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div
      className={
        error
          ? "rounded-xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950"
          : "rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-950"
      }
    >
      {children}
    </div>
  );
}

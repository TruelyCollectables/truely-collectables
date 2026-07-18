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
    moved?: string;
    skipped?: string;
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
            Paste purchases you already made on eBay, preserve item price, shipping, tax,
            and total paid, then route each card to Resale or Hold/Investment review.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.added ? (
          <Notice>Purchase added to the inbox.</Notice>
        ) : null}
        {query?.moved ? (
          <Notice>{query.moved} purchase row(s) moved to exact-card review.</Notice>
        ) : null}
        {query?.skipped ? <Notice>{query.skipped} row(s) skipped.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        {loadError ? (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-2xl font-black">Purchase Inbox migration required</h2>
            <p className="mt-2 font-semibold">{loadError}</p>
            <p className="mt-3 text-sm font-bold">
              Apply <code>supabase/migrations/20260718_tcos_market_intel_ebay_purchase_inbox.sql</code> in Supabase SQL Editor, then reload.
            </p>
          </section>
        ) : null}

        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
          <h2 className="text-2xl font-black">Why this is manual</h2>
          <p className="mt-2 font-semibold leading-6">
            eBay does not expose a list endpoint for ordinary personal Purchase History.
            Paste the item URL or item number and the exact receipt amounts here. TCOS
            pulls the listing details and stages the card for exact identity review.
          </p>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-800">
            Add purchase
          </p>
          <h2 className="mt-1 text-3xl font-black">Paste an eBay purchase</h2>
          <form
            method="post"
            action={adminHref("/api/admin/market-intel/purchases/ebay-intake")}
            className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          >
            <input type="hidden" name="action" value="add" />
            <Field name="ebayItem" label="eBay item URL or item number" required className="md:col-span-2 xl:col-span-2" />
            <Field name="playerName" label="Player name" required />
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
            <Field name="externalOrderId" label="eBay order number (optional)" />
            <Field name="purchaseDate" label="Purchase date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            <Field name="quantity" label="Quantity" type="number" required defaultValue="1" min="1" />
            <label className="text-sm font-black">
              Initial bucket
              <select name="targetBucket" defaultValue="resale" className={inputClass}>
                <option value="resale">Resale</option>
                <option value="hold">Hold / Investment</option>
                <option value="skip">Skip</option>
              </select>
            </label>
            <Field name="itemSubtotal" label="Item subtotal" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="inboundShipping" label="Shipping" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="salesTax" label="Sales tax" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="buyerFees" label="Buyer fees" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <Field name="otherCost" label="Other cost" type="number" required defaultValue="0.00" step="0.01" min="0" />
            <AdminSubmitButton
              className="rounded-md bg-lime-700 px-4 py-3 font-black text-white md:col-span-2 xl:col-span-3"
              pendingChildren="Adding purchase..."
            >
              Add to Purchase Inbox
            </AdminSubmitButton>
          </form>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="Pending Review" value={String(pending.length)} />
          <Metric label="Moved to Exact Review" value={String(moved.length)} />
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
            <form method="post" action={adminHref("/api/admin/market-intel/purchases/ebay-intake") }>
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
                        </td>
                        <td className="px-4 py-4 font-black">{row.player_name}</td>
                        <td className="max-w-md px-4 py-4">
                          <a href={row.direct_url} target="_blank" rel="noreferrer" className="font-bold text-blue-700 hover:underline">
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
                >
                  Move Selected to Resale Review
                </AdminSubmitButton>
                <AdminSubmitButton
                  name="action"
                  value="move_hold"
                  className="rounded-md bg-fuchsia-800 px-4 py-3 font-black text-white"
                  pendingChildren="Moving to hold review..."
                >
                  Move Selected to Hold / Investment Review
                </AdminSubmitButton>
                <AdminSubmitButton
                  name="action"
                  value="skip"
                  className="rounded-md border border-neutral-400 bg-white px-4 py-3 font-black"
                  pendingChildren="Skipping selected..."
                >
                  Skip Selected
                </AdminSubmitButton>
              </div>
            </form>
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
  step,
  min,
  className = "",
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
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
        step={step}
        min={min}
        className={inputClass}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={error ? "rounded-xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950" : "rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-950"}>
      {children}
    </div>
  );
}

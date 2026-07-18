import Link from "next/link";
import { notFound } from "next/navigation";
import AdminSubmitButton from "../../../../AdminSubmitButton";
import PurchaseCostEditor, {
  type PurchaseCostEntryMode,
} from "../../PurchaseCostEditor";
import { addAdminHandoff } from "../../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../../lib/admin-session";
import {
  getEditableMarketIntelPurchase,
  type EditableAcquisitionChannel,
} from "../../../../../../lib/market-intel-purchase-editor";
import {
  purchasePortfolioBucket,
} from "../../../../../../lib/market-intel-purchase-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 font-semibold outline-none focus:border-black";

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function dateValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function acquisitionChannel(
  metadata: Record<string, unknown>,
  marketplaceSlug: string | null | undefined,
): EditableAcquisitionChannel {
  const value = textValue(metadata.acquisition_channel);
  if (
    [
      "ebay",
      "marketplace",
      "card_show",
      "card_shop",
      "private_deal",
      "trade",
      "other",
    ].includes(value)
  ) {
    return value as EditableAcquisitionChannel;
  }
  return marketplaceSlug === "ebay" ? "ebay" : marketplaceSlug ? "marketplace" : "other";
}

function costEntryMode(metadata: Record<string, unknown>): PurchaseCostEntryMode {
  return metadata.cost_entry_mode === "per_item" ? "per_item" : "lot_total";
}

export default async function EditPurchasePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const handoff = await createAdminSessionValue();
  const adminHref = (href: string) => addAdminHandoff(href, handoff);
  const purchase = await getEditableMarketIntelPurchase(id);
  if (!purchase) notFound();

  const metadata = purchase.metadata;
  const bucket = purchasePortfolioBucket(metadata);
  const channel = acquisitionChannel(metadata, purchase.marketplace?.slug);
  const sourceName =
    textValue(metadata.acquisition_source_name) || purchase.marketplace?.name || "";
  const sourceLocation = textValue(metadata.acquisition_location);
  const externalOrderId = textValue(metadata.external_order_id);
  const hasSales = purchase.sale_count > 0 || purchase.quantity_sold > 0;
  const received = Boolean(purchase.received_at) || purchase.status === "in_inventory";
  const deletePhrase = `DELETE PURCHASE #${purchase.purchase_number}`;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={adminHref(`/admin/market-intel/purchases/${purchase.id}`)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Purchase #{purchase.purchase_number}
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            Universal purchase correction
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">Edit / Correct Purchase</h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Fix the source, purchase date, strategy, receipt status, quantity, lot total,
            per-item cost, shipping, tax, fees, notes, or an accidental duplicate without
            rebuilding the position.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "corrected" ? (
          <Notice tone="success">
            Purchase corrected. TCOS recalculated the total lot cost and all-in cost per item.
          </Notice>
        ) : null}
        {query?.error ? <Notice tone="error">{query.error}</Notice> : null}

        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em]">Exact identity</p>
              <h2 className="mt-1 text-2xl font-black">
                {purchase.collectible?.display_name || "Unmatched collectible"}
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6">
                This editor changes the purchase record and cost basis only. Exact-card identity
                and sold comps stay attached to the same card market.
              </p>
            </div>
            {purchase.collectible_identity_id ? (
              <Link
                href={adminHref(
                  `/admin/market-intel/comps/${purchase.collectible_identity_id}`,
                )}
                className="rounded-md bg-cyan-950 px-4 py-3 text-center font-black text-white"
              >
                Open InstaComp™ / Exact Card
              </Link>
            ) : null}
          </div>
        </section>

        <form
          method="post"
          action={adminHref(`/api/admin/market-intel/purchases/${purchase.id}/edit`)}
          className="space-y-6"
        >
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-800">
              Purchase record
            </p>
            <h2 className="mt-1 text-3xl font-black">Source, date, and destination</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-sm font-black">
                Purchase source
                <select
                  name="acquisitionChannel"
                  defaultValue={channel}
                  className={inputClass}
                >
                  <option value="ebay">eBay</option>
                  <option value="marketplace">Other Online Marketplace</option>
                  <option value="card_show">Card Show</option>
                  <option value="card_shop">Card Shop</option>
                  <option value="private_deal">Private Deal</option>
                  <option value="trade">Trade / Cash Difference</option>
                  <option value="other">Other Purchase</option>
                </select>
              </label>
              <Input
                name="sourceName"
                label="Marketplace, show, shop, or seller"
                defaultValue={sourceName}
              />
              <Input
                name="sourceLocation"
                label="Location"
                defaultValue={sourceLocation}
                placeholder="Denver, CO"
              />
              <Input
                name="purchaseDate"
                label="Purchase date"
                type="date"
                defaultValue={dateValue(purchase.purchased_at)}
                required
              />
              <label className="text-sm font-black">
                Strategy lane
                <select
                  name="portfolioBucket"
                  defaultValue={bucket}
                  className={inputClass}
                >
                  <option value="resale">Resale</option>
                  <option value="hold">Hold / Investment</option>
                  <option value="pc">Personal Collection</option>
                </select>
              </label>
              <Input
                name="externalOrderId"
                label="Order, receipt, or deal ID"
                defaultValue={externalOrderId}
              />
              <Input
                name="sourceUrl"
                label="Original listing or receipt URL"
                type="url"
                defaultValue={purchase.source_url || ""}
                className="md:col-span-2"
              />
              <label className="flex items-center gap-3 rounded-md border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-black md:col-span-2">
                <input
                  name="alreadyReceived"
                  type="checkbox"
                  defaultChecked={received}
                  disabled={hasSales}
                  className="h-5 w-5"
                />
                Item is received and in inventory
              </label>
              {hasSales ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950 md:col-span-2">
                  Receipt status is locked because {purchase.quantity_sold} unit(s) are already
                  recorded as sold. Cost and source corrections are still allowed.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
              Cost correction
            </p>
            <h2 className="mt-1 text-3xl font-black">Lot total or price per item</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-amber-950">
              Choose how you remember the deal. TCOS converts either method into one total paid
              for the lot and one all-in cost basis per card or item.
            </p>
            <PurchaseCostEditor
              className="mt-5"
              defaultMode={costEntryMode(metadata)}
              defaultQuantity={purchase.quantity_purchased}
              defaultItemSubtotal={purchase.item_subtotal}
              defaultInboundShipping={purchase.inbound_shipping}
              defaultSalesTax={purchase.sales_tax}
              defaultBuyerFees={purchase.buyer_fees}
              defaultOtherCost={purchase.other_acquisition_cost}
            />
            {purchase.quantity_sold > 0 ? (
              <p className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-950">
                Quantity cannot be reduced below {purchase.quantity_sold}, because that many units
                have already been recorded as sold.
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <label className="text-sm font-black">
              Purchase notes
              <textarea
                name="notes"
                rows={5}
                defaultValue={purchase.notes || ""}
                className={inputClass}
                placeholder="Offer details, table number, seller, trade notes, receipt notes, or correction explanation."
              />
            </label>
          </section>

          <AdminSubmitButton
            className="w-full rounded-xl bg-black px-6 py-4 text-xl font-black text-white"
            pendingChildren="Correcting purchase..."
            title="Save corrected purchase fields and recalculate total lot cost and all-in unit cost basis."
          >
            SAVE ALL PURCHASE CORRECTIONS
          </AdminSubmitButton>
        </form>

        <section
          id="delete-purchase"
          className="rounded-xl border-2 border-rose-400 bg-rose-50 p-6 text-rose-950"
        >
          <p className="text-xs font-black uppercase tracking-[0.18em]">Danger zone</p>
          <h2 className="mt-1 text-3xl font-black">Delete accidental duplicate</h2>
          <p className="mt-2 max-w-4xl font-semibold leading-6">
            This permanently removes Purchase #{purchase.purchase_number} from the ledger and
            portfolio totals. It is intended only for a purchase that was entered twice.
          </p>

          {hasSales ? (
            <div className="mt-5 rounded-md border border-rose-500 bg-white p-4 font-bold">
              Deletion is blocked because this purchase has {purchase.sale_count} recorded sale
              {purchase.sale_count === 1 ? "" : "s"}. Correct the purchase instead so realized
              profit history remains intact.
            </div>
          ) : (
            <form
              method="post"
              action={adminHref(
                `/api/admin/market-intel/purchases/${purchase.id}/delete`,
              )}
              className="mt-5 space-y-4"
            >
              <label className="flex items-start gap-3 rounded-md border border-rose-300 bg-white p-4 font-black">
                <input
                  name="duplicateConfirmed"
                  type="checkbox"
                  required
                  className="mt-1 h-5 w-5"
                />
                I confirm this purchase is an accidental duplicate and should be permanently
                removed.
              </label>
              <label className="block text-sm font-black">
                Type <code>{deletePhrase}</code> exactly
                <input
                  name="confirmation"
                  required
                  autoComplete="off"
                  className={inputClass}
                />
              </label>
              <AdminSubmitButton
                className="rounded-md bg-rose-700 px-5 py-3 font-black text-white"
                pendingChildren="Deleting duplicate..."
                title="Permanently delete this no-sales duplicate purchase from the ledger."
              >
                DELETE DUPLICATE PURCHASE
              </AdminSubmitButton>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function Input({
  name,
  label,
  type = "text",
  defaultValue,
  placeholder,
  required = false,
  className = "",
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`text-sm font-black ${className}`}>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className={inputClass}
      />
    </label>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950"
          : "rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-950"
      }
    >
      {children}
    </div>
  );
}

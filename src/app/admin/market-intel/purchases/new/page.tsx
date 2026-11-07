import Link from "next/link";
import AdminSubmitButton from "../../../AdminSubmitButton";
import PurchaseCostEditor from "../PurchaseCostEditor";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../lib/admin-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-semibold shadow-inner shadow-neutral-100 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10";

export default async function NewOfflinePurchasePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM] || (await createAdminSessionValue());
  const adminHref = (href: string) => addAdminHandoff(href, handoff);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#ecfccb,_transparent_28%),linear-gradient(180deg,_#f8fafc,_#f5f5f4)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(132,204,22,0.28),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <Link
            href={adminHref("/admin/market-intel/purchases")}
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
          >
            ← Purchase Ledger
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-lime-300">
            TCOS Market Intel™
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Card Show + Card Shop Purchase
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Record an offline card purchase with exact identity, full out-the-door cost,
            acquisition source, and its Resale, Hold/Investment, or Personal Collection lane.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {query?.error ? (
          <div className="rounded-3xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950 shadow-sm ring-1 ring-rose-950/5">
            {query.error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950 shadow-sm ring-1 ring-cyan-950/5">
          <h2 className="text-2xl font-black">One entry creates the full position</h2>
          <p className="mt-2 font-semibold leading-6">
            TCOS creates or reuses the exact-card identity, records the cost basis, and opens
            the new Purchase Ledger position. InstaComp™ and sold-comps tracking attach to the
            same exact identity.
          </p>
        </section>

        <form
          method="post"
          action={adminHref("/api/admin/market-intel/purchases/manual")}
          className="space-y-6"
        >
          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-800">
              Acquisition
            </p>
            <h2 className="mt-1 text-3xl font-black">Where and why you bought it</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField name="acquisitionChannel" label="Purchase source" defaultValue="card_show">
                <option value="card_show">Card Show</option>
                <option value="card_shop">Card Shop</option>
                <option value="private_deal">Private Deal</option>
                <option value="trade">Trade / Cash Difference</option>
                <option value="other">Other Offline Purchase</option>
              </SelectField>
              <Input name="sourceName" label="Show, shop, or seller name" placeholder="Denver Card Show" />
              <Input name="sourceLocation" label="Location" placeholder="Denver, CO" />
              <Input
                name="purchaseDate"
                label="Purchase date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
              <SelectField name="portfolioBucket" label="Strategy" defaultValue="resale">
                <option value="resale">Resale</option>
                <option value="hold">Hold / Investment</option>
                <option value="pc">Personal Collection</option>
              </SelectField>
              <label className="flex items-center gap-3 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-black shadow-sm md:col-span-2">
                <input name="alreadyReceived" type="checkbox" defaultChecked className="h-5 w-5" />
                Item is already received and in my possession
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">
              Exact card
            </p>
            <h2 className="mt-1 text-3xl font-black">Identify the card once</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              These fields control InstaComp™, sales comps, and market movement. Raw and graded
              cards remain separate identities.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Input name="playerName" label="Player / athlete" required />
              <SelectField name="sportOrCategory" label="Sport/category" defaultValue="Baseball">
                <option>Baseball</option>
                <option>Basketball</option>
                <option>Football</option>
                <option>Hockey</option>
                <option>Other Sports Card</option>
              </SelectField>
              <Input name="seasonYear" label="Year / season" placeholder="2025-26" required />
              <Input name="manufacturer" label="Manufacturer" placeholder="Topps" required />
              <Input name="brand" label="Brand" placeholder="Bowman Chrome" />
              <Input name="productLine" label="Product line" placeholder="Bowman Chrome" />
              <Input name="setName" label="Set" />
              <Input name="insertName" label="Insert" />
              <Input name="cardNumber" label="Card number" placeholder="BCP-123" required />
              <Input name="parallelName" label="Parallel" defaultValue="Base" required />
              <Input name="variationName" label="Variation" />
              <Input name="serialNumberedTo" label="Numbered to" type="number" min="1" />
              <SelectField name="conditionType" label="Condition type" defaultValue="raw">
                <option value="raw">Raw</option>
                <option value="graded">Graded</option>
                <option value="sealed">Sealed</option>
                <option value="authenticated">Authenticated</option>
              </SelectField>
              <Input name="gradingCompany" label="Grading company" placeholder="PSA" />
              <Input name="grade" label="Grade" placeholder="10" />
              <div className="flex flex-wrap gap-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-black shadow-sm xl:col-span-4">
                <Check name="rookieDesignation" label="Rookie" />
                <Check name="autograph" label="Autograph" />
                <Check name="memorabilia" label="Memorabilia / relic" />
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm ring-1 ring-amber-950/5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
              Cost basis
            </p>
            <h2 className="mt-1 text-3xl font-black">Lot total or price per item</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-amber-950">
              Enter either the total item price for the complete lot or the amount paid for each
              card. TCOS adds shipping, tax, fees, and other acquisition costs, then shows the
              total paid and the all-in cost basis per item before you save.
            </p>
            <PurchaseCostEditor className="mt-5" defaultQuantity={1} />
            <label className="mt-5 block text-sm font-black">
              Notes
              <textarea
                name="notes"
                rows={3}
                className={inputClass}
                placeholder="Seller, table number, deal details, trade notes, or anything needed later."
              />
            </label>
          </section>

          <AdminSubmitButton
            className="w-full rounded-2xl bg-black px-6 py-4 text-xl font-black text-white shadow-sm transition hover:bg-neutral-800"
            pendingChildren="Creating purchase position..."
            title="Create the exact-card identity and offline Purchase Ledger position with the entered cost basis."
          >
            ADD PURCHASE TO LEDGER
          </AdminSubmitButton>
        </form>
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
  min,
  step,
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  min?: string;
  step?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        min={min}
        step={step}
        required={required}
        className={inputClass}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  defaultValue,
  children,
}: {
  name: string;
  label: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <select name={name} defaultValue={defaultValue} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <input name={name} type="checkbox" className="h-5 w-5" /> {label}
    </label>
  );
}

import Link from "next/link";
import AdminSubmitButton from "../../../AdminSubmitButton";
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
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 font-semibold outline-none focus:border-black";

export default async function NewOfflinePurchasePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM] || (await createAdminSessionValue());
  const adminHref = (href: string) => addAdminHandoff(href, handoff);

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
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Card Show + Card Shop Purchase
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Record an offline card purchase with exact identity, full out-the-door cost,
            acquisition source, and its Resale, Hold/Investment, or Personal Collection lane.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950">
            {query.error}
          </div>
        ) : null}

        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
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
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
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
              <label className="flex items-center gap-3 rounded-md border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-black md:col-span-2">
                <input name="alreadyReceived" type="checkbox" defaultChecked className="h-5 w-5" />
                Item is already received and in my possession
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
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
              <div className="flex flex-wrap gap-5 rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm font-black xl:col-span-4">
                <Check name="rookieDesignation" label="Rookie" />
                <Check name="autograph" label="Autograph" />
                <Check name="memorabilia" label="Memorabilia / relic" />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
              Cost basis
            </p>
            <h2 className="mt-1 text-3xl font-black">What you actually paid</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Input name="quantity" label="Quantity" type="number" min="1" defaultValue="1" required />
              <MoneyInput name="itemSubtotal" label="Item subtotal" required />
              <MoneyInput name="inboundShipping" label="Shipping" />
              <MoneyInput name="salesTax" label="Sales tax" />
              <MoneyInput name="buyerFees" label="Buyer fees" />
              <MoneyInput name="otherCost" label="Other cost / trade value" />
              <label className="text-sm font-black md:col-span-2 xl:col-span-4">
                Notes
                <textarea
                  name="notes"
                  rows={3}
                  className={inputClass}
                  placeholder="Seller, table number, deal details, trade notes, or anything needed later."
                />
              </label>
            </div>
          </section>

          <AdminSubmitButton
            className="w-full rounded-xl bg-black px-6 py-4 text-xl font-black text-white"
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
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  min?: string;
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
        required={required}
        className={inputClass}
      />
    </label>
  );
}

function MoneyInput({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  return (
    <Input
      name={name}
      label={label}
      type="number"
      min="0"
      defaultValue="0.00"
      required={required}
    />
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

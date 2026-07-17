import Link from "next/link";
import EbayInventoryIntakeClient from "./EbayInventoryIntakeClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EbayInventoryIntakePage() {
  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Simple Intake
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Inventory Intake
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              One clean working table: review what is for sale, select rows,
              push good listings live, and send problem rows to InstaComp™.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/admin" label="Command Center" />
            <HeaderLink href="/admin/ebay/import-runner" label="Import More" primary />
            <HeaderLink href="/admin/instacomp" label="InstaComp™" />
            <HeaderLink href="/shop" label="Shop" />
          </div>
        </div>
      </section>

      <EbayInventoryIntakeClient />
    </main>
  );
}

function HeaderLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-4 py-2 text-sm font-bold ${
        primary
          ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
          : "border border-white/20 text-white hover:bg-white/10"
      }`}
    >
      {label}
    </Link>
  );
}

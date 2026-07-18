import Link from "next/link";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../lib/admin-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    number?: string;
    collectible?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

export default async function DeletedPurchasePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM] || (await createAdminSessionValue());
  const adminHref = (href: string) => addAdminHandoff(href, handoff);

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-12 text-neutral-950">
      <section className="mx-auto max-w-2xl rounded-xl border border-emerald-300 bg-white p-8 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
          Duplicate removed
        </p>
        <h1 className="mt-2 text-4xl font-black">
          Purchase #{query?.number || "—"} was deleted
        </h1>
        <p className="mt-4 font-semibold leading-7 text-neutral-700">
          {query?.collectible || "The duplicate purchase"} was removed from the Purchase Ledger.
          Its cost basis is no longer counted in portfolio totals.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href={adminHref("/admin/market-intel/purchases")}
            className="rounded-md bg-black px-5 py-3 font-black text-white"
          >
            Return to Purchase Ledger
          </Link>
          <Link
            href={adminHref("/admin/market-intel/purchases/new")}
            className="rounded-md border border-neutral-300 bg-white px-5 py-3 font-black"
          >
            Add Another Purchase
          </Link>
        </div>
      </section>
    </main>
  );
}

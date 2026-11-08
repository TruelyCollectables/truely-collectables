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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ecfccb_0,#f8fafc_44%,#fff7ed_100%)] px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white/95 p-8 shadow-2xl shadow-emerald-950/10 ring-1 ring-emerald-950/5">
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
            className="rounded-full bg-black px-5 py-3 font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800"
          >
            Return to Purchase Ledger
          </Link>
          <Link
            href={adminHref("/admin/market-intel/purchases/new")}
            className="rounded-full border border-neutral-300 bg-white px-5 py-3 font-black shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50"
          >
            Add Another Purchase
          </Link>
        </div>
      </section>
    </main>
  );
}

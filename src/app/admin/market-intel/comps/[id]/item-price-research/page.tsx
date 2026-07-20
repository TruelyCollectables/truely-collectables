import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

export default async function ItemPriceResearchPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: identity, error } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id,display_name,identity_key,condition_type,card_number,parallel_name,active")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!identity) notFound();

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Link
            href={addAdminHandoff(`/admin/market-intel/comps/${id}`, handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Exact-Card Market
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            Source access required
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            SportsCardsPro Price Data Disabled
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            {identity.display_name}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-2xl border border-rose-300 bg-rose-50 p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-900">
            No subscription or written permission on file
          </p>
          <h2 className="mt-2 text-2xl font-black text-rose-950">
            TCOS will not store or use SportsCardsPro price data.
          </h2>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-rose-950">
            SportsCardsPro states that internal business use of its Price Data requires a
            current Legendary subscription. Use inside software that is accessible to third
            parties requires express written permission. Until qualifying access is confirmed,
            TCOS blocks entry, import, display, valuation, scoring, alerts, and redistribution
            of SportsCardsPro Price Data.
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">What remains allowed in TCOS</h2>
            <ul className="mt-4 space-y-3 text-sm font-semibold leading-6 text-neutral-700">
              <li>• Verified eBay purchase receipts tied to the exact card identity.</li>
              <li>• Owner-provided completed-sale evidence with item price and shipping.</li>
              <li>• Licensed provider data under terms that allow the intended TCOS use.</li>
              <li>• Exact live listings as asking-price research, never as sold comps.</li>
            </ul>
          </article>

          <article className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
            <h2 className="text-2xl font-black text-amber-950">Access options</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-amber-950">
              Review the official terms and subscription/API documentation before enabling
              this source. Written permission is required for uses not covered by a qualifying
              subscription.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href="https://www.sportscardspro.com/page/terms-of-service"
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-black"
              >
                REVIEW OFFICIAL TERMS →
              </a>
              <a
                href="https://www.sportscardspro.com/api-documentation"
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-amber-500 bg-white px-4 py-2 text-sm font-black text-amber-950 hover:bg-amber-100"
              >
                REVIEW API ACCESS →
              </a>
            </div>
          </article>
        </section>

        <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-6">
          <h2 className="text-xl font-black text-cyan-950">Exact identity remains protected</h2>
          <dl className="mt-4 grid gap-3 text-sm font-semibold text-cyan-950 sm:grid-cols-2">
            <Row label="Card number" value={identity.card_number || "Not set"} />
            <Row label="Parallel" value={identity.parallel_name || "Not set"} />
            <Row label="Condition" value={String(identity.condition_type || "unknown").toUpperCase()} />
            <Row label="Identity status" value={identity.active ? "ACTIVE" : "INACTIVE"} />
          </dl>
          <p className="mt-4 break-all text-xs font-semibold text-cyan-900">
            {identity.identity_key}
          </p>
        </section>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cyan-200 bg-white p-4">
      <dt className="text-xs font-black uppercase tracking-wider text-cyan-800">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

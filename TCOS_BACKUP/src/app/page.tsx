import Link from "next/link";
import { createSupabaseServerClient } from "../lib/supabase-server";
import { getStoreSettings } from "../lib/store-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return (
    <main>
      <section className="border-b border-neutral-200 bg-neutral-950 text-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 py-16 lg:grid-cols-[1fr_420px] lg:py-20">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-bold uppercase text-yellow-300">
              {storeSettings.displayName}
            </p>
            <h1 className="mt-4 max-w-4xl text-5xl font-black leading-tight md:text-7xl">
              Collector-first cards, research, and purchase confidence.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-300">
              Shop active inventory, compare research paths, review exact-match
              signals, and make the item yours with TCOS-backed checkout,
              evidence, and fulfillment.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/shop"
                className="rounded bg-yellow-300 px-6 py-3 font-black text-neutral-950 hover:bg-yellow-200"
              >
                Shop Inventory
              </Link>
              <Link
                href="/admin/launch-readiness"
                className="rounded border border-neutral-700 px-6 py-3 font-bold text-white hover:bg-neutral-900"
              >
                Launch Readiness
              </Link>
            </div>
          </div>

          <div className="grid content-start gap-3">
            {[
              ["Collector Intelligence", "Market links, source checks, pop-report lookups, and exact-match signals."],
              ["Secure Checkout", "TOS acceptance, identity evidence, Stripe webhooks, and transaction records."],
              ["Fulfillment Control", "Order queues, packing slips, tracking, shipment proof, and evidence PDFs."],
            ].map(([title, body]) => (
              <section key={title} className="rounded border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-lg font-black text-yellow-300">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-300">{body}</p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {[
            ["Cards", "Active inventory and set-builder research."],
            ["Memorabilia", "Future category-ready collection model."],
            ["Sneakers", "Future Dag Danky Shoes storefront lane."],
            ["Megahub", "Wish lists, checklists, trades, and collector tools."],
          ].map(([title, body]) => (
            <section key={title} className="rounded border bg-white p-5">
              <h2 className="font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">{body}</p>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}

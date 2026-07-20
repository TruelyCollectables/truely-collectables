import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../lib/admin-session";
import { getMarketIntelFreshStartPreview } from "../../../../lib/market-intel-fresh-start";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    reset?: string;
    searches?: string;
    purchases?: string;
    sales?: string;
    comps?: string;
    keeper?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default async function MarketIntelFreshStartPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM] || (await createAdminSessionValue());
  const adminHref = (href: string) => addAdminHandoff(href, handoff);

  let preview: Awaited<ReturnType<typeof getMarketIntelFreshStartPreview>>;
  try {
    preview = await getMarketIntelFreshStartPreview();
  } catch (error) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <Link href={adminHref("/admin/market-intel")} className="font-black text-blue-700">
            ← Market Intel
          </Link>
          <section className="mt-6 rounded-xl border border-rose-300 bg-rose-50 p-6 text-rose-950">
            <h1 className="text-3xl font-black">Fresh Start could not load</h1>
            <p className="mt-2 font-semibold">
              {error instanceof Error ? error.message : "Unable to load cleanup preview."}
            </p>
          </section>
        </div>
      </main>
    );
  }

  const canReset = preview.eligibleKeeperCount > 0;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <Link
            href={adminHref("/admin/market-intel")}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Market Intel
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-rose-300">
            Controlled cleanup
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">Market Intel Fresh Start</h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Empty the current player-search list and remove old tracked purchase positions while
            protecting the Ivan Demidov eBay lot. Exact-card identities, general sold comps,
            market observations, and card research stay intact.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        {query?.reset === "1" ? (
          <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
            <h2 className="text-2xl font-black">Fresh Start complete</h2>
            <p className="mt-2 font-semibold">
              Removed {query.searches || "0"} search targets, {query.purchases || "0"} purchase
              positions, {query.sales || "0"} linked sale rows, and {query.comps || "0"}
              purchase-receipt comps. Protected purchase: {query.keeper || "Ivan Demidov eBay lot"}.
            </p>
          </section>
        ) : null}
        {query?.error ? (
          <section role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
            <h2 className="text-xl font-black">Cleanup did not run</h2>
            <p className="mt-2 font-semibold">{query.error}</p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Metric label="Search Targets to Remove" value={String(preview.watchTargetCount)} />
          <Metric
            label="Purchases to Remove"
            value={String(Math.max(0, preview.purchases.length - 1))}
          />
          <Metric label="Eligible Demidov Keepers" value={String(preview.eligibleKeeperCount)} />
        </section>

        <section className="rounded-xl border border-cyan-300 bg-cyan-50 p-5 text-cyan-950">
          <h2 className="text-2xl font-black">What this reset preserves</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Preserved>Exact collectible identities and card-number knowledge</Preserved>
            <Preserved>General verified sold comps and InstaComp™ market history</Preserved>
            <Preserved>Market observations and historical pricing evidence</Preserved>
            <Preserved>The one protected Ivan Demidov eBay purchase lot</Preserved>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-800">
              Required keeper selection
            </p>
            <h2 className="mt-1 text-3xl font-black">Choose the Demidov eBay lot to protect</h2>
            <p className="mt-2 font-semibold text-neutral-600">
              Only an eBay purchase tied to Ivan Demidov can be protected. Every other tracked
              purchase position will be removed.
            </p>
          </div>

          {preview.purchases.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No tracked purchases currently exist.</p>
          ) : (
            <form
              method="post"
              action={adminHref("/api/admin/market-intel/fresh-start")}
              className="divide-y divide-neutral-200"
            >
              <div className="divide-y divide-neutral-200">
                {preview.purchases.map((purchase) => (
                  <label
                    key={purchase.id}
                    className={`grid gap-3 p-5 md:grid-cols-[auto_1fr_auto] md:items-center ${
                      purchase.eligibleKeeper
                        ? "cursor-pointer bg-emerald-50/60 hover:bg-emerald-50"
                        : "bg-neutral-50 opacity-65"
                    }`}
                  >
                    <input
                      type="radio"
                      name="keepPurchaseId"
                      value={purchase.id}
                      disabled={!purchase.eligibleKeeper}
                      defaultChecked={purchase.id === preview.suggestedKeeperId}
                      className="h-5 w-5"
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-black">Purchase #{purchase.purchaseNumber}</span>
                        {purchase.eligibleKeeper ? (
                          <span className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-black text-white">
                            CAN KEEP
                          </span>
                        ) : (
                          <span className="rounded-full bg-neutral-300 px-3 py-1 text-xs font-black">
                            WILL DELETE
                          </span>
                        )}
                        {purchase.isLot ? (
                          <span className="rounded-full border border-fuchsia-300 bg-fuchsia-50 px-3 py-1 text-xs font-black text-fuchsia-900">
                            LOT
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 font-black">{purchase.collectibleName}</p>
                      <p className="mt-1 text-sm font-semibold text-neutral-600">
                        {purchase.marketplaceName} · Qty {purchase.quantity} · {new Date(purchase.purchasedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-2xl font-black">{money(purchase.totalCost)}</p>
                      {purchase.sourceUrl ? (
                        <a
                          href={purchase.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs font-black text-blue-700 hover:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Open source
                        </a>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>

              <div className="bg-rose-50 p-5">
                <label className="block max-w-xl text-sm font-black text-rose-950">
                  Type RESET MARKET INTEL to confirm
                  <input
                    name="confirmation"
                    required
                    autoComplete="off"
                    className="mt-2 w-full rounded-md border border-rose-400 bg-white px-4 py-3 font-black outline-none focus:border-rose-700"
                    placeholder="RESET MARKET INTEL"
                  />
                </label>
                <AdminSubmitButton
                  className="mt-4 rounded-md bg-rose-800 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                  pendingChildren="Resetting Market Intel..."
                  disabled={!canReset}
                  disabledReason={
                    canReset
                      ? undefined
                      : "No eligible Ivan Demidov eBay purchase was found to protect."
                  }
                  title="Delete all current search targets and all tracked purchase positions except the selected Ivan Demidov eBay lot."
                >
                  Reset Searches + Purchases
                </AdminSubmitButton>
                <p className="mt-3 max-w-3xl text-sm font-bold text-rose-950">
                  This is intentionally destructive. It removes the current search-target list and
                  tracked purchase/profit positions, including linked purchase sales and receipt comps.
                  It does not delete exact-card identities or the general market-data engine.
                </p>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-4xl font-black">{value}</p>
    </div>
  );
}

function Preserved({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-cyan-300 bg-white/70 p-4 font-black">
      ✓ {children}
    </div>
  );
}

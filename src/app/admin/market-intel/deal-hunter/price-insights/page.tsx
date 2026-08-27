import Link from "next/link";
import { priceInsightsCandidateEligibility } from "../../../../../lib/deal-hunter-price-insights-capture";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const raw = params[key];
  return Array.isArray(raw) ? raw[0] || "" : raw || "";
}

function shortIdentity(identity: Record<string, unknown>) {
  return [
    identity.year,
    identity.brand,
    identity.setName,
    identity.player,
    identity.parallel,
    identity.cardNumber ? `#${String(identity.cardNumber).replace(/^#/, "")}` : null,
    identity.gradingCompany,
    identity.gradeValue,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

export default async function DealHunterPriceInsightsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const saved = value(params, "saved") === "1";
  const error = value(params, "error");
  const selectedCandidateId = value(params, "candidateId");
  const inserted = value(params, "inserted");
  const duplicates = value(params, "duplicates");
  const registryIdentityId = value(params, "registryIdentityId");

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error: loadError } = await supabase
    .from("tcos_deal_hunter_candidates")
    .select("id,title,identity,exact_market,evaluation,listing_url,updated_at")
    .order("updated_at", { ascending: false })
    .limit(250);

  const candidates = (data || [])
    .map((candidate) => ({ candidate, eligibility: priceInsightsCandidateEligibility(candidate) }))
    .filter((row) => row.eligibility.eligible)
    .slice(0, 100);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl rounded-[2rem] border border-neutral-900 bg-neutral-950 p-6 text-white shadow-2xl lg:p-8">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/market-intel/deal-hunter"
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black"
          >
            ← Deal Hunter
          </Link>
          <Link
            href="/admin/market-intel"
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black"
          >
            Market Intel
          </Link>
        </div>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
          Exact Sold Memory Intake
        </p>
        <h1 className="mt-2 text-4xl font-black">eBay Price Insights → InstaComp</h1>
        <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
          Capture a real completed eBay sale for a Registry-locked Deal Hunter card. The existing
          InstaComp exact-card firewall verifies the sold title, card number, parallel, print run,
          grading state, sold date, direct eBay item URL, and landed price before anything is saved.
        </p>
      </section>

      <div className="mx-auto max-w-5xl space-y-5 py-6">
        {saved ? (
          <section className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
            <p className="text-xs font-black uppercase tracking-[0.16em]">Saved to InstaComp memory</p>
            <h2 className="mt-1 text-2xl font-black">
              Exact sold evidence accepted
            </h2>
            <p className="mt-2 font-semibold">
              New observations: {inserted || "0"} · Existing duplicates: {duplicates || "0"}
              {registryIdentityId ? ` · Registry ${registryIdentityId}` : ""}
            </p>
            <p className="mt-2 text-sm font-semibold">
              The next scan of this exact Registry identity can reuse this sold evidence before any
              paid SerpApi sold search.
            </p>
          </section>
        ) : null}

        {error ? (
          <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
            <p className="text-xs font-black uppercase tracking-[0.16em]">Capture rejected</p>
            <p className="mt-1 font-bold">{error}</p>
          </section>
        ) : null}

        {loadError ? (
          <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 font-bold text-rose-950">
            Candidate load failed: {loadError.message}
          </section>
        ) : null}

        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <form
              action="/api/admin/market-intel/deal-hunter/price-insights"
              method="post"
              className="space-y-4"
            >
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                  1. Exact Deal Hunter identity
                </p>
                <label className="mt-2 block text-sm font-black" htmlFor="candidateId">
                  Registry-locked candidate
                </label>
                <select
                  id="candidateId"
                  name="candidateId"
                  required
                  defaultValue={selectedCandidateId}
                  className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 font-semibold"
                >
                  <option value="">Choose an exact card…</option>
                  {candidates.map(({ candidate, eligibility }) => {
                    if (!eligibility.eligible) return null;
                    const identity = candidate.identity as Record<string, unknown>;
                    return (
                      <option key={candidate.id} value={candidate.id}>
                        {shortIdentity(identity)} — {candidate.title}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs font-semibold text-neutral-500">
                  Only candidates with complete 95%+ identity and a locked Registry UUID/fingerprint
                  appear here. Eligible now: {candidates.length}.
                </p>
              </div>

              <div className="border-t border-neutral-200 pt-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                  2. One real eBay Price Insights sold row
                </p>
                <label className="mt-2 block text-sm font-black" htmlFor="soldTitle">
                  Sold listing title
                </label>
                <textarea
                  id="soldTitle"
                  name="soldTitle"
                  required
                  rows={3}
                  placeholder="Paste the exact completed-listing title from eBay Price Insights"
                  className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-black" htmlFor="soldAt">Sold date</label>
                  <input
                    id="soldAt"
                    name="soldAt"
                    type="date"
                    required
                    className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black" htmlFor="itemPrice">Item price</label>
                  <input
                    id="itemPrice"
                    name="itemPrice"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    placeholder="19.99"
                    className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black" htmlFor="shippingPrice">Shipping</label>
                  <input
                    id="shippingPrice"
                    name="shippingPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="0.00"
                    className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-black" htmlFor="sourceUrl">
                  Direct sold eBay item URL
                </label>
                <input
                  id="sourceUrl"
                  name="sourceUrl"
                  type="url"
                  required
                  placeholder="https://www.ebay.com/itm/123456789012"
                  className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-black" htmlFor="condition">Condition</label>
                  <input
                    id="condition"
                    name="condition"
                    placeholder="Ungraded - Near Mint or Better"
                    className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-black" htmlFor="buyingOption">Sale type</label>
                  <input
                    id="buyingOption"
                    name="buyingOption"
                    placeholder="Buy It Now / Offer accepted"
                    className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-2xl bg-neutral-950 px-5 py-3.5 text-sm font-black text-white"
              >
                VERIFY EXACT SALE + SAVE TO INSTACOMP MEMORY
              </button>
            </form>

            <aside className="rounded-3xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
              <p className="text-xs font-black uppercase tracking-[0.16em]">What this does</p>
              <h2 className="mt-1 text-2xl font-black">One accepted sale is reusable</h2>
              <div className="mt-4 space-y-3 text-sm font-semibold">
                <p>1. Deal Hunter supplies the already-locked Registry identity.</p>
                <p>2. You supply the actual Price Insights sold evidence from eBay.</p>
                <p>3. InstaComp rejects wrong card numbers, parallels, print runs, grading states, or non-eBay item URLs.</p>
                <p>4. Accepted landed price = item price + known shipping.</p>
                <p>5. The exact sold observation is retained against the Registry UUID/fingerprint.</p>
                <p>6. Future scans of that exact card check this memory before paid sold search.</p>
              </div>
              <div className="mt-5 rounded-2xl border border-cyan-300 bg-white/70 p-4 text-sm font-bold">
                Active asking prices never become sold value. This screen records completed sales only.
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

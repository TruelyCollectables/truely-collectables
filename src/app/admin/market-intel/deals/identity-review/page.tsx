import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../lib/admin-handoff";
import {
  isMarketIntelIdentityProofVerified,
  marketIntelIdentityProofLabel,
  marketIntelIdentityProofStatus,
  type MarketIntelIdentityProofStatus,
} from "../../../../../lib/market-intel-identity-proof";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

type JsonRecord = Record<string, unknown>;

type IdentityRow = {
  id: string;
  display_name: string;
  condition_type: string;
};

type CandidateRow = {
  id: string;
  source_slug: string;
  collectible_identity_id: string | null;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  image_urls: unknown;
  listing_format: string;
  asking_price: number;
  shipping_price: number;
  buyer_fee: number;
  quantity: number;
  seller_name: string | null;
  seller_rating: number | null;
  query_mode: string | null;
  query_text: string | null;
  candidate_confidence: number | null;
  candidate_priority_score: number | null;
  status: string;
  evidence: JsonRecord | null;
  last_seen_at: string;
};

type ListingRow = {
  id: string;
  marketplace_id: string;
  collectible_identity_id: string | null;
  direct_url: string;
  original_title: string;
  asking_price: number;
  shipping_price: number;
  buyer_fee: number;
  delivered_price: number;
  quantity: number;
  identity_match_confidence: number | null;
  suspected_mislisting: boolean;
  mislisting_reason: string | null;
  metadata: JsonRecord | null;
  first_seen_at: string;
};

function money(value: unknown) {
  const parsed = Number(value || 0);
  return `$${Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00"}`;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function proofTone(status: MarketIntelIdentityProofStatus) {
  if (status === "verified_exact") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (status === "conflict_detected" || status === "rejected") {
    return "border-rose-300 bg-rose-100 text-rose-950";
  }
  if (status === "probable_exact") {
    return "border-cyan-300 bg-cyan-100 text-cyan-950";
  }
  return "border-amber-300 bg-amber-100 text-amber-950";
}

export default async function ProfitHunterIdentityReviewPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const supabase = createSupabaseServerClient({ admin: true });

  const [candidateResult, listingResult, identityResult, marketplaceResult] =
    await Promise.all([
      supabase
        .from("tcos_mi_search_candidates")
        .select(
          "id,source_slug,collectible_identity_id,external_listing_id,direct_url,original_title,image_urls,listing_format,asking_price,shipping_price,buyer_fee,quantity,seller_name,seller_rating,query_mode,query_text,candidate_confidence,candidate_priority_score,status,evidence,last_seen_at",
        )
        .in("status", [
          "pending_review",
          "probable_exact",
          "conflict_detected",
        ])
        .order("candidate_priority_score", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(100),
      supabase
        .from("tcos_mi_listings")
        .select(
          "id,marketplace_id,collectible_identity_id,direct_url,original_title,asking_price,shipping_price,buyer_fee,delivered_price,quantity,identity_match_confidence,suspected_mislisting,mislisting_reason,metadata,first_seen_at",
        )
        .eq("listing_status", "active")
        .order("first_seen_at", { ascending: false })
        .limit(200),
      supabase
        .from("tcos_mi_collectible_identities")
        .select("id,display_name,condition_type")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("tcos_mi_marketplaces")
        .select("id,name,slug")
        .eq("active", true),
    ]);

  if (listingResult.error) throw new Error(listingResult.error.message);
  if (identityResult.error) throw new Error(identityResult.error.message);
  if (marketplaceResult.error) throw new Error(marketplaceResult.error.message);

  const queueMissing = candidateResult.error?.code === "42P01";
  if (candidateResult.error && !queueMissing) {
    throw new Error(candidateResult.error.message);
  }

  const identities = (identityResult.data || []) as IdentityRow[];
  const identityById = new Map(identities.map((row) => [row.id, row]));
  const marketplaceById = new Map(
    (marketplaceResult.data || []).map((row) => [
      String(row.id),
      { name: String(row.name), slug: String(row.slug) },
    ]),
  );
  const candidates = (candidateResult.data || []) as CandidateRow[];
  const unverifiedListings = ((listingResult.data || []) as ListingRow[]).filter(
    (listing) => !isMarketIntelIdentityProofVerified(recordValue(listing.metadata)),
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin/market-intel/deals", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Profit Hunter
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-fuchsia-300">
            Private owner verification
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Identity Proof Gate™
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            Search results stay quarantined here until you personally prove the exact card.
            No unverified candidate may become an actionable deal or purchase position.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved ? (
          <Notice>
            Identity decision saved. Profit Hunter was rescored under the proof gate.
          </Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Staged Search Candidates" value={String(candidates.length)} />
          <Metric label="Existing Listings Needing Proof" value={String(unverifiedListings.length)} />
          <Metric label="Verified Standard" value="OWNER + EVIDENCE" />
        </section>

        <section className="rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-5 text-fuchsia-950">
          <h2 className="text-xl font-black">VERIFIED EXACT requirements</h2>
          <p className="mt-2 font-semibold leading-7">
            Front image, back image or slab label, checklist/catalog match, card number,
            exact parallel/variation, and no conflicting evidence. Serial-number and
            autograph/relic evidence must also be checked whenever applicable.
          </p>
        </section>

        {queueMissing ? (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
            <h2 className="text-xl font-black">Candidate queue migration is not installed</h2>
            <p className="mt-2 font-semibold">
              Apply Supabase migration
              {" "}
              <code>20260719153000_market_intel_identity_proof_gate.sql</code>
              {" "}
              before running the external worker.
            </p>
          </section>
        ) : null}

        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              External worker staging
            </p>
            <h2 className="mt-1 text-3xl font-black">Unverified Search Candidates</h2>
          </div>

          {candidates.length === 0 ? (
            <EmptyState>
              No staged candidates are waiting. The external worker writes raw results here
              without using Vercel for marketplace searches.
            </EmptyState>
          ) : (
            candidates.map((candidate) => {
              const guessedIdentity = candidate.collectible_identity_id
                ? identityById.get(candidate.collectible_identity_id)
                : null;
              const images = stringArray(candidate.image_urls);
              const evidence = recordValue(candidate.evidence);
              return (
                <article
                  key={candidate.id}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-5 xl:flex-row">
                    <ImageStrip images={images} title={candidate.original_title} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                            {candidate.source_slug} · {candidate.query_mode || "search"}
                          </p>
                          <a
                            href={candidate.direct_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block text-xl font-black hover:underline"
                          >
                            {candidate.original_title}
                          </a>
                        </div>
                        <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-black text-amber-950">
                          {String(candidate.status).replaceAll("_", " ").toUpperCase()}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
                        <Fact label="Ask" value={money(candidate.asking_price)} />
                        <Fact label="Shipping" value={money(candidate.shipping_price)} />
                        <Fact
                          label="Candidate confidence"
                          value={`${Number(candidate.candidate_confidence || 0).toFixed(0)}%`}
                        />
                        <Fact
                          label="Guessed identity"
                          value={guessedIdentity?.display_name || "Unmatched"}
                        />
                      </div>

                      <p className="mt-3 break-words rounded-lg bg-neutral-100 p-3 font-mono text-xs text-neutral-700">
                        {candidate.query_text || "No query text stored."}
                      </p>
                      {Array.isArray(evidence.identity_match_reasons) ? (
                        <p className="mt-2 text-xs font-semibold text-neutral-600">
                          Signals: {evidence.identity_match_reasons.map(String).join("; ")}
                        </p>
                      ) : null}

                      <form
                        method="post"
                        action={addAdminHandoff(
                          `/api/admin/market-intel/search-candidates/${candidate.id}/decision`,
                          handoff,
                        )}
                        className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4"
                      >
                        <label className="text-sm font-black">
                          Exact card identity
                          <select
                            name="identityId"
                            defaultValue={candidate.collectible_identity_id || ""}
                            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold"
                          >
                            <option value="">Select exact identity</option>
                            {identities.map((identity) => (
                              <option key={identity.id} value={identity.id}>
                                {identity.display_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <EvidenceChecklist />
                        <label className="mt-4 block text-sm font-black">
                          Owner notes
                          <textarea
                            name="notes"
                            rows={2}
                            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold"
                          />
                        </label>
                        <DecisionButtons promote />
                      </form>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="space-y-4 border-t border-neutral-300 pt-7">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              Existing Profit Hunter records
            </p>
            <h2 className="mt-1 text-3xl font-black">Listings Blocked by Identity Proof</h2>
          </div>

          {unverifiedListings.length === 0 ? (
            <EmptyState>Every active Profit Hunter listing is owner-verified exact.</EmptyState>
          ) : (
            unverifiedListings.map((listing) => {
              const metadata = recordValue(listing.metadata);
              const status = marketIntelIdentityProofStatus(metadata);
              const identity = listing.collectible_identity_id
                ? identityById.get(listing.collectible_identity_id)
                : null;
              const marketplace = marketplaceById.get(String(listing.marketplace_id));
              return (
                <article
                  key={listing.id}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                        {marketplace?.name || "Marketplace"} · confidence {Number(
                          listing.identity_match_confidence || 0,
                        ).toFixed(0)}%
                      </p>
                      <a
                        href={listing.direct_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-xl font-black hover:underline"
                      >
                        {listing.original_title}
                      </a>
                      <p className="mt-1 text-sm font-semibold text-neutral-600">
                        Proposed identity: {identity?.display_name || "None"}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${proofTone(status)}`}>
                      {marketIntelIdentityProofLabel(status)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
                    <Fact label="Delivered" value={money(listing.delivered_price)} />
                    <Fact label="Quantity" value={String(listing.quantity)} />
                    <Fact
                      label="Mislisting"
                      value={listing.suspected_mislisting ? "YES" : "NO"}
                    />
                    <Fact label="Status" value={marketIntelIdentityProofLabel(status)} />
                  </div>

                  <ImageStrip
                    images={stringArray(metadata.image_urls)}
                    title={listing.original_title}
                    compact
                  />

                  <form
                    method="post"
                    action={addAdminHandoff(
                      `/api/admin/market-intel/listings/${listing.id}/identity-proof`,
                      handoff,
                    )}
                    className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <EvidenceChecklist />
                    <label className="mt-4 block text-sm font-black">
                      Owner notes
                      <textarea
                        name="notes"
                        rows={2}
                        defaultValue={String(metadata.identity_proof_notes || "")}
                        className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold"
                      />
                    </label>
                    <DecisionButtons />
                  </form>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

function EvidenceChecklist() {
  const rows = [
    ["frontImageConfirmed", "Front image matches"],
    ["backImageConfirmed", "Back image matches"],
    ["slabLabelConfirmed", "Slab label matches"],
    ["checklistConfirmed", "Checklist/catalog confirms identity"],
    ["cardNumberConfirmed", "Card number confirmed"],
    ["parallelConfirmed", "Exact parallel/variation confirmed"],
    ["serialNumberConfirmed", "Serial-number tier confirmed when applicable"],
    ["autographRelicConfirmed", "Auto/relic status confirmed when applicable"],
    ["noConflictingEvidence", "No conflicting title, image, label, or checklist evidence"],
  ] as const;

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {rows.map(([name, label]) => (
        <label key={name} className="flex items-start gap-2 text-xs font-black text-neutral-800">
          <input name={name} type="checkbox" className="mt-0.5" />
          {label}
        </label>
      ))}
    </div>
  );
}

function DecisionButtons({ promote = false }: { promote?: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="submit"
        name="decision"
        value="verified_exact"
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
      >
        {promote ? "Verify Exact + Promote" : "Verify Exact"}
      </button>
      <button
        type="submit"
        name="decision"
        value="probable_exact"
        className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-black text-white hover:bg-cyan-800"
      >
        Probable — Keep Reviewing
      </button>
      <button
        type="submit"
        name="decision"
        value="conflict_detected"
        className="rounded-md bg-amber-600 px-4 py-2 text-sm font-black text-black hover:bg-amber-500"
      >
        Conflict Detected
      </button>
      <button
        type="submit"
        name="decision"
        value="rejected"
        className="rounded-md bg-rose-700 px-4 py-2 text-sm font-black text-white hover:bg-rose-800"
      >
        Reject Candidate
      </button>
    </div>
  );
}

function ImageStrip({
  images,
  title,
  compact = false,
}: {
  images: string[];
  title: string;
  compact?: boolean;
}) {
  if (!images.length) {
    return compact ? null : (
      <div className="flex h-48 w-full items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-100 text-sm font-black text-neutral-500 xl:w-64">
        NO IMAGES
      </div>
    );
  }
  return (
    <div className={`mt-4 flex gap-3 overflow-x-auto ${compact ? "" : "xl:mt-0 xl:w-72 xl:flex-col"}`}>
      {images.slice(0, 4).map((src, index) => (
        // Marketplace-hosted URLs are intentionally rendered without Next image optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src}-${index}`}
          src={src}
          alt={`${title} evidence ${index + 1}`}
          className={`${compact ? "h-32 w-24" : "h-56 w-40 xl:h-48 xl:w-full"} shrink-0 rounded-xl border border-neutral-200 bg-white object-contain`}
        />
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 break-words font-black">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 font-semibold text-neutral-600">
      {children}
    </p>
  );
}

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <p
      className={`rounded-xl border p-4 font-black ${
        error
          ? "border-rose-300 bg-rose-50 text-rose-950"
          : "border-emerald-300 bg-emerald-50 text-emerald-950"
      }`}
    >
      {children}
    </p>
  );
}

import Link from "next/link";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../../lib/admin-handoff";
import {
  isMarketIntelIdentityProofVerified,
  marketIntelIdentityProofLabel,
  marketIntelIdentityProofStatus,
  type MarketIntelIdentityProofStatus,
} from "../../../../../lib/market-intel-identity-proof";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type JsonRecord = Record<string, unknown>;
type PageProps = {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

type IdentityRow = {
  id: string;
  display_name: string;
  condition_type: string;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
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
  listed_at: string | null;
  auction_end_at: string | null;
  query_mode: string | null;
  query_text: string | null;
  candidate_confidence: number | null;
  candidate_priority_score: number | null;
  status: string;
  evidence: JsonRecord | null;
  first_seen_at: string;
  last_seen_at: string;
};

type ListingRow = {
  id: string;
  marketplace_id: string;
  collectible_identity_id: string | null;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  listing_format: string;
  delivered_price: number;
  quantity: number;
  identity_match_confidence: number | null;
  suspected_mislisting: boolean;
  metadata: JsonRecord | null;
  first_seen_at: string;
  last_seen_at: string;
  auction_end_at: string | null;
};

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function money(value: unknown) {
  const parsed = Number(value || 0);
  return `$${Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00"}`;
}

function sourceKey(row: {
  source_slug?: string | null;
  external_listing_id?: string | null;
  direct_url: string;
}) {
  const source = String(row.source_slug || "");
  return row.external_listing_id
    ? `${source}|${row.external_listing_id}`
    : `${source}|url:${row.direct_url}`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ageLabel(value: string | null | undefined) {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  const hours = Math.max(0, (Date.now() - timestamp) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 48) return `${hours.toFixed(1)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function categoryLabel(evidence: JsonRecord) {
  const rows = Array.isArray(evidence.ebay_categories) ? evidence.ebay_categories : [];
  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const name = String((row as JsonRecord).categoryName || "").trim();
      if (name) return name;
    }
  }
  return "Unknown";
}

function proofTone(status: MarketIntelIdentityProofStatus) {
  if (status === "verified_exact") return "border-emerald-300 bg-emerald-100 text-emerald-950";
  if (status === "conflict_detected" || status === "rejected") {
    return "border-rose-300 bg-rose-100 text-rose-950";
  }
  if (status === "probable_exact") return "border-cyan-300 bg-cyan-100 text-cyan-950";
  return "border-amber-300 bg-amber-100 text-amber-950";
}

export default async function ProfitHunterIdentityReviewPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const supabase = createSupabaseServerClient({ admin: true });

  const [candidateResult, listingResult, identityResult, marketplaceResult] =
    await Promise.all([
      supabase
        .from("tcos_mi_search_candidates")
        .select(
          "id,source_slug,collectible_identity_id,external_listing_id,direct_url,original_title,image_urls,listing_format,asking_price,shipping_price,buyer_fee,quantity,seller_name,seller_rating,listed_at,auction_end_at,query_mode,query_text,candidate_confidence,candidate_priority_score,status,evidence,first_seen_at,last_seen_at",
        )
        .in("status", ["pending_review", "probable_exact", "conflict_detected"])
        .order("candidate_priority_score", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(100),
      supabase
        .from("tcos_mi_listings")
        .select(
          "id,marketplace_id,collectible_identity_id,external_listing_id,direct_url,original_title,listing_format,delivered_price,quantity,identity_match_confidence,suspected_mislisting,metadata,first_seen_at,last_seen_at,auction_end_at",
        )
        .eq("listing_status", "active")
        .order("first_seen_at", { ascending: false })
        .limit(500),
      supabase
        .from("tcos_mi_collectible_identities")
        .select("id,display_name,condition_type,serial_numbered_to,autograph,memorabilia")
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
  if (candidateResult.error && !queueMissing) throw new Error(candidateResult.error.message);

  const identities = (identityResult.data || []) as IdentityRow[];
  const identityById = new Map(identities.map((row) => [row.id, row]));
  const marketplaceById = new Map(
    (marketplaceResult.data || []).map((row) => [
      String(row.id),
      { name: String(row.name), slug: String(row.slug) },
    ]),
  );
  const candidates = (candidateResult.data || []) as CandidateRow[];
  const listings = (listingResult.data || []) as ListingRow[];
  const unverifiedListings = listings.filter(
    (listing) => !isMarketIntelIdentityProofVerified(recordValue(listing.metadata)),
  );

  const candidateGroups = new Map<string, CandidateRow[]>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate);
    const rows = candidateGroups.get(key) || [];
    rows.push(candidate);
    candidateGroups.set(key, rows);
  }

  const activeListingsBySource = new Map<string, ListingRow[]>();
  for (const listing of listings) {
    const marketplace = marketplaceById.get(String(listing.marketplace_id));
    const key = sourceKey({
      source_slug: marketplace?.slug || "",
      external_listing_id: listing.external_listing_id,
      direct_url: listing.direct_url,
    });
    const rows = activeListingsBySource.get(key) || [];
    rows.push(listing);
    activeListingsBySource.set(key, rows);
  }

  const crossIdentityGroups = Array.from(candidateGroups.values()).filter(
    (rows) =>
      new Set(rows.map((row) => row.collectible_identity_id).filter(Boolean)).size > 1,
  ).length;

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
          <h1 className="mt-2 text-4xl font-black md:text-5xl">Identity Proof Gate™</h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            Search results stay quarantined until you personally prove the exact card.
            Lots and unresolved cross-identity matches cannot be promoted.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved ? <Notice>Identity decision saved and rescored.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="grid gap-3 sm:grid-cols-4">
          <Metric label="Staged Candidates" value={String(candidates.length)} />
          <Metric label="Cross-Identity Groups" value={String(crossIdentityGroups)} />
          <Metric label="Listings Needing Proof" value={String(unverifiedListings.length)} />
          <Metric label="Verified Standard" value="OWNER + EVIDENCE" />
        </section>

        <section className="rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-5 text-fuchsia-950">
          <h2 className="text-xl font-black">VERIFIED EXACT requirements</h2>
          <p className="mt-2 font-semibold leading-7">
            Front, back or slab label, checklist, card number, exact parallel/variation,
            and no conflicts are required. Serial-number and autograph/relic evidence are
            mandatory whenever the selected identity requires them.
          </p>
        </section>

        {queueMissing ? (
          <Warning>Candidate queue migration is not installed.</Warning>
        ) : null}

        <section className="space-y-4">
          <h2 className="text-3xl font-black">Unverified Search Candidates</h2>
          {candidates.length === 0 ? (
            <EmptyState>No staged candidates are waiting.</EmptyState>
          ) : (
            candidates.map((candidate) => {
              const identity = candidate.collectible_identity_id
                ? identityById.get(candidate.collectible_identity_id) || null
                : null;
              const evidence = recordValue(candidate.evidence);
              const images = stringArray(candidate.image_urls);
              const key = sourceKey(candidate);
              const siblings = candidateGroups.get(key) || [];
              const siblingIdentityIds = new Set(
                siblings.map((row) => row.collectible_identity_id).filter(Boolean),
              );
              const crossIdentity = siblingIdentityIds.size > 1;
              const lotBlocked =
                candidate.listing_format === "lot" ||
                candidate.query_mode === "lot" ||
                evidence.requires_lot_workflow === true;
              const blockReason = lotBlocked
                ? "Lot candidates require the lot-composition workflow."
                : crossIdentity
                  ? "Reject the wrong sibling identity before promotion."
                  : "";
              const conflicts = Array.isArray(evidence.identity_match_conflicts)
                ? evidence.identity_match_conflicts.map(String)
                : [];
              const activeMatches = activeListingsBySource.get(key) || [];
              const delivered =
                Number(candidate.asking_price || 0) +
                Number(candidate.shipping_price || 0) +
                Number(candidate.buyer_fee || 0);

              return (
                <article key={candidate.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-5 xl:flex-row">
                    <ImageStrip images={images} title={candidate.original_title} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                            {candidate.source_slug} · {candidate.query_mode || "search"} · item {candidate.external_listing_id || "unknown"}
                          </p>
                          <a href={candidate.direct_url} target="_blank" rel="noreferrer" className="mt-1 block text-xl font-black hover:underline">
                            {candidate.original_title}
                          </a>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-black ${candidate.status === "conflict_detected" ? "border-rose-300 bg-rose-100 text-rose-950" : "border-amber-300 bg-amber-100 text-amber-950"}`}>
                          {candidate.status.replaceAll("_", " ").toUpperCase()}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
                        <Fact label="Delivered" value={money(delivered)} />
                        <Fact label="Images" value={String(images.length)} />
                        <Fact label="Confidence" value={`${Number(candidate.candidate_confidence || 0).toFixed(0)}%`} />
                        <Fact label="Guessed identity" value={identity?.display_name || "Unmatched"} />
                        <Fact label="Seller" value={candidate.seller_name || "Unknown"} />
                        <Fact label="Seller rating" value={`${Number(candidate.seller_rating || 0).toFixed(1)}%`} />
                        <Fact label="Feedback count" value={String(evidence.seller_feedback_count || "Unknown")} />
                        <Fact label="Category" value={categoryLabel(evidence)} />
                        <Fact label="First seen" value={dateLabel(candidate.first_seen_at)} />
                        <Fact label="Last seen" value={ageLabel(candidate.last_seen_at)} />
                        <Fact label="Auction ends" value={dateLabel(candidate.auction_end_at)} />
                        <Fact label="Active matches" value={String(activeMatches.length)} />
                      </div>

                      {images.length < 2 ? <Warning>Only {images.length} image is available. Do not verify without back or slab-label proof.</Warning> : null}
                      {lotBlocked ? <Warning>LOT QUARANTINE: quantity and exact composition are not proven.</Warning> : null}
                      {crossIdentity ? <Warning>CROSS-IDENTITY CONFLICT: {siblings.length} rows point to {siblingIdentityIds.size} identities.</Warning> : null}
                      {conflicts.length ? <Warning>Automated conflicts: {conflicts.join("; ")}</Warning> : null}

                      <p className="mt-3 break-words rounded-lg bg-neutral-100 p-3 font-mono text-xs text-neutral-700">
                        {candidate.query_text || "No query text stored."}
                      </p>
                      {Array.isArray(evidence.identity_match_reasons) ? (
                        <p className="mt-2 text-xs font-semibold text-neutral-600">
                          Signals: {evidence.identity_match_reasons.map(String).join("; ")}
                        </p>
                      ) : null}

                      <form method="post" action={addAdminHandoff(`/api/admin/market-intel/search-candidates/${candidate.id}/decision`, handoff)} className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                        <label className="text-sm font-black">
                          Exact card identity
                          <select name="identityId" defaultValue={candidate.collectible_identity_id || ""} className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold">
                            <option value="">Select exact identity</option>
                            {identities.map((row) => <option key={row.id} value={row.id}>{row.display_name}</option>)}
                          </select>
                        </label>
                        <EvidenceChecklist identity={identity} />
                        <label className="mt-4 block text-sm font-black">
                          Owner notes
                          <textarea name="notes" rows={2} className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold" />
                        </label>
                        <DecisionButtons promote blockedReason={blockReason} />
                      </form>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <section className="space-y-4 border-t border-neutral-300 pt-7">
          <h2 className="text-3xl font-black">Listings Blocked by Identity Proof</h2>
          {unverifiedListings.length === 0 ? (
            <EmptyState>Every active listing is owner-verified exact.</EmptyState>
          ) : (
            unverifiedListings.map((listing) => {
              const metadata = recordValue(listing.metadata);
              const status = marketIntelIdentityProofStatus(metadata);
              const identity = listing.collectible_identity_id
                ? identityById.get(listing.collectible_identity_id) || null
                : null;
              const marketplace = marketplaceById.get(String(listing.marketplace_id));
              const lotBlocked = listing.listing_format === "lot";
              return (
                <article key={listing.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                        {marketplace?.name || "Marketplace"} · PURCHASE BLOCKED
                      </p>
                      <a href={listing.direct_url} target="_blank" rel="noreferrer" className="mt-1 block text-xl font-black hover:underline">
                        {listing.original_title}
                      </a>
                      <p className="mt-1 text-sm font-semibold text-neutral-600">Proposed identity: {identity?.display_name || "None"}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${proofTone(status)}`}>{marketIntelIdentityProofLabel(status)}</span>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
                    <Fact label="Delivered" value={money(listing.delivered_price)} />
                    <Fact label="Quantity" value={String(listing.quantity)} />
                    <Fact label="Format" value={listing.listing_format} />
                    <Fact label="Confidence" value={`${Number(listing.identity_match_confidence || 0).toFixed(0)}%`} />
                    <Fact label="First seen" value={dateLabel(listing.first_seen_at)} />
                    <Fact label="Last seen" value={ageLabel(listing.last_seen_at)} />
                    <Fact label="Auction ends" value={dateLabel(listing.auction_end_at)} />
                    <Fact label="Mislisting" value={listing.suspected_mislisting ? "YES" : "NO"} />
                  </div>
                  <ImageStrip images={stringArray(metadata.image_urls)} title={listing.original_title} compact />
                  <form method="post" action={addAdminHandoff(`/api/admin/market-intel/listings/${listing.id}/identity-proof`, handoff)} className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                    <EvidenceChecklist identity={identity} />
                    <label className="mt-4 block text-sm font-black">
                      Owner notes
                      <textarea name="notes" rows={2} defaultValue={String(metadata.identity_proof_notes || "")} className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold" />
                    </label>
                    <DecisionButtons blockedReason={lotBlocked ? "Lot listings require the lot-composition workflow." : ""} />
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

function EvidenceChecklist({ identity }: { identity: IdentityRow | null }) {
  const rows = [
    ["frontImageConfirmed", "Front image matches", true],
    ["backImageConfirmed", "Back image matches", true],
    ["slabLabelConfirmed", "Slab label matches", false],
    ["checklistConfirmed", "Checklist/catalog confirms identity", true],
    ["cardNumberConfirmed", "Card number confirmed", true],
    ["parallelConfirmed", "Exact parallel/variation confirmed", true],
    ["serialNumberConfirmed", "Serial-number tier confirmed", Number(identity?.serial_numbered_to || 0) > 0],
    ["autographRelicConfirmed", "Auto/relic status confirmed", Boolean(identity?.autograph || identity?.memorabilia)],
    ["noConflictingEvidence", "No conflicting evidence", true],
  ] as const;
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {rows.map(([name, label, required]) => (
        <label key={name} className="flex items-start gap-2 text-xs font-black text-neutral-800">
          <input name={name} type="checkbox" className="mt-0.5" />
          <span>{label}{required ? " — REQUIRED" : " — when applicable"}</span>
        </label>
      ))}
    </div>
  );
}

function DecisionButtons({ promote = false, blockedReason = "" }: { promote?: boolean; blockedReason?: string }) {
  return (
    <div className="mt-4">
      {blockedReason ? <Warning>VERIFY/PROMOTE BLOCKED: {blockedReason}</Warning> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" name="decision" value="verified_exact" disabled={Boolean(blockedReason)} title={blockedReason || undefined} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400">
          {promote ? "Verify Exact + Promote" : "Verify Exact"}
        </button>
        <button type="submit" name="decision" value="probable_exact" className="rounded-md bg-cyan-700 px-4 py-2 text-sm font-black text-white hover:bg-cyan-800">Probable — Keep Reviewing</button>
        <button type="submit" name="decision" value="conflict_detected" className="rounded-md bg-amber-600 px-4 py-2 text-sm font-black text-black hover:bg-amber-500">Conflict Detected</button>
        <button type="submit" name="decision" value="rejected" className="rounded-md bg-rose-700 px-4 py-2 text-sm font-black text-white hover:bg-rose-800">Reject Candidate</button>
      </div>
    </div>
  );
}

function ImageStrip({ images, title, compact = false }: { images: string[]; title: string; compact?: boolean }) {
  if (!images.length) {
    return compact ? null : <div className="flex h-48 w-full items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-100 text-sm font-black text-neutral-500 xl:w-64">NO IMAGES</div>;
  }
  return (
    <div className={`mt-4 flex gap-3 overflow-x-auto ${compact ? "" : "xl:mt-0 xl:w-72 xl:flex-col"}`}>
      {images.slice(0, 6).map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`${src}-${index}`} src={src} alt={`${title} evidence ${index + 1}`} className={`${compact ? "h-32 w-24" : "h-56 w-40 xl:h-48 xl:w-full"} shrink-0 rounded-xl border border-neutral-200 bg-white object-contain`} />
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p><p className="mt-1 break-words font-black">{value}</p></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>;
}
function Warning({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs font-black text-rose-950">{children}</p>;
}
function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 font-semibold text-neutral-600">{children}</p>;
}
function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <p className={`rounded-xl border p-4 font-black ${error ? "border-rose-300 bg-rose-50 text-rose-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}>{children}</p>;
}

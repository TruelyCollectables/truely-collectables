import "server-only";

import { revalidatePath } from "next/cache";
import { recalculateMarketIntelValue } from "./market-intel-comps";
import { scanEbayForMarketIntel } from "./market-intel-ebay";
import { createSupabaseServerClient } from "./supabase-server";

export async function resolveMarketIntelIdentity(input: {
  identityId?: string | null;
  sourceUrl?: string | null;
  listingId?: string | null;
  purchaseId?: string | null;
  candidateId?: string | null;
}) {
  const directIdentity = String(input.identityId || "").trim();
  if (directIdentity) return directIdentity;

  const supabase = createSupabaseServerClient({ admin: true });

  if (input.listingId) {
    const { data, error } = await supabase
      .from("tcos_mi_listings")
      .select("collectible_identity_id")
      .eq("id", input.listingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.collectible_identity_id) return String(data.collectible_identity_id);
  }

  if (input.purchaseId) {
    const { data, error } = await supabase
      .from("tcos_mi_purchase_lots")
      .select("collectible_identity_id")
      .eq("id", input.purchaseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.collectible_identity_id) return String(data.collectible_identity_id);
  }

  if (input.candidateId) {
    const { data, error } = await supabase
      .from("tcos_mi_identity_candidates")
      .select("approved_identity_id")
      .eq("id", input.candidateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.approved_identity_id) return String(data.approved_identity_id);
  }

  const sourceUrl = String(input.sourceUrl || "").trim();
  if (sourceUrl) {
    const [listingResult, purchaseResult, candidateResult] = await Promise.all([
      supabase
        .from("tcos_mi_listings")
        .select("collectible_identity_id")
        .eq("direct_url", sourceUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tcos_mi_purchase_lots")
        .select("collectible_identity_id")
        .eq("source_url", sourceUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tcos_mi_identity_candidates")
        .select("approved_identity_id")
        .eq("direct_url", sourceUrl)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    for (const result of [listingResult, purchaseResult, candidateResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const resolved =
      listingResult.data?.collectible_identity_id ||
      purchaseResult.data?.collectible_identity_id ||
      candidateResult.data?.approved_identity_id;
    if (resolved) return String(resolved);
  }

  return null;
}

export async function trackMarketIntelIdentityToday(identityId: string) {
  const id = String(identityId || "").trim();
  if (!id) throw new Error("Exact collectible identity is required.");

  const scan = await scanEbayForMarketIntel({
    identityIds: [id],
    maxTargets: 1,
    resultsPerTarget: 25,
    minimumConfidence: 80,
  });
  const market = await recalculateMarketIntelValue(id);

  for (const path of [
    "/admin/market-intel/watch-center",
    "/admin/market-intel/deals",
    "/admin/market-intel/buy",
    "/admin/market-intel/growth-specs",
    "/admin/market-intel/purchases",
    "/admin/market-intel/portfolio",
    `/admin/market-intel/comps/${id}`,
  ]) {
    revalidatePath(path);
  }

  const accepted = Number(scan.candidatesAccepted || 0);
  const created = Number(scan.ingest.created || 0);
  const updated = Number(scan.ingest.updated || 0);
  const scored = Number(scan.ingest.scored || 0);

  return {
    identityId: id,
    accepted,
    created,
    updated,
    scored,
    scanErrors: Number(scan.ingest.errors || 0),
    market,
    message: `Tracked today: ${accepted} exact live match${accepted === 1 ? "" : "es"}; ${created} new, ${updated} refreshed, ${scored} scored. Market snapshot now uses ${market.sample_size} verified comp${market.sample_size === 1 ? "" : "s"}.`,
  };
}

import "server-only";

import { revalidatePath } from "next/cache";
import { recalculateMarketIntelValue } from "./market-intel-comps";
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

  // Keep the manual button intentionally lightweight. Heavy eBay, Discovery, Growth,
  // alert, and cleanup work runs on the shared six-hour Vercel cron cycle.
  // Recalculation inserts a dated exact-card market snapshot from already verified comps;
  // the market-observation trigger preserves today's history point.
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

  return {
    identityId: id,
    accepted: 0,
    created: 0,
    updated: 0,
    scored: 0,
    scanErrors: 0,
    market,
    message: `Today's verified-comp snapshot was recorded using ${market.sample_size} comp${market.sample_size === 1 ? "" : "s"}. The heavy marketplace miner runs automatically every six hours.`,
  };
}

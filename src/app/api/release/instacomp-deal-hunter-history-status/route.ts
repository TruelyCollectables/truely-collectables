import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";
import { loadExactCardMarketHistory } from "../../../../lib/instacomp-market-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authorized(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) throw new Error("Production Supabase service role is not configured.");
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const since = new URL(request.url).searchParams.get("since") || "2026-08-07T18:00:00Z";
    const { count, error: countError } = await supabase
      .from("tcos_card_market_observations")
      .select("id", { count: "exact", head: true });
    if (countError) throw new Error(`History count failed: ${countError.message}`);
    const { data, error } = await supabase
      .from("tcos_card_market_observations")
      .select("registry_identity_id,observation_kind,provider_source,listing_item_id,delivered_price,created_at,observed_at,scan_id")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`History diagnostic read failed: ${error.message}`);
    const rows = data || [];
    const identityId = String(rows[0]?.registry_identity_id || "").trim();
    const history = identityId ? await loadExactCardMarketHistory(identityId) : null;
    return Response.json({
      success: true,
      schema: "truelycollectables.instacompDealHunterHistoryDiagnostics.v1",
      totalObservationCount: Number(count || 0),
      since,
      observationCountSince: rows.length,
      recent: rows.map((row) => ({
        registryIdentityId: row.registry_identity_id,
        kind: row.observation_kind,
        source: row.provider_source,
        listingItemId: row.listing_item_id,
        deliveredPrice: row.delivered_price,
        createdAt: row.created_at,
        observedAt: row.observed_at,
        scanId: row.scan_id,
      })),
      latestIdentity: history ? {
        registryIdentityId: identityId,
        observationCount: history.observations.length,
        trend: history.trend,
      } : null,
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

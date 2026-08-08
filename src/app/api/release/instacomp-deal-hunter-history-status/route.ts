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

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function safeProviderMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((row) => {
    const provider = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    return {
      label: text(provider.label),
      status: text(provider.status),
      results: Number(provider.results || 0),
      message: text(provider.message)?.slice(0, 500) || null,
    };
  });
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
    const url = new URL(request.url);
    const since = url.searchParams.get("since") || "2026-08-07T18:00:00Z";
    const runId = text(url.searchParams.get("runId"));

    const [{ count, error: countError }, { data, error }] = await Promise.all([
      supabase.from("tcos_card_market_observations").select("id", { count: "exact", head: true }),
      supabase
        .from("tcos_card_market_observations")
        .select("registry_identity_id,observation_kind,provider_source,listing_item_id,delivered_price,created_at,observed_at,scan_id")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (countError) throw new Error(`History count failed: ${countError.message}`);
    if (error) throw new Error(`History diagnostic read failed: ${error.message}`);

    let candidateRows: any[] = [];
    if (runId) {
      const { data: candidates, error: candidateError } = await supabase
        .from("tcos_deal_hunter_candidates")
        .select("id,run_id,listing_item_id,title,identity,exact_market,evaluation,updated_at")
        .eq("run_id", runId)
        .order("updated_at", { ascending: true })
        .limit(100);
      if (candidateError) throw new Error(`Candidate diagnostic read failed: ${candidateError.message}`);
      candidateRows = candidates || [];
    }

    const cutoff90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const [legacyAll, legacyRecent, legacyIdentities] = await Promise.all([
      supabase
        .from("tcos_mi_sold_comps")
        .select("id", { count: "exact", head: true })
        .eq("verified", true)
        .eq("excluded", false)
        .eq("outlier_flag", false),
      supabase
        .from("tcos_mi_sold_comps")
        .select("collectible_identity_id,sold_at,match_confidence", { count: "exact" })
        .eq("verified", true)
        .eq("excluded", false)
        .eq("outlier_flag", false)
        .gte("sold_at", cutoff90)
        .gte("match_confidence", 95)
        .order("sold_at", { ascending: false })
        .limit(1000),
      supabase
        .from("tcos_mi_collectible_identities")
        .select("id", { count: "exact", head: true })
        .eq("active", true),
    ]);
    for (const [label, result] of [
      ["Legacy sold all-time", legacyAll],
      ["Legacy sold 90-day", legacyRecent],
      ["Legacy identity", legacyIdentities],
    ] as const) {
      if (result.error) throw new Error(`${label} census failed: ${result.error.message}`);
    }
    const legacyRecentRows = legacyRecent.data || [];
    const legacyRecentIdentityCount = new Set(
      legacyRecentRows.map((row) => String(row.collectible_identity_id || "")).filter(Boolean),
    ).size;

    const rows = data || [];
    const identityId = String(rows[0]?.registry_identity_id || "").trim();
    const history = identityId ? await loadExactCardMarketHistory(identityId) : null;
    return Response.json({
      success: true,
      schema: "truelycollectables.instacompDealHunterHistoryDiagnostics.v3",
      totalObservationCount: Number(count || 0),
      since,
      observationCountSince: rows.length,
      legacySoldCensus: {
        verifiedIncludedAllTime: Number(legacyAll.count || 0),
        verifiedHighConfidenceLast90Days: Number(legacyRecent.count || legacyRecentRows.length || 0),
        identitiesWithRecentSold: legacyRecentIdentityCount,
        activeLegacyIdentities: Number(legacyIdentities.count || 0),
        cutoff90,
        newestSoldAt: legacyRecentRows[0]?.sold_at || null,
        oldestReturnedSoldAt: legacyRecentRows[legacyRecentRows.length - 1]?.sold_at || null,
      },
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
      completedRunCandidates: runId ? {
        runId,
        count: candidateRows.length,
        candidates: candidateRows.map((row) => {
          const identity = row.identity && typeof row.identity === "object" ? row.identity : {};
          const exactMarket = row.exact_market && typeof row.exact_market === "object" ? row.exact_market : {};
          const evaluation = row.evaluation && typeof row.evaluation === "object" ? row.evaluation : {};
          return {
            listingItemId: row.listing_item_id,
            title: row.title,
            updatedAt: row.updated_at,
            identity: {
              player: text(identity.player),
              year: text(identity.year),
              brand: text(identity.brand),
              setName: text(identity.setName),
              cardNumber: text(identity.cardNumber),
              parallel: text(identity.parallel),
              confidence: Number(identity.confidence || 0),
            },
            exactMarket: {
              status: text(exactMarket.status),
              missingIdentityFields: Array.isArray(exactMarket.missingIdentityFields)
                ? exactMarket.missingIdentityFields.map(text).filter(Boolean).slice(0, 10)
                : [],
              soldCount: Number(exactMarket.soldCount || 0),
              pricingEligibleSoldCount: Number(exactMarket.pricingEligibleSoldCount || 0),
              activeCount: Number(exactMarket.activeCount || 0),
              providerMessages: safeProviderMessages(exactMarket.providerMessages),
            },
            evaluation: {
              status: text(evaluation.status),
              errorCode: text(evaluation.errorCode),
              dealLabel: text(evaluation.dealLabel),
              reason: text(evaluation.reason),
            },
          };
        }),
      } : null,
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

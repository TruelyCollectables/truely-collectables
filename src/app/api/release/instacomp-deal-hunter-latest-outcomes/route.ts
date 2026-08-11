import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
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

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactCandidate(row: any) {
  const history = row?.historical_sold_memory && typeof row.historical_sold_memory === "object"
    ? row.historical_sold_memory
    : null;
  const fallback = row?.historical_sold_fallback && typeof row.historical_sold_fallback === "object"
    ? row.historical_sold_fallback
    : null;
  const identity = row?.identity && typeof row.identity === "object" ? row.identity : {};
  const evaluation = row?.evaluation && typeof row.evaluation === "object" ? row.evaluation : {};
  const configuredTeachers = Array.isArray(row?.configured_teachers)
    ? row.configured_teachers.map(String)
    : [];
  return {
    runId: String(row?.run_id || "") || null,
    title: String(row?.title || "").slice(0, 350) || null,
    listingUrl: String(row?.listing_url || "") || null,
    lane: String(row?.lane || "") || null,
    dealLabel: String(row?.deal_label || "") || null,
    actionable: row?.actionable === true,
    alertworthy: row?.alertworthy === true,
    itemPrice: numberValue(row?.item_price),
    deliveredCost: numberValue(row?.delivered_cost),
    conservativeResale: numberValue(row?.conservative_resale),
    expectedNetProfit: numberValue(row?.expected_net_profit),
    roiPercent: numberValue(row?.roi_percent),
    identity: {
      status: String(identity?.status || "") || null,
      confidence: numberValue(identity?.confidence),
      registryIdentityId: String(identity?.registryIdentityId || identity?.registry_identity_id || "") || null,
      registryFingerprintSha256:
        String(identity?.registryFingerprintSha256 || identity?.registry_fingerprint_sha256 || "") || null,
      player: String(identity?.player || "") || null,
      year: String(identity?.year || "") || null,
      brand: String(identity?.brand || "") || null,
      setName: String(identity?.setName || identity?.set_name || "") || null,
      cardNumber: String(identity?.cardNumber || identity?.card_number || "") || null,
      parallel: String(identity?.parallel || "") || null,
      serialNumber: String(identity?.serialNumber || identity?.serial_number || "") || null,
      gradingCompany: String(identity?.gradingCompany || identity?.grading_company || "") || null,
      gradeValue: identity?.gradeValue ?? identity?.grade_value ?? null,
    },
    exactMarket: {
      status: String(row?.market_status || "") || null,
      pricingEligibleSoldCount: Number(row?.pricing_eligible_sold_count || 0),
      trustedSuggestedPrice: numberValue(row?.trusted_suggested_price),
      historicalSoldMemory: history
        ? {
            used: history.used === true,
            soldCount: Number(history.soldCount || 0),
            medianDeliveredPrice: numberValue(history.medianDeliveredPrice),
            newestSoldAt: String(history.newestSoldAt || "") || null,
          }
        : null,
      historicalSoldFallback: fallback
        ? {
            used: fallback.used === true,
            soldCount: Number(fallback.soldCount || 0),
            medianDeliveredPrice: numberValue(fallback.medianDeliveredPrice),
            newestSoldAt: String(fallback.newestSoldAt || "") || null,
            error: fallback.error ? String(fallback.error).slice(0, 300) : null,
          }
        : null,
      configuredTeachers,
      requiredVotes: Number(row?.required_votes || 0),
    },
    evaluation: {
      status: String(evaluation?.status || "") || null,
      errorCode: String(evaluation?.errorCode || evaluation?.error_code || "") || null,
      errorMessage: String(evaluation?.errorMessage || evaluation?.error_message || "").slice(0, 500) || null,
    },
    updatedAt: String(row?.updated_at || "") || null,
  };
}

function shiftedIso(value: unknown, offsetMs: number) {
  const parsed = new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(parsed.getTime() + offsetMs).toISOString();
}

const CANDIDATE_PROJECTION = [
  "run_id",
  "title",
  "listing_url",
  "lane",
  "deal_label",
  "actionable",
  "alertworthy",
  "identity",
  "evaluation",
  "item_price",
  "delivered_cost",
  "conservative_resale",
  "expected_net_profit",
  "roi_percent",
  "updated_at",
  "market_status:exact_market->>status",
  "pricing_eligible_sold_count:exact_market->>pricingEligibleSoldCount",
  "trusted_suggested_price:exact_market->>trustedSuggestedPrice",
  "historical_sold_memory:exact_market->historicalSoldMemory",
  "historical_sold_fallback:exact_market->historicalSoldFallback",
  "configured_teachers:exact_market->teacherConsensus->configuredTeachers",
  "required_votes:exact_market->teacherConsensus->>requiredVotes",
].join(",");

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) {
      throw new Error("Production Supabase service role is not configured.");
    }
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: runs, error: runError } = await supabase
      .from("tcos_deal_hunter_runs")
      .select("run_id,status,started_at,completed_at,discovery_count,evaluated_count,actionable_count,manual_review_count,failure_count,summary")
      .order("completed_at", { ascending: false })
      .limit(1);
    if (runError) throw new Error(`Latest Deal Hunter run query failed: ${runError.message}`);
    const run = runs?.[0] || null;
    if (!run?.run_id) {
      return Response.json({ success: true, latestRun: null, candidates: [], summary: null });
    }

    const windowStart = shiftedIso(run.started_at || run.completed_at, -120_000);
    const windowEnd = shiftedIso(run.completed_at || run.started_at, 120_000);
    let candidateQuery = supabase
      .from("tcos_deal_hunter_candidates")
      .select(CANDIDATE_PROJECTION)
      .order("updated_at", { ascending: true })
      .limit(50);
    if (windowStart) candidateQuery = candidateQuery.gte("updated_at", windowStart);
    if (windowEnd) candidateQuery = candidateQuery.lte("updated_at", windowEnd);
    const { data: candidateRows, error: candidateError } = await candidateQuery;
    if (candidateError) {
      throw new Error(`Latest Deal Hunter candidate query failed: ${candidateError.message}`);
    }

    const candidates = (candidateRows || [])
      .filter((row: any) => String(row.run_id || "") === String(run.run_id))
      .slice(0, 25)
      .map(compactCandidate);
    const summary = {
      rowCount: candidates.length,
      memoryPriced: candidates.filter(
        (row) => row.exactMarket.historicalSoldMemory?.used || row.exactMarket.historicalSoldFallback?.used,
      ).length,
      trustedPrice: candidates.filter((row) => Number(row.exactMarket.trustedSuggestedPrice || 0) > 0).length,
      teacherRan: candidates.filter((row) => row.exactMarket.configuredTeachers.length > 0).length,
      teacherTrustedSold: candidates.filter(
        (row) => row.exactMarket.configuredTeachers.length > 0 && row.exactMarket.pricingEligibleSoldCount > 0,
      ).length,
      noTrustedSold: candidates.filter((row) => !(Number(row.exactMarket.trustedSuggestedPrice || 0) > 0)).length,
      actionable: candidates.filter((row) => row.actionable).length,
    };

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterLatestOutcomes.v2",
        latestRun: {
          runId: run.run_id,
          status: run.status,
          startedAt: run.started_at,
          completedAt: run.completed_at,
          discoveryCount: Number(run.discovery_count || 0),
          evaluatedCount: Number(run.evaluated_count || 0),
          actionableCount: Number(run.actionable_count || 0),
          manualReviewCount: Number(run.manual_review_count || 0),
          failureCount: Number(run.failure_count || 0),
          summary: run.summary || null,
        },
        queryWindow: { start: windowStart, end: windowEnd },
        summary,
        candidates,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

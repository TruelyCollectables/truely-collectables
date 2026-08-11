import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function macBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    throw new Error("Production InstaComp Mac tunnel URL is missing or invalid.");
  }
  return configured;
}

function macHeaders() {
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!key) throw new Error("Production InstaComp Mac shared key is missing.");
  return { "X-InstaComp-AI-Key": key, Accept: "application/json" };
}

async function fetchJson(url: string, options: RequestInit, label: string) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 1000) };
  }
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

function compactMacCandidate(row: any) {
  return {
    runId: String(row?.run_id || "") || null,
    candidateKey: String(row?.candidate_key || "") || null,
    title: String(row?.title || "") || null,
    listingUrl: String(row?.listing_url || "") || null,
    lane: String(row?.lane || "") || null,
    status: String(row?.status || "") || null,
    dealLabel: String(row?.deal_label || "") || null,
    actionable: row?.actionable === true || row?.actionable === 1,
    alertworthy: row?.alertworthy === true || row?.alertworthy === 1,
    errorCode: String(row?.error_code || "") || null,
    errorMessage: row?.error_message ? String(row.error_message).slice(0, 1200) : null,
    identity: row?.identity || row?.identity_json || null,
    exactMarket: row?.exact_market || row?.exact_market_json || null,
    roiPercent: row?.roi_percent ?? null,
    expectedNetProfit: row?.expected_net_profit ?? null,
    conservativeResale: row?.conservative_resale ?? null,
    deliveredCost: row?.delivered_cost ?? null,
    createdAt: String(row?.created_at || "") || null,
  };
}

function compactTeacherReceipt(row: any) {
  const market = row?.exact_market && typeof row.exact_market === "object"
    ? row.exact_market
    : {};
  const consensus = market?.teacherConsensus && typeof market.teacherConsensus === "object"
    ? market.teacherConsensus
    : null;
  const attempts = Array.isArray(consensus?.attempts) ? consensus.attempts : [];
  const learning = market?.teacherLearning && typeof market.teacherLearning === "object"
    ? market.teacherLearning
    : null;
  return {
    runId: String(row?.run_id || "") || null,
    title: String(row?.title || "").slice(0, 300) || null,
    updatedAt: String(row?.updated_at || "") || null,
    configuredTeachers: Array.isArray(consensus?.configuredTeachers)
      ? consensus.configuredTeachers.map(String)
      : [],
    requiredVotes: Number(consensus?.requiredVotes || 0),
    attempts: attempts.map((attempt: any) => ({
      teacher: String(attempt?.teacher || ""),
      configured: attempt?.configured === true,
      ok: attempt?.ok === true,
      soldCount: Array.isArray(attempt?.sold) ? attempt.sold.length : 0,
      activeCount: Array.isArray(attempt?.active) ? attempt.active.length : 0,
      error: attempt?.error ? String(attempt.error).slice(0, 500) : null,
    })),
    pricingEligibleSoldCount: Number(market?.pricingEligibleSoldCount || 0),
    teacherLearning: learning
      ? {
          status: String(learning.status || "") || null,
          trustedMarketTruth: learning.trustedMarketTruth === true,
          studentTrainingEligible: learning.studentTrainingEligible === true,
          pricingAuthority: learning.pricingAuthority === true,
        }
      : null,
  };
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const requestedMode = String(url.searchParams.get("mode") || "").trim().toLowerCase();
    const teacherOnly = requestedMode === "teachers";
    const productionOnly = requestedMode === "production" || teacherOnly;
    let macCandidates: any[] = [];
    let macCandidateError: string | null = null;

    if (!productionOnly) {
      const baseUrl = macBaseUrl();
      const headers = macHeaders();
      try {
        const macPayload = await fetchJson(
          `${baseUrl}/v1/deal-hunter/candidates?limit=50`,
          { headers },
          "Mac candidate receipts",
        );
        const rows = Array.isArray(macPayload?.candidates)
          ? macPayload.candidates
          : Array.isArray(macPayload)
            ? macPayload
            : [];
        macCandidates = rows.map(compactMacCandidate);
      } catch (error) {
        macCandidateError = error instanceof Error ? error.message : String(error);
      }
    }

    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) {
      throw new Error("Production Supabase service role is not configured.");
    }
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (teacherOnly) {
      const sinceInput = String(url.searchParams.get("since") || "").trim();
      const parsedSince = Date.parse(sinceInput);
      const since = Number.isFinite(parsedSince)
        ? new Date(parsedSince).toISOString()
        : new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: teacherRows, error: teacherError } = await supabase
        .from("tcos_deal_hunter_candidates")
        .select("run_id,title,exact_market,updated_at")
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(30);
      if (teacherError) {
        throw new Error(`Production teacher receipt diagnostics failed: ${teacherError.message}`);
      }
      const { data: latestRuns, error: runsError } = await supabase
        .from("tcos_deal_hunter_runs")
        .select("run_id,status,completed_at,discovery_count,evaluated_count,actionable_count,manual_review_count,failure_count")
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(10);
      if (runsError) {
        throw new Error(`Production run diagnostics failed: ${runsError.message}`);
      }
      return Response.json(
        {
          success: true,
          schema: "truelycollectables.instacompDealHunterTeacherDiagnostics.v1",
          mode: "teachers",
          since,
          teacherReceipts: (teacherRows || []).map(compactTeacherReceipt),
          latestRuns: latestRuns || [],
          checkedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: productionCandidates, error: productionError } = await supabase
      .from("tcos_deal_hunter_candidates")
      .select("run_id,candidate_key,title,listing_url,lane,deal_label,actionable,alertworthy,identity,exact_market,evaluation,item_price,delivered_cost,conservative_resale,expected_net_profit,roi_percent,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (productionError) {
      throw new Error(`Production candidate diagnostics failed: ${productionError.message}`);
    }

    const { data: latestRuns, error: runsError } = await supabase
      .from("tcos_deal_hunter_runs")
      .select("run_id,status,completed_at,discovery_count,evaluated_count,actionable_count,manual_review_count,failure_count,summary")
      .order("completed_at", { ascending: false })
      .limit(10);
    if (runsError) {
      throw new Error(`Production run diagnostics failed: ${runsError.message}`);
    }

    const errorCounts = new Map<string, number>();
    const labelCounts = new Map<string, number>();
    for (const row of macCandidates) {
      const code = String(row.errorCode || "NONE");
      errorCounts.set(code, (errorCounts.get(code) || 0) + 1);
      const label = String(row.dealLabel || "NONE");
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterCandidateDiagnostics.v1",
        mode: productionOnly ? "production" : "full",
        macCandidateError,
        macCandidates,
        macErrorCounts: Object.fromEntries(errorCounts),
        macDealLabelCounts: Object.fromEntries(labelCounts),
        productionCandidates: productionCandidates || [],
        latestRuns: latestRuns || [],
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

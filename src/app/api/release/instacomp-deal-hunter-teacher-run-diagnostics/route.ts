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
    const runId = String(url.searchParams.get("runId") || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
      return Response.json({ success: false, error: "A valid Deal Hunter runId is required." }, { status: 400 });
    }

    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) {
      throw new Error("Production Supabase service role is not configured.");
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: runRows, error: runError }, { data: teacherRows, error: teacherError }] = await Promise.all([
      supabase
        .from("tcos_deal_hunter_runs")
        .select("run_id,status,created_at,completed_at,discovery_count,evaluated_count,actionable_count,manual_review_count,failure_count")
        .eq("run_id", runId)
        .limit(1),
      supabase
        .from("tcos_deal_hunter_candidates")
        .select("run_id,title,exact_market,updated_at")
        .eq("run_id", runId)
        .order("updated_at", { ascending: false })
        .limit(20),
    ]);

    if (runError) {
      throw new Error(`Production run diagnostics failed: ${runError.message}`);
    }
    if (teacherError) {
      throw new Error(`Production teacher receipt diagnostics failed: ${teacherError.message}`);
    }

    const run = Array.isArray(runRows) && runRows.length > 0 ? runRows[0] : null;
    if (!run) {
      return Response.json({ success: false, error: "Deal Hunter run was not found.", runId }, { status: 404 });
    }

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterTeacherRunDiagnostics.v1",
        runId,
        run,
        teacherReceipts: (teacherRows || []).map(compactTeacherReceipt),
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

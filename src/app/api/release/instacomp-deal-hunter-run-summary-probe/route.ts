import { randomUUID } from "node:crypto";
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

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const runId = `diagnostic-${randomUUID()}`;
  let evaluateStatus = 0;
  let evaluatePayload: any = null;
  let cleanupError: string | null = null;

  try {
    const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
    if (!key) throw new Error("Production InstaComp Mac shared key is missing.");
    const origin = new URL(request.url).origin;
    const response = await fetch(`${origin}/api/instacomp/deal-hunter/evaluate`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        kind: "run_complete",
        runId,
        status: "diagnostic",
        counts: { discovery: 0, evaluated: 0, actionable: 0, manual_review: 0, failure: 0 },
        summary: { diagnostic: true, source: "release_run_summary_probe" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    evaluateStatus = response.status;
    const text = await response.text();
    try {
      evaluatePayload = text ? JSON.parse(text) : null;
    } catch {
      evaluatePayload = { raw: text.slice(0, 1500) };
    }
  } catch (error) {
    evaluatePayload = { error: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
      const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
      if (!supabaseUrl || !serviceRole) {
        cleanupError = "Production Supabase service role is not configured for cleanup.";
      } else {
        const supabase = createClient(supabaseUrl, serviceRole, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await supabase
          .from("tcos_deal_hunter_runs")
          .delete()
          .eq("run_id", runId);
        if (error) cleanupError = error.message;
      }
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }

  return Response.json(
    {
      success: evaluateStatus >= 200 && evaluateStatus < 300 && !cleanupError,
      schema: "truelycollectables.instacompDealHunterRunSummaryProbe.v1",
      evaluateStatus,
      evaluatePayload,
      cleanupSucceeded: !cleanupError,
      cleanupError,
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

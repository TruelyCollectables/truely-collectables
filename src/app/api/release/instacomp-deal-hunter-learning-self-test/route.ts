import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";
import { loadExactCardMarketHistory } from "../../../../lib/instacomp-market-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

async function jsonFetch(url: string, options: RequestInit, label: string, timeoutMs = 30_000) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
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

function macBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    throw new Error("Production InstaComp Mac tunnel URL is missing or not on truelycollectables.com.");
  }
  return configured;
}

function macHeaders() {
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!key) throw new Error("Production InstaComp Mac shared key is missing.");
  return { "X-InstaComp-AI-Key": key, Accept: "application/json" };
}

async function waitForCompletedManualRun(baseUrl: string, headers: Record<string, string>, startedAt: string) {
  const startedMs = Date.parse(startedAt);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const payload = await jsonFetch(`${baseUrl}/v1/deal-hunter/runs?limit=5`, { headers }, "Mac run receipts", 20_000);
    const runs = Array.isArray(payload?.runs) ? payload.runs : [];
    const run = runs.find((row: any) =>
      String(row?.trigger || "") === "manual" &&
      Date.parse(String(row?.started_at || "")) >= startedMs - 2_000,
    );
    if (run && String(run.status || "") !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Physical Mac did not expose a completed durable manual Deal Hunter run receipt.");
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const pass = Math.max(1, Math.min(Number(new URL(request.url).searchParams.get("pass") || 1), 2));
  const requireNewHistory = pass === 1;
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRole) {
    return Response.json({ success: false, error: "Production Supabase service role is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const baseUrl = macBaseUrl();
  const headers = macHeaders();
  const startedAt = new Date().toISOString();

  const { count: beforeCount, error: beforeError } = await supabase
    .from("tcos_card_market_observations")
    .select("id", { count: "exact", head: true });
  if (beforeError) throw new Error(`Production history pre-count failed: ${beforeError.message}`);

  const health = await jsonFetch(`${baseUrl}/health`, {}, "Physical Mac health", 20_000);
  const beforeStatus = await jsonFetch(`${baseUrl}/v1/deal-hunter/status`, { headers }, "Deal Hunter status", 20_000);
  if (health?.ok !== true) throw new Error("Physical Mac health endpoint is not ready.");
  if (beforeStatus?.enabled !== true) throw new Error("Physical Mac Deal Hunter scheduler is disabled.");
  if (beforeStatus?.mac_evaluation_key_configured !== true) throw new Error("Physical Mac evaluation key is not configured.");

  let trigger: any = null;
  try {
    trigger = await jsonFetch(
      `${baseUrl}/v1/deal-hunter/run`,
      { method: "POST", headers },
      "Physical Mac manual Deal Hunter run",
      240_000,
    );
  } catch (error) {
    if (!/timeout|abort/i.test(String(error))) throw error;
  }

  const durableRun = await waitForCompletedManualRun(baseUrl, headers, startedAt);
  if (String(durableRun.status || "") !== "completed") {
    throw new Error(`Physical Mac Deal Hunter run failed: ${String(durableRun.error_message || durableRun.status || "unknown")}`);
  }

  const { count: afterCount, error: afterError } = await supabase
    .from("tcos_card_market_observations")
    .select("id", { count: "exact", head: true });
  if (afterError) throw new Error(`Production history post-count failed: ${afterError.message}`);
  const delta = Number(afterCount || 0) - Number(beforeCount || 0);

  const { data: recent, error: recentError } = await supabase
    .from("tcos_card_market_observations")
    .select("registry_identity_id,observation_kind,observation_fingerprint,delivered_price,created_at")
    .gte("created_at", startedAt)
    .order("created_at", { ascending: false })
    .limit(50);
  if (recentError) throw new Error(`Production history readback failed: ${recentError.message}`);

  if (requireNewHistory && delta <= 0) {
    throw new Error(
      `Physical Mac run completed but wrote no new trusted market history (evaluated=${Number(durableRun.evaluated_count || 0)}, failures=${Number(durableRun.failure_count || 0)}).`,
    );
  }

  const registryIdentityId = String(recent?.[0]?.registry_identity_id || "").trim();
  let exactHistory: Awaited<ReturnType<typeof loadExactCardMarketHistory>> | null = null;
  if (registryIdentityId) {
    exactHistory = await loadExactCardMarketHistory(registryIdentityId);
    if (!exactHistory.identity || !Array.isArray(exactHistory.observations) || !exactHistory.observations.length) {
      throw new Error("New trusted Registry identity could not be read back with its market history.");
    }
  } else if (requireNewHistory) {
    throw new Error("New Production history did not expose a canonical Registry identity.");
  }

  return Response.json(
    {
      success: true,
      schema: "truelycollectables.instacompDealHunterLearningSelfTest.v1",
      pass,
      physicalMac: {
        healthy: true,
        schedulerEnabled: true,
        evaluationKeyConfigured: true,
      },
      run: {
        accepted: trigger?.accepted ?? null,
        runId: durableRun.run_id || null,
        status: durableRun.status,
        discoveryCount: Number(durableRun.discovery_count || 0),
        evaluatedCount: Number(durableRun.evaluated_count || 0),
        actionableCount: Number(durableRun.actionable_count || 0),
        manualReviewCount: Number(durableRun.manual_review_count || 0),
        failureCount: Number(durableRun.failure_count || 0),
      },
      productionHistory: {
        before: Number(beforeCount || 0),
        after: Number(afterCount || 0),
        delta,
        rowsCreatedSincePassStart: recent?.length || 0,
        registryIdentityId: registryIdentityId || null,
        historyReadable: Boolean(exactHistory?.identity && exactHistory.observations.length),
        observationCountForIdentity: exactHistory?.observations.length || 0,
        trend: exactHistory?.trend || null,
      },
      completedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

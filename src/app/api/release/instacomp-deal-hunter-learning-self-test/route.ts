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

function sanitizeRun(row: any) {
  return {
    runId: String(row?.run_id || "") || null,
    trigger: String(row?.trigger || "") || null,
    status: String(row?.status || "") || null,
    startedAt: String(row?.started_at || "") || null,
    completedAt: String(row?.completed_at || "") || null,
    discoveryCount: Number(row?.discovery_count || 0),
    evaluatedCount: Number(row?.evaluated_count || 0),
    actionableCount: Number(row?.actionable_count || 0),
    manualReviewCount: Number(row?.manual_review_count || 0),
    failureCount: Number(row?.failure_count || 0),
    error: row?.error_message ? String(row.error_message).slice(0, 600) : null,
  };
}

async function currentMacDiagnostics(baseUrl: string, headers: Record<string, string>) {
  const status = await jsonFetch(`${baseUrl}/v1/deal-hunter/status`, { headers }, "Deal Hunter status", 20_000);
  const payload = await jsonFetch(`${baseUrl}/v1/deal-hunter/runs?limit=10`, { headers }, "Mac run receipts", 20_000);
  const runs = Array.isArray(payload?.runs) ? payload.runs.map(sanitizeRun) : [];
  return {
    scheduler: {
      enabled: status?.enabled === true,
      running: status?.running === true,
      activeRunId: String(status?.active_run_id || "") || null,
      lastStartedAt: String(status?.last_started_at || "") || null,
      lastCompletedAt: String(status?.last_completed_at || "") || null,
      lastStatus: String(status?.last_status || "") || null,
      lastError: status?.last_error ? String(status.last_error).slice(0, 600) : null,
      evaluationKeyConfigured: status?.mac_evaluation_key_configured === true,
    },
    runs,
  };
}

async function waitForCompletedManualRun(baseUrl: string, headers: Record<string, string>, startedAt: string) {
  const startedMs = Date.parse(startedAt);
  for (let attempt = 0; attempt < 44; attempt += 1) {
    const payload = await jsonFetch(`${baseUrl}/v1/deal-hunter/runs?limit=10`, { headers }, "Mac run receipts", 20_000);
    const runs = Array.isArray(payload?.runs) ? payload.runs : [];
    const run = runs.find((row: any) =>
      String(row?.trigger || "") === "manual" &&
      Date.parse(String(row?.started_at || "")) >= startedMs - 2_000,
    );
    if (run && String(run.status || "") !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const diagnostics = await currentMacDiagnostics(baseUrl, headers);
  throw new Error(`Physical Mac did not complete a durable manual Deal Hunter run in the bounded window. Diagnostics=${JSON.stringify(diagnostics).slice(0, 4000)}`);
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const mode = String(url.searchParams.get("mode") || "run").toLowerCase();
    const baseUrl = macBaseUrl();
    const headers = macHeaders();

    if (mode === "status") {
      const health = await jsonFetch(`${baseUrl}/health`, {}, "Physical Mac health", 20_000);
      const diagnostics = await currentMacDiagnostics(baseUrl, headers);
      return Response.json({
        success: true,
        schema: "truelycollectables.instacompDealHunterLearningDiagnostics.v1",
        physicalMacHealthy: health?.ok === true,
        ...diagnostics,
        checkedAt: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const requestedPass = Number(url.searchParams.get("pass") || 1);
    const pass = requestedPass === 2 ? 2 : 1;
    const requireNewHistory = pass === 1;
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) {
      return Response.json({ success: false, error: "Production Supabase service role is not configured." }, { status: 503 });
    }

    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const startedAt = new Date().toISOString();

    const { count: beforeCount, error: beforeError } = await supabase
      .from("tcos_card_market_observations")
      .select("id", { count: "exact", head: true });
    if (beforeError) throw new Error(`Production history pre-count failed: ${beforeError.message}`);

    const health = await jsonFetch(`${baseUrl}/health`, {}, "Physical Mac health", 20_000);
    const beforeDiagnostics = await currentMacDiagnostics(baseUrl, headers);
    const beforeStatus = beforeDiagnostics.scheduler;
    if (health?.ok !== true) throw new Error("Physical Mac health endpoint is not ready.");
    if (beforeStatus?.enabled !== true) throw new Error("Physical Mac Deal Hunter scheduler is disabled.");
    if (beforeStatus?.evaluationKeyConfigured !== true) throw new Error("Physical Mac evaluation key is not configured.");

    if (beforeStatus.running) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const state = await currentMacDiagnostics(baseUrl, headers);
        if (!state.scheduler.running) break;
        if (attempt === 19) {
          throw new Error(`Physical Mac already had a run active and it did not clear. Diagnostics=${JSON.stringify(state).slice(0, 4000)}`);
        }
      }
    }

    let trigger: any = null;
    try {
      trigger = await jsonFetch(
        `${baseUrl}/v1/deal-hunter/run`,
        { method: "POST", headers },
        "Physical Mac manual Deal Hunter run",
        25_000,
      );
    } catch (error) {
      if (!/timeout|abort/i.test(String(error))) throw error;
    }

    let durableRun: any = null;
    if (trigger?.accepted === true && String(trigger?.status || "") && trigger?.run_id) {
      const receipts = await jsonFetch(`${baseUrl}/v1/deal-hunter/runs?limit=10`, { headers }, "Mac run receipts", 20_000);
      durableRun = (Array.isArray(receipts?.runs) ? receipts.runs : []).find((row: any) => row?.run_id === trigger.run_id && String(row?.status || "") !== "running") || null;
    }
    if (!durableRun) durableRun = await waitForCompletedManualRun(baseUrl, headers, startedAt);
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

    let registryIdentityId = String(recent?.[0]?.registry_identity_id || "").trim();
    if (!registryIdentityId) {
      const { data: latest, error: latestError } = await supabase
        .from("tcos_card_market_observations")
        .select("registry_identity_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw new Error(`Latest retained history lookup failed: ${latestError.message}`);
      registryIdentityId = String(latest?.registry_identity_id || "").trim();
    }

    if (!registryIdentityId) throw new Error("Production contains no canonical Registry-backed market history to read back.");
    const exactHistory = await loadExactCardMarketHistory(registryIdentityId);
    if (!exactHistory.identity || !Array.isArray(exactHistory.observations) || !exactHistory.observations.length) {
      throw new Error("Trusted Registry identity could not be read back with its retained market history.");
    }

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterLearningSelfTest.v2",
        pass,
        physicalMac: { healthy: true, schedulerEnabled: true, evaluationKeyConfigured: true },
        run: sanitizeRun(durableRun),
        productionHistory: {
          before: Number(beforeCount || 0),
          after: Number(afterCount || 0),
          delta,
          rowsCreatedSincePassStart: recent?.length || 0,
          registryIdentityId,
          historyReadable: true,
          observationCountForIdentity: exactHistory.observations.length,
          trend: exactHistory.trend,
        },
        completedAt: new Date().toISOString(),
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

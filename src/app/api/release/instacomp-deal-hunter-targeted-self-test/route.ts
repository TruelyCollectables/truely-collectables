import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

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

async function jsonFetch(
  url: string,
  options: RequestInit,
  label: string,
  timeoutMs = 30_000,
) {
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
    throw new Error(
      `${label} returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`,
    );
  }
  return payload;
}

function sanitizeRun(row: any) {
  return {
    runId: String(row?.run_id || row?.runId || "") || null,
    trigger: String(row?.trigger || "") || null,
    status: String(row?.status || "") || null,
    startedAt: String(row?.started_at || row?.startedAt || "") || null,
    completedAt: String(row?.completed_at || row?.completedAt || "") || null,
    discoveryCount: Number(row?.discovery_count ?? row?.discoveryCount ?? 0),
    evaluatedCount: Number(row?.evaluated_count ?? row?.evaluatedCount ?? 0),
    actionableCount: Number(row?.actionable_count ?? row?.actionableCount ?? 0),
    manualReviewCount: Number(row?.manual_review_count ?? row?.manualReviewCount ?? 0),
    failureCount: Number(row?.failure_count ?? row?.failureCount ?? 0),
    error: row?.error_message
      ? String(row.error_message).slice(0, 600)
      : row?.error
        ? String(row.error).slice(0, 600)
        : null,
  };
}

async function requireMacReady(baseUrl: string, headers: Record<string, string>) {
  const health = await jsonFetch(`${baseUrl}/health`, {}, "Physical Mac health", 20_000);
  if (health?.ok !== true) throw new Error("Physical Mac health endpoint is not ready.");

  const status = await jsonFetch(
    `${baseUrl}/v1/deal-hunter/status`,
    { headers },
    "Deal Hunter status",
    20_000,
  );
  if (status?.enabled !== true) throw new Error("Physical Mac Deal Hunter scheduler is disabled.");
  if (status?.mac_evaluation_key_configured !== true) {
    throw new Error("Physical Mac evaluation key is not configured.");
  }
  return status;
}

async function recentRuns(baseUrl: string, headers: Record<string, string>) {
  const receipts = await jsonFetch(
    `${baseUrl}/v1/deal-hunter/runs?limit=50`,
    { headers },
    "Mac run receipts",
    20_000,
  );
  return Array.isArray(receipts?.runs) ? receipts.runs : [];
}

function recentTargetedRun(runs: any[], startedMs: number) {
  return runs.find(
    (row: any) =>
      String(row?.trigger || "") === "manual_targeted" &&
      Date.parse(String(row?.started_at || "")) >= startedMs - 2_000,
  );
}

async function startTargetedRun(
  baseUrl: string,
  headers: Record<string, string>,
  limit: number,
) {
  const statusBefore = await requireMacReady(baseUrl, headers);
  if (statusBefore?.running === true) {
    throw new Error(
      `Physical Mac already has an active Deal Hunter run: ${String(statusBefore?.active_run_id || "unknown")}`,
    );
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.parse(startedAt);
  let trigger: any = null;
  let triggerTimedOut = false;
  try {
    trigger = await jsonFetch(
      `${baseUrl}/v1/deal-hunter/run-targeted?lane=ivan_demidov&force=true&limit=${limit}`,
      { method: "POST", headers },
      "Physical Mac targeted Ivan Deal Hunter run",
      25_000,
    );
  } catch (error) {
    if (!/timeout|abort/i.test(String(error))) throw error;
    triggerTimedOut = true;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const [statusNow, runs] = await Promise.all([
      jsonFetch(
        `${baseUrl}/v1/deal-hunter/status`,
        { headers },
        "Deal Hunter status after targeted start",
        20_000,
      ),
      recentRuns(baseUrl, headers),
    ]);

    const durable = recentTargetedRun(runs, startedMs);
    if (durable) {
      return {
        run: sanitizeRun(durable),
        triggerAccepted: trigger?.accepted ?? true,
        triggerTimedOut,
      };
    }

    const activeRunId = String(statusNow?.active_run_id || "").trim();
    if (statusNow?.running === true && /^[0-9a-f-]{36}$/i.test(activeRunId)) {
      return {
        run: sanitizeRun({
          run_id: activeRunId,
          trigger: "manual_targeted",
          status: "running",
          started_at: startedAt,
        }),
        triggerAccepted: trigger?.accepted ?? true,
        triggerTimedOut,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("Physical Mac accepted no durable targeted Ivan run in the bounded start window.");
}

async function pollTargetedRun(
  baseUrl: string,
  headers: Record<string, string>,
  runId: string,
) {
  const [status, runs] = await Promise.all([
    requireMacReady(baseUrl, headers),
    recentRuns(baseUrl, headers),
  ]);
  const durable = runs.find((row: any) => String(row?.run_id || "") === runId);
  if (durable) return sanitizeRun(durable);

  if (status?.running === true && String(status?.active_run_id || "") === runId) {
    return sanitizeRun({ run_id: runId, trigger: "manual_targeted", status: "running" });
  }

  throw new Error(`Targeted Ivan run ${runId} was not found in current Mac receipts.`);
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const lane = String(url.searchParams.get("lane") || "ivan_demidov").trim();
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 10)));
    const mode = String(url.searchParams.get("mode") || "wait").trim().toLowerCase();
    if (lane !== "ivan_demidov") {
      return Response.json(
        { success: false, error: "This acceptance route is locked to ivan_demidov." },
        { status: 400 },
      );
    }

    const baseUrl = macBaseUrl();
    const headers = macHeaders();

    if (mode === "start") {
      const started = await startTargetedRun(baseUrl, headers, limit);
      if (!started.run.runId) throw new Error("Targeted Ivan start returned no run ID.");
      return Response.json(
        {
          success: true,
          schema: "truelycollectables.instacompDealHunterTargetedSelfTest.v2",
          mode: "start",
          lane,
          forceCooldownBypass: true,
          requestedLimit: limit,
          triggerAccepted: started.triggerAccepted,
          triggerTimedOut: started.triggerTimedOut,
          run: started.run,
          checkedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (mode === "poll") {
      const runId = String(url.searchParams.get("runId") || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
        return Response.json(
          { success: false, error: "A valid targeted Deal Hunter runId is required." },
          { status: 400 },
        );
      }
      const run = await pollTargetedRun(baseUrl, headers, runId);
      return Response.json(
        {
          success: true,
          schema: "truelycollectables.instacompDealHunterTargetedSelfTest.v2",
          mode: "poll",
          lane,
          run,
          checkedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (mode !== "wait") {
      return Response.json(
        { success: false, error: "Unsupported mode. Use wait, start, or poll." },
        { status: 400 },
      );
    }

    const status = await requireMacReady(baseUrl, headers);
    if (status?.running === true) {
      throw new Error(
        `Physical Mac already has an active Deal Hunter run: ${String(status?.active_run_id || "unknown")}`,
      );
    }

    const startedAt = new Date().toISOString();
    let trigger: any = null;
    try {
      trigger = await jsonFetch(
        `${baseUrl}/v1/deal-hunter/run-targeted?lane=ivan_demidov&force=true&limit=${limit}`,
        { method: "POST", headers },
        "Physical Mac targeted Ivan Deal Hunter run",
        25_000,
      );
    } catch (error) {
      if (!/timeout|abort/i.test(String(error))) throw error;
    }

    const startedMs = Date.parse(startedAt);
    let durableRun: any = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await recentRuns(baseUrl, headers);
      durableRun = recentTargetedRun(runs, startedMs);
      if (durableRun && String(durableRun?.status || "") !== "running") break;
      durableRun = null;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    if (!durableRun) {
      throw new Error("Physical Mac did not complete a durable targeted Ivan run in the bounded window.");
    }
    if (String(durableRun.status || "") !== "completed") {
      throw new Error(
        `Targeted Ivan run failed: ${String(durableRun.error_message || durableRun.status || "unknown")}`,
      );
    }
    if (Number(durableRun.discovery_count || 0) <= 0) {
      throw new Error("Targeted Ivan run discovered zero candidates.");
    }
    if (Number(durableRun.evaluated_count || 0) <= 0) {
      throw new Error("Targeted Ivan run evaluated zero candidates.");
    }

    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterTargetedSelfTest.v1",
        lane,
        forceCooldownBypass: true,
        requestedLimit: limit,
        triggerAccepted: trigger?.accepted ?? null,
        run: sanitizeRun(durableRun),
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

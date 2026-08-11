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

function compact(row: any) {
  return {
    runId: String(row?.run_id || "") || null,
    candidateKey: String(row?.candidate_key || "") || null,
    lane: String(row?.lane || "") || null,
    title: String(row?.title || "").slice(0, 300) || null,
    status: String(row?.status || "") || null,
    dealLabel: String(row?.deal_label || "") || null,
    errorCode: String(row?.error_code || "") || null,
    errorMessage: row?.error_message ? String(row.error_message).slice(0, 1800) : null,
    actionable: row?.actionable === true || row?.actionable === 1,
    alertworthy: row?.alertworthy === true || row?.alertworthy === 1,
    createdAt: String(row?.created_at || "") || null,
  };
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(`${macBaseUrl()}/v1/deal-hunter/candidates?limit=50`, {
      headers: macHeaders(),
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
      throw new Error(`Mac candidate receipts returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
    }
    const source = Array.isArray(payload?.candidates)
      ? payload.candidates
      : Array.isArray(payload)
        ? payload
        : [];
    const candidates = source.map(compact);
    const errorCounts = new Map<string, number>();
    for (const row of candidates) {
      const key = String(row.errorCode || "NONE");
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterMacCandidateDiagnostics.v1",
        candidates,
        errorCounts: Object.fromEntries(errorCounts),
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

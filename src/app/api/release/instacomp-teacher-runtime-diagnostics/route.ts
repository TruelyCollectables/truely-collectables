import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";
import { resolveInstaCompTeacherRuntimeConfiguration } from "../../../../lib/instacomp-teacher-runtime-status";

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
  return /^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)
    ? configured
    : null;
}

function macHeaders() {
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  return key ? { "X-InstaComp-AI-Key": key, Accept: "application/json" } : null;
}

async function macTrainingReadiness() {
  const baseUrl = macBaseUrl();
  const headers = macHeaders();
  if (!baseUrl || !headers) {
    return {
      reachable: false,
      teacherLearningEndpointAvailable: false,
      status: "not_configured",
      teacherCompLearning: null,
      error: null,
    };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/training/readiness`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok) {
      return {
        reachable: false,
        teacherLearningEndpointAvailable: false,
        status: "error",
        teacherCompLearning: null,
        error: `Mac training readiness returned HTTP ${response.status}`,
      };
    }
    const teacherCompLearning = payload.teacher_comp_learning || null;
    return {
      reachable: true,
      teacherLearningEndpointAvailable: Boolean(teacherCompLearning),
      status: teacherCompLearning ? "ready" : "service_update_required",
      teacherCompLearning,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      teacherLearningEndpointAvailable: false,
      status: "error",
      teacherCompLearning: null,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    };
  }
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // Vercel Functions provide OIDC on the request context/header. Builds/local
  // pulls may instead expose VERCEL_OIDC_TOKEN directly. Feed only the presence
  // into the status resolver; the token value is never returned.
  const requestOidc = String(request.headers.get("x-vercel-oidc-token") || "").trim();
  const configuration = resolveInstaCompTeacherRuntimeConfiguration({
    ...process.env,
    VERCEL_OIDC_TOKEN:
      String(process.env.VERCEL_OIDC_TOKEN || "").trim() || requestOidc || undefined,
  });
  const mac = await macTrainingReadiness();
  return Response.json(
    {
      success: true,
      schema: "truelycollectables.instacompTeacherRuntimeDiagnostics.v2",
      configuration,
      mac,
      boundaries: {
        secretValuesExposed: false,
        instaCompAiPricingAuthority: false,
        instaCompAiIdentityAuthorityFromTeacherReceipts: false,
        minimumVotingTeachersForTrustedSoldTruth: 2,
        duplicateProviderFamilyVotesAllowed: false,
      },
      checkedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

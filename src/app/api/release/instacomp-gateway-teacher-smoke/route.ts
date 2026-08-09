import { getTeacherExactMarketProviders } from "../../../../lib/instacomp-teacher-market-provider";
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

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // This call intentionally supplies no model-provider key and no manually
  // forwarded OIDC token. A successful response therefore proves the deployed
  // Vercel Function's automatic AI Gateway OIDC path and both search tools.
  const result = await getTeacherExactMarketProviders({
    exactTitle: "2025 Panini Prizm WNBA Hailey Van Lith #139 Cracked Ice Prizm",
    ai: {
      player: "Hailey Van Lith",
      year: "2025",
      brand: "Panini Prizm WNBA",
      setName: "Base",
      cardNumber: "139",
      parallel: "Cracked Ice Prizm",
      serialNumber: null,
      gradingCompany: null,
      gradeValue: null,
      isRookie: true,
      isAuto: false,
      isRelic: false,
    } as any,
  });

  const gatewayAttempts = result.attempts.filter((attempt) =>
    ["gateway_inclusionai", "gateway_poolside"].includes(attempt.teacher),
  );
  const inclusionAi = gatewayAttempts.find((attempt) => attempt.teacher === "gateway_inclusionai") || null;
  const poolside = gatewayAttempts.find((attempt) => attempt.teacher === "gateway_poolside") || null;
  const operational = Boolean(
    inclusionAi?.configured && inclusionAi.ok && poolside?.configured && poolside.ok,
  );

  return Response.json(
    {
      success: operational,
      schema: "truelycollectables.instacompGatewayTeacherSmoke.v2",
      automaticVercelGatewayAuthProven: operational,
      gatewayTeachersOperational: operational,
      configuredTeachers: result.configuredTeachers,
      requiredVotes: result.requiredVotes,
      gatewayAttempts,
      consensusSoldStatus: result.sold.status,
      consensusSoldCount: result.sold.results.length,
      discoverySoldCount: result.discovery.sold.length,
      discoveryActiveCount: result.discovery.active.length,
      boundaries: {
        secretsExposed: false,
        directSoldUrlsExposed: false,
        pricingAuthorityGrantedToInstaCompAi: false,
        identityTruthMutated: false,
      },
      checkedAt: new Date().toISOString(),
    },
    {
      status: operational ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

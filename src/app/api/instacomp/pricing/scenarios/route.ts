import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import { compareKingmakerPricingScenarios, type KingmakerPricingScenario } from "../../../../../lib/kingmaker-pricing-profile-scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !Array.isArray(body.scenarios)) {
      return NextResponse.json({ ok: false, error: "scenarios is required." }, { status: 400 });
    }
    const comparison = compareKingmakerPricingScenarios(body.scenarios as KingmakerPricingScenario[]);
    return NextResponse.json({ ok: true, comparison, sourceDisclosure: null }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not compare pricing scenarios.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

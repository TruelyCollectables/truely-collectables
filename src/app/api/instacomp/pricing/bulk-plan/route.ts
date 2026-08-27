import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import {
  buildKingmakerBulkPricingPlan,
  kingmakerBulkPricingPlanToCsv,
  type KingmakerBulkPricingCandidate,
} from "../../../../../lib/kingmaker-pricing-bulk-planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !Array.isArray(body.candidates)) {
      return NextResponse.json({ ok: false, error: "candidates is required." }, { status: 400 });
    }

    const candidates = body.candidates.slice(0, 100) as KingmakerBulkPricingCandidate[];
    const plan = buildKingmakerBulkPricingPlan(candidates);
    const format = String(body.format || "json").toLowerCase();

    if (format === "csv") {
      return new NextResponse(kingmakerBulkPricingPlanToCsv(plan), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=pricing-bulk-plan.csv",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      plan,
      sourceDisclosure: null,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build bulk pricing plan.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

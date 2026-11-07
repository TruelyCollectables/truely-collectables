import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { getKingmakerPricingCommandCenterSnapshot } from "../../../../../lib/kingmaker-pricing-command-center-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const snapshot = await getKingmakerPricingCommandCenterSnapshot(actor);
    return NextResponse.json({ ok: true, snapshot, sourceDisclosure: null }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Pricing Command Center.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

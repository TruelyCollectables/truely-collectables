import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import {
  createKingmakerPricingSavedView,
  listKingmakerPricingSavedViews,
} from "../../../../../lib/kingmaker-pricing-command-center-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const views = await listKingmakerPricingSavedViews(actor);
    return NextResponse.json({ ok: true, views, sourceDisclosure: null }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load saved views.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: "A JSON request body is required." }, { status: 400 });
    const view = await createKingmakerPricingSavedView(actor, body);
    return NextResponse.json({ ok: true, view, sourceDisclosure: null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create saved view.";
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

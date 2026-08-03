import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../lib/instacomp-mutation-security";
import {
  retireKingmakerPricingProfile,
  updateKingmakerPricingProfile,
} from "../../../../../../lib/kingmaker-pricing-profile-lifecycle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ profileId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const { profileId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: "A JSON request body is required." }, { status: 400 });
    const result = await updateKingmakerPricingProfile({ actor, profileId, body });
    return NextResponse.json({ ok: true, ...result, sourceDisclosure: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update pricing profile.";
    const status = message.includes("changed") || message.includes("not found") ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const { profileId } = await context.params;
    const result = await retireKingmakerPricingProfile({ actor, profileId });
    return NextResponse.json({ ok: true, ...result, sourceDisclosure: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retire pricing profile.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

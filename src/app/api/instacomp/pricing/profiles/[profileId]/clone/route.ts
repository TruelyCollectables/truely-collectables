import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../../lib/instacomp-mutation-security";
import { cloneKingmakerPricingProfile } from "../../../../../../../lib/kingmaker-pricing-profile-lifecycle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ profileId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const { profileId } = await context.params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await cloneKingmakerPricingProfile({
      actor,
      profileId,
      name: body.name,
      isDefault: body.isDefault === true,
    });
    return NextResponse.json({ ok: true, ...result, sourceDisclosure: null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not clone pricing profile.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

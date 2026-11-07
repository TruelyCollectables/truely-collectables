import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../lib/instacomp-mutation-security";
import { KINGMAKER_PRICING_PROFILE_PRESETS } from "../../../../../../lib/kingmaker-pricing-profile-lifecycle";
import { createKingmakerPricingProfileFromPreset } from "../../../../../../lib/kingmaker-pricing-profile-lifecycle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireInstaCompJobActor(request);
    return NextResponse.json({ ok: true, presets: KINGMAKER_PRICING_PROFILE_PRESETS, sourceDisclosure: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load pricing presets.";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: "A JSON request body is required." }, { status: 400 });
    const result = await createKingmakerPricingProfileFromPreset({
      actor,
      presetId: body.presetId,
      name: body.name,
      isDefault: body.isDefault === true,
    });
    return NextResponse.json({ ok: true, ...result, sourceDisclosure: null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create pricing profile preset.";
    const status = message.includes("Unknown") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

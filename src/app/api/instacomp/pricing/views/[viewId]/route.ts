import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../../lib/instacomp-mutation-security";
import { retireKingmakerPricingSavedView } from "../../../../../../lib/kingmaker-pricing-command-center-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ viewId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const { viewId } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "A JSON request body with expectedVersion is required." },
        { status: 400 },
      );
    }
    const result = await retireKingmakerPricingSavedView(
      actor,
      viewId,
      body.expectedVersion,
    );
    return NextResponse.json({ ok: true, ...result, sourceDisclosure: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retire saved view.";
    const status = message.includes("expectedVersion is required")
      ? 400
      : message.includes("changed")
        ? 409
        : message.includes("not found")
          ? 404
          : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import { buildPendingListingIdentity } from "../../../../lib/instacomp-pending-listing-identity";
import type { InstaCompChecklistLookupInput } from "../../../../lib/instacomp-checklist-first";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(req);
    assertTrustedInstaCompMutationRequest({ request: req, actor });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "A JSON pending-listing identity payload is required." },
        { status: 400 },
      );
    }

    const input: InstaCompChecklistLookupInput = {
      year: text((body as any).year),
      manufacturer: text((body as any).manufacturer),
      cardNumber: text((body as any).cardNumber),
      player: text((body as any).player),
      serialNumber: text((body as any).serialNumber),
      isAuto: optionalBoolean((body as any).isAuto),
      isRelic: optionalBoolean((body as any).isRelic),
      parallel: text((body as any).parallel),
      variation: text((body as any).variation),
    };

    const decision = await resolveInstaCompChecklistFirstFromRegistry(input);
    const pendingListingIdentity = buildPendingListingIdentity({ input, decision });

    return NextResponse.json({
      ok: true,
      pendingListingIdentity,
      checklistDecision: {
        status: decision.status,
        aiRequired: decision.aiRequired,
        candidateCount: decision.candidates.length,
        reasons: decision.reasons,
      },
      nextAction:
        pendingListingIdentity.status === "identified"
          ? "Apply lockedFields to the pending listing, preserve the Registry identity and fingerprint, then run InstaComp marketplace comp search."
          : "Keep the pending listing in review and use AI only to resolve missing or ambiguous identity evidence.",
    });
  } catch (error) {
    console.error("Pending listing checklist identification failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Pending listing checklist identification failed.",
      },
      { status: 500 },
    );
  }
}

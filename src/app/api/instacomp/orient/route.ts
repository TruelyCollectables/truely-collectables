import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import {
  detectInstaCompSideOrientations,
  type InstaCompOrientationDecision,
} from "../../../../lib/instacomp-image-orientation";
import { readValidatedInstaCompImage } from "../../../../lib/instacomp-image-safety";
import {
  InstaCompMutationSecurityError,
  assertTrustedInstaCompMutationRequest,
} from "../../../../lib/instacomp-mutation-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const requestedMinimumConfidence = Number(
  process.env.INSTACOMP_ORIENTATION_MIN_CONFIDENCE || 0.55,
);
const MINIMUM_CONFIDENCE = Number.isFinite(requestedMinimumConfidence)
  ? Math.max(0.5, Math.min(0.99, requestedMinimumConfidence))
  : 0.55;

function reviewReasons(
  orientation: InstaCompOrientationDecision,
  hasBack: boolean,
) {
  const reasons: string[] = [];
  if (orientation.status !== "completed") {
    reasons.push(
      `Automatic text orientation did not complete: ${orientation.reason}`,
    );
    return reasons;
  }
  if (orientation.frontConfidence < MINIMUM_CONFIDENCE) {
    reasons.push(
      `Front orientation confidence was ${(orientation.frontConfidence * 100).toFixed(0)}%; visually confirm the front is upright.`,
    );
  }
  if (hasBack && orientation.backConfidence < MINIMUM_CONFIDENCE) {
    reasons.push(
      `Back orientation confidence was ${(orientation.backConfidence * 100).toFixed(0)}%; visually confirm the back is upright.`,
    );
  }
  return reasons;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });

    const formData = await request.formData();
    const frontValue = formData.get("frontImage");
    const backValue = formData.get("backImage");
    const frontImage = frontValue instanceof File ? frontValue : null;
    const backImage =
      backValue instanceof File && backValue.size > 0 ? backValue : null;

    if (!frontImage) {
      return NextResponse.json(
        { ok: false, error: "Upload a front card image." },
        { status: 400 },
      );
    }

    const [front, back] = await Promise.all([
      readValidatedInstaCompImage(frontImage, "Front image"),
      backImage
        ? readValidatedInstaCompImage(backImage, "Back image")
        : Promise.resolve(null),
    ]);

    const orientation = await detectInstaCompSideOrientations({
      frontDataUrl: front.dataUrl,
      backDataUrl: back?.dataUrl || null,
    });

    return NextResponse.json(
      {
        ok: true,
        orientation,
        reviewReasons: reviewReasons(orientation, Boolean(back)),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Automatic card orientation failed.",
        ...(error instanceof InstaCompMutationSecurityError
          ? { code: error.code }
          : {}),
      },
      {
        status:
          error instanceof InstaCompMutationSecurityError
            ? error.status
            : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}

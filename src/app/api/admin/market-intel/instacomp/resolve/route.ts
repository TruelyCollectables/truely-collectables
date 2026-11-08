import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import {
  resolveMarketIntelIdentity,
  trackMarketIntelIdentityToday,
} from "../../../../../../lib/market-intel-track-today";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function resolutionInput(request: NextRequest) {
  return {
    identityId: request.nextUrl.searchParams.get("identityId"),
    sourceUrl: request.nextUrl.searchParams.get("sourceUrl"),
    listingId: request.nextUrl.searchParams.get("listingId"),
    purchaseId: request.nextUrl.searchParams.get("purchaseId"),
    candidateId: request.nextUrl.searchParams.get("candidateId"),
  };
}

export async function GET(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const identityId = await resolveMarketIntelIdentity(resolutionInput(request));
    if (!identityId) {
      throw new Error(
        "This card does not have an approved exact identity yet. Complete exact-card review first.",
      );
    }
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps/${identityId}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to resolve InstaComp™.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/comps?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const identityId = await resolveMarketIntelIdentity(resolutionInput(request));
    if (!identityId) {
      throw new Error(
        "This card does not have an approved exact identity yet. Complete exact-card review first.",
      );
    }
    const result = await trackMarketIntelIdentityToday(identityId);
    return NextResponse.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to track this card today.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

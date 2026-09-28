import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/kingmaker-local-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retired legacy image editor. KINGMAKER image truth now lives exclusively in
// the Mac-local scan archive and the active seller image-rotation route.
export async function POST(request: NextRequest) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    {
      success: false,
      code: "LEGACY_KINGMAKER_IMAGE_ROUTE_RETIRED",
      error:
        "This legacy image editor has been retired. KINGMAKER images are Mac-local only.",
      replacement:
        "/api/account/seller/inventory/instacomp-image-rotate",
      sourceAuthority: "mac_local",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

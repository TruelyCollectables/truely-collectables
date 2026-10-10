import { NextRequest } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import { getInstaCompAiLocalArchivedImage } from "../../../../lib/instacomp-ai-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });
  const isOwner = [
    "sales@truelycollectables.com",
    "sales@trulycollectables.com",
  ].includes(String(account.email || "").trim().toLowerCase());
  if (!isOwner) {
    return Response.json({ error: "KINGMAKER scan images are owner-only." }, { status: 403 });
  }

  const scanId = String(request.nextUrl.searchParams.get("scanId") || "").trim();
  const sideParam = String(request.nextUrl.searchParams.get("side") || "").trim().toLowerCase();
  if (!scanId || scanId.length > 200) {
    return Response.json({ error: "A valid scanId is required." }, { status: 400 });
  }
  if (sideParam !== "front" && sideParam !== "back") {
    return Response.json({ error: "side must be front or back." }, { status: 400 });
  }
  const side = sideParam as "front" | "back";
  try {
    const image = await getInstaCompAiLocalArchivedImage({ scanId, side });
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        ...(image.sha256 ? { "X-InstaComp-Image-Sha256": image.sha256 } : {}),
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Image unavailable" }, { status: 404 });
  }
}

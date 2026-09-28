import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import { fetchInstaCompAiLocalScanImage } from "../../../../lib/instacomp-ai-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scanId = String(request.nextUrl.searchParams.get("scanId") || "").trim();
  const side = String(request.nextUrl.searchParams.get("side") || "")
    .trim()
    .toLowerCase();
  if (!scanId || (side !== "front" && side !== "back")) {
    return NextResponse.json(
      { error: "scanId and side=front|back are required." },
      { status: 400 },
    );
  }

  try {
    const file = await fetchInstaCompAiLocalScanImage({
      scanId,
      side: side as "front" | "back",
      timeoutMs: 10_000,
    });
    return new NextResponse(await file.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": file.type || "image/jpeg",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Mac-local scan image could not be loaded.",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}

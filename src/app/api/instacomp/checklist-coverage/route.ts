import { NextResponse } from "next/server";
import { isValidInstaCompServiceRequest } from "../../../../lib/instacomp-job-server";
import { postInstaCompMacRegistry } from "../../../../lib/instacomp-mac-registry-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isValidInstaCompServiceRequest(request)) {
    return NextResponse.json(
      { ok: false, registryAuthenticated: false, authority: "mac_local_registry", error: "Valid InstaComp service authentication is required." },
      { status: 401 },
    );
  }
  try {
    const data = await postInstaCompMacRegistry("/api/instacomp/registry-stats", {}, 10_000);
    const activeLiveVersions = Number(data.activeReleases || 0);
    const activeLiveCards = Number(data.activeIdentities || 0);
    return NextResponse.json({
      ok: activeLiveVersions > 0 && activeLiveCards > 0,
      registryAuthenticated: true,
      authority: "mac_local_registry",
      activeLiveVersions,
      activeLiveCards,
      lookupScope: "Mac-local authoritative Registry identities",
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      registryAuthenticated: false,
      authority: "mac_local_registry",
      activeLiveVersions: 0,
      activeLiveCards: 0,
      error: error instanceof Error ? error.message : "Mac Registry coverage audit failed.",
    }, { status: 503 });
  }
}

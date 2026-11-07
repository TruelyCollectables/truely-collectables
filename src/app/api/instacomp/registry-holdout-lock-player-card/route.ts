import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";
import { isValidInstaCompSentinelArchiveRequest } from "../../../../lib/instacomp-sentinel-auth";
import { postInstaCompMacRegistry } from "../../../../lib/instacomp-mac-registry-client";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const sentinelMacRequest = isValidInstaCompSentinelArchiveRequest(req);
    const actor = sentinelMacRequest
      ? { type: "admin" as const, storeId: getActiveStoreId(), sellerAccountId: null }
      : await requireInstaCompJobActor(req);
    if (!sentinelMacRequest) {
      assertTrustedInstaCompMutationRequest({ request: req, actor });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data = await postInstaCompMacRegistry(
      "/api/instacomp/registry-lock",
      body,
      25_000,
    );
    const exact = String(data.resolverStatus || data.status || "") === "internal_exact_match" ||
      String(data.status || "") === "exact_match";

    return NextResponse.json({
      ...data,
      ok: true,
      resolver: "trustedHoldoutMacRegistryPlayerCardCompat",
      holdoutAuthority: "mac_local_registry",
      cloudRegistryAuthority: false,
      identificationPath: exact
        ? "trusted_holdout_mac_registry_bootstrap_pending_physical_revalidation"
        : String(data.identificationPath || "review_required"),
    });
  } catch (error) {
    console.error("Mac-local trusted holdout Registry proxy error:", error);
    return NextResponse.json(
      {
        ok: false,
        resolver: "trustedHoldoutMacRegistryPlayerCardCompat",
        holdoutAuthority: "mac_local_registry",
        cloudRegistryAuthority: false,
        error: error instanceof Error ? error.message : "Mac Registry lookup failed.",
      },
      { status: 503 },
    );
  }
}

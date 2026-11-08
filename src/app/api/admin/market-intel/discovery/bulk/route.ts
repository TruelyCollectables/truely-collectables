import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { enforceBaseballPremiumPolicy } from "../../../../../../lib/market-intel-baseball-premium-enforcement";
import {
  bulkApproveIdentityCandidates,
  bulkRejectIdentityCandidates,
} from "../../../../../../lib/market-intel-identity-candidate-bulk";

export const maxDuration = 60;

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const json = wantsJson(request);

  try {
    const formData = await request.formData();
    const action = String(formData.get("action") || "").trim();
    const candidateIds = formData
      .getAll("candidateIds")
      .map((value) => String(value));

    if (candidateIds.length === 0) {
      throw new Error("Select at least one pending candidate.");
    }

    await enforceBaseballPremiumPolicy();

    const result =
      action === "reject"
        ? await bulkRejectIdentityCandidates(
            candidateIds,
            String(formData.get("reason") || "").trim() ||
              "Bulk rejected during Discovery Desk review.",
          )
        : action === "approve"
          ? await bulkApproveIdentityCandidates(candidateIds)
          : null;

    if (!result) throw new Error("Unsupported bulk action.");
    revalidatePath("/admin/market-intel/discovery");

    if (json) {
      return NextResponse.json(
        { success: true, result },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const firstError = result.errors[0]?.message || "";
    const params = new URLSearchParams({
      bulk: "1",
      requested: String(result.requested),
      processed: String(result.requested),
      approved: String(result.approved),
      rejected: String(result.rejected),
      skipped: String(result.skipped),
      t: String(Date.now()),
    });
    if (firstError) params.set("firstError", firstError.slice(0, 220));

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?${params.toString()}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process selected candidates.";
    revalidatePath("/admin/market-intel/discovery");

    if (json) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?error=${encodeURIComponent(message)}&t=${Date.now()}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

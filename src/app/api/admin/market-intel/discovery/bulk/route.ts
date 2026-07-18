import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import {
  bulkApproveIdentityCandidates,
  bulkRejectIdentityCandidates,
} from "../../../../../../lib/market-intel-identity-candidate-bulk";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const action = String(formData.get("action") || "").trim();
    const candidateIds = formData
      .getAll("candidateIds")
      .map((value) => String(value));

    if (candidateIds.length === 0) {
      throw new Error("Select at least one pending candidate.");
    }

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

    const firstError = result.errors[0]?.message || "";
    const params = new URLSearchParams({
      bulk: "1",
      requested: String(result.requested),
      approved: String(result.approved),
      rejected: String(result.rejected),
      skipped: String(result.skipped),
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
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

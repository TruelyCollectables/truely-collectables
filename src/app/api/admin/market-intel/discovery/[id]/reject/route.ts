import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { rejectIdentityCandidate } from "../../../../../../../lib/market-intel-identity-candidates";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  try {
    const formData = await request.formData();
    await rejectIdentityCandidate(
      id,
      String(formData.get("reason") ?? "").trim(),
    );
    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/discovery?rejected=1",
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to reject candidate.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?error=${encodeURIComponent(message)}#candidate-${encodeURIComponent(id)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

import { NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import {
  getKingmakerPricingByIdentityId,
  getKingmakerPricingHistory,
} from "../../../../lib/kingmaker-pricing-server";
import { buildInstaCompKingmakerPricing } from "../../../../lib/instacomp-kingmaker-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    await requireInstaCompJobActor(request);
  } catch {
    return jsonError("Unauthorized", 401);
  }

  const body = await request.json().catch(() => null);
  const identityId =
    body && typeof body === "object" && "identityId" in body
      ? String((body as { identityId?: unknown }).identityId || "").trim()
      : "";
  const includeHistory = Boolean(
    body && typeof body === "object" && "includeHistory" in body
      ? (body as { includeHistory?: unknown }).includeHistory
      : false,
  );
  const requestedLimit = Number(
    body && typeof body === "object" && "historyLimit" in body
      ? (body as { historyLimit?: unknown }).historyLimit
      : 24,
  );

  if (!identityId) {
    return jsonError("identityId is required", 400);
  }

  try {
    const record = await getKingmakerPricingByIdentityId(identityId);
    const pricing = buildInstaCompKingmakerPricing(record);
    const history =
      includeHistory && record
        ? await getKingmakerPricingHistory(
            identityId,
            Number.isFinite(requestedLimit) ? requestedLimit : 24,
          )
        : undefined;

    return NextResponse.json({
      ok: true,
      identityId,
      pricing,
      ...(history ? { history } : {}),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "KINGMAKER_PRICING_FAILED";
    if (code === "KINGMAKER_PRICING_IDENTITY_ID_INVALID") {
      return jsonError("Invalid identityId", 400);
    }

    console.error("KINGMAKER Pricing API failed:", error);
    return jsonError("Pricing is temporarily unavailable", 503);
  }
}

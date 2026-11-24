import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/kingmaker-local-auth";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
} from "../../../../../lib/instacomp-mac-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    );
    if (!isOwner) {
      await ensureAccountStoreMembership({
        accountId: account.id,
        role: "seller",
        status: "active",
      });
    }

    const { id } = await context.params;
    const listingId = String(id || "").trim();
    if (!listingId) {
      return NextResponse.json({ ok: false, error: "Listing ID is required." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const baseUrl = getConfiguredInstaCompMacUrl() || "http://127.0.0.1:8787";
    const key = getConfiguredInstaCompMacKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "InstaComp Mac API key is not configured." },
        { status: 503 },
      );
    }

    const response = await fetch(
      `${baseUrl}/api/listings/${encodeURIComponent(listingId)}/accept-recomp-price`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-InstaComp-AI-Key": key,
        },
        body: JSON.stringify(
          typeof body?.suggestedPrice === "number" ? { suggestedPrice: body.suggestedPrice } : {},
        ),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: String(payload?.detail || payload?.error || `Accept recomp price failed (${response.status}).`),
        },
        { status: response.status >= 400 ? response.status : 502 },
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not accept recomp price.",
      },
      { status: 500 },
    );
  }
}

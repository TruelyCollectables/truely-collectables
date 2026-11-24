import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/kingmaker-local-auth";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
} from "../../../../lib/instacomp-mac-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const listingIds = Array.isArray(body?.listingIds)
      ? body.listingIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    if (!listingIds.length) {
      return NextResponse.json(
        { ok: false, error: "Select at least one listing for InstaReComp." },
        { status: 400 },
      );
    }

    const applyNewPrice = body?.applyNewPrice === true;
    const baseUrl = getConfiguredInstaCompMacUrl() || "http://127.0.0.1:8787";
    const key = getConfiguredInstaCompMacKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "InstaComp Mac API key is not configured." },
        { status: 503 },
      );
    }

    const response = await fetch(`${baseUrl}/api/listings/instarecomp`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-InstaComp-AI-Key": key,
      },
      body: JSON.stringify({ listingIds, applyNewPrice }),
      cache: "no-store",
      signal: AbortSignal.timeout(110_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: String(payload?.detail || payload?.error || `InstaReComp failed (${response.status}).`),
        },
        { status: response.status >= 400 ? response.status : 502 },
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "InstaReComp failed.",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
} from "../../../../../lib/instacomp-job-server";
import { runEbayAuthoritativeStoreSync } from "../../../../../lib/ebay-authoritative-store-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function errorResponse(error: unknown) {
  if (error instanceof InstaCompJobServerError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "eBay full-store sync failed.",
    },
    { status: 500 },
  );
}

async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);

  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "The full eBay store sync is restricted to the Truely Collectables administrator.",
      403,
      "EBAY_FULL_SYNC_ADMIN_REQUIRED",
    );
  }

  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const supabase = requireInstaCompJobSupabase();
    const result = await runEbayAuthoritativeStoreSync({
      supabase,
      storeId: actor.storeId,
      mode: "preview",
      deactivateEnded: false,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const supabase = requireInstaCompJobSupabase();
    const body = await request.json().catch(() => ({}));
    const result = await runEbayAuthoritativeStoreSync({
      supabase,
      storeId: actor.storeId,
      mode: "apply",
      deactivateEnded: body?.deactivateEnded === true,
    });

    return NextResponse.json(
      { success: result.failed === 0, result },
      { status: result.failed === 0 ? 200 : 207 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

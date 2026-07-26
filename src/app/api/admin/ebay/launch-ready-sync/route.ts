import { NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
} from "../../../../../../lib/instacomp-job-server";
import { runEbayAuthoritativeStoreSync } from "../../../../../../lib/ebay-authoritative-store-sync";
import { syncEbayAllListingImages } from "../../../../../../lib/ebay-all-image-sync";
import { enrichAndAuditEbayLaunchCatalog } from "../../../../../../lib/ebay-launch-ready-enrichment";

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
          : "The eBay launch-ready sync failed.",
    },
    { status: 500 },
  );
}

async function requireAdmin(request: Request) {
  const actor = await requireInstaCompJobActor(request);
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "The launch-ready eBay sync is restricted to the Truely Collectables administrator.",
      403,
      "EBAY_LAUNCH_SYNC_ADMIN_REQUIRED",
    );
  }
  return actor;
}

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const supabase = requireInstaCompJobSupabase();
    const preview = await runEbayAuthoritativeStoreSync({
      supabase,
      storeId: actor.storeId,
      mode: "preview",
      deactivateEnded: false,
    });

    return NextResponse.json({
      success: preview.failed === 0,
      mode: "preview",
      preview,
      nextAction:
        "POST this route to apply the authoritative catalog sync, reconcile up to 20 images per listing, enrich descriptions and Best Offer evidence, stamp website shipping policy, and run the final readiness audit.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const supabase = requireInstaCompJobSupabase();
    const body = await request.json().catch(() => ({}));

    const catalogSync = await runEbayAuthoritativeStoreSync({
      supabase,
      storeId: actor.storeId,
      mode: "apply",
      deactivateEnded: body?.deactivateEnded === true,
    });
    const imageSync = await syncEbayAllListingImages({
      supabase,
      storeId: actor.storeId,
    });
    const readiness = await enrichAndAuditEbayLaunchCatalog({
      supabase,
      storeId: actor.storeId,
    });

    const success =
      catalogSync.cycleComplete &&
      catalogSync.failed === 0 &&
      imageSync.errors.length === 0 &&
      readiness.failedEnrichment === 0 &&
      readiness.notReady === 0;

    return NextResponse.json(
      {
        success,
        mode: "apply",
        catalogSync,
        imageSync,
        readiness,
      },
      { status: success ? 200 : 409 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/kingmaker-local-auth";
import { effectiveInstaCompPricingGroupKey } from "../../../../lib/instacomp-pricing-group";
import {
  archiveKingmakerMacReviewFallback,
  findMacDuplicateByImagePair,
  listMacMasterListingGroup,
  refreshKingmakerMacMarketForScan,
  runKingmakerMacScan,
  sha256File,
} from "../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// Receiving identity is authoritative on the Mac-local InstaComp pipeline.
// Do not reintroduce a Supabase-first placeholder scan before this handoff.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function noStoreHeaders(extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function validateFile(value: FormDataEntryValue | null, side: "front" | "back") {
  if (!(value instanceof File) || value.size <= 0) {
    throw new Error(`${side} image is required.`);
  }
  if (value.size > MAX_IMAGE_BYTES) {
    throw new Error(`${side} image is larger than 12MB.`);
  }
  const type = value.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${side} image must be JPEG, PNG, or WebP.`);
  }
  return value;
}

function isTransientLocalFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /abort|timeout|timed out|fetch failed|econnrefused|econnreset|incomplete|mac api|8787/i.test(
    message,
  );
}

function failureResponse(error: unknown, startedAt: number) {
  const message =
    error instanceof Error ? error.message : "Scanner intake failed.";
  const transient = isTransientLocalFailure(error);
  return NextResponse.json(
    {
      success: false,
      code: transient ? "SCANNER_LOCAL_UNAVAILABLE" : "SCANNER_INTAKE_FAILED",
      error: message,
      retryable: transient,
      durationMs: Date.now() - startedAt,
    },
    {
      status: transient ? 503 : 500,
      headers: noStoreHeaders(transient ? { "Retry-After": "5" } : {}),
    },
  );
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json(
        { success: false, code: "UNAUTHORIZED", error: "Unauthorized" },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const form = await request.formData();
    const forceFreshIdentity = form.get("forceFreshIdentity") === "true";
    const replaceManualIdentity = form.get("replaceManualIdentity") === "true";
    const front = validateFile(form.get("front"), "front");
    const back = validateFile(form.get("back"), "back");
    const [frontSha256, backSha256] = await Promise.all([
      sha256File(front),
      sha256File(back),
    ]);

    if (frontSha256 === backSha256) {
      return NextResponse.json(
        {
          success: false,
          code: "FRONT_BACK_IMAGES_DUPLICATE",
          error: "Front and back photos must be different images.",
          retryable: false,
        },
        { status: 409, headers: noStoreHeaders() },
      );
    }

    const inputImagePairSha256 = createHash("sha256")
      .update(`front:${frontSha256}|back:${backSha256}`)
      .digest("hex");
    const duplicate = await findMacDuplicateByImagePair(inputImagePairSha256);

    if (duplicate && !forceFreshIdentity) {
      const dual = ((duplicate.metadata as any)?.dual_marketplace || {});
      const isLive = duplicate.status === "active" || ["website", "ebay", "mercari", "both", "all3"].includes(duplicate.folder || "");
      return NextResponse.json(
        {
          success: true,
          stage: "review_required",
          identityComplete: false,
          inventoryItemId: duplicate.inventoryItemId,
          title: duplicate.title,
          code: "DUPLICATE_SCAN",
          error:
            "This exact front/back image pair already exists in Mac-local KINGMAKER inventory.",
          retryable: false,
          duplicate: {
            inventoryItemId: duplicate.inventoryItemId,
            title: duplicate.title,
            status: duplicate.status,
            price: duplicate.price,
            quantity: duplicate.quantity,
            matchType: "exact_scan_pair",
          },
          exactMatch: {
            found: true,
            existingInventoryItemId: duplicate.inventoryItemId,
            existingTitle: duplicate.title,
            existingQuantity: Number(duplicate.quantity || 1),
            existingPrice: Number(duplicate.price || 0),
            status: duplicate.status,
            folder: duplicate.folder || "pending",
            isLive,
            channels: {
              website: Boolean(dual.website?.status === "active" || duplicate.folder === "website" || duplicate.folder === "both" || duplicate.folder === "all3"),
              ebay: Boolean(dual.ebay?.status === "active" || duplicate.folder === "ebay" || duplicate.folder === "both" || duplicate.folder === "all3"),
              mercari: Boolean(dual.mercari?.status === "active" || duplicate.folder === "mercari" || duplicate.folder === "all3"),
            },
            newInventoryItemId: duplicate.inventoryItemId,
            matchType: "exact_scan_pair",
          },
          durationMs: Date.now() - startedAt,
        },
        { status: 202, headers: noStoreHeaders() },
      );
    }

    let result;
    try {
      result = await runKingmakerMacScan({
        front,
        back,
        imagePairSha256: inputImagePairSha256,
        inventoryItemId: forceFreshIdentity
          ? duplicate?.inventoryItemId || null
          : null,
        searchMarket: false,
        forceFreshIdentity,
        replaceManualIdentity,
        scanTimeoutMs: forceFreshIdentity ? 25_000 : 25_000,
        fastPassOnly: !forceFreshIdentity,
      });
    } catch (error) {
      // A normal scan must never lose the photos because the fast identity pass
      // timed out. Preserve the pair in Pending Listings and require review.
      if (forceFreshIdentity) throw error;
      result = await archiveKingmakerMacReviewFallback({
        front,
        back,
        imagePairSha256: inputImagePairSha256,
        reason:
          error instanceof Error
            ? `Fast identity pass failed: ${error.message}`
            : "Fast identity pass failed before an exact identity was returned.",
      });
    }

    if ((result.inventoryItem.metadata?.verifiedCsv as Record<string, unknown> | undefined)?.authority === "seller_verified_csv_v1") {
      return NextResponse.json({ success: true, stage: "verified_csv_comparison", identityComplete: true, inventoryItemId: result.inventoryItem.inventoryItemId, title: result.inventoryItem.title, verifiedFieldsLocked: true, imagesPreserved: true, lessonCaptured: true, ai: result.ai }, { headers: noStoreHeaders() });
    }
    let immediateMarket: Record<string, unknown> | null = null;
    let immediatePricingSucceeded = false;
    if (result.identityComplete) {
      try {
        const refreshed = await Promise.race([
          refreshKingmakerMacMarketForScan(
            result.scan,
            result.inventoryItem.inventoryItemId,
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 22_000)),
        ]);
        if (refreshed) {
          immediateMarket = refreshed as unknown as Record<string, unknown>;
          immediatePricingSucceeded = Boolean(refreshed.suggestedPrice);
        } else {
          after(async () => {
            try {
              await refreshKingmakerMacMarketForScan(
                result.scan,
                result.inventoryItem.inventoryItemId,
              );
            } catch (error) {
              console.error("KINGMAKER background market refresh failed", error);
            }
          });
        }
      } catch (error) {
        console.error("KINGMAKER immediate market refresh failed", error);
      }
    }

    let exactMatch: Record<string, unknown> | null = null;
    const groupKey = effectiveInstaCompPricingGroupKey(result.inventoryItem.metadata);
    if (groupKey) {
      try {
        const existingRows = await listMacMasterListingGroup(groupKey, { compact: false, timeoutMs: 5_000 });
        const existing = existingRows.find((row) => {
          const id = String(row.inventoryItemId || row.id || "");
          if (!id || id === result.inventoryItem.inventoryItemId) return false;
          return row.status !== "archived";
        });
        if (existing) {
          const dual = ((existing.metadata as any)?.dual_marketplace || {});
          const isLive = existing.status === "active" || ["website", "ebay", "mercari", "both", "all3"].includes(existing.folder || "");
          exactMatch = {
            found: true,
            existingInventoryItemId: existing.inventoryItemId || existing.id,
            existingTitle: existing.title,
            existingQuantity: Number(existing.quantity || 1),
            existingPrice: Number(existing.price || 0),
            status: existing.status,
            folder: existing.folder || "pending",
            isLive,
            channels: {
              website: Boolean(dual.website?.status === "active" || existing.folder === "website" || existing.folder === "both" || existing.folder === "all3"),
              ebay: Boolean(dual.ebay?.status === "active" || existing.folder === "ebay" || existing.folder === "both" || existing.folder === "all3"),
              mercari: Boolean(dual.mercari?.status === "active" || existing.folder === "mercari" || existing.folder === "all3"),
            },
            newInventoryItemId: result.inventoryItem.inventoryItemId,
            matchType: "exact_identity_group",
          };
        }
      } catch {
        // Non-blocking duplicate lookup
      }
    }

    return NextResponse.json(
      {
        success: true,
        stage: result.identityComplete ? "complete" : "review_required",
        identityComplete: result.identityComplete,
        cardUuid: result.scan.card_uuid || null,
        inventoryItemId: result.inventoryItem.inventoryItemId,
        title: result.inventoryItem.title,
        ai: result.ai,
        checklistDecision:
          result.inventoryItem.metadata?.instacomp &&
          (result.inventoryItem.metadata.instacomp as Record<string, unknown>)
            .checklistDecision || null,
        parallelDecision:
          result.inventoryItem.metadata?.instacomp &&
          (result.inventoryItem.metadata.instacomp as Record<string, unknown>)
            .parallelDecision || null,
        normalizedImages: {
          frontImageUrl:
            (result.inventoryItem.metadata?.instacomp as Record<
              string,
              unknown
            > | undefined)?.frontImageUrl || null,
          backImageUrl:
            (result.inventoryItem.metadata?.instacomp as Record<
              string,
              unknown
            > | undefined)?.backImageUrl || null,
        },
        pricing: result.identityComplete
          ? immediateMarket
            ? {
                status: immediatePricingSucceeded ? "comped" : "no_exact_sold_comps",
                suggestedPrice: immediateMarket.suggestedPrice ?? null,
                marketSummary: immediateMarket.marketSummary ?? null,
              }
            : { status: "background_refresh_queued", suggestedPrice: null }
          : null,
        pricingSucceeded: immediatePricingSucceeded,
        pricingBackgroundQueued: result.identityComplete && !immediateMarket,
        exactMatch,
        imagesPreserved: true,
        stagingMirrored: false,
        imagePairSha256: result.scan.image_pair_sha256 || null,
        sourceOfTruth: "mac_local",
        retryable: false,
        durationMs: Date.now() - startedAt,
      },
      {
        status: result.identityComplete ? 201 : 202,
        headers: noStoreHeaders(),
      },
    );
  } catch (error) {
    return failureResponse(error, startedAt);
  }
}

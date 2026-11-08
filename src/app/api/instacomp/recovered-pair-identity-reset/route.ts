import { NextRequest, NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  isValidInstaCompServiceRequest,
  requireInstaCompJobSupabase,
} from "../../../../lib/instacomp-job-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireServiceRequest(request: NextRequest) {
  requireInstaCompJobSupabase();
  if (!isValidInstaCompServiceRequest(request)) {
    throw new InstaCompJobServerError(
      "Valid InstaComp service authentication is required.",
      401,
      "INSTACOMP_IDENTITY_RESET_UNAUTHORIZED",
    );
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof InstaCompJobServerError ? error.status : 500;
  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Recovered-pair identity reset failed.",
    },
    { status },
  );
}

export async function POST(request: NextRequest) {
  try {
    requireServiceRequest(request);
    const supabase = requireInstaCompJobSupabase();
    const storeId = getActiveStoreId();
    const now = new Date().toISOString();

    const { data: rows, error: rowError } = await supabase
      .from("inventory_items")
      .select("id,title,metadata,status")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true });
    if (rowError) throw rowError;

    const candidates = (rows || []).filter((row: any) => {
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      return Boolean(
        textValue(instaComp.scanId) &&
          textValue(instaComp.imageRecoveryStatus)?.startsWith("recovered_by_") &&
          instaComp.hasBackImage === true,
      );
    });

    const itemIds = candidates.map((row: any) => row.id);
    const { data: images, error: imageError } = itemIds.length
      ? await supabase
          .from("inventory_images")
          .select("inventory_item_id,image_url,sort_order,is_primary,alt_text")
          .in("inventory_item_id", itemIds)
          .order("sort_order", { ascending: true })
      : { data: [], error: null };
    if (imageError) throw imageError;

    const imagesByItem = new Map<string, any[]>();
    for (const image of images || []) {
      const key = String((image as any).inventory_item_id);
      const current = imagesByItem.get(key) || [];
      current.push(image);
      imagesByItem.set(key, current);
    }

    const results: Array<Record<string, unknown>> = [];
    for (const row of candidates as any[]) {
      const storedImages = imagesByItem.get(String(row.id)) || [];
      const front = storedImages.find(
        (image) =>
          image.is_primary === true ||
          Number(image.sort_order) === 0 ||
          /\bfront\b/i.test(String(image.alt_text || "")),
      );
      const back = storedImages.find(
        (image) =>
          Number(image.sort_order) === 1 ||
          /\bback\b/i.test(String(image.alt_text || "")),
      );

      if (!front?.image_url || !back?.image_url || front.image_url === back.image_url) {
        results.push({
          inventoryItemId: row.id,
          title: row.title || "Untitled item",
          reset: false,
          error: "A distinct stored front/back pair was not found.",
        });
        continue;
      }

      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      const sellerReview = recordValue(metadata.seller_review);
      const previousAi = recordValue(instaComp.ai);
      const nextMetadata = {
        ...metadata,
        instacomp: {
          ...instaComp,
          priorIdentityBeforeBackRecovery: previousAi,
          ai: {},
          humanVerified: false,
          trustedForIdentity: false,
          identityRefreshRequired: true,
          identityResolutionStatus: "awaiting_front_back_registry_rescan",
          identityResetAt: now,
          identityResetReason: "recovered_back_image_requires_fresh_two_image_identity",
          pricingStatus: "not_run",
          pricingReason: "Fresh front/back identity resolution is required before pricing.",
          suggestedPrice: null,
          reliableSoldCompCount: 0,
          soldCompEvidence: [],
          activeCompetition: [],
          rejectedCandidates: [],
          excludedCompEvidence: [],
          providerCoverage: [],
          pricingCheckedAt: null,
        },
        seller_review: {
          ...sellerReview,
          identity_confirmed: false,
          confirmed_at: null,
          confirmed_by: null,
          confirmed_account_id: null,
          reset_at: now,
          reset_reason: "fresh_front_back_registry_identity_required",
        },
      };

      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ metadata: nextMetadata, updated_at: now })
        .eq("id", row.id)
        .eq("store_id", storeId)
        .eq("status", "draft");
      if (updateError) throw updateError;

      results.push({
        inventoryItemId: row.id,
        title: row.title || "Untitled item",
        reset: true,
        frontUrl: front.image_url,
        backUrl: back.image_url,
        identityRefreshRequired: true,
        pricingStatus: "not_run",
        published: false,
      });
    }

    const reset = results.filter((result) => result.reset === true).length;
    const failed = results.length - reset;
    return NextResponse.json({
      ok: failed === 0,
      candidates: candidates.length,
      reset,
      failed,
      results,
      published: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { persistNormalizedInstaCompImagePair } from "../../../../../../lib/instacomp-normalized-image-storage";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const form = await request.formData();
    const inventoryItemId = clean(form.get("inventoryItemId"), 100);
    const rotatedSide = clean(form.get("rotatedSide"), 20).toLowerCase();
    const front = form.get("frontImage") ?? form.get("front");
    const back = form.get("backImage") ?? form.get("back");
    if (!inventoryItemId || !(front instanceof File) || !(back instanceof File)) {
      return NextResponse.json(
        { error: "Pending card plus distinct front and back image files are required." },
        { status: 400 },
      );
    }
    if (rotatedSide !== "front" && rotatedSide !== "back") {
      return NextResponse.json({ error: "rotatedSide must be front or back." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let query = supabase
      .from("inventory_items")
      .select("id,title,seller_account_id,status,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await query.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Pending card was not found." }, { status: 404 });

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const sellerReview = record(metadata.seller_review);
    const updatedAt = new Date().toISOString();
    const persisted = await persistNormalizedInstaCompImagePair({
      supabase,
      storeId,
      inventoryItemId,
      title: item.title || "Card",
      frontFile: front,
      backFile: back,
      orientation: {
        status: "seller_manual_override",
        model: null,
        frontRotation: rotatedSide === "front" ? 90 : 0,
        backRotation: rotatedSide === "back" ? 90 : 0,
        frontConfidence: 1,
        backConfidence: 1,
        reason: `Seller manually rotated the stored ${rotatedSide} image 90 degrees clockwise after automatic text orientation.`,
      },
    });

    const { data: refreshed, error: refreshedError } = await supabase
      .from("inventory_items")
      .select("metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (refreshedError) throw refreshedError;
    const refreshedMetadata = record(refreshed?.metadata);
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        metadata: {
          ...refreshedMetadata,
          seller_review: {
            ...sellerReview,
            image_rotation_corrected_at: updatedAt,
            image_rotation_corrected_by: account.id,
            image_rotation_corrected_side: rotatedSide,
          },
        },
        updated_at: updatedAt,
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      rotatedSide,
      frontImageUrl: persisted.frontImageUrl,
      backImageUrl: persisted.backImageUrl,
      persisted: persisted.verified === true,
      published: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not rotate pending card image." },
      { status: 500 },
    );
  }
}

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

type StoredImageRow = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

function storedImageUrls(rows: StoredImageRow[], metadata: Record<string, unknown>) {
  const sorted = [...rows]
    .filter((row) => Boolean(clean(row.image_url, 2000)))
    .sort((left, right) => {
      if (left.is_primary === true && right.is_primary !== true) return -1;
      if (right.is_primary === true && left.is_primary !== true) return 1;
      return Number(left.sort_order || 0) - Number(right.sort_order || 0);
    });
  const frontRow =
    sorted.find((row) => /\bfront\b/i.test(row.alt_text || "")) ||
    sorted.find((row) => row.is_primary === true) ||
    sorted[0] ||
    null;
  const backRow =
    sorted.find((row) => /\bback\b/i.test(row.alt_text || "") && row.image_url !== frontRow?.image_url) ||
    sorted.find((row) => row !== frontRow && row.image_url !== frontRow?.image_url) ||
    null;
  const instaComp = record(metadata.instacomp);
  const recovered = record(instaComp.recoveredImageUrls);
  const sourceImages = Array.isArray(instaComp.sourceImageUrls) ? instaComp.sourceImageUrls : [];
  const front =
    clean(frontRow?.image_url, 2000) ||
    clean(instaComp.frontImageUrl, 2000) ||
    clean(recovered.front, 2000) ||
    clean(sourceImages[0], 2000);
  const back =
    clean(backRow?.image_url, 2000) ||
    clean(instaComp.backImageUrl, 2000) ||
    clean(recovered.back, 2000) ||
    clean(sourceImages[1], 2000);
  return front && back && front !== back ? { front, back } : null;
}

async function storedImageFile(url: string, side: "front" | "back") {
  if (!/^https?:\/\//i.test(url)) throw new Error(`Stored ${side} image URL is not fetchable.`);
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Stored ${side} image returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1_000 || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error(`Stored ${side} image has an invalid size.`);
  }
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) throw new Error(`Stored ${side} image is not an image response.`);
  return new File([bytes], `${side}.jpg`, { type: contentType });
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

    const contentType = request.headers.get("content-type") || "";
    let inventoryItemId = "";
    let rotatedSide = "";
    let front: File | null = null;
    let back: File | null = null;
    if (contentType.toLowerCase().includes("application/json")) {
      const body = record(await request.json().catch(() => ({})));
      inventoryItemId = clean(body.inventoryItemId, 100);
      rotatedSide = clean(body.rotatedSide, 20).toLowerCase();
    } else {
      const form = await request.formData();
      inventoryItemId = clean(form.get("inventoryItemId"), 100);
      rotatedSide = clean(form.get("rotatedSide"), 20).toLowerCase();
      const submittedFront = form.get("frontImage") ?? form.get("front");
      const submittedBack = form.get("backImage") ?? form.get("back");
      front = submittedFront instanceof File ? submittedFront : null;
      back = submittedBack instanceof File ? submittedBack : null;
    }
    if (!inventoryItemId) {
      return NextResponse.json({ error: "Pending card is required." }, { status: 400 });
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
    if (!front || !back) {
      const { data: storedImages, error: imageError } = await supabase
        .from("inventory_images")
        .select("image_url,alt_text,sort_order,is_primary")
        .eq("inventory_item_id", inventoryItemId)
        .order("sort_order", { ascending: true });
      if (imageError) throw imageError;
      const urls = storedImageUrls((storedImages || []) as StoredImageRow[], metadata);
      if (!urls) {
        return NextResponse.json(
          { error: "A distinct stored front and back are required before rotating this card." },
          { status: 400 },
        );
      }
      [front, back] = await Promise.all([
        storedImageFile(urls.front, "front"),
        storedImageFile(urls.back, "back"),
      ]);
    }
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
        status: "completed",
        model: null,
        source: "seller_manual_pixel_rotation",
        frontRotation: 0,
        backRotation: 0,
        frontConfidence: 1,
        backConfidence: 1,
        reason: `Seller manually rotated the stored ${rotatedSide} image pixels 90 degrees clockwise and verified the persisted pair.`,
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

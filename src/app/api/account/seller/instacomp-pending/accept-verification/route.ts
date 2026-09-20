import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

type StoredImage = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};
function hasDistinctStoredPair(rows: StoredImage[]) {
  const urls = rows
    .map((row) => text(row.image_url))
    .filter((value): value is string => Boolean(value));
  const unique = new Set(urls);
  const front = rows.find(
    (row) => /\bfront\b/i.test(row.alt_text || "") || row.is_primary === true,
  );
  const back = rows.find(
    (row) => /\bback\b/i.test(row.alt_text || "") && row.image_url !== front?.image_url,
  );
  return Boolean(front?.image_url && back?.image_url && unique.size >= 2);
}

function identityReady(metadata: Record<string, unknown>) {
  const instaComp = record(metadata.instacomp);
  const sellerReview = record(metadata.seller_review);
  return Boolean(
    instaComp.identityComplete === true ||
      instaComp.trustedForIdentity === true ||
      instaComp.manualIdentityLocked === true ||
      instaComp.humanVerified === true ||
      sellerReview.identity_confirmed === true ||
      text(instaComp.lastStatus) === "identity_complete",
  );
}
export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = record(await request.json().catch(() => ({})));
    const inventoryItemId = text(body.inventoryItemId);
    if (!inventoryItemId) {
      return Response.json({ error: "Pending card is required." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,title,status,seller_account_id,metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId)
      .eq("status", "draft");
    itemQuery = isOwner
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return Response.json({ error: "Pending verification card was not found." }, { status: 404 });
    }

    const metadata = record(item.metadata);
    if (!identityReady(metadata)) {
      return Response.json(
        { error: "Finish or confirm the card identity before moving it to Pending Listings." },
        { status: 409 },
      );
    }
    const { data: images, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url,alt_text,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;
    if (!hasDistinctStoredPair((images || []) as StoredImage[])) {
      return Response.json(
        { error: "A distinct stored front and back are required before accepting verification." },
        { status: 409 },
      );
    }
    const instaComp = record(metadata.instacomp);
    const orientation = record(instaComp.imageOrientation);
    const workflow = record(metadata.listingWorkflow);
    const sellerReview = record(metadata.seller_review);
    const now = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        imageOrientation: {
          ...orientation,
          status: "completed",
          verified: true,
          source: "seller_verification_accept",
          frontRotation: 0,
          backRotation: 0,
          frontConfidence: 1,
          backConfidence: 1,
          reason: "Seller visually accepted the stored front/back pair as correctly oriented.",
        },
        imageOrientationVerified: true,
        imageOrientationPersisted: true,
        imagePersistenceVerified: true,
      },
      listingWorkflow: {
        ...workflow,
        label: "Pending Listings",
        queue: "pending_listings",
        reason: "seller_accepted_verification",
        movedAt: now,
        reversible: true,
        previousQueue: "pending_verification",
      },
      seller_review: {
        ...sellerReview,
        image_orientation_confirmed_at: now,
        image_orientation_confirmed_by: account.id,
        image_orientation_confirmed_source: "pending_verification_accept",
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: now })
      .eq("store_id", storeId)
      .eq("id", inventoryItemId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return Response.json({
      success: true,
      inventoryItemId,
      title: item.title,
      queue: "listings",
      published: false,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not accept pending verification.",
      },
      { status: 500 },
    );
  }
}

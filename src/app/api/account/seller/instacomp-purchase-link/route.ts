import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = text(body.inventoryItemId);
    const acquisitionItemId = Number(body.acquisitionItemId || 0);
    const disposition = body.disposition === "investment_stash" ? "investment_stash" : "resale";
    if (!inventoryItemId || acquisitionItemId <= 0) {
      return Response.json({ error: "A scanned existing inventory item and purchase match are required." }, { status: 400 });
    }

    const storeId = getActiveStoreId();
    const supabase = createSupabaseServerClient({ admin: true });
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    );
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,seller_account_id,card_uuid,quantity,status,metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    itemQuery = isOwner
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return Response.json({ error: "Existing scanned inventory item was not found." }, { status: 404 });

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const scanId = text(instaComp.scanId);
    if (!scanId) {
      return Response.json(
        { error: "LINK BLOCKED: this existing inventory row does not have a real InstaComp scan ID." },
        { status: 409 },
      );
    }

    const { data: images, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url")
      .eq("inventory_item_id", inventoryItemId);
    if (imageError) throw imageError;
    const distinctImages = new Set((images || []).map((row: any) => text(row.image_url)).filter(Boolean));
    if (distinctImages.size < 2) {
      return Response.json(
        { error: "LINK BLOCKED: the existing inventory row must still have its scanned front and back." },
        { status: 409 },
      );
    }

    const originalQuantity = Number(item.quantity || 0);
    const originalStatus = text(item.status);
    const cardUuid = text(item.card_uuid) || text(instaComp.cardUuid) || text(body.cardUuid) || "";
    const data = await postInstaCompMacAccounting("/v1/kingmaker/accounting/link-existing", {
      card_uuid: cardUuid,
      inventory_item_id: inventoryItemId,
      scan_id: scanId,
      acquisition_item_id: acquisitionItemId,
      disposition,
    });

    if (data.status === "linked_existing") {
      const now = data.linkedAt || new Date().toISOString();
      const currentLifecycle = record(metadata.inventory_lifecycle);
      const nextMetadata = {
        ...metadata,
        acquisition: {
          sourceOfTruth: "mac_local_kingmaker_accounting",
          status: "linked_existing",
          receiptMode: "linked_existing",
          linkedAt: now,
          scanId,
          ...(data.match && typeof data.match === "object" ? data.match : {}),
        },
        inventory_lifecycle: {
          ...currentLifecycle,
          sourceOfTruth: "mac_local_kingmaker_accounting",
          state: data.inventoryState || (disposition === "investment_stash" ? "investment_stash" : "resale_ready"),
          disposition,
          receiptMode: "linked_existing",
          linkedPurchaseAt: now,
          scanId,
        },
      };
      let updateQuery = supabase
        .from("inventory_items")
        .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
        .eq("store_id", storeId)
        .eq("id", inventoryItemId)
        .eq("quantity", originalQuantity);
      updateQuery = originalStatus ? updateQuery.eq("status", originalStatus) : updateQuery.is("status", null);
      const { error: updateError } = await updateQuery;
      if (updateError) throw updateError;
      data.quantityUnchanged = true;
      data.originalQuantity = originalQuantity;
      data.inventoryRowReused = true;
    }

    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Seller login is required." }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = text(body.inventoryItemId);
    const acquisitionItemId = Number(body.acquisitionItemId || 0);
    const disposition =
      body.disposition === "investment_stash" ? "investment_stash" : "resale";
    if (!inventoryItemId || acquisitionItemId <= 0 || !text(body.scanId)) {
      return Response.json(
        { error: "A verified physical scan and exact purchase match are required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner = [
      "sales@truelycollectables.com",
      "sales@trulycollectables.com",
    ].includes(String(account.email || "").toLowerCase());

    // KINGMAKER inventory is Mac-local authority. A newly scanned card may not
    // have a storefront mirror yet, so absence from Supabase cannot block receipt.
    const { data: mirroredItem, error: readError } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId)
      .maybeSingle();
    if (readError) throw readError;

    if (
      mirroredItem &&
      !isOwner &&
      String(mirroredItem.seller_account_id || "") !== String(account.id)
    ) {
      return Response.json({ error: "Inventory item not found." }, { status: 404 });
    }

    // The Mac ledger verifies the exact scan, card UUID, purchase reservation,
    // and acquisition row. This is the authoritative receive gate.
    const data = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/receive",
      {
        card_uuid: text(body.cardUuid),
        inventory_item_id: inventoryItemId,
        scan_id: text(body.scanId),
        acquisition_item_id: acquisitionItemId,
        disposition,
      },
    );
    if (data.status !== "received") {
      return Response.json(data, { status: 409 });
    }

    let storefrontMirrorUpdated = false;
    if (mirroredItem) {
      const metadata = record(mirroredItem.metadata);
      const currentLifecycle = record(metadata.inventory_lifecycle);
      const match = record(data.match);
      const receivedAt = text(data.receivedAt) || new Date().toISOString();

      const nextMetadata = {
        ...metadata,
        acquisition: {
          ...record(metadata.acquisition),
          sourceOfTruth: "mac_local_kingmaker_accounting",
          acquisitionItemId,
          purchaseId: match.purchaseId || null,
          source: match.source || null,
          purchaseDate: match.purchaseDate || null,
          allocatedCost: match.allocatedCost ?? null,
          orderNumber: match.orderNumber || null,
          sourceItemId: match.sourceItemId || null,
          listingUrl: match.listingUrl || null,
          status: "received",
          receivedAt,
        },
        inventory_lifecycle: {
          ...currentLifecycle,
          sourceOfTruth: "mac_local_kingmaker_accounting",
          state: data.inventoryState,
          disposition,
          scanId: data.scanId || text(body.scanId),
          receivedAt,
          updatedAt: new Date().toISOString(),
        },
      };

      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
        .eq("store_id", storeId)
        .eq("id", inventoryItemId);
      if (updateError) throw updateError;
      storefrontMirrorUpdated = true;
    }

    return Response.json(
      { success: true, ...data, storefrontMirrorUpdated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

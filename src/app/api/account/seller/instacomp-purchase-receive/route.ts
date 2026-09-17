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
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = text(body.inventoryItemId);
    const acquisitionItemId = Number(body.acquisitionItemId || 0);
    const disposition = body.disposition === "investment_stash" ? "investment_stash" : "resale";
    if (!inventoryItemId || acquisitionItemId <= 0 || !text(body.scanId)) {
      return Response.json(
        { error: "A verified physical scan and exact purchase match are required." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    );
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,seller_account_id,metadata")
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    itemQuery = isOwner
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: readError } = await itemQuery.maybeSingle();
    if (readError) throw readError;
    if (!item) return Response.json({ error: "Inventory item not found." }, { status: 404 });

    // Prove that this seller can act on the target storefront row before
    // advancing the Mac-local acquisition ledger to received. Mac remains the
    // receive authority; this preflight only prevents an unauthorized/stale
    // inventory id from creating a split-brain lifecycle.
    const data = await postInstaCompMacAccounting("/v1/kingmaker/accounting/receive", {
      card_uuid: text(body.cardUuid),
      inventory_item_id: inventoryItemId,
      scan_id: text(body.scanId),
      acquisition_item_id: acquisitionItemId,
      disposition,
    });
    if (data.status !== "received") return Response.json(data, { status: 409 });

    const metadata = record(item.metadata);
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

    return Response.json({ success: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

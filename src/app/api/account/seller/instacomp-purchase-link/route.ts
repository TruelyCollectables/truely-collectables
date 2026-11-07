import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/kingmaker-local-auth";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import {
  getMacMasterListingRow,
  updateMacKingmakerDraft,
} from "../../../../../lib/kingmaker-mac-scan-server";

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
    const scanId = text(body.scanId);
    const acquisitionItemId = Number(body.acquisitionItemId || 0);
    const disposition = body.disposition === "investment_stash" ? "investment_stash" : "resale";
    if (!inventoryItemId || !scanId || acquisitionItemId <= 0) {
      return Response.json(
        { error: "A seller-owned scanned inventory item and exact purchase match are required." },
        { status: 400 },
      );
    }

    const item = await getMacMasterListingRow(inventoryItemId, 5_000);
    if (!item) return Response.json({ error: "Mac-local inventory item not found." }, { status: 404 });
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      text(account.email).toLowerCase(),
    );
    if (
      !isOwner &&
      text(item.seller_account_id) &&
      text(item.seller_account_id) !== account.id
    ) {
      return Response.json({ error: "Inventory item not found." }, { status: 404 });
    }

    const data = await postInstaCompMacAccounting("/v1/kingmaker/accounting/link-existing", {
      card_uuid: text(body.cardUuid),
      inventory_item_id: inventoryItemId,
      scan_id: scanId,
      acquisition_item_id: acquisitionItemId,
      disposition,
    });
    if (data.status === "linked_existing") {
      const metadata = record(item.metadata);
      const currentLifecycle = record(metadata.inventory_lifecycle);
      const match = record(data.match);
      const receivedAt = text(data.receivedAt) || text(data.linkedAt) || new Date().toISOString();
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
          status: "linked_existing",
          receivedAt,
        },
        inventory_lifecycle: {
          ...currentLifecycle,
          sourceOfTruth: "mac_local_kingmaker_accounting",
          state: data.inventoryState || "resale_ready",
          disposition: data.disposition || disposition,
          scanId: data.scanId || scanId,
          receivedAt,
          linkedAt: text(data.linkedAt) || receivedAt,
          receiptMode: "linked_existing",
          updatedAt: new Date().toISOString(),
        },
      };
      await updateMacKingmakerDraft(inventoryItemId, {
        metadata: nextMetadata,
      });
      data.quantityUnchanged = true;
      data.inventoryRowReused = true;
    }
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

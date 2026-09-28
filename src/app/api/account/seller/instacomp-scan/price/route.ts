import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  getMacMasterListingRow,
  listMacMasterListingRows,
  updateMacKingmakerDrafts,
} from "../../../../../../lib/kingmaker-mac-scan-server";
import {
  discountedListingPrice,
  listingPromotionFromMetadata,
} from "../../../../../../lib/listing-promotions";
import { instaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";

export const dynamic = "force-dynamic";

function price(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    const selectedPrice = price(body.price);
    const source = String(body.source || "scanner_manual").slice(0, 80);
    if (!inventoryItemId || !selectedPrice) {
      return Response.json({ success: false, error: "A valid inventory item and price are required." }, { status: 400 });
    }

    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const row = await getMacMasterListingRow(inventoryItemId);
    if (!row) return Response.json({ success: false, error: "Pending item not found." }, { status: 404 });
    const sellerAccountId = String(row.seller_account_id ?? row.sellerAccountId ?? "").trim();
    if (!isOwner && sellerAccountId && sellerAccountId !== account.id) {
      return Response.json({ success: false, error: "Pending item not found." }, { status: 404 });
    }

    const groupKey = instaCompPricingGroupKey(row.metadata) || "";
    const applyGroup = body.applyGroup !== false && Boolean(groupKey);
    let candidates: any[] = [row];
    if (applyGroup) {
      const rows = await listMacMasterListingRows({ compact: false, timeoutMs: 15_000 });
      candidates = rows.filter((candidate: any) => {
        const candidateSeller = String(candidate.seller_account_id ?? candidate.sellerAccountId ?? "").trim();
        return (
          (isOwner || !candidateSeller || candidateSeller === account.id) &&
          instaCompPricingGroupKey(candidate.metadata) === groupKey
        );
      });
    }

    const now = new Date().toISOString();
    const edits = candidates.map((candidate: any) => {
      const metadata = record(candidate.metadata);
      const instaComp = record(metadata.instacomp);
      const promotion = listingPromotionFromMetadata(metadata);
      const effectivePrice = promotion.onSale
        ? discountedListingPrice(selectedPrice, promotion.discountPercent) || selectedPrice
        : selectedPrice;
      const promo = record(metadata.tcos_promo);
      const nextMetadata = {
        ...metadata,
        ...(promotion.onSale
          ? {
              tcos_promo: {
                ...promo,
                original_price: selectedPrice,
                sale_price: effectivePrice,
              },
            }
          : {}),
        instacomp: {
          ...instaComp,
          listingPrice: effectivePrice,
          pricingGroupBasePrice: selectedPrice,
          listingPriceSource: source,
          pricingChosenAt: now,
          pricingGroupKey: groupKey || null,
        },
      };
      return {
        inventoryItemId: String(candidate.id ?? candidate.inventoryItemId ?? candidate.inventory_item_id ?? "").trim(),
        edit: {
          price: effectivePrice,
          metadata: nextMetadata,
          updatedAt: now,
        },
      };
    }).filter((entry) => Boolean(entry.inventoryItemId));
    await updateMacKingmakerDrafts(edits, 20_000);
    const updatedCount = edits.length;

    return Response.json({
      success: true,
      inventoryItemId,
      price: selectedPrice,
      source,
      groupKey: groupKey || null,
      grouped: applyGroup,
      updatedCount,
    });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Could not save price." }, { status: 500 });
  }
}

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/kingmaker-local-auth";
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
import {
  calculateDualMarketplacePricing,
  normalizeDualMarketplaceFeeProfile,
} from "../../../../../../lib/dual-marketplace-pricing";

export const dynamic = "force-dynamic";

function environmentNumber(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return raw >= 1 && raw <= 100 && name.includes("PERCENT") ? raw / 100 : raw;
}

function pendingChannelFeeProfile() {
  return normalizeDualMarketplaceFeeProfile({
    ebayPercent: environmentNumber("TCOS_EBAY_FEE_PERCENT", 0.1325),
    ebayFixed: environmentNumber("TCOS_EBAY_FIXED_FEE", 0.4),
    ebayFixedUnderTen: environmentNumber("TCOS_EBAY_FIXED_FEE_UNDER_10", 0.3),
    promotedPercent: environmentNumber("TCOS_EBAY_PROMOTED_PERCENT", 0),
    websitePercent: environmentNumber("TCOS_WEBSITE_PROCESSING_PERCENT", 0.029),
    websiteFixed: environmentNumber("TCOS_WEBSITE_FIXED_FEE", 0.3),
    minimumWebsiteDiscountPercent: environmentNumber(
      "TCOS_MINIMUM_WEBSITE_DISCOUNT_PERCENT",
      0.03,
    ),
    websitePriceEnding: environmentNumber("TCOS_WEBSITE_PRICE_ENDING", 0.99),
  });
}

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
    const feeProfile = pendingChannelFeeProfile();
    const uniformOperatorPrice = body.applyAllChannels !== false;
    const edits = candidates.map((candidate: any) => {
      const metadata = record(candidate.metadata);
      const instaComp = record(metadata.instacomp);
      const promotion = listingPromotionFromMetadata(metadata);
      const effectivePrice = promotion.onSale
        ? discountedListingPrice(selectedPrice, promotion.discountPercent) || selectedPrice
        : selectedPrice;
      const promo = record(metadata.tcos_promo);
      const channelBreakdown = calculateDualMarketplacePricing(effectivePrice, feeProfile);
      const websitePrice = uniformOperatorPrice ? effectivePrice : channelBreakdown.websitePrice;
      const ebayPrice = uniformOperatorPrice ? effectivePrice : channelBreakdown.ebayPrice;
      const mercariPrice = Math.max(1.0, uniformOperatorPrice ? effectivePrice : channelBreakdown.ebayPrice);
      const dualMarketplace = record(metadata.dual_marketplace);
      const dualWebsite = record(dualMarketplace.website);
      const dualEbay = record(dualMarketplace.ebay);
      const dualMercari = record(dualMarketplace.mercari);
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
        dual_marketplace: {
          ...dualMarketplace,
          schema: "tcos.dualMarketplaceListing.v3",
          pricing: {
            ...channelBreakdown,
            websitePrice,
            ebayPrice,
            feeProfile,
            calculatedAt: now,
            source,
            sellerPriceOverride: true,
          },
          website: {
            ...dualWebsite,
            price: websitePrice,
          },
          ebay: {
            ...dualEbay,
            price: ebayPrice,
          },
          mercari: {
            ...dualMercari,
            price: mercariPrice,
          },
          updatedAt: now,
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
    const primaryBreakdown = calculateDualMarketplacePricing(selectedPrice, feeProfile);
    const outWebsitePrice = uniformOperatorPrice ? selectedPrice : primaryBreakdown.websitePrice;
    const outEbayPrice = uniformOperatorPrice ? selectedPrice : primaryBreakdown.ebayPrice;
    const outMercariPrice = Math.max(1.0, uniformOperatorPrice ? selectedPrice : primaryBreakdown.ebayPrice);

    return Response.json({
      success: true,
      inventoryItemId,
      price: selectedPrice,
      websitePrice: outWebsitePrice,
      ebayPrice: outEbayPrice,
      mercariPrice: outMercariPrice,
      source,
      groupKey: groupKey || null,
      grouped: applyGroup,
      updatedCount,
    });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Could not save price." }, { status: 500 });
  }
}

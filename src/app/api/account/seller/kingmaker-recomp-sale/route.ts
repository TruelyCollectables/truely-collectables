import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/kingmaker-local-auth";
import {
  getMacMasterListingRows,
  updateMacKingmakerDrafts,
} from "../../../../../lib/kingmaker-mac-scan-server";
import { postInstaCompMacAccounting } from "../../../../../lib/instacomp-mac-accounting-client";
import { updateStorefrontProduct } from "../../../../../lib/storefront-publication-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ChannelKey = "website" | "ebay" | "mercari";
type JsonRecord = Record<string, any>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  const s = String(value ?? "").trim();
  return s || null;
}

function roundTo99(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1.99;
  const floored = Math.floor(value);
  const candidate = floored + 0.99;
  if (candidate >= value - 0.005) return Math.round(candidate * 100) / 100;
  return Math.round((floored + 1 + 0.99) * 100) / 100;
}

function adjustPrice(base: number, adjustmentPercent: number, use99: boolean, minFloor: number): number {
  const raw = base * (1 + adjustmentPercent / 100);
  const adjusted = use99 ? roundTo99(raw) : Math.round(raw * 100) / 100;
  return Math.max(minFloor, adjusted);
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemIds = Array.isArray(body.inventoryItemIds)
      ? Array.from(new Set(body.inventoryItemIds.map((v: unknown) => String(v || "").trim()).filter(Boolean))) as string[]
      : [];
    if (!inventoryItemIds.length) {
      return Response.json({ success: false, error: "Select or filter at least one card first." }, { status: 400 });
    }

    const rawChannels = Array.isArray(body.channels) ? body.channels.map(String) : ["website", "ebay", "mercari"];
    const channels = new Set<ChannelKey>(
      rawChannels.filter((c: string): c is ChannelKey => c === "website" || c === "ebay" || c === "mercari"),
    );
    if (!channels.size) {
      return Response.json({ success: false, error: "Choose at least one target marketplace." }, { status: 400 });
    }

    const adjustmentPercent = Number(body.adjustmentPercent ?? body.percent ?? 0);
    if (!Number.isFinite(adjustmentPercent) || adjustmentPercent <= -95 || adjustmentPercent > 500) {
      return Response.json({ success: false, error: "Adjustment percent must be between -95% and +500%." }, { status: 400 });
    }
    const use99 = body.roundTo99 !== false;
    const pushLive = body.pushLive !== false;
    const saleLabel = text(body.saleLabel) || (adjustmentPercent < 0 ? `Sale ${adjustmentPercent}%` : `Markup +${adjustmentPercent}%`);

    const rows = await getMacMasterListingRows(inventoryItemIds, 30_000);
    if (!rows.length) {
      return Response.json({ success: false, error: "No matching inventory items were found." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const edits: Array<{ inventoryItemId: string; edit: JsonRecord }> = [];
    const liveWebsiteTasks: Array<{ inventoryItemId: string; title: string; productId: number; price: number }> = [];
    const liveEbayTasks: Array<{
      inventoryItemId: string;
      title: string;
      sku: string;
      listingId: string;
      price: number;
      quantity: number;
    }> = [];
    let mercariLocalUpdated = 0;

    for (const row of rows) {
      const iid = String(row.id ?? row.inventoryItemId ?? "").trim();
      if (!iid) continue;
      const md = record(row.metadata);
      const ic = record(md.instacomp);
      const dm = record(md.dual_marketplace);
      const mlp = record(md.master_listing_projection);
      const dmWebsite = record(dm.website);
      const dmEbay = record(dm.ebay);
      const dmMercari = record(dm.mercari);
      const fallbackPrice = Number(row.price || ic.listingPrice || ic.suggestedPrice || dmEbay.price || dmWebsite.price || dmMercari.price || 0);
      if (!Number.isFinite(fallbackPrice) || fallbackPrice <= 0) continue;

      const curWebsite = Number(dmWebsite.price || fallbackPrice);
      const curEbay = Number(dmEbay.price || fallbackPrice);
      const curMercari = Number(dmMercari.price || fallbackPrice);

      const newWebsite = channels.has("website") ? adjustPrice(curWebsite, adjustmentPercent, use99, 0.99) : curWebsite;
      const newEbay = channels.has("ebay") ? adjustPrice(curEbay, adjustmentPercent, use99, 2.0) : curEbay;
      const newMercari = channels.has("mercari") ? adjustPrice(curMercari, adjustmentPercent, use99, 1.0) : curMercari;

      const primaryUpdatedPrice = channels.has("website")
        ? newWebsite
        : channels.has("ebay")
          ? newEbay
          : newMercari;

      const isVerifiedCsv = record(md.verifiedCsv).authority === "seller_verified_csv_v1";
      const nextDual = {
        ...dm,
        schema: "tcos.dualMarketplaceListing.v3",
        pricing: {
          ...record(dm.pricing),
          websitePrice: newWebsite,
          ebayPrice: newEbay,
          calculatedAt: now,
          source: "kingmaker_bulk_sale_engine",
          sellerPriceOverride: true,
        },
        website: { ...dmWebsite, price: newWebsite },
        ebay: { ...dmEbay, price: newEbay },
        mercari: { ...dmMercari, price: newMercari },
        updatedAt: now,
      };

      const nextInstacomp = isVerifiedCsv
        ? {
            listingPrice: primaryUpdatedPrice,
            pricingGroupBasePrice: primaryUpdatedPrice,
            listingPriceSource: "kingmaker_bulk_sale_engine",
            pricingChosenAt: now,
          }
        : {
            ...ic,
            listingPrice: primaryUpdatedPrice,
            pricingGroupBasePrice: primaryUpdatedPrice,
            listingPriceSource: "kingmaker_bulk_sale_engine",
            pricingChosenAt: now,
          };

      const nextMetadata: JsonRecord = isVerifiedCsv
        ? {
            ...md,
            dual_marketplace: nextDual,
            tcos_promo: {
              ...record(md.tcos_promo),
              on_sale: adjustmentPercent < 0,
              discount_percent: adjustmentPercent < 0 ? Math.abs(adjustmentPercent) : 0,
              original_price: fallbackPrice,
              sale_price: primaryUpdatedPrice,
              label: saleLabel,
              updated_at: now,
            },
            instacomp: nextInstacomp,
          }
        : {
            ...md,
            dual_marketplace: nextDual,
            tcos_promo: {
              ...record(md.tcos_promo),
              on_sale: adjustmentPercent < 0,
              discount_percent: adjustmentPercent < 0 ? Math.abs(adjustmentPercent) : 0,
              original_price: fallbackPrice,
              sale_price: primaryUpdatedPrice,
              label: saleLabel,
              updated_at: now,
            },
            instacomp: nextInstacomp,
          };

      edits.push({
        inventoryItemId: iid,
        edit: {
          price: primaryUpdatedPrice,
          metadata: nextMetadata,
          updatedAt: now,
        },
      });

      const websiteActive = mlp.websiteActive === true || String(dmWebsite.status || "").toLowerCase() === "active";
      const productId = Number(row.legacy_product_id || row.legacyProductId || dmWebsite.productId || record(mlp.product).id || 0);
      if (pushLive && channels.has("website") && websiteActive && productId > 0) {
        liveWebsiteTasks.push({ inventoryItemId: iid, title: String(row.title || iid), productId, price: newWebsite });
      }

      const ebayActive = mlp.ebayActive === true || ["active", "linked"].includes(String(dmEbay.status || "").toLowerCase());
      const ebayListingId = text(dmEbay.listingId) || text(record(mlp.product).ebay_item_id) || text((row as any).ebayItemId);
      const sku = text(row.sku) || text(record(mlp.product).sku) || `KM-${iid.slice(0, 12)}`;
      if (pushLive && channels.has("ebay") && ebayActive && ebayListingId && sku) {
        liveEbayTasks.push({
          inventoryItemId: iid,
          title: String(row.title || iid),
          sku,
          listingId: ebayListingId,
          price: newEbay,
          quantity: Math.max(1, Math.floor(Number(row.quantity || 1))),
        });
      }

      const mercariActive = mlp.mercariActive === true || ["active", "linked", "live"].includes(String(dmMercari.status || "").toLowerCase());
      if (channels.has("mercari") && mercariActive) {
        mercariLocalUpdated += 1;
      }
    }

    if (edits.length) {
      await updateMacKingmakerDrafts(edits, 30_000);
    }

    let websiteLiveUpdated = 0;
    let ebayLiveUpdated = 0;
    const failures: string[] = [];

    for (const task of liveWebsiteTasks) {
      try {
        await updateStorefrontProduct(request, task.productId, { price: task.price });
        websiteLiveUpdated += 1;
      } catch (err) {
        failures.push(`Website (${task.title}): ${err instanceof Error ? err.message : "update failed"}`);
      }
    }

    for (const task of liveEbayTasks) {
      try {
        await postInstaCompMacAccounting(
          "/v1/kingmaker/accounting/ebay-bridge",
          {
            mode: "revise",
            confirmation: "REVISE_LIVE",
            revision: {
              sku: task.sku,
              listingId: task.listingId,
              price: task.price,
              quantity: task.quantity,
            },
          },
          60_000,
        );
        ebayLiveUpdated += 1;
      } catch (err) {
        failures.push(`eBay (${task.title}): ${err instanceof Error ? err.message : "revise failed"}`);
      }
    }

    return Response.json({
      ok: true,
      success: failures.length === 0,
      updatedCount: edits.length,
      updatedLocalCount: edits.length,
      liveUpdated: {
        website: websiteLiveUpdated,
        ebay: ebayLiveUpdated,
      },
      websiteLiveUpdated,
      ebayLiveUpdated,
      mercariLocalUpdated,
      errors: failures.slice(0, 10),
      failures: failures.slice(0, 10),
      failureCount: failures.length,
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Bulk recomp/sale failed." },
      { status: 500 },
    );
  }
}

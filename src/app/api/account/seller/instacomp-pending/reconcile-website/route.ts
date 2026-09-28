import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { effectiveInstaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";
import { isInstaCompPublicationIdentityConfirmed } from "../../../../../../lib/instacomp-publication-identity";
import { postInstaCompMacAccounting } from "../../../../../../lib/instacomp-mac-accounting-client";
import {
  getMacMasterListingRow,
  listMacMasterListingGroup,
  updateMacKingmakerDrafts,
} from "../../../../../../lib/kingmaker-mac-scan-server";
import {
  findStorefrontProductsBySku,
  getStorefrontProduct,
  updateStorefrontProduct,
} from "../../../../../../lib/storefront-publication-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 500) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function quantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function rowId(row: any) {
  return text(row?.id ?? row?.inventoryItemId ?? row?.inventory_item_id, 200);
}

function cardUuid(row: any) {
  const metadata = record(row?.metadata);
  const instacomp = record(metadata.instacomp);
  return (
    text(row?.card_uuid ?? row?.cardUuid, 200) ||
    text(instacomp.cardUuid, 200) ||
    text(instacomp.internalCardUuid, 200)
  );
}

function imagePair(row: any) {
  const instacomp = record(record(row?.metadata).instacomp);
  return (
    text(instacomp.imagePairSha256, 128) ||
    text(instacomp.inputImagePairSha256, 128)
  );
}

function physicalKey(row: any) {
  return cardUuid(row) || imagePair(row) || rowId(row) || crypto.randomUUID();
}

function websiteProductId(row: any) {
  const metadata = record(row?.metadata);
  const dual = record(metadata.dual_marketplace);
  const website = record(dual.website);
  return (
    Number(website.productId || 0) ||
    Number(row?.legacy_product_id || row?.legacyProductId || 0) ||
    null
  );
}

function websiteStatus(row: any) {
  const website = record(record(record(row?.metadata).dual_marketplace).website);
  return text(website.status, 80)?.toLowerCase() || "";
}

async function resolveWebsiteProduct(row: any) {
  const linkedId = websiteProductId(row);
  if (linkedId) {
    const product = await getStorefrontProduct(linkedId);
    if (product) return product;
  }
  const sku = text(row?.sku, 120);
  if (!sku) return null;
  const matches = await findStorefrontProductsBySku(sku, 2);
  return matches.length === 1 ? matches[0] : null;
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.from(
      new Set<string>(
        (Array.isArray(body.inventoryItemIds) ? body.inventoryItemIds : [])
          .map((value: unknown) => text(value, 200))
          .filter((value: string | null): value is string => Boolean(value)),
      ),
    ).slice(0, 500);
    const ebayStrategy =
      body.ebayStrategy === "increase_existing"
        ? "increase_existing"
        : "keep_existing";
    if (!ids.length) {
      return Response.json(
        { success: false, error: "Choose one or more exact-card scans to merge." },
        { status: 400 },
      );
    }

    const isOwner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
    const processedGroups = new Set<string>();
    const results: Array<Record<string, unknown>> = [];
    let reconciled = 0;
    let blocked = 0;
    let duplicatesIgnored = 0;

    for (const inventoryItemId of ids) {
      const requested = await getMacMasterListingRow(inventoryItemId, 10_000);
      if (!requested) {
        blocked += 1;
        results.push({
          inventoryItemId,
          status: "blocked",
          reason: "mac_inventory_item_not_found",
        });
        continue;
      }
      const sellerAccountId = text(requested.seller_account_id, 200);
      if (!isOwner && sellerAccountId && sellerAccountId !== account.id) {
        blocked += 1;
        results.push({
          inventoryItemId,
          status: "blocked",
          reason: "seller_scope_mismatch",
        });
        continue;
      }
      if (!isInstaCompPublicationIdentityConfirmed(requested.metadata)) {
        blocked += 1;
        results.push({
          inventoryItemId,
          status: "blocked",
          reason: "identity_not_confirmed",
        });
        continue;
      }

      const groupKey = effectiveInstaCompPricingGroupKey(requested.metadata);
      if (!groupKey) {
        blocked += 1;
        results.push({
          inventoryItemId,
          status: "blocked",
          reason: "exact_pricing_group_missing",
        });
        continue;
      }
      if (processedGroups.has(groupKey)) continue;
      processedGroups.add(groupKey);

      const groupRows = (
        await listMacMasterListingGroup(groupKey, {
          compact: false,
          timeoutMs: 10_000,
        })
      ).filter(
        (row) =>
          row.status !== "archived" &&
          row.status !== "sold" &&
          quantity(row.quantity) > 0 &&
          effectiveInstaCompPricingGroupKey(row.metadata) === groupKey,
      );
      if (!groupRows.length) {
        blocked += 1;
        results.push({
          inventoryItemId,
          status: "blocked",
          reason: "exact_group_empty",
        });
        continue;
      }

      const byPhysical = new Map<string, any>();
      for (const row of groupRows) {
        const key = physicalKey(row);
        if (byPhysical.has(key)) {
          duplicatesIgnored += 1;
          continue;
        }
        byPhysical.set(key, row);
      }
      const physicalRows = [...byPhysical.values()];
      const keeper =
        physicalRows.find((row) => websiteStatus(row) === "active") ||
        physicalRows.find((row) => websiteProductId(row)) ||
        requested;
      const keeperId = rowId(keeper);
      if (!keeperId) {
        blocked += 1;
        results.push({
          inventoryItemId,
          status: "blocked",
          reason: "keeper_inventory_id_missing",
        });
        continue;
      }

      const product = await resolveWebsiteProduct(keeper);
      if (!product?.id) {
        blocked += 1;
        results.push({
          inventoryItemId,
          keeperInventoryItemId: keeperId,
          status: "blocked",
          reason: "exact_live_website_product_not_found",
        });
        continue;
      }

      const existingKeeperQuantity = quantity(keeper.quantity);
      const additionalQuantity = physicalRows
        .filter((row) => rowId(row) !== keeperId)
        .reduce((sum, row) => sum + quantity(row.quantity), 0);
      const targetQuantity = Math.max(1, existingKeeperQuantity + additionalQuantity);
      const now = new Date().toISOString();

      const keeperMetadata = record(keeper.metadata);
      const dual = record(keeperMetadata.dual_marketplace);
      const website = record(dual.website);
      const mercari = record(dual.mercari);
      const ebay = record(dual.ebay);
      const mercariStatus = text(mercari.status, 80)?.toLowerCase() || "";
      const mercariAction =
        mercariStatus === "sold" || mercariStatus === "ended"
          ? "mark_eligible_to_relist"
          : mercariStatus === "active"
            ? "keep_one_active_listing"
            : "unchanged";
      const nextMercari =
        mercariAction === "mark_eligible_to_relist"
          ? {
              ...mercari,
              status: "eligible_to_relist",
              relistEligibleAt: now,
              lastError: null,
            }
          : mercari;

      let ebayAction = "kept_existing_listing_quantity";
      let ebayError: string | null = null;
      const ebayListingId = text(ebay.listingId, 120);
      if (ebayStrategy === "increase_existing" && ebayListingId) {
        try {
          await postInstaCompMacAccounting(
            "/v1/kingmaker/accounting/ebay-bridge",
            {
              mode: "revise",
              confirmation: "REVISE_LIVE",
              revision: {
                sku: text(keeper.sku, 120),
                listingId: ebayListingId,
                title: text(ebay.title, 80) || text(keeper.title, 80),
                description:
                  text(ebay.description, 100_000) ||
                  text(keeper.description, 100_000),
                quantity: targetQuantity,
                price: Number(ebay.price || keeper.price || 0),
              },
            },
            120_000,
          );
          ebayAction = "increased_existing_listing_quantity";
        } catch (error) {
          ebayAction = "increase_existing_listing_quantity_failed";
          ebayError =
            error instanceof Error ? error.message : "eBay quantity revision failed.";
        }
      }

      await updateStorefrontProduct(product.id, {
        quantity: targetQuantity,
        listing_status: "live",
        archived_at: null,
      });

      const memberIds = physicalRows.map(rowId).filter(Boolean);
      const nextKeeperMetadata = {
        ...keeperMetadata,
        instacomp: {
          ...record(keeperMetadata.instacomp),
          commercialQuantity: targetQuantity,
          commercialKeeperInventoryItemId: keeperId,
          pricingGroupKey: groupKey,
        },
        dual_marketplace: {
          ...dual,
          website: {
            ...website,
            productId: product.id,
            status: "active",
            quantity: targetQuantity,
            reconciledAt: now,
            verificationStatus: "verified",
          },
          ebay: {
            ...ebay,
            lastQuantityReconcileAt: now,
            lastQuantityReconcileError: ebayError,
          },
          mercari: nextMercari,
          commercialGroup: {
            pricingGroupKey: groupKey,
            keeperInventoryItemId: keeperId,
            memberInventoryItemIds: memberIds,
            quantity: targetQuantity,
            updatedAt: now,
          },
          updatedAt: now,
        },
        commercial_merge: {
          keeper_inventory_item_id: keeperId,
          pricing_group_key: groupKey,
          website_product_id: product.id,
          reconciled_quantity: targetQuantity,
          reconciled_at: now,
        },
      };

      const edits: Array<{ inventoryItemId: string; edit: Record<string, unknown> }> = [
        {
          inventoryItemId: keeperId,
          edit: {
            status: "active",
            quantity: targetQuantity,
            metadata: nextKeeperMetadata,
            updatedAt: now,
          },
        },
      ];
      for (const row of physicalRows) {
        const id = rowId(row);
        if (!id || id === keeperId) continue;
        edits.push({
          inventoryItemId: id,
          edit: {
            status: "archived",
            quantity: 0,
            metadata: {
              ...record(row.metadata),
              commercial_merge: {
                keeper_inventory_item_id: keeperId,
                pricing_group_key: groupKey,
                website_product_id: product.id,
                merged_quantity: quantity(row.quantity),
                merged_at: now,
                reason: "exact_raw_card_consolidated_listing",
              },
            },
            updatedAt: now,
          },
        });
      }
      await updateMacKingmakerDrafts(edits, 20_000);

      reconciled += Math.max(0, targetQuantity - existingKeeperQuantity);
      results.push({
        inventoryItemId,
        keeperInventoryItemId: keeperId,
        status: "reconciled",
        pricingGroupKey: groupKey,
        websiteProductId: product.id,
        previousQuantity: existingKeeperQuantity,
        quantity: targetQuantity,
        mergedInventoryItemIds: memberIds.filter((id) => id !== keeperId),
        mercariAction,
        ebayAction,
        ebayError,
      });
    }

    return Response.json(
      {
        success: true,
        reconciled,
        blocked,
        duplicatesIgnored,
        results,
        sourceAuthority: "mac_local_sqlite",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Website reconciliation failed.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

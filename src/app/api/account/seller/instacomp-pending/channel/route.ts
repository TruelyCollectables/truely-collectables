import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  calculateCustomWebsitePricing,
  calculateDualMarketplacePricing,
  normalizeDualMarketplaceFeeProfile,
} from "../../../../../../lib/dual-marketplace-pricing";
import { createDualMarketplaceListingDraft } from "../../../../../../lib/dual-marketplace-listing";
import { assertSafeEbayListingContent } from "../../../../../../lib/ebay-listing-content";
import { publishEbayInventoryItem } from "../../../../../../lib/ebay-inventory-publisher";
import { effectiveInstaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;
type ChannelAction = "save" | "publish-website" | "publish-ebay" | "publish-both";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, max = 500) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function envNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  if (name.includes("PERCENT") && parsed >= 1 && parsed <= 100) return parsed / 100;
  return parsed;
}

function feeProfile() {
  return normalizeDualMarketplaceFeeProfile({
    ebayPercent: envNumber("TCOS_EBAY_FEE_PERCENT", 0.1325),
    ebayFixed: envNumber("TCOS_EBAY_FIXED_FEE", 0.4),
    ebayFixedUnderTen: envNumber("TCOS_EBAY_FIXED_FEE_UNDER_10", 0.3),
    promotedPercent: envNumber("TCOS_EBAY_PROMOTED_PERCENT", 0),
    websitePercent: envNumber("TCOS_WEBSITE_PROCESSING_PERCENT", 0.029),
    websiteFixed: envNumber("TCOS_WEBSITE_FIXED_FEE", 0.3),
    minimumWebsiteDiscountPercent: envNumber(
      "TCOS_MINIMUM_WEBSITE_DISCOUNT_PERCENT",
      0.03,
    ),
    websitePriceEnding: envNumber("TCOS_WEBSITE_PRICE_ENDING", 0.99),
  });
}

function uniquePhysical(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const asset = record(metadata.collectible_asset);
  const identity = record(
    instaComp.manualIdentityLocked === true
      ? instaComp.manualIdentity
      : instaComp.ai,
  );
  return Boolean(
    text(asset.exact_serial_number) ||
      text(asset.grading_cert_number) ||
      text(identity.serialNumber) ||
      text(identity.certificationNumber) ||
      text(identity.gradingCertNumber),
  );
}

function liveChannelRow(row: any) {
  const dual = record(record(row.metadata).dual_marketplace);
  const ebay = record(dual.ebay);
  return row.status === "active" || text(ebay.status) === "active";
}

function publicationLocked(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const review = record(metadata.seller_review);
  return (
    instaComp.manualIdentityLocked === true ||
    instaComp.humanVerified === true ||
    review.identity_confirmed === true
  );
}

function generatedSku(row: any) {
  return (
    text(row.sku, 120) ||
    (row.legacy_product_id ? `TCOS-${row.legacy_product_id}` : null) ||
    `KM-${String(row.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase()}`
  );
}

async function archiveDuplicateDrafts(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  keeperId: string;
  rows: any[];
  groupKey: string | null;
  now: string;
}) {
  const duplicates = params.rows.filter(
    (row) => row.id !== params.keeperId && row.status === "draft",
  );
  for (const duplicate of duplicates) {
    const metadata = record(duplicate.metadata);
    const nextMetadata = {
      ...metadata,
      commercial_merge: {
        keeper_inventory_item_id: params.keeperId,
        pricing_group_key: params.groupKey,
        merged_quantity: wholeQuantity(duplicate.quantity),
        merged_at: params.now,
        reason: "exact_raw_card_consolidated_listing",
      },
    };
    const { error } = await params.supabase
      .from("inventory_items")
      .update({
        status: "archived",
        quantity: 0,
        metadata: nextMetadata,
        updated_at: params.now,
      })
      .eq("store_id", params.storeId)
      .eq("id", duplicate.id);
    if (error) throw error;

    if (duplicate.legacy_product_id) {
      const { error: productError } = await params.supabase
        .from("products")
        .update({ quantity: 0, archived_at: params.now })
        .eq("store_id", params.storeId)
        .eq("id", duplicate.legacy_product_id);
      if (productError) throw productError;
    }
  }
  return duplicates.length;
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
    const action = String(body.action || "save") as ChannelAction;
    if (!["save", "publish-website", "publish-ebay", "publish-both"].includes(action)) {
      return Response.json({ success: false, error: "Unsupported channel action." }, { status: 400 });
    }
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return Response.json({ success: false, error: "Choose a KINGMAKER listing group." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

    let requestedQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .eq("id", inventoryItemId);
    requestedQuery = isOwner
      ? requestedQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : requestedQuery.eq("seller_account_id", account.id);
    const { data: requested, error: requestedError } = await requestedQuery.maybeSingle();
    if (requestedError) throw requestedError;
    if (!requested) {
      return Response.json({ success: false, error: "Listing group not found or not owned." }, { status: 404 });
    }

    const requestedUnique = uniquePhysical(requested.metadata);
    const groupKey = requestedUnique
      ? null
      : effectiveInstaCompPricingGroupKey(requested.metadata);

    let ownedQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId);
    ownedQuery = isOwner
      ? ownedQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : ownedQuery.eq("seller_account_id", account.id);
    const { data: ownedRows, error: ownedError } = await ownedQuery.range(0, 4999);
    if (ownedError) throw ownedError;

    const groupRows = requestedUnique || !groupKey
      ? [requested]
      : (ownedRows || []).filter((row) => {
          if (row.status === "archived" || row.status === "sold") return false;
          if (wholeQuantity(row.quantity) < 1) return false;
          if (uniquePhysical(row.metadata)) return false;
          return effectiveInstaCompPricingGroupKey(row.metadata) === groupKey;
        });
    if (!groupRows.some((row) => row.id === requested.id)) groupRows.unshift(requested);

    const liveRows = groupRows.filter(liveChannelRow);
    if (liveRows.length > 1) {
      return Response.json(
        {
          success: false,
          error:
            "Multiple live listings already exist for this exact-card group. KINGMAKER stopped instead of creating another duplicate; reconcile the live duplicates first.",
          code: "MULTIPLE_LIVE_EXACT_CARD_LISTINGS",
          liveInventoryItemIds: liveRows.map((row) => row.id),
        },
        { status: 409 },
      );
    }

    const keeper = liveRows[0] || requested;
    if (!publicationLocked(keeper.metadata)) {
      return Response.json(
        {
          success: false,
          error: "Human/operator identity confirmation is required before channel publishing.",
        },
        { status: 409 },
      );
    }

    const totalQuantity = groupRows.reduce(
      (sum, row) => sum + wholeQuantity(row.quantity),
      0,
    );
    if (totalQuantity < 1) {
      return Response.json({ success: false, error: "Group quantity is zero." }, { status: 409 });
    }

    const { data: images, error: imageError } = await supabase
      .from("inventory_images")
      .select("inventory_item_id,image_url,sort_order,is_primary")
      .in("inventory_item_id", [keeper.id, requested.id])
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;
    const imageUrls = Array.from(
      new Set(
        (images || [])
          .sort((a: any, b: any) => {
            const keeperA = a.inventory_item_id === keeper.id ? 0 : 1;
            const keeperB = b.inventory_item_id === keeper.id ? 0 : 1;
            return keeperA - keeperB || Number(a.sort_order || 0) - Number(b.sort_order || 0);
          })
          .map((image: any) => text(image.image_url, 2000))
          .filter((value): value is string => Boolean(value)),
      ),
    ).slice(0, 24);
    if (imageUrls.length < 2 && action !== "save") {
      return Response.json(
        { success: false, error: "A stored front and back image are required before publishing." },
        { status: 409 },
      );
    }

    const metadata = record(keeper.metadata);
    const instaComp = record(metadata.instacomp);
    const dual = record(metadata.dual_marketplace);
    const storedWebsite = record(dual.website);
    const storedEbay = record(dual.ebay);
    const generated = createDualMarketplaceListingDraft({
      title: String(keeper.title || "Trading Card"),
      description: keeper.description,
      category: keeper.category,
      condition: keeper.condition,
      metadata,
    });

    const basePrice =
      money(body.ebayPrice) ||
      money(storedEbay.price) ||
      money(instaComp.listingPrice) ||
      money(instaComp.suggestedPrice) ||
      money(keeper.price);
    if (!basePrice) {
      return Response.json(
        { success: false, error: "Run InstaComp or choose a selling price before publishing." },
        { status: 409 },
      );
    }

    const fees = feeProfile();
    const automaticPricing = calculateDualMarketplacePricing(basePrice, fees);
    const ebayPrice = money(body.ebayPrice) || money(storedEbay.price) || automaticPricing.ebayPrice;
    const websitePrice =
      money(body.websitePrice) || money(storedWebsite.price) || automaticPricing.websitePrice;
    const pricing = calculateCustomWebsitePricing(ebayPrice, websitePrice, fees);
    const now = new Date().toISOString();
    const sku = generatedSku(keeper);

    const websiteTitle = text(body.websiteTitle, 200) || text(storedWebsite.title, 200) || generated.websiteTitle;
    const websiteDescription =
      text(body.websiteDescription, 100_000) ||
      text(storedWebsite.description, 100_000) ||
      generated.websiteDescription;
    const ebayTitle = text(body.ebayTitle, 80) || text(storedEbay.title, 80) || generated.ebayTitle;
    const ebayDescription =
      text(body.ebayDescription, 100_000) ||
      text(storedEbay.description, 100_000) ||
      generated.ebayDescription;
    const cardCondition = text(body.cardCondition, 100) || text(storedEbay.cardCondition, 100) || generated.cardCondition;
    const bestOfferEnabled =
      body.bestOfferEnabled === true || storedEbay.bestOfferEnabled === true;

    const nextMetadata: UnknownRecord = {
      ...metadata,
      instacomp: {
        ...instaComp,
        pricingGroupKey: groupKey || effectiveInstaCompPricingGroupKey(metadata),
        commercialQuantity: totalQuantity,
        commercialKeeperInventoryItemId: keeper.id,
      },
      dual_marketplace: {
        ...dual,
        schema: "tcos.dualMarketplaceListing.v3",
        pricing: {
          ...pricing,
          feeProfile: fees,
          calculatedAt: now,
          source: "kingmaker_pending",
        },
        website: {
          ...storedWebsite,
          title: websiteTitle,
          description: websiteDescription,
          price: websitePrice,
          status: text(storedWebsite.status, 40) || "draft",
        },
        ebay: {
          ...storedEbay,
          title: ebayTitle,
          description: ebayDescription,
          price: ebayPrice,
          categoryId: text(body.ebayCategoryId, 40) || text(storedEbay.categoryId, 40) || generated.ebayCategoryId,
          condition: text(storedEbay.condition, 40) || generated.ebayCondition,
          cardCondition,
          grader: text(storedEbay.grader, 120) || generated.grader,
          grade: text(storedEbay.grade, 40) || generated.grade,
          certificationNumber:
            text(storedEbay.certificationNumber, 80) || generated.certificationNumber,
          aspects: Object.keys(record(storedEbay.aspects)).length
            ? record(storedEbay.aspects)
            : generated.aspects,
          bestOfferEnabled,
          status: text(storedEbay.status, 40) || "draft",
        },
        commercialGroup: {
          pricingGroupKey: groupKey,
          keeperInventoryItemId: keeper.id,
          memberInventoryItemIds: groupRows.map((row) => row.id),
          quantity: totalQuantity,
          updatedAt: now,
        },
        updatedAt: now,
      },
    };

    let linkedProductId = keeper.legacy_product_id ? Number(keeper.legacy_product_id) : null;
    if ((action === "publish-website" || action === "publish-both") && !linkedProductId) {
      const { data: existingProducts, error: existingProductError } = await supabase
        .from("products")
        .select("id")
        .eq("store_id", storeId)
        .eq("sku", sku)
        .limit(2);
      if (existingProductError) throw existingProductError;
      if ((existingProducts || []).length > 1) {
        return Response.json(
          {
            success: false,
            error: "Multiple website product rows already use this KINGMAKER SKU. Publishing stopped to prevent duplicate inventory.",
            code: "MULTIPLE_WEBSITE_PRODUCTS_FOR_SKU",
            productIds: (existingProducts || []).map((row: any) => row.id),
          },
          { status: 409 },
        );
      }
      if ((existingProducts || []).length === 1) {
        linkedProductId = Number(existingProducts![0].id);
      } else {
        const { data: createdProduct, error: createProductError } = await supabase
          .from("products")
          .insert({
            store_id: storeId,
            seller_account_id: keeper.seller_account_id || account.id,
            sku,
            title: websiteTitle,
            description: websiteDescription,
            player: generated.identity.player,
            sport: generated.identity.sport,
            price: websitePrice,
            quantity: 0,
            image_url: imageUrls[0] || null,
            listing_status: "draft",
            archived_at: null,
          })
          .select("id")
          .single();
        if (createProductError || !createdProduct?.id) {
          throw createProductError || new Error("Could not create the linked website product record.");
        }
        linkedProductId = Number(createdProduct.id);
      }
    }

    const { error: keeperSaveError } = await supabase
      .from("inventory_items")
      .update({
        sku,
        quantity: totalQuantity,
        legacy_product_id: linkedProductId,
        metadata: nextMetadata,
        updated_at: now,
      })
      .eq("store_id", storeId)
      .eq("id", keeper.id);
    if (keeperSaveError) throw keeperSaveError;

    if (linkedProductId) {
      const { error: skuError } = await supabase
        .from("products")
        .update({ sku })
        .eq("store_id", storeId)
        .eq("id", linkedProductId);
      if (skuError) throw skuError;
    }

    let ebayResult: any = null;
    let websitePublished = false;
    const errors: string[] = [];

    if (action === "publish-ebay" || action === "publish-both") {
      if (!isOwner) {
        errors.push("eBay publish from this KINGMAKER flow is currently limited to the store-owner account.");
      } else if (!cardCondition && generated.ebayCondition === "USED_VERY_GOOD") {
        errors.push("Review and save the raw card condition before publishing to eBay.");
      } else {
        try {
          assertSafeEbayListingContent(ebayDescription || "");
          ebayResult = await publishEbayInventoryItem({
            supabase,
            storeId,
            item: {
              sku,
              title: ebayTitle || generated.ebayTitle,
              description: ebayDescription || generated.ebayDescription,
              quantity: totalQuantity,
              price: ebayPrice,
              imageUrls,
              aspects: record(record(nextMetadata.dual_marketplace).ebay).aspects as Record<string, string[]>,
              categoryId:
                text(record(record(nextMetadata.dual_marketplace).ebay).categoryId, 40) ||
                generated.ebayCategoryId,
              condition: generated.ebayCondition,
              cardCondition: cardCondition || "",
              grader: generated.grader,
              grade: generated.grade,
              certificationNumber: generated.certificationNumber,
              bestOfferEnabled,
            },
          });
          const latestDual = record(nextMetadata.dual_marketplace);
          nextMetadata.dual_marketplace = {
            ...latestDual,
            ebay: {
              ...record(latestDual.ebay),
              status: "active",
              listingId: ebayResult.listingId,
              offerId: ebayResult.offerId,
              publishedAt: new Date().toISOString(),
              warnings: ebayResult.warnings || [],
              lastError: null,
            },
          };
          await supabase
            .from("inventory_items")
            .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
            .eq("store_id", storeId)
            .eq("id", keeper.id)
            .throwOnError();
          if (linkedProductId) {
            await supabase
              .from("products")
              .update({ ebay_item_id: ebayResult.listingId, last_seen_at: new Date().toISOString() })
              .eq("store_id", storeId)
              .eq("id", linkedProductId)
              .throwOnError();
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "eBay publishing failed.");
        }
      }
    }

    if (action === "publish-website" || action === "publish-both") {
      try {
        if (!linkedProductId) {
          throw new Error("Website product linkage could not be established.");
        }
        const { error: inventoryError } = await supabase
          .from("inventory_items")
          .update({
            sku,
            title: websiteTitle,
            description: websiteDescription,
            status: "active",
            quantity: totalQuantity,
            price: websitePrice,
            metadata: {
              ...nextMetadata,
              dual_marketplace: {
                ...record(nextMetadata.dual_marketplace),
                website: {
                  ...record(record(nextMetadata.dual_marketplace).website),
                  status: "active",
                  publishedAt: new Date().toISOString(),
                  lastError: null,
                },
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("store_id", storeId)
          .eq("id", keeper.id);
        if (inventoryError) throw inventoryError;

        const { error: productError } = await supabase
          .from("products")
          .update({
            sku,
            title: websiteTitle,
            description: websiteDescription,
            player: generated.identity.player,
            sport: generated.identity.sport,
            price: websitePrice,
            quantity: totalQuantity,
            image_url: imageUrls[0] || null,
            archived_at: null,
            listing_status: "live",
          })
          .eq("store_id", storeId)
          .eq("id", linkedProductId);
        if (productError) throw productError;
        websitePublished = true;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Website publishing failed.");
      }
    }

    const anyPublished = websitePublished || Boolean(ebayResult);
    const archivedDuplicateCount = anyPublished
      ? await archiveDuplicateDrafts({
          supabase,
          storeId,
          keeperId: keeper.id,
          rows: groupRows,
          groupKey,
          now: new Date().toISOString(),
        })
      : 0;

    const success = errors.length === 0;
    return Response.json(
      {
        success,
        partial: !success && anyPublished,
        action,
        requestedInventoryItemId: requested.id,
        keeperInventoryItemId: keeper.id,
        groupKey,
        grouped: groupRows.length > 1,
        memberInventoryItemIds: groupRows.map((row) => row.id),
        quantity: totalQuantity,
        archivedDuplicateCount,
        suggestedPrice: money(instaComp.suggestedPrice) || null,
        ebayPrice,
        websitePrice,
        pricing,
        websitePublished,
        ebayPublished: Boolean(ebayResult),
        ebayListingId: ebayResult?.listingId || null,
        ebayOfferId: ebayResult?.offerId || null,
        websiteProductId: linkedProductId,
        errors,
      },
      { status: success ? 200 : anyPublished ? 207 : 409 },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "KINGMAKER channel action failed.",
      },
      { status: 500 },
    );
  }
}

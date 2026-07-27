import {
  ensureAccountStoreMembership,
  getAuthenticatedSellerAccountFromRequest,
} from "../../../../../lib/account-auth";
import { classifySaleTiming } from "../../../../../lib/collectible-assets";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function missingTables(error: { code?: string; message?: string }) {
  const message = String(error.message || "").toLowerCase();
  return error.code === "42P01" || message.includes("collectible_assets");
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedSellerAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

    let assetQuery = supabase
      .from("collectible_assets")
      .select("*")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .limit(1000);

    assetQuery = owner
      ? assetQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : assetQuery.eq("seller_account_id", account.id);

    const { data: assets, error: assetError } = await assetQuery;
    if (assetError) {
      if (missingTables(assetError)) {
        return Response.json(
          {
            error:
              "Collectible lifecycle tracking is not available until its database migration is applied.",
            code: "COLLECTIBLE_ASSET_MIGRATION_REQUIRED",
          },
          { status: 503 },
        );
      }
      throw assetError;
    }

    const assetRows = assets || [];
    const assetIds = assetRows.map((asset) => asset.id);
    const legacyProductIds = assetRows
      .map((asset) => asset.legacy_product_id)
      .filter((value): value is number => Number.isInteger(Number(value)));

    const [snapshotResult, productResult] = await Promise.all([
      assetIds.length
        ? supabase
            .from("collectible_market_snapshots")
            .select("*")
            .eq("store_id", storeId)
            .in("asset_id", assetIds)
            .order("checked_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      legacyProductIds.length
        ? supabase
            .from("products")
            .select("id,image_url")
            .eq("store_id", storeId)
            .in("id", legacyProductIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (snapshotResult.error) throw snapshotResult.error;
    if (productResult.error) throw productResult.error;

    const productsById = new Map(
      (productResult.data || []).map((product) => [Number(product.id), product]),
    );
    const snapshotsByAsset = new Map<string, any[]>();
    for (const snapshot of snapshotResult.data || []) {
      const list = snapshotsByAsset.get(snapshot.asset_id) || [];
      list.push(snapshot);
      snapshotsByAsset.set(snapshot.asset_id, list);
    }

    const responseAssets = assetRows.map((asset) => {
      const snapshots = snapshotsByAsset.get(asset.id) || [];
      const saleTiming = classifySaleTiming({
        soldPrice: asset.sold_price,
        soldAt: asset.sold_at,
        snapshots,
      });
      const product = asset.legacy_product_id
        ? productsById.get(Number(asset.legacy_product_id))
        : null;

      return {
        assetId: asset.id,
        inventoryItemId: asset.inventory_item_id,
        legacyProductId: asset.legacy_product_id,
        sourceRecordKey: asset.source_record_key,
        lifecycleStatus: asset.lifecycle_status,
        title: asset.title,
        player: asset.player,
        year: asset.card_year,
        manufacturer: asset.manufacturer,
        productSet: asset.product_set,
        insertSubset: asset.insert_subset,
        cardNumber: asset.card_number,
        parallel: asset.parallel_variant,
        team: asset.team,
        sport: asset.sport,
        rookieStatus: asset.rookie_status,
        autographStatus: asset.autograph_status,
        memorabiliaStatus: asset.memorabilia_status,
        exactSerialNumber: asset.exact_serial_number,
        serialCopyNumber: asset.serial_copy_number,
        serialPrintRun: asset.serial_print_run,
        gradingCompany: asset.grading_company,
        gradingGrade: asset.grading_grade,
        gradingCertNumber: asset.grading_cert_number,
        graderVerificationStatus: asset.grader_verification_status,
        graderVerificationUrl: asset.grader_verification_url,
        graderVerifiedAt: asset.grader_verified_at,
        listingPrice: money(asset.listing_price),
        soldPrice: money(asset.sold_price),
        soldAt: asset.sold_at,
        currentMarketValue: money(asset.current_market_value),
        lastMarketCheckedAt: asset.last_market_checked_at,
        postSaleTrackingEnabled: asset.post_sale_tracking_enabled === true,
        imageUrl: product?.image_url || null,
        marketSnapshotCount: snapshots.length,
        saleTiming,
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
      };
    });

    return Response.json({
      assets: responseAssets,
      summary: {
        total: responseAssets.length,
        pending: responseAssets.filter(
          (asset) => asset.lifecycleStatus === "pending_listing",
        ).length,
        active: responseAssets.filter(
          (asset) => asset.lifecycleStatus === "active",
        ).length,
        sold: responseAssets.filter((asset) => asset.lifecycleStatus === "sold")
          .length,
        graded: responseAssets.filter((asset) => asset.gradingCompany).length,
        serialized: responseAssets.filter((asset) => asset.exactSerialNumber)
          .length,
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Collectible lifecycle lookup failed." },
      { status: 500 },
    );
  }
}

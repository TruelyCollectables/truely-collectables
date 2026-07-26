import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../lib/account-auth";
import { getInventoryActivationBlockers } from "../../../../../lib/inventory-activation";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalPrice(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function effectiveGraderStatus(metadata: Record<string, unknown>) {
  const instaComp = recordValue(metadata.instacomp);
  const collectibleAsset = recordValue(metadata.collectible_asset);
  const verifiedReference = recordValue(metadata.verified_reference);
  const stored = textValue(collectibleAsset.grader_verification_status);
  const company = textValue(collectibleAsset.grading_company);
  const certNumber = textValue(collectibleAsset.grading_cert_number);
  const humanVerifiedSlabEvidence =
    instaComp.humanVerified === true &&
    Boolean(company) &&
    Boolean(certNumber) &&
    Boolean(textValue(verifiedReference.front_sha256));

  if (stored === "conflict") return "conflict";
  if (stored === "verified" || stored === "manual_verified") return stored;
  if (humanVerifiedSlabEvidence) return "manual_verified";
  return stored || "pending";
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let inventoryQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,description,category,condition,status,quantity,price,metadata,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true });

    inventoryQuery = isStoreOwnerAccount
      ? inventoryQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : inventoryQuery.eq("seller_account_id", account.id);

    const { data: inventoryRows, error: inventoryError } = await inventoryQuery;
    if (inventoryError) throw inventoryError;

    const rows = (inventoryRows || []).filter((row: any) => {
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      return Boolean(textValue(instaComp.source) || textValue(instaComp.scanId));
    });

    const productIds = Array.from(
      new Set(
        rows
          .map((row: any) => row.legacy_product_id)
          .filter((value: unknown): value is number => typeof value === "number"),
      ),
    );
    const { data: products, error: productError } =
      productIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("products")
            .select("id,image_url")
            .eq("store_id", storeId)
            .in("id", productIds);
    if (productError) throw productError;

    const productMap = new Map(
      (products || []).map((product: any) => [product.id, product]),
    );

    const items = rows.map((row: any) => {
      const metadata = recordValue(row.metadata);
      const instaComp = recordValue(metadata.instacomp);
      const ai = recordValue(instaComp.ai);
      const collectibleAsset = recordValue(metadata.collectible_asset);
      const graderVerification = recordValue(metadata.grader_verification);
      const product = row.legacy_product_id
        ? productMap.get(row.legacy_product_id)
        : null;
      const suggestedPrice = optionalPrice(
        Object.prototype.hasOwnProperty.call(instaComp, "suggestedPrice")
          ? instaComp.suggestedPrice
          : instaComp.marketPrice,
      );
      const pricingStatus =
        textValue(instaComp.pricingStatus) ||
        (suggestedPrice === null
          ? "not_run"
          : suggestedPrice > 0
            ? "suggested_from_reliable_sold_comps"
            : "seller_price_required");
      const blockers = getInventoryActivationBlockers({
        sku: row.sku || null,
        price: Number(row.price || 0),
        quantity: Number(row.quantity || 0),
        imageUrl: product?.image_url || null,
        title: row.title || null,
        category: row.category || null,
        metadata,
      });

      return {
        inventoryItemId: row.id,
        legacyProductId: row.legacy_product_id,
        title: row.title || "Untitled item",
        description: row.description || null,
        sku: row.sku || null,
        status: row.status || "draft",
        quantity: Number(row.quantity || 0),
        price: Number(row.price || 0),
        imageUrl: product?.image_url || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        activationReadiness: {
          ready: blockers.length === 0,
          blockers,
        },
        instaComp: {
          source: textValue(instaComp.source),
          scanId: textValue(instaComp.scanId),
          humanVerified: instaComp.humanVerified === true,
          serialNumber: textValue(ai.serialNumber),
          hasBackImage: instaComp.hasBackImage === true,
          suggestedPrice,
          pricingStatus,
          pricingReason:
            textValue(instaComp.pricingReason) ||
            (pricingStatus === "not_run"
              ? "InstaComp pricing has not run yet."
              : pricingStatus === "seller_price_required"
                ? "No reliable sold comps were available. Seller sets the price."
                : "Reliable sold comps produced this suggestion."),
          reliableSoldCompCount: Math.max(
            0,
            Number(instaComp.reliableSoldCompCount || 0),
          ),
          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          listingPrice: optionalPrice(instaComp.listingPrice),
          listingPriceSource: textValue(instaComp.listingPriceSource),
          gradingCompany:
            textValue(collectibleAsset.grading_company) ||
            textValue(ai.gradingCompany),
          gradingGrade:
            textValue(collectibleAsset.grading_grade) || textValue(ai.gradeValue),
          gradingCertNumber:
            textValue(collectibleAsset.grading_cert_number) ||
            textValue(ai.gradingCertNumber),
          graderVerificationStatus: effectiveGraderStatus(metadata),
          graderVerificationUrl:
            textValue(collectibleAsset.grader_verification_url) ||
            textValue(graderVerification.verificationUrl),
        },
      };
    });

    return Response.json(
      {
        items,
        count: items.length,
        pricingRule: {
          reliableSoldComps: "Suggested price is greater than $0.00.",
          noReliableSoldComps:
            "$0.00 means no reliable sold comps passed; seller pricing is required.",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load InstaComp pending listings." },
      { status: 500 },
    );
  }
}

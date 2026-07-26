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

function evidenceList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        title: textValue(row.title) || "Untitled listing",
        price: optionalPrice(row.price) || 0,
        currency: textValue(row.currency) || "USD",
        url: textValue(row.url),
        imageUrl: textValue(row.imageUrl),
        source: textValue(row.source),
        sourceLabel: textValue(row.sourceLabel) || textValue(row.source) || "Source",
        sourceCategory: textValue(row.sourceCategory),
        matchScore:
          Number.isFinite(Number(row.matchScore)) && Number(row.matchScore) >= 0
            ? Number(row.matchScore)
            : null,
        flags: Array.isArray(row.flags)
          ? row.flags.map((flag) => String(flag)).slice(0, 20)
          : [],
        soldAt: textValue(row.soldAt),
        listedAt: textValue(row.listedAt),
        observedAt: textValue(row.observedAt),
      };
    })
    .filter((entry) => entry.url && entry.price > 0)
    .slice(0, 20);
}

function providerCoverageList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        source: textValue(row.source),
        label: textValue(row.label),
        status: textValue(row.status),
        resultCount: Math.max(0, Number(row.resultCount || 0)),
        message: textValue(row.message),
        searchUrl: textValue(row.searchUrl),
      };
    });
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
      const sellerReview = recordValue(metadata.seller_review);
      const sourceLinks = recordValue(instaComp.sourceLinks);
      const pricingAnalysis = recordValue(instaComp.pricingAnalysis);
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
      const exactSerialNumber = textValue(collectibleAsset.exact_serial_number);
      const gradingCertNumber =
        textValue(collectibleAsset.grading_cert_number) ||
        textValue(ai.gradingCertNumber) ||
        textValue(ai.certificationNumber);
      const uniquePhysicalCopy = Boolean(exactSerialNumber || gradingCertNumber);

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
        uniquePhysicalCopy,
        quantityRule: uniquePhysicalCopy
          ? "Serial-numbered and graded-cert copies stay quantity 1 so each physical asset keeps its own history."
          : "Additional identical raw, non-serialized copies may be merged into this quantity.",
        activationReadiness: {
          ready: blockers.length === 0,
          blockers,
        },
        sellerReview: {
          identityConfirmed: sellerReview.identity_confirmed === true,
          confirmedAt: textValue(sellerReview.confirmed_at),
          confirmedBy: textValue(sellerReview.confirmed_by),
        },
        instaComp: {
          source: textValue(instaComp.source),
          scanId: textValue(instaComp.scanId),
          humanVerified: instaComp.humanVerified === true,
          serialNumber: textValue(ai.serialNumber) || exactSerialNumber,
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
          pricingAnalysis: {
            strategy: textValue(pricingAnalysis.strategy) || "no_market",
            soldCount: Math.max(0, Number(pricingAnalysis.soldCount || 0)),
            activeCount: Math.max(0, Number(pricingAnalysis.activeCount || 0)),
            soldLow: optionalPrice(pricingAnalysis.soldLow),
            soldMedian: optionalPrice(pricingAnalysis.soldMedian),
            soldAverage: optionalPrice(pricingAnalysis.soldAverage),
            soldHigh: optionalPrice(pricingAnalysis.soldHigh),
            activeLow: optionalPrice(pricingAnalysis.activeLow),
            activeMedian: optionalPrice(pricingAnalysis.activeMedian),
            activeAverage: optionalPrice(pricingAnalysis.activeAverage),
            activeHigh: optionalPrice(pricingAnalysis.activeHigh),
            soldListTarget: optionalPrice(pricingAnalysis.soldListTarget),
            competitiveTarget: optionalPrice(pricingAnalysis.competitiveTarget),
          },
          pricingCheckedAt: textValue(instaComp.pricingCheckedAt),
          listingPrice: optionalPrice(instaComp.listingPrice),
          listingPriceSource: textValue(instaComp.listingPriceSource),
          soldCompEvidence: evidenceList(instaComp.soldCompEvidence),
          activeCompetition: evidenceList(instaComp.activeCompetition),
          rejectedCandidates: evidenceList(instaComp.rejectedCandidates),
          providerCoverage: providerCoverageList(instaComp.providerCoverage),
          sourceLinks: {
            ebaySoldUrl: textValue(sourceLinks.ebaySoldUrl),
            ebayActiveUrl: textValue(sourceLinks.ebayActiveUrl),
            broadCardMarketUrl: textValue(sourceLinks.broadCardMarketUrl),
          },
          gradingCompany:
            textValue(collectibleAsset.grading_company) ||
            textValue(ai.gradingCompany),
          gradingGrade:
            textValue(collectibleAsset.grading_grade) || textValue(ai.gradeValue),
          gradingCertNumber,
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
          reliableSoldComps:
            "Exact sold comps establish market value. Exact active listings establish current competition. InstaComp combines both into a transparent sweet-spot listing suggestion.",
          noReliableSoldComps:
            "$0.00 means no reliable sold comps passed; seller pricing is required.",
          activeCompetition:
            "Active listings are shown separately and also constrain the sweet-spot listing target without replacing sold-market evidence.",
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

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { trustedRequestOrigin } from "../../../../../../../lib/site-origin";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  title: string | null;
  category: string | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
};

type ProductRow = {
  id: number;
  title: string | null;
  image_url: string | null;
  ebay_item_id: string | null;
};

type ImageRow = {
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function listValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function moneyValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function roundValue(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function uniqueStrings(values: Array<unknown>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function compactComp(value: unknown) {
  const row = recordValue(value);
  const price = moneyValue(row.price);
  const title = textValue(row.title);
  const url = textValue(row.url);
  if (!price || !title || !url) return null;

  return {
    title,
    price,
    url,
    source: textValue(row.source),
    sourceLabel: textValue(row.sourceLabel),
    soldAt: textValue(row.soldAt),
    observedAt: textValue(row.observedAt),
    matchScore: Number.isFinite(Number(row.matchScore))
      ? Number(row.matchScore)
      : null,
    flags: listValue(row.flags).map((flag) => String(flag)).slice(0, 10),
  };
}

function compList(value: unknown, maximum = 5) {
  return listValue(value)
    .map(compactComp)
    .filter(Boolean)
    .slice(0, maximum);
}

function compactHistorySnapshot(value: Record<string, unknown>) {
  return {
    updatedAt: textValue(value.updatedAt),
    listingPrice: moneyValue(value.listingPrice),
    marketPrice: moneyValue(value.marketPrice),
    soldMedian: moneyValue(value.soldMedian),
    soldCompCount: Number(value.soldCompCount || 0),
    sales7d: Number(value.sales7d || 0),
    sales30d: Number(value.sales30d || 0),
    deltaAmount:
      value.deltaAmount === null || value.deltaAmount === undefined
        ? null
        : roundValue(Number(value.deltaAmount || 0)),
    deltaPercent:
      value.deltaPercent === null || value.deltaPercent === undefined
        ? null
        : roundValue(Number(value.deltaPercent || 0)),
    trustedForPricing: value.trustedForPricing === true,
  };
}

function soldVelocity(comps: Array<Record<string, unknown>>, days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return comps.filter((comp) => {
    const soldAt = Date.parse(String(comp.soldAt || ""));
    return Number.isFinite(soldAt) && soldAt >= cutoff;
  }).length;
}

async function imageFileFromUrl(url: string, side: "front" | "back") {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "TruelyCollectables-InstaComp/1.0",
      Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    throw new Error(`Could not load the ${side} image (${response.status}).`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0) {
    throw new Error(`The ${side} image was empty.`);
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`The ${side} image is larger than 12MB.`);
  }

  const rawType = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentType = ALLOWED_IMAGE_TYPES.has(rawType) ? rawType : "image/jpeg";
  const extension =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";

  return new File([bytes], `${side}-existing-inventory.${extension}`, {
    type: contentType,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
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

    const { inventoryItemId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const scanTier = body.deepScan === true ? "courtroom" : "adaptive";
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

    const { data: itemData, error: itemError } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,title,category,price,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .single();

    if (itemError || !itemData) {
      return Response.json({ error: "Inventory item was not found." }, { status: 404 });
    }

    const item = itemData as InventoryRow;
    const allowed =
      item.seller_account_id === account.id || (owner && item.seller_account_id === null);
    if (!allowed) {
      return Response.json({ error: "Inventory item was not found." }, { status: 404 });
    }

    const categoryText = String(item.category || "").toLowerCase();
    const titleText = String(item.title || "").toLowerCase();
    if (
      !categoryText.includes("card") &&
      !titleText.includes(" card") &&
      !titleText.startsWith("card")
    ) {
      return Response.json(
        { error: "InstaComp™ inventory tracking is currently limited to cards." },
        { status: 409 },
      );
    }

    const productResult = item.legacy_product_id
      ? await supabase
          .from("products")
          .select("id,title,image_url,ebay_item_id")
          .eq("id", item.legacy_product_id)
          .eq("store_id", storeId)
          .maybeSingle()
      : { data: null, error: null };
    if (productResult.error) throw productResult.error;
    const product = productResult.data as ProductRow | null;

    const { data: imageData, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;

    const metadata = recordValue(item.metadata);
    const orderedImages = ((imageData || []) as ImageRow[]).sort(
      (left, right) =>
        Number(right.is_primary || false) - Number(left.is_primary || false) ||
        Number(left.sort_order || 0) - Number(right.sort_order || 0),
    );
    const imageUrls = uniqueStrings([
      ...orderedImages.map((image) => image.image_url),
      product?.image_url,
      ...listValue(metadata.ebay_image_urls),
      ...listValue(metadata.image_urls),
      ...listValue(metadata.source_image_urls),
    ]);

    if (!imageUrls[0]) {
      return Response.json(
        { error: "This card does not have an image available for InstaComp™." },
        { status: 409 },
      );
    }

    const [frontImage, backImage] = await Promise.all([
      imageFileFromUrl(imageUrls[0], "front"),
      imageUrls[1]
        ? imageFileFromUrl(imageUrls[1], "back").catch(() => null)
        : Promise.resolve(null),
    ]);
    const form = new FormData();
    form.append("frontImage", frontImage);
    if (backImage) form.append("backImage", backImage);
    form.append("aiCouncilTier", scanTier);

    const authorization = request.headers.get("authorization");
    const scanResponse = await fetch(
      `${trustedRequestOrigin(request)}/api/instacomp/scan`,
      {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : undefined,
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(285_000),
      },
    );
    const scan = await scanResponse.json().catch(() => ({}));

    if (!scanResponse.ok || scan?.ok !== true) {
      throw new Error(scan?.error || "InstaComp™ could not refresh this card.");
    }

    const marketStats = recordValue(scan.stats);
    const soldStats = recordValue(scan.soldStats);
    const review = recordValue(scan.review);
    const consensus = recordValue(scan.consensus);
    const ai = recordValue(scan.ai);
    const ocrDiagnostics = recordValue(scan.ocrDiagnostics);
    const aiCouncil = recordValue(ocrDiagnostics.aiCouncil);
    const soldComps = compList(scan.soldComps, 8) as Array<Record<string, unknown>>;
    const marketComps = compList(scan.marketValueComps, 8) as Array<
      Record<string, unknown>
    >;
    const listingPrice = moneyValue(item.price) || 0;
    const soldMedian = moneyValue(soldStats.median);
    const marketPrice =
      soldMedian ||
      moneyValue(marketStats.suggestedPrice) ||
      moneyValue(marketStats.median);
    const deltaAmount = marketPrice ? roundValue(listingPrice - marketPrice) : null;
    const deltaPercent =
      marketPrice && marketPrice > 0
        ? roundValue(((listingPrice - marketPrice) / marketPrice) * 100)
        : null;
    const latestSoldAt = soldComps
      .map((comp) => textValue(comp.soldAt))
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;
    const updatedAt = new Date().toISOString();
    const current = {
      schema: "truely.instacompInventoryTracking.v1",
      updatedAt,
      scanId: textValue(scan.scanId),
      searchQuery: textValue(scan.searchQuery),
      scanTier,
      aiJudgments: 1 + Math.max(0, Number(aiCouncil.completedReaders || 0)),
      hasBackImage: Boolean(backImage),
      identity: {
        player: textValue(ai.player),
        year: textValue(ai.year),
        brand: textValue(ai.brand),
        setName: textValue(ai.setName),
        cardNumber: textValue(ai.cardNumber),
        parallel: textValue(ai.parallel),
        serialNumber: textValue(ai.serialNumber),
        gradingCompany: textValue(ai.gradingCompany),
        gradeValue: textValue(ai.gradeValue),
        isRookie: ai.isRookie === true,
        isAuto: ai.isAuto === true,
        isRelic: ai.isRelic === true,
        confidence: Number.isFinite(Number(ai.confidence)) ? Number(ai.confidence) : null,
      },
      trustedForPricing: review.trustedForPricing === true,
      trustedForIdentity: consensus.trustedForIdentity === true,
      reviewReasons: listValue(review.reviewReasons)
        .map((reason) => String(reason))
        .slice(0, 20),
      listingPrice,
      marketPrice,
      marketMedian: moneyValue(marketStats.median),
      marketLow: moneyValue(marketStats.low),
      marketHigh: moneyValue(marketStats.high),
      soldMedian,
      soldLow: moneyValue(soldStats.low),
      soldHigh: moneyValue(soldStats.high),
      marketCompCount: marketComps.length,
      soldCompCount: soldComps.length,
      latestSoldAt,
      sales7d: soldVelocity(soldComps, 7),
      sales30d: soldVelocity(soldComps, 30),
      deltaAmount,
      deltaPercent,
      pricingPosition:
        deltaPercent === null
          ? "no_market"
          : deltaPercent > 5
            ? "above_market"
            : deltaPercent < -5
              ? "below_market"
              : "at_market",
      topSoldComps: soldComps.slice(0, 5),
      topMarketComps: marketComps.slice(0, 5),
      sourceCoverage: listValue(scan.sourceCoverage).slice(0, 50),
      providers: listValue(scan.providers)
        .map((provider) => {
          const row = recordValue(provider);
          return {
            source: textValue(row.source),
            label: textValue(row.label),
            status: textValue(row.status),
            resultCount: listValue(row.results).length,
            message: textValue(row.message),
          };
        })
        .slice(0, 20),
    };

    const trackingRoot = recordValue(metadata.instacomp_tracking);
    const previousCurrent = recordValue(trackingRoot.current);
    const existingHistory = listValue(trackingRoot.history)
      .map((entry) => recordValue(entry))
      .filter((entry) => Object.keys(entry).length > 0);
    const history = [
      ...(Object.keys(previousCurrent).length > 0
        ? [compactHistorySnapshot(previousCurrent)]
        : []),
      ...existingHistory,
    ].slice(0, 30);
    const nextMetadata = {
      ...metadata,
      instacomp_tracking: {
        schema: "truely.instacompInventoryTrackingHistory.v1",
        current,
        history,
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: updatedAt })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return Response.json({
      success: true,
      inventoryItemId,
      tracking: current,
      historyCount: history.length,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "InstaComp™ inventory tracking failed." },
      { status: 500 },
    );
  }
}

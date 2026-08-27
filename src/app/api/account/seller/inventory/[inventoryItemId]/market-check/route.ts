import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  classifyCollectibleCategory,
  tradingCardCategoryMetadata,
} from "../../../../../../../lib/collectible-category-policy";
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
  status: string | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ProductRow = {
  id: number;
  title: string | null;
  image_url: string | null;
  ebay_item_id: string | null;
  sport: string | null;
  price?: number | string | null;
};

type ImageRow = {
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

type PricingComp = {
  title: string;
  price: number;
  url: string;
  source: string;
  sourceLabel: string;
  sourceCategory: string;
  soldAt: string | null;
  observedAt: string | null;
  matchScore: number;
  flags: string[];
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function listValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
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

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9#/+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_TOKENS = new Set([
  "the",
  "and",
  "with",
  "card",
  "cards",
  "trading",
  "sports",
  "hockey",
  "baseball",
  "basketball",
  "football",
  "golf",
  "near",
  "mint",
  "nm",
  "condition",
  "authentic",
  "authenticity",
  "upper",
  "deck",
  "panini",
  "topps",
]);

function meaningfulTokens(value: unknown) {
  return normalized(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_TOKENS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function yearToken(value: unknown) {
  return normalized(value).match(/\b(?:19|20)\d{2}(?:[-/]\d{2,4})?\b/)?.[0] || null;
}

function serialDenominator(value: unknown) {
  const text = normalized(value);
  const match =
    text.match(/(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/) ||
    text.match(/\bof\s+(\d{1,4})(?!\d)/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cardNumberToken(value: unknown) {
  const text = normalized(value);
  const match = text.match(/#([a-z0-9][a-z0-9-]{0,15})\b/);
  return match?.[1] || null;
}

function hasAuto(value: unknown) {
  return /\b(auto|autograph|autographed|signed)\b/.test(normalized(value));
}

function hasRelic(value: unknown) {
  return /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn)\b/.test(
    normalized(value),
  );
}

function hasGrading(value: unknown) {
  return /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(normalized(value));
}

function looksBad(value: unknown) {
  return /\b(lot of|pick your|choose your|custom|reprint|digital|break|case break|box break|team lot|player lot|facsimile|proxy|replica)\b/.test(
    normalized(value),
  );
}

function compactRawComp(value: unknown): PricingComp | null {
  const row = recordValue(value);
  const title = textValue(row.title);
  const price = moneyValue(row.price);
  const url = textValue(row.url);
  if (!title || !price || !url) return null;

  return {
    title,
    price,
    url,
    source: textValue(row.source) || "unknown",
    sourceLabel: textValue(row.sourceLabel) || "Marketplace",
    sourceCategory: textValue(row.sourceCategory) || "marketplace",
    soldAt: textValue(row.soldAt),
    observedAt: textValue(row.observedAt),
    matchScore: Number.isFinite(Number(row.matchScore)) ? Number(row.matchScore) : 0,
    flags: listValue(row.flags).map((flag) => String(flag)).slice(0, 20),
  };
}

function listingTitleMatch(params: {
  listingTitle: string;
  candidate: PricingComp;
  ai: Record<string, unknown>;
  currentEbayItemId: string | null;
}) {
  const candidateText = normalized(params.candidate.title);
  if (!candidateText || looksBad(candidateText)) return null;
  if (
    params.currentEbayItemId &&
    (params.candidate.url.includes(params.currentEbayItemId) ||
      candidateText.includes(params.currentEbayItemId))
  ) {
    return null;
  }

  const targetYear = yearToken(params.listingTitle) || yearToken(params.ai.year);
  const targetSerial = serialDenominator(params.listingTitle) || serialDenominator(params.ai.serialNumber);
  const targetCardNumber = cardNumberToken(params.listingTitle) || textValue(params.ai.cardNumber)?.toLowerCase() || null;
  const targetPlayer = normalized(params.ai.player);
  const targetAuto = hasAuto(params.listingTitle) || params.ai.isAuto === true;
  const targetRelic = hasRelic(params.listingTitle) || params.ai.isRelic === true;
  const targetGraded = hasGrading(params.listingTitle) || Boolean(params.ai.gradingCompany || params.ai.gradeValue);

  if (targetYear && !candidateText.includes(targetYear)) return null;
  if (targetSerial && serialDenominator(candidateText) !== targetSerial) return null;
  if (targetCardNumber) {
    const padded = ` ${candidateText} `;
    const patterns = [
      `#${targetCardNumber}`,
      ` ${targetCardNumber} `,
      `-${targetCardNumber} `,
      `/${targetCardNumber} `,
      ` card ${targetCardNumber} `,
      ` no ${targetCardNumber} `,
    ];
    if (!patterns.some((pattern) => padded.includes(pattern))) return null;
  }
  if (targetPlayer && !candidateText.includes(targetPlayer)) return null;
  if (targetAuto !== hasAuto(candidateText)) return null;
  if (targetRelic !== hasRelic(candidateText)) return null;
  if (targetGraded !== hasGrading(candidateText)) return null;

  const targetTokens = Array.from(new Set(meaningfulTokens(params.listingTitle)));
  const candidateTokens = new Set(meaningfulTokens(candidateText));
  const matched = targetTokens.filter((token) => candidateTokens.has(token));
  const overlap = targetTokens.length ? matched.length / targetTokens.length : 0;

  let score = overlap * 70;
  const flags = [`title overlap ${Math.round(overlap * 100)}%`];
  if (targetPlayer) {
    score += 18;
    flags.push("player");
  }
  if (targetYear) {
    score += 8;
    flags.push("year");
  }
  if (targetCardNumber) {
    score += 18;
    flags.push("card #");
  }
  if (targetSerial) {
    score += 18;
    flags.push(`print run /${targetSerial}`);
  }
  if (targetAuto) {
    score += 8;
    flags.push("autograph");
  }
  if (targetRelic) {
    score += 8;
    flags.push("relic");
  }

  if (overlap < 0.48 || score < 58) return null;

  return {
    ...params.candidate,
    matchScore: Math.round(score),
    flags: Array.from(new Set([...params.candidate.flags, ...flags, "seller title verified"])),
  };
}

function dedupeComps(values: PricingComp[]) {
  const map = new Map<string, PricingComp>();
  for (const comp of values) {
    const key = `${normalized(comp.title)}|${comp.price.toFixed(2)}|${comp.url}`;
    const previous = map.get(key);
    if (!previous || comp.matchScore > previous.matchScore) map.set(key, comp);
  }
  return Array.from(map.values()).sort((left, right) => {
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    return left.price - right.price;
  });
}

function compStats(comps: PricingComp[]) {
  const prices = comps
    .map((comp) => comp.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);
  if (!prices.length) {
    return { low: null, median: null, average: null, high: null, suggestedPrice: null };
  }
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[middle - 1] + prices[middle]) / 2
      : prices[middle];
  const average = prices.reduce((total, price) => total + price, 0) / prices.length;
  return {
    low: roundValue(prices[0]),
    median: roundValue(median),
    average: roundValue(average),
    high: roundValue(prices[prices.length - 1]),
    suggestedPrice: roundValue(median || average),
  };
}

function soldVelocity(comps: PricingComp[], days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return comps.filter((comp) => {
    const soldAt = Date.parse(String(comp.soldAt || ""));
    return Number.isFinite(soldAt) && soldAt >= cutoff;
  }).length;
}

function compactHistorySnapshot(value: Record<string, unknown>) {
  return {
    updatedAt: textValue(value.updatedAt),
    listingPrice: moneyValue(value.listingPrice),
    marketPrice: moneyValue(value.marketPrice),
    soldMedian: moneyValue(value.soldMedian),
    soldCompCount: Number(value.soldCompCount || 0),
    marketCompCount: Number(value.marketCompCount || 0),
    deltaAmount:
      value.deltaAmount === null || value.deltaAmount === undefined
        ? null
        : roundValue(Number(value.deltaAmount || 0)),
    deltaPercent:
      value.deltaPercent === null || value.deltaPercent === undefined
        ? null
        : roundValue(Number(value.deltaPercent || 0)),
    pricingEvidenceMode: textValue(value.pricingEvidenceMode),
  };
}

function uniqueStrings(values: Array<unknown>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
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
  if (!response.ok) throw new Error(`Could not load the ${side} image (${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error(`The ${side} image was empty.`);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`The ${side} image is larger than 12MB.`);
  const rawType = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentType = ALLOWED_IMAGE_TYPES.has(rawType) ? rawType : "image/jpeg";
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return new File([bytes], `${side}-active-inventory.${extension}`, { type: contentType });
}

async function internalSoldEvidence(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  currentInventoryItemId: string;
  listingTitle: string;
  ai: Record<string, unknown>;
  currentEbayItemId: string | null;
}) {
  const { data: soldData, error: soldError } = await params.supabase
    .from("inventory_items")
    .select("id,legacy_product_id,title,price,updated_at,metadata")
    .eq("store_id", params.storeId)
    .eq("status", "sold")
    .neq("id", params.currentInventoryItemId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  if (soldError) throw soldError;

  const rows = soldData || [];
  const productIds = Array.from(
    new Set(
      rows
        .map((row: any) => Number(row.legacy_product_id || 0))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
  const productResult = productIds.length
    ? await params.supabase
        .from("products")
        .select("id,title,price,ebay_item_id")
        .eq("store_id", params.storeId)
        .in("id", productIds)
    : { data: [], error: null };
  if (productResult.error) throw productResult.error;
  const products = new Map((productResult.data || []).map((row: any) => [Number(row.id), row]));

  const candidates = rows
    .map((row: any) => {
      const product = row.legacy_product_id ? products.get(Number(row.legacy_product_id)) : null;
      const price = moneyValue(row.price) || moneyValue(product?.price);
      const title = textValue(row.title) || textValue(product?.title);
      if (!price || !title) return null;
      return {
        title,
        price,
        url: row.legacy_product_id
          ? `/admin/products/${row.legacy_product_id}`
          : `/seller/inventory?search=${encodeURIComponent(title)}`,
        source: "tcos_sold_inventory",
        sourceLabel: "TCOS Sold Inventory",
        sourceCategory: "sold",
        soldAt: textValue(row.updated_at),
        observedAt: textValue(row.updated_at),
        matchScore: 0,
        flags: ["internal sold history"],
      } satisfies PricingComp;
    })
    .filter((value): value is PricingComp => Boolean(value));

  return dedupeComps(
    candidates
      .map((candidate) =>
        listingTitleMatch({
          listingTitle: params.listingTitle,
          candidate,
          ai: params.ai,
          currentEbayItemId: params.currentEbayItemId,
        }),
      )
      .filter((value): value is PricingComp => Boolean(value)),
  ).slice(0, 12);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

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
      .select("id,legacy_product_id,seller_account_id,title,category,status,price,metadata,updated_at")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .single();
    if (itemError || !itemData) {
      return Response.json({ error: "Inventory item was not found." }, { status: 404 });
    }

    const item = itemData as InventoryRow;
    const allowed = item.seller_account_id === account.id || (owner && item.seller_account_id === null);
    if (!allowed) return Response.json({ error: "Inventory item was not found." }, { status: 404 });
    if (item.status !== "active") {
      return Response.json(
        { error: "Only active inventory can be refreshed from the active pricing workspace." },
        { status: 409 },
      );
    }

    const productResult = item.legacy_product_id
      ? await supabase
          .from("products")
          .select("id,title,image_url,ebay_item_id,sport,price")
          .eq("id", item.legacy_product_id)
          .eq("store_id", storeId)
          .maybeSingle()
      : { data: null, error: null };
    if (productResult.error) throw productResult.error;
    const product = productResult.data as ProductRow | null;
    const metadata = recordValue(item.metadata);
    const listingTitle = item.title || product?.title || "Untitled sports card";
    const categoryDecision = classifyCollectibleCategory({
      title: listingTitle,
      category: item.category,
      sport: product?.sport,
      metadata,
    });
    if (!categoryDecision.isTradingCard) {
      return Response.json(
        {
          error: "InstaComp™ for physical memorabilia and other collectibles is coming soon.",
          availability: "coming_soon",
        },
        { status: 409 },
      );
    }

    const { data: imageData, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;

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
    const scanResponse = await fetch(`${trustedRequestOrigin(request)}/api/instacomp/scan`, {
      method: "POST",
      headers: authorization ? { Authorization: authorization } : undefined,
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(285_000),
    });
    const scan = await scanResponse.json().catch(() => ({}));
    if (!scanResponse.ok || scan?.ok !== true) {
      throw new Error(scan?.error || "InstaComp™ could not refresh this card.");
    }

    const ai = recordValue(scan.ai);
    const rawProviderComps = [
      ...listValue(scan.activeComps),
      ...listValue(scan.providers).flatMap((provider) => listValue(recordValue(provider).results)),
    ]
      .map(compactRawComp)
      .filter((value): value is PricingComp => Boolean(value));

    const fallbackMatches = dedupeComps(
      rawProviderComps
        .map((candidate) =>
          listingTitleMatch({
            listingTitle,
            candidate,
            ai,
            currentEbayItemId: product?.ebay_item_id || null,
          }),
        )
        .filter((value): value is PricingComp => Boolean(value)),
    );
    const internalSold = await internalSoldEvidence({
      supabase,
      storeId,
      currentInventoryItemId: inventoryItemId,
      listingTitle,
      ai,
      currentEbayItemId: product?.ebay_item_id || null,
    });

    const originalMarket = listValue(scan.marketValueComps)
      .map(compactRawComp)
      .filter((value): value is PricingComp => Boolean(value));
    const originalSold = listValue(scan.soldComps)
      .map(compactRawComp)
      .filter((value): value is PricingComp => Boolean(value));

    const soldComps = dedupeComps([
      ...originalSold,
      ...fallbackMatches.filter((comp) => comp.sourceCategory === "sold"),
      ...internalSold,
    ]).slice(0, 12);
    const marketComps = dedupeComps([
      ...originalMarket,
      ...fallbackMatches.filter(
        (comp) => !["reference", "broad"].includes(comp.sourceCategory),
      ),
      ...soldComps,
    ]).slice(0, 20);

    const marketStats = compStats(marketComps);
    const soldStats = compStats(soldComps);
    const originalReview = recordValue(scan.review);
    const originalConsensus = recordValue(scan.consensus);
    const fallbackUsed = originalMarket.length === 0 && marketComps.length > 0;
    const trustedForPricing =
      originalReview.trustedForPricing === true || soldComps.length > 0 || marketComps.length >= 2;
    const reviewReasons = listValue(originalReview.reviewReasons)
      .map((reason) => String(reason))
      .filter((reason) => !(marketComps.length > 0 && reason === "missing_usable_comps"));
    if (fallbackUsed) reviewReasons.push("seller_title_fallback_used");
    if (internalSold.length > 0) reviewReasons.push("tcos_sold_history_used");
    if (marketComps.length === 1 && soldComps.length === 0) {
      reviewReasons.push("single_active_comp_guidance_only");
    }

    const listingPrice = moneyValue(item.price) || 0;
    const marketPrice = soldStats.median || marketStats.suggestedPrice || marketStats.median;
    const deltaAmount = marketPrice ? roundValue(listingPrice - marketPrice) : null;
    const deltaPercent =
      marketPrice && marketPrice > 0
        ? roundValue(((listingPrice - marketPrice) / marketPrice) * 100)
        : null;
    const latestSoldAt =
      soldComps
        .map((comp) => comp.soldAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null;
    const ocrDiagnostics = recordValue(scan.ocrDiagnostics);
    const aiCouncil = recordValue(ocrDiagnostics.aiCouncil);
    const updatedAt = new Date().toISOString();
    const current = {
      schema: "truely.activeInventoryMarketCheck.v2",
      updatedAt,
      scanId: textValue(scan.scanId),
      searchQuery: listingTitle,
      scanTier,
      pricingEvidenceMode:
        soldComps.length > 0
          ? "exact_sold_and_market"
          : fallbackUsed
            ? "seller_title_exact_market_fallback"
            : marketComps.length > 0
              ? "exact_market"
              : "no_exact_market",
      fallbackUsed,
      internalSoldCompCount: internalSold.length,
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
      trustedForPricing,
      trustedForIdentity: originalConsensus.trustedForIdentity === true,
      reviewReasons: Array.from(new Set(reviewReasons)).slice(0, 20),
      listingPrice,
      marketPrice,
      marketMedian: marketStats.median,
      marketLow: marketStats.low,
      marketHigh: marketStats.high,
      soldMedian: soldStats.median,
      soldLow: soldStats.low,
      soldHigh: soldStats.high,
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
      sourceCoverage: [
        ...listValue(scan.sourceCoverage),
        {
          label: "TCOS Sold Inventory",
          category: "sold",
          status: internalSold.length ? "included" : "no_matches",
          includedInMarketValue: internalSold.length > 0,
          resultCount: internalSold.length,
          message: internalSold.length
            ? "Exact sold inventory matches were included from the TCOS database."
            : "No exact sold inventory matches were found in the TCOS database.",
        },
      ].slice(0, 60),
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
      ...tradingCardCategoryMetadata({
        metadata,
        previousCategory: item.category,
        decision: categoryDecision,
      }),
      instacomp_tracking: {
        schema: "truely.instacompInventoryTrackingHistory.v2",
        current,
        history,
      },
    };

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        category: categoryDecision.category,
        metadata: nextMetadata,
        updated_at: updatedAt,
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return Response.json({
      success: true,
      inventoryItemId,
      category: categoryDecision.category,
      tracking: current,
      historyCount: history.length,
      evidence: {
        rawProviderCandidates: rawProviderComps.length,
        exactFallbackMatches: fallbackMatches.length,
        internalSoldMatches: internalSold.length,
        marketCompCount: marketComps.length,
        soldCompCount: soldComps.length,
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Active inventory market check failed." },
      { status: 500 },
    );
  }
}

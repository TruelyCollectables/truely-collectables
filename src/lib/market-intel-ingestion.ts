import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { scoreMarketIntelListing } from "./market-intel-deals";
import { createSupabaseServerClient } from "./supabase-server";

const MAX_BATCH_SIZE = 100;
const LISTING_FORMATS = new Set([
  "fixed_price",
  "auction",
  "best_offer",
  "lot",
  "unknown",
]);

type JsonRecord = Record<string, unknown>;

type MarketIntelListingWrite = {
  marketplace_id: string;
  collectible_identity_id: string;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  listing_status: "active";
  listing_format: string;
  asking_price: number;
  shipping_price: number;
  buyer_fee: number;
  quantity: number;
  seller_name: string | null;
  seller_rating: number | null;
  auction_end_at: string | null;
  last_seen_at: string;
  identity_match_confidence: number;
  suspected_mislisting: boolean;
  mislisting_reason: string | null;
  metadata: JsonRecord;
};

export type MarketIntelIngestItem = {
  marketplaceSlug: string;
  collectibleIdentityId?: string | null;
  collectibleIdentityKey?: string | null;
  externalListingId?: string | null;
  directUrl: string;
  originalTitle: string;
  description?: string | null;
  imageUrls?: string[];
  listingFormat?: string;
  askingPrice: number;
  shippingPrice?: number;
  buyerFee?: number;
  currency?: string;
  quantity?: number;
  sellerName?: string | null;
  sellerRating?: number | null;
  sellerFeedbackCount?: number | null;
  locationText?: string | null;
  listedAt?: string | null;
  lastSeenAt?: string | null;
  auctionEndAt?: string | null;
  identityMatchConfidence?: number;
  identityMatchMethod?: string | null;
  suspectedMislisting?: boolean;
  mislistingReason?: string | null;
  metadata?: JsonRecord;
};

export type MarketIntelIngestResult = {
  inputIndex: number;
  status: "created" | "updated" | "rejected" | "error";
  listingId?: string;
  marketplaceSlug?: string;
  externalListingId?: string | null;
  priceChanged?: boolean;
  scored?: boolean;
  message?: string;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerValue(value: unknown, fallback = 0) {
  const parsed = Math.round(numberValue(value, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value: string | null | undefined, fallback?: string) {
  if (!value) return fallback || null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed.toISOString();
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function isAuthorizedMarketIntelIngest(request: Request) {
  const configuredSecret = (
    process.env.MARKET_INTEL_INGEST_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
  if (!configuredSecret) return false;

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerSecret = (
    request.headers.get("x-market-intel-key") || bearer
  ).trim();

  return Boolean(headerSecret && secureEqual(configuredSecret, headerSecret));
}

function listingFingerprint(
  marketplaceSlug: string,
  externalListingId: string | null,
  directUrl: string,
  identityId: string,
) {
  return createHash("sha256")
    .update(
      [marketplaceSlug, externalListingId || "", directUrl, identityId].join("|"),
    )
    .digest("hex");
}

function validateItem(item: MarketIntelIngestItem) {
  const marketplaceSlug = String(item.marketplaceSlug || "").trim();
  const directUrl = String(item.directUrl || "").trim();
  const originalTitle = String(item.originalTitle || "").trim();
  const listingFormat = String(item.listingFormat || "unknown").trim();
  const askingPrice = numberValue(item.askingPrice, Number.NaN);
  const shippingPrice = numberValue(item.shippingPrice, 0);
  const buyerFee = numberValue(item.buyerFee, 0);
  const quantity = integerValue(item.quantity, 1);
  const matchConfidence = numberValue(item.identityMatchConfidence, 100);
  const currency = String(item.currency || "USD").trim().toUpperCase() || "USD";

  if (!marketplaceSlug) throw new Error("marketplaceSlug is required.");
  if (!directUrl || !isHttpUrl(directUrl)) {
    throw new Error("A direct http(s) listing URL is required.");
  }
  if (!originalTitle) throw new Error("originalTitle is required.");
  if (!LISTING_FORMATS.has(listingFormat)) {
    throw new Error(`Unsupported listingFormat: ${listingFormat}`);
  }
  if (!Number.isFinite(askingPrice) || askingPrice < 0) {
    throw new Error("askingPrice must be zero or greater.");
  }
  if (shippingPrice < 0 || buyerFee < 0) {
    throw new Error("shippingPrice and buyerFee cannot be negative.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive whole number.");
  }
  if (matchConfidence < 0 || matchConfidence > 100) {
    throw new Error("identityMatchConfidence must be between 0 and 100.");
  }

  return {
    marketplaceSlug,
    directUrl,
    originalTitle,
    listingFormat,
    askingPrice,
    shippingPrice,
    buyerFee,
    quantity,
    matchConfidence,
    currency,
  };
}

export async function ingestMarketIntelListings(
  items: MarketIntelIngestItem[],
) {
  if (!Array.isArray(items)) throw new Error("items must be an array.");
  if (items.length === 0) throw new Error("At least one listing is required.");
  if (items.length > MAX_BATCH_SIZE) {
    throw new Error(`A single ingest request is limited to ${MAX_BATCH_SIZE} listings.`);
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const results: MarketIntelIngestResult[] = [];

  for (let inputIndex = 0; inputIndex < items.length; inputIndex += 1) {
    const item = items[inputIndex];

    try {
      const validated = validateItem(item);
      const externalListingId =
        String(item.externalListingId || "").trim() || null;

      const { data: marketplaceRows, error: marketplaceError } = await supabase
        .from("tcos_mi_marketplaces")
        .select("id,slug")
        .eq("slug", validated.marketplaceSlug)
        .eq("active", true)
        .limit(1);
      if (marketplaceError) throw new Error(marketplaceError.message);
      const marketplace = marketplaceRows?.[0] || null;

      if (!marketplace) {
        results.push({
          inputIndex,
          status: "rejected",
          marketplaceSlug: validated.marketplaceSlug,
          externalListingId,
          message: "Marketplace is not configured or active.",
        });
        continue;
      }

      let identityQuery = supabase
        .from("tcos_mi_collectible_identities")
        .select("id,identity_key,active")
        .eq("active", true);

      if (item.collectibleIdentityId) {
        identityQuery = identityQuery.eq("id", item.collectibleIdentityId);
      } else if (item.collectibleIdentityKey) {
        identityQuery = identityQuery.eq(
          "identity_key",
          item.collectibleIdentityKey,
        );
      } else {
        results.push({
          inputIndex,
          status: "rejected",
          marketplaceSlug: validated.marketplaceSlug,
          externalListingId,
          message:
            "Exact collectibleIdentityId or collectibleIdentityKey is required; loose matching is not allowed.",
        });
        continue;
      }

      const { data: identityRows, error: identityError } = await identityQuery
        .order("created_at", { ascending: true })
        .limit(1);
      if (identityError) throw new Error(identityError.message);
      const identity = identityRows?.[0] || null;

      if (!identity) {
        results.push({
          inputIndex,
          status: "rejected",
          marketplaceSlug: validated.marketplaceSlug,
          externalListingId,
          message: "Exact collectible identity was not found or is inactive.",
        });
        continue;
      }

      let existingQuery = supabase
        .from("tcos_mi_listings")
        .select(
          "id,asking_price,shipping_price,buyer_fee,delivered_price,first_seen_at,metadata",
        )
        .eq("marketplace_id", marketplace.id);

      existingQuery = externalListingId
        ? existingQuery.eq("external_listing_id", externalListingId)
        : existingQuery.eq("direct_url", validated.directUrl);

      const { data: existingRows, error: existingError } = await existingQuery
        .order("created_at", { ascending: true })
        .limit(1);
      if (existingError) throw new Error(existingError.message);
      const existing = existingRows?.[0] || null;

      const seenAt = parseDate(item.lastSeenAt, new Date().toISOString())!;
      const oldMetadata = recordValue(existing?.metadata);
      const priorListedAt =
        typeof oldMetadata.listed_at === "string"
          ? oldMetadata.listed_at
          : null;
      const listedAt =
        parseDate(item.listedAt) ||
        priorListedAt ||
        existing?.first_seen_at ||
        seenAt;
      const auctionEndAt = parseDate(item.auctionEndAt);
      const priceChanged = Boolean(
        existing &&
          (numberValue(existing.asking_price) !== validated.askingPrice ||
            numberValue(existing.shipping_price) !== validated.shippingPrice ||
            numberValue(existing.buyer_fee) !== validated.buyerFee),
      );
      const priorHistory = Array.isArray(oldMetadata.price_history)
        ? oldMetadata.price_history
        : [];
      const priceHistory = priceChanged
        ? [
            ...priorHistory,
            {
              changed_at: seenAt,
              asking_price: numberValue(existing?.asking_price),
              shipping_price: numberValue(existing?.shipping_price),
              buyer_fee: numberValue(existing?.buyer_fee),
              delivered_price: numberValue(existing?.delivered_price),
            },
          ].slice(-50)
        : priorHistory;

      const description =
        item.description === undefined
          ? typeof oldMetadata.description === "string"
            ? oldMetadata.description
            : null
          : item.description;
      const imageUrls =
        item.imageUrls === undefined
          ? stringArray(oldMetadata.image_urls)
          : stringArray(item.imageUrls);
      const sellerFeedbackCount =
        item.sellerFeedbackCount === undefined ||
        item.sellerFeedbackCount === null
          ? oldMetadata.seller_feedback_count === undefined ||
            oldMetadata.seller_feedback_count === null
            ? null
            : integerValue(oldMetadata.seller_feedback_count)
          : integerValue(item.sellerFeedbackCount);
      const locationText =
        item.locationText === undefined
          ? typeof oldMetadata.location_text === "string"
            ? oldMetadata.location_text
            : null
          : item.locationText;
      const identityMatchMethod =
        item.identityMatchMethod ||
        (typeof oldMetadata.identity_match_method === "string"
          ? oldMetadata.identity_match_method
          : "external_exact_identity");
      const staleFingerprint = listingFingerprint(
        validated.marketplaceSlug,
        externalListingId,
        validated.directUrl,
        String(identity.id),
      );

      // Keep this object aligned to the installed Beta One table. Source fields
      // that do not exist as physical columns are retained in metadata below.
      const payload: MarketIntelListingWrite = {
        marketplace_id: String(marketplace.id),
        collectible_identity_id: String(identity.id),
        external_listing_id: externalListingId,
        direct_url: validated.directUrl,
        original_title: validated.originalTitle,
        listing_status: "active",
        listing_format: validated.listingFormat,
        asking_price: validated.askingPrice,
        shipping_price: validated.shippingPrice,
        buyer_fee: validated.buyerFee,
        quantity: validated.quantity,
        seller_name: item.sellerName || null,
        seller_rating:
          item.sellerRating === null || item.sellerRating === undefined
            ? null
            : numberValue(item.sellerRating),
        auction_end_at: auctionEndAt,
        last_seen_at: seenAt,
        identity_match_confidence: validated.matchConfidence,
        suspected_mislisting: Boolean(item.suspectedMislisting),
        mislisting_reason: item.mislistingReason || null,
        metadata: {
          ...oldMetadata,
          ...(item.metadata || {}),
          currency: validated.currency,
          description,
          image_urls: imageUrls,
          seller_feedback_count: sellerFeedbackCount,
          location_text: locationText,
          listed_at: listedAt,
          ended_at: null,
          identity_match_method: identityMatchMethod,
          stale_fingerprint: staleFingerprint,
          ingestion_source: "market-intel-gateway",
          last_ingested_at: seenAt,
          price_history: priceHistory,
        },
      };

      let listingId: string;
      let status: "created" | "updated";

      if (existing) {
        const { error: updateError } = await supabase
          .from("tcos_mi_listings")
          .update(payload)
          .eq("id", existing.id);
        if (updateError) throw new Error(updateError.message);
        listingId = String(existing.id);
        status = "updated";
      } else {
        const { data: createdRows, error: createError } = await supabase
          .from("tcos_mi_listings")
          .insert({
            ...payload,
            first_seen_at: seenAt,
          })
          .select("id")
          .limit(1);
        if (createError) throw new Error(createError.message);
        if (!createdRows?.[0]?.id) {
          throw new Error("Listing insert completed without returning an ID.");
        }
        listingId = String(createdRows[0].id);
        status = "created";
      }

      let scored = false;
      let scoreMessage: string | undefined;
      try {
        await scoreMarketIntelListing(listingId);
        scored = true;
      } catch (error) {
        scoreMessage =
          error instanceof Error
            ? `Listing saved but scoring failed: ${error.message}`
            : "Listing saved but scoring failed.";
      }

      results.push({
        inputIndex,
        status,
        listingId,
        marketplaceSlug: validated.marketplaceSlug,
        externalListingId,
        priceChanged,
        scored,
        message: scoreMessage,
      });
    } catch (error) {
      results.push({
        inputIndex,
        status: "error",
        marketplaceSlug: String(item?.marketplaceSlug || "") || undefined,
        externalListingId: item?.externalListingId || null,
        message: error instanceof Error ? error.message : "Unknown ingest error.",
      });
    }
  }

  return {
    received: items.length,
    created: results.filter((result) => result.status === "created").length,
    updated: results.filter((result) => result.status === "updated").length,
    rejected: results.filter((result) => result.status === "rejected").length,
    errors: results.filter((result) => result.status === "error").length,
    priceChanges: results.filter((result) => result.priceChanged).length,
    scored: results.filter((result) => result.scored).length,
    results,
  };
}

export async function cleanupStaleMarketIntelListings(staleAfterHours = 26) {
  if (!Number.isFinite(staleAfterHours) || staleAfterHours < 1) {
    throw new Error("staleAfterHours must be at least 1.");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(
    now.getTime() - staleAfterHours * 60 * 60 * 1000,
  ).toISOString();

  const { data: expiredAuctions, error: expiredError } = await supabase
    .from("tcos_mi_listings")
    .update({
      listing_status: "ended",
      last_seen_at: nowIso,
    })
    .eq("listing_status", "active")
    .eq("listing_format", "auction")
    .lt("auction_end_at", nowIso)
    .select("id");
  if (expiredError) throw new Error(expiredError.message);

  const { data: staleListings, error: staleError } = await supabase
    .from("tcos_mi_listings")
    .update({ listing_status: "stale" })
    .eq("listing_status", "active")
    .lt("last_seen_at", cutoff)
    .select("id");
  if (staleError) throw new Error(staleError.message);

  return {
    staleAfterHours,
    cutoff,
    endedAuctions: expiredAuctions?.length || 0,
    markedStale: staleListings?.length || 0,
  };
}

import "server-only";

import { configuredSiteOrigin } from "./site-origin";
import { getActiveStoreId } from "./stores";
import { getStoreSettings } from "./store-settings";
import { createSupabaseServerClient } from "./supabase-server";

const EBAY_MARKETPLACE_ID = "EBAY_US";
const EBAY_CURRENCY = "USD";
const EBAY_LANGUAGE = "en-US";
const TOKEN_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
].join(" ");

export type EbayListingFormat = "AUCTION" | "FIXED_PRICE";
export type EbayListingDuration = "DAYS_3" | "GTC";

export type EbayPolicyChoice = {
  id: string;
  name: string;
  description: string | null;
  marketplaceId: string | null;
};

export type EbayLocationChoice = {
  merchantLocationKey: string;
  name: string;
  status: string | null;
  city: string | null;
  stateOrProvince: string | null;
  postalCode: string | null;
  country: string | null;
};

export type EbayPublisherSetup = {
  connected: true;
  environment: string;
  marketplaceId: typeof EBAY_MARKETPLACE_ID;
  policies: {
    fulfillment: EbayPolicyChoice[];
    payment: EbayPolicyChoice[];
    return: EbayPolicyChoice[];
  };
  locations: EbayLocationChoice[];
  suggestions: {
    fulfillmentPolicyId: string | null;
    auctionPaymentPolicyId: string | null;
    fixedPaymentPolicyId: string | null;
    returnPolicyId: string | null;
    merchantLocationKey: string | null;
  };
};

export type EbayPublisherListing = {
  sku: string;
  title: string;
  description: string;
  categoryId: string;
  format: EbayListingFormat;
  listingDuration: EbayListingDuration;
  price: number;
  quantity: number;
  imagePaths: string[];
  aspects: Record<string, string[]>;
  merchantLocationKey: string;
  policies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
};

export type EbayPublisherAction = "draft" | "publish";

function ebayApiBase(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Content-Language": EBAY_LANGUAGE,
    "Accept-Language": EBAY_LANGUAGE,
    "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function ebayErrorMessage(label: string, status: number, data: any) {
  const errors = Array.isArray(data?.errors)
    ? data.errors
        .map((error: any) =>
          [error?.message, error?.longMessage].filter(Boolean).join(" — "),
        )
        .filter(Boolean)
        .join(" | ")
    : "";
  const fallback =
    data?.error_description || data?.message || data?.error || JSON.stringify(data);

  return `${label} failed (${status}): ${errors || fallback || "Unknown eBay error"}`;
}

async function ebayJson(params: {
  accessToken: string;
  ebayApi: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
}) {
  const response = await fetch(`${params.ebayApi}${params.path}`, {
    method: params.method || "GET",
    headers: ebayHeaders(params.accessToken),
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: "no-store",
  });
  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(ebayErrorMessage(params.path, response.status, data));
  }

  return data;
}

async function getEbaySession() {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    throw new Error("Missing eBay client credentials.");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);

  if (!storeSettings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store.");
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenError || !tokenRow?.refresh_token) {
    throw new Error("No eBay refresh token is connected to this store.");
  }

  const ebayApi = ebayApiBase(storeSettings.ebayEnvironment);
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");
  const tokenResponse = await fetch(`${ebayApi}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
      scope: TOKEN_SCOPE,
    }),
    cache: "no-store",
  });
  const tokenData = await readJson(tokenResponse);

  if (!tokenResponse.ok || !tokenData?.access_token) {
    throw new Error(
      ebayErrorMessage("eBay token refresh", tokenResponse.status, tokenData),
    );
  }

  return {
    accessToken: String(tokenData.access_token),
    ebayApi,
    environment: storeSettings.ebayEnvironment,
  };
}

function policyChoices(data: any, key: string, idKey: string): EbayPolicyChoice[] {
  const values = Array.isArray(data?.[key]) ? data[key] : [];

  return values
    .map((policy: any) => ({
      id: String(policy?.[idKey] || ""),
      name: String(policy?.name || "Unnamed policy"),
      description: policy?.description ? String(policy.description) : null,
      marketplaceId: policy?.marketplaceId
        ? String(policy.marketplaceId)
        : EBAY_MARKETPLACE_ID,
    }))
    .filter((policy: EbayPolicyChoice) => Boolean(policy.id));
}

function locationChoices(data: any): EbayLocationChoice[] {
  const values = Array.isArray(data?.locations)
    ? data.locations
    : Array.isArray(data?.inventoryLocations)
      ? data.inventoryLocations
      : [];

  return values
    .map((location: any) => {
      const address = location?.location?.address || location?.address || {};

      return {
        merchantLocationKey: String(location?.merchantLocationKey || ""),
        name: String(location?.name || location?.merchantLocationKey || "Location"),
        status: location?.merchantLocationStatus
          ? String(location.merchantLocationStatus)
          : null,
        city: address?.city ? String(address.city) : null,
        stateOrProvince: address?.stateOrProvince
          ? String(address.stateOrProvince)
          : null,
        postalCode: address?.postalCode ? String(address.postalCode) : null,
        country: address?.country ? String(address.country) : null,
      };
    })
    .filter((location: EbayLocationChoice) => Boolean(location.merchantLocationKey));
}

function preferredPolicy(
  policies: EbayPolicyChoice[],
  preferredWords: string[],
  blockedWords: string[] = [],
) {
  const eligible = policies.filter((policy) => {
    const text = `${policy.name} ${policy.description || ""}`.toLowerCase();
    return !blockedWords.some((word) => text.includes(word));
  });

  return (
    eligible.find((policy) => {
      const text = `${policy.name} ${policy.description || ""}`.toLowerCase();
      return preferredWords.some((word) => text.includes(word));
    }) ||
    eligible[0] ||
    policies[0] ||
    null
  );
}

export async function getEbayPublisherSetup(): Promise<EbayPublisherSetup> {
  const session = await getEbaySession();
  const query = `marketplace_id=${encodeURIComponent(EBAY_MARKETPLACE_ID)}`;
  const [fulfillmentData, paymentData, returnData, locationData] =
    await Promise.all([
      ebayJson({
        ...session,
        path: `/sell/account/v1/fulfillment_policy?${query}`,
      }),
      ebayJson({
        ...session,
        path: `/sell/account/v1/payment_policy?${query}`,
      }),
      ebayJson({
        ...session,
        path: `/sell/account/v1/return_policy?${query}`,
      }),
      ebayJson({
        ...session,
        path: "/sell/inventory/v1/location?limit=100",
      }),
    ]);

  const fulfillment = policyChoices(
    fulfillmentData,
    "fulfillmentPolicies",
    "fulfillmentPolicyId",
  );
  const payment = policyChoices(paymentData, "paymentPolicies", "paymentPolicyId");
  const returns = policyChoices(returnData, "returnPolicies", "returnPolicyId");
  const locations = locationChoices(locationData).filter(
    (location) => location.status !== "DISABLED",
  );
  const fulfillmentSuggestion = preferredPolicy(fulfillment, [
    "standard envelope",
    "trading card",
    "card",
  ]);
  const auctionPaymentSuggestion = preferredPolicy(
    payment,
    ["auction"],
    ["immediate", "require immediate"],
  );
  const fixedPaymentSuggestion = preferredPolicy(payment, ["immediate", "fixed"]);
  const returnSuggestion = preferredPolicy(returns, ["30 day", "returns"]);

  return {
    connected: true,
    environment: session.environment,
    marketplaceId: EBAY_MARKETPLACE_ID,
    policies: {
      fulfillment,
      payment,
      return: returns,
    },
    locations,
    suggestions: {
      fulfillmentPolicyId: fulfillmentSuggestion?.id || null,
      auctionPaymentPolicyId: auctionPaymentSuggestion?.id || null,
      fixedPaymentPolicyId: fixedPaymentSuggestion?.id || null,
      returnPolicyId: returnSuggestion?.id || null,
      merchantLocationKey: locations[0]?.merchantLocationKey || null,
    },
  };
}

function cleanSku(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function cleanAspects(value: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, values]) => [
        name.trim().slice(0, 65),
        values
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .map((item) => item.slice(0, 65)),
      ])
      .filter(([name, values]) => Boolean(name) && (values as string[]).length > 0),
  );
}

function publicImageUrl(path: string) {
  const value = String(path || "").trim();
  if (!value) throw new Error("Every listing needs at least one image.");

  if (value.startsWith("/")) {
    return new URL(value, configuredSiteOrigin()).toString();
  }

  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("eBay image URLs must use HTTPS.");
  }

  return url.toString();
}

function validateListing(listing: EbayPublisherListing) {
  const sku = cleanSku(listing.sku);
  const title = String(listing.title || "").trim();
  const description = String(listing.description || "").trim();
  const categoryId = String(listing.categoryId || "").trim();
  const price = Number(listing.price);
  const quantity = Number(listing.quantity);

  if (!sku) throw new Error("SKU is required.");
  if (!title) throw new Error("Title is required.");
  if (title.length > 80) throw new Error("eBay titles cannot exceed 80 characters.");
  if (!description) throw new Error("Description is required.");
  if (!/^\d+$/.test(categoryId)) throw new Error("A numeric eBay category ID is required.");
  if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be greater than zero.");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Quantity must be a whole number of at least one.");
  if (listing.format === "AUCTION" && listing.listingDuration !== "DAYS_3") {
    throw new Error("These auction presets are locked to a 3-day duration.");
  }
  if (listing.format === "FIXED_PRICE" && listing.listingDuration !== "GTC") {
    throw new Error("Fixed-price listings must use Good 'Til Cancelled.");
  }
  if (!listing.merchantLocationKey) throw new Error("Select an eBay inventory location.");
  if (!listing.policies.fulfillmentPolicyId) throw new Error("Select a fulfillment policy.");
  if (!listing.policies.paymentPolicyId) throw new Error("Select a payment policy.");
  if (!listing.policies.returnPolicyId) throw new Error("Select a return policy.");

  const imageUrls = listing.imagePaths.map(publicImageUrl);
  if (imageUrls.length === 0) throw new Error("At least one listing image is required.");

  return {
    ...listing,
    sku,
    title,
    description,
    categoryId,
    price: Math.round(price * 100) / 100,
    quantity,
    imageUrls,
    aspects: cleanAspects(listing.aspects),
  };
}

function amount(value: number) {
  return {
    currency: EBAY_CURRENCY,
    value: value.toFixed(2),
  };
}

function offerPayload(listing: ReturnType<typeof validateListing>) {
  const payload: Record<string, unknown> = {
    sku: listing.sku,
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: listing.format,
    categoryId: listing.categoryId,
    merchantLocationKey: listing.merchantLocationKey,
    listingDescription: listing.description,
    listingDuration: listing.listingDuration,
    includeCatalogProductDetails: false,
    listingPolicies: listing.policies,
    pricingSummary:
      listing.format === "AUCTION"
        ? { auctionStartPrice: amount(listing.price) }
        : { price: amount(listing.price) },
  };

  if (listing.format === "FIXED_PRICE") {
    payload.availableQuantity = listing.quantity;
  }

  return payload;
}

async function createOrUpdateOffer(params: {
  accessToken: string;
  ebayApi: string;
  listing: ReturnType<typeof validateListing>;
}) {
  const offersData = await ebayJson({
    ...params,
    path: `/sell/inventory/v1/offer?sku=${encodeURIComponent(params.listing.sku)}`,
  });
  const offers = Array.isArray(offersData?.offers) ? offersData.offers : [];
  const existing = offers.find(
    (offer: any) =>
      offer?.format === params.listing.format &&
      offer?.marketplaceId === EBAY_MARKETPLACE_ID,
  );

  if (existing?.status === "PUBLISHED" && existing?.listing?.listingId) {
    return {
      offerId: String(existing.offerId),
      listingId: String(existing.listing.listingId),
      alreadyPublished: true,
    };
  }

  const payload = offerPayload(params.listing);

  if (existing?.offerId) {
    await ebayJson({
      ...params,
      path: `/sell/inventory/v1/offer/${encodeURIComponent(String(existing.offerId))}`,
      method: "PUT",
      body: payload,
    });

    return {
      offerId: String(existing.offerId),
      listingId: null,
      alreadyPublished: false,
    };
  }

  const created = await ebayJson({
    ...params,
    path: "/sell/inventory/v1/offer",
    method: "POST",
    body: payload,
  });

  if (!created?.offerId) {
    throw new Error("eBay did not return an offer ID.");
  }

  return {
    offerId: String(created.offerId),
    listingId: null,
    alreadyPublished: false,
  };
}

export async function saveOrPublishEbayListing(params: {
  action: EbayPublisherAction;
  listing: EbayPublisherListing;
  confirmation?: string;
}) {
  if (params.action === "publish" && params.confirmation !== "PUBLISH_LIVE") {
    throw new Error("Live publishing requires explicit confirmation.");
  }

  const listing = validateListing(params.listing);
  const session = await getEbaySession();

  await ebayJson({
    ...session,
    path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(listing.sku)}`,
    method: "PUT",
    body: {
      availability: {
        shipToLocationAvailability: {
          quantity: listing.quantity,
        },
      },
      condition: "USED_VERY_GOOD",
      conditionDescription:
        "Ungraded trading card. Near Mint or Better. Please review the front and back scans for the exact card you will receive.",
      conditionDescriptors: [
        {
          name: "40001",
          values: ["400010"],
        },
      ],
      product: {
        title: listing.title,
        description: listing.description,
        aspects: listing.aspects,
        imageUrls: listing.imageUrls,
      },
    },
  });

  const offer = await createOrUpdateOffer({
    ...session,
    listing,
  });

  if (offer.alreadyPublished) {
    return {
      ok: true,
      action: "publish" as const,
      sku: listing.sku,
      offerId: offer.offerId,
      listingId: offer.listingId,
      listingUrl: `https://www.ebay.com/itm/${offer.listingId}`,
      alreadyPublished: true,
    };
  }

  if (params.action === "draft") {
    return {
      ok: true,
      action: "draft" as const,
      sku: listing.sku,
      offerId: offer.offerId,
      listingId: null,
      listingUrl: null,
      alreadyPublished: false,
    };
  }

  const published = await ebayJson({
    ...session,
    path: `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/publish`,
    method: "POST",
  });
  const listingId = String(published?.listingId || "");

  if (!listingId) {
    throw new Error("eBay published the offer but did not return a listing ID.");
  }

  return {
    ok: true,
    action: "publish" as const,
    sku: listing.sku,
    offerId: offer.offerId,
    listingId,
    listingUrl: `https://www.ebay.com/itm/${listingId}`,
    alreadyPublished: false,
  };
}

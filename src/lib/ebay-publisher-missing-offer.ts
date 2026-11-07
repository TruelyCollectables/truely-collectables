import "server-only";

import type {
  EbayPublisherAction,
  EbayPublisherListing,
} from "./ebay-publisher";
import { getActiveStoreId } from "./stores";
import { getStoreSettings } from "./store-settings";
import { createSupabaseServerClient } from "./supabase-server";

const EBAY_MARKETPLACE_ID = "EBAY_US";
const EBAY_CURRENCY = "USD";
const TOKEN_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
].join(" ");

function ebayApiBase(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
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
  };
}

function amount(value: number) {
  return {
    currency: EBAY_CURRENCY,
    value: Number(value).toFixed(2),
  };
}

function offerPayload(listing: EbayPublisherListing) {
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

export function isMissingEbayOfferLookupError(error: unknown) {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes("/sell/inventory/v1/offer?sku=") &&
    message.includes("failed (404)") &&
    (message.includes("offer is not available") ||
      message.includes("offer not available"))
  );
}

export async function createMissingEbayOffer(params: {
  action: EbayPublisherAction;
  listing: EbayPublisherListing;
  confirmation?: string;
}) {
  if (params.action === "publish" && params.confirmation !== "PUBLISH_LIVE") {
    throw new Error("Live publishing requires explicit confirmation.");
  }

  const session = await getEbaySession();
  const createResponse = await fetch(`${session.ebayApi}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
    },
    body: JSON.stringify(offerPayload(params.listing)),
    cache: "no-store",
  });
  const createData = await readJson(createResponse);

  if (!createResponse.ok || !createData?.offerId) {
    throw new Error(
      ebayErrorMessage("Create eBay offer", createResponse.status, createData),
    );
  }

  const offerId = String(createData.offerId);

  if (params.action === "draft") {
    return {
      ok: true,
      action: "draft" as const,
      sku: params.listing.sku,
      offerId,
      listingId: null,
      listingUrl: null,
      alreadyPublished: false,
    };
  }

  const publishResponse = await fetch(
    `${session.ebayApi}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
      },
      cache: "no-store",
    },
  );
  const publishData = await readJson(publishResponse);

  if (!publishResponse.ok || !publishData?.listingId) {
    throw new Error(
      ebayErrorMessage("Publish eBay offer", publishResponse.status, publishData),
    );
  }

  const listingId = String(publishData.listingId);
  return {
    ok: true,
    action: "publish" as const,
    sku: params.listing.sku,
    offerId,
    listingId,
    listingUrl: `https://www.ebay.com/itm/${listingId}`,
    alreadyPublished: false,
  };
}

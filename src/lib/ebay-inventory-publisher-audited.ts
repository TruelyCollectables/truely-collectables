import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertSafeEbayListingContent,
  normalizeEbayAspects,
  plainTextFromEbayHtml,
  validatedHttpsImageUrls,
} from "./ebay-listing-content";

const DEFAULT_MARKETPLACE_ID = "EBAY_US";
const EBAY_REQUEST_TIMEOUT_MS = 30_000;

type EbayTokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
  accountScopeAvailable: boolean;
};

type EbaySetup = {
  marketplaceId: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
};

export type EbaySetupReadiness = {
  connected: boolean;
  ready: boolean;
  marketplaceId: string;
  merchantLocationKey: string | null;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  missing: string[];
  error: string | null;
};

export type EbayInventoryPublishInput = {
  sku: string;
  title: string;
  description: string;
  quantity: number;
  price: number;
  imageUrls: string[];
  aspects: Record<string, string[]>;
  categoryId: string;
  condition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber?: string | null;
  bestOfferEnabled?: boolean;
};

export type EbayInventoryPublishResult = {
  offerId: string;
  listingId: string;
  createdOffer: boolean;
  publishedOffer: boolean;
  warnings: string[];
};

class EbaySetupError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = "EbaySetupError";
  }
}

const tokenCache = new Map<string, EbayTokenCacheEntry>();

function ebayApiRoot() {
  return String(process.env.EBAY_ENVIRONMENT || "production").toLowerCase() ===
    "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function cleanText(value: unknown, maximum = 500) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, maximum) : null;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function positiveQuantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function errorDetails(data: any) {
  const rows = [
    ...(Array.isArray(data?.errors) ? data.errors : []),
    ...(Array.isArray(data?.warnings) ? data.warnings : []),
  ];

  return rows
    .map((row: any) => {
      const message = cleanText(row?.longMessage || row?.message || row?.errorId, 800);
      const parameter = Array.isArray(row?.parameters)
        ? row.parameters
            .map((entry: any) => cleanText(entry?.value, 200))
            .filter(Boolean)
            .join(", ")
        : "";
      return message ? `${message}${parameter ? ` (${parameter})` : ""}` : null;
    })
    .filter((value: string | null): value is string => Boolean(value));
}

function requestSignal() {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS)
    : undefined;
}

async function ebayRequest<T>(params: {
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  marketplaceId?: string;
}) {
  let response: Response;

  try {
    response = await fetch(`${ebayApiRoot()}${params.path}`, {
      method: params.method || "GET",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID":
          params.marketplaceId || DEFAULT_MARKETPLACE_ID,
      },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      cache: "no-store",
      signal: requestSignal(),
    });
  } catch (error: any) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("eBay did not respond within 30 seconds.");
    }
    throw error;
  }

  const data = response.status === 204 ? null : await response.json().catch(() => ({}));

  if (!response.ok) {
    const details = errorDetails(data);
    const error = new Error(
      details.join(" ") || `eBay request failed with status ${response.status}.`,
    ) as Error & { status?: number; ebayData?: unknown };
    error.status = response.status;
    error.ebayData = data;
    throw error;
  }

  return data as T;
}

async function requestAccessToken(params: {
  refreshToken: string;
  scopes: string[];
}) {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    throw new Error("eBay application credentials are not configured.");
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${ebayApiRoot()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      scope: params.scopes.join(" "),
    }),
    cache: "no-store",
    signal: requestSignal(),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    const details = errorDetails(data);
    throw new Error(details.join(" ") || "Could not refresh the eBay seller token.");
  }

  return {
    accessToken: String(data.access_token),
    expiresIn: Math.max(300, Number(data.expires_in || 7200)),
  };
}

async function getSellerAccessToken(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const cacheKey = `${params.storeId}:${ebayApiRoot()}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const { data, error } = await params.supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.refresh_token) {
    throw new Error("The active store is not connected to an eBay seller account.");
  }

  const inventoryScope = "https://api.ebay.com/oauth/api_scope/sell.inventory";
  const accountScope = "https://api.ebay.com/oauth/api_scope/sell.account.readonly";
  let token: { accessToken: string; expiresIn: number };
  let accountScopeAvailable = true;

  try {
    token = await requestAccessToken({
      refreshToken: String(data.refresh_token),
      scopes: [inventoryScope, accountScope],
    });
  } catch {
    accountScopeAvailable = false;
    token = await requestAccessToken({
      refreshToken: String(data.refresh_token),
      scopes: [inventoryScope],
    });
  }

  const entry = {
    accessToken: token.accessToken,
    expiresAt: Date.now() + Math.max(300, token.expiresIn - 60) * 1000,
    accountScopeAvailable,
  };
  tokenCache.set(cacheKey, entry);
  return entry;
}

function choosePolicy(params: {
  policies: any[];
  marketplaceId: string;
  kind: "payment" | "return" | "fulfillment";
}) {
  const idField = `${params.kind}PolicyId`;
  const matching = params.policies.filter(
    (row) =>
      !row?.marketplaceId || String(row.marketplaceId) === params.marketplaceId,
  );
  const namedDefault = matching.filter((row) =>
    /\b(?:default|standard|primary)\b/i.test(String(row?.name || "")),
  );
  const selected =
    matching.length === 1
      ? matching[0]
      : namedDefault.length === 1
        ? namedDefault[0]
        : null;

  if (!selected?.[idField]) {
    const envName = `EBAY_${params.kind.toUpperCase()}_POLICY_ID`;
    throw new EbaySetupError(
      matching.length > 1
        ? `Multiple eBay ${params.kind} policies are available. Configure ${envName} so TCOS cannot choose the wrong policy.`
        : `No eBay ${params.kind} policy is available for ${params.marketplaceId}.`,
      [`an unambiguous eBay ${params.kind} policy`],
    );
  }

  return String(selected[idField]);
}

async function discoverPolicyId(params: {
  accessToken: string;
  marketplaceId: string;
  kind: "payment" | "return" | "fulfillment";
}) {
  const response = await ebayRequest<any>({
    accessToken: params.accessToken,
    marketplaceId: params.marketplaceId,
    path: `/sell/account/v1/${params.kind}_policy?marketplace_id=${encodeURIComponent(
      params.marketplaceId,
    )}`,
  });
  const collectionName = `${params.kind}Policies`;
  const policies = Array.isArray(response?.[collectionName])
    ? response[collectionName]
    : [];

  return choosePolicy({ ...params, policies });
}

async function discoverMerchantLocationKey(params: {
  accessToken: string;
  marketplaceId: string;
}) {
  const response = await ebayRequest<any>({
    accessToken: params.accessToken,
    marketplaceId: params.marketplaceId,
    path: "/sell/inventory/v1/location?limit=200",
  });
  const locations = (Array.isArray(response?.locations) ? response.locations : [])
    .filter(
      (row: any) =>
        String(row?.locationStatus || "ENABLED").toUpperCase() === "ENABLED",
    );
  const preferred = locations.filter((row: any) =>
    /\b(?:default|main|primary)\b/i.test(
      `${row?.merchantLocationKey || ""} ${row?.name || ""}`,
    ),
  );
  const location =
    locations.length === 1
      ? locations[0]
      : preferred.length === 1
        ? preferred[0]
        : null;

  if (!location?.merchantLocationKey) {
    throw new EbaySetupError(
      locations.length > 1
        ? "Multiple enabled eBay inventory locations are available. Configure EBAY_MERCHANT_LOCATION_KEY so TCOS cannot ship from the wrong location."
        : "No enabled eBay inventory location is available.",
      ["an unambiguous enabled eBay inventory location"],
    );
  }

  return String(location.merchantLocationKey);
}

async function resolveEbaySetup(params: {
  accessToken: string;
  accountScopeAvailable: boolean;
}): Promise<EbaySetup> {
  const marketplaceId =
    cleanText(process.env.EBAY_MARKETPLACE_ID, 40) || DEFAULT_MARKETPLACE_ID;
  let merchantLocationKey = cleanText(process.env.EBAY_MERCHANT_LOCATION_KEY, 50);
  let fulfillmentPolicyId = cleanText(process.env.EBAY_FULFILLMENT_POLICY_ID, 120);
  let paymentPolicyId = cleanText(process.env.EBAY_PAYMENT_POLICY_ID, 120);
  let returnPolicyId = cleanText(process.env.EBAY_RETURN_POLICY_ID, 120);

  if (!merchantLocationKey) {
    merchantLocationKey = await discoverMerchantLocationKey({
      accessToken: params.accessToken,
      marketplaceId,
    });
  }

  if (params.accountScopeAvailable) {
    [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
      fulfillmentPolicyId
        ? Promise.resolve(fulfillmentPolicyId)
        : discoverPolicyId({
            accessToken: params.accessToken,
            marketplaceId,
            kind: "fulfillment",
          }),
      paymentPolicyId
        ? Promise.resolve(paymentPolicyId)
        : discoverPolicyId({
            accessToken: params.accessToken,
            marketplaceId,
            kind: "payment",
          }),
      returnPolicyId
        ? Promise.resolve(returnPolicyId)
        : discoverPolicyId({
            accessToken: params.accessToken,
            marketplaceId,
            kind: "return",
          }),
    ]);
  }

  const missing = [
    !merchantLocationKey ? "an enabled eBay inventory location" : null,
    !fulfillmentPolicyId ? "an eBay fulfillment policy" : null,
    !paymentPolicyId ? "an eBay payment policy" : null,
    !returnPolicyId ? "an eBay return policy" : null,
  ].filter((value): value is string => Boolean(value));

  if (missing.length) {
    throw new EbaySetupError(
      `eBay publishing setup is incomplete: ${missing.join(", ")}. Reconnect eBay with account-readonly permission or configure the matching EBAY_* environment values.`,
      missing,
    );
  }

  return {
    marketplaceId,
    merchantLocationKey: merchantLocationKey!,
    fulfillmentPolicyId: fulfillmentPolicyId!,
    paymentPolicyId: paymentPolicyId!,
    returnPolicyId: returnPolicyId!,
  };
}

export async function getEbayPublishingReadiness(params: {
  supabase: SupabaseClient;
  storeId: string;
}): Promise<EbaySetupReadiness> {
  const marketplaceId =
    cleanText(process.env.EBAY_MARKETPLACE_ID, 40) || DEFAULT_MARKETPLACE_ID;

  try {
    const token = await getSellerAccessToken(params);
    const setup = await resolveEbaySetup(token);
    return {
      connected: true,
      ready: true,
      marketplaceId: setup.marketplaceId,
      merchantLocationKey: setup.merchantLocationKey,
      fulfillmentPolicyId: setup.fulfillmentPolicyId,
      paymentPolicyId: setup.paymentPolicyId,
      returnPolicyId: setup.returnPolicyId,
      missing: [],
      error: null,
    };
  } catch (error: any) {
    const message = error?.message || "eBay publishing is not ready.";
    return {
      connected: !message.toLowerCase().includes("not connected"),
      ready: false,
      marketplaceId,
      merchantLocationKey: cleanText(process.env.EBAY_MERCHANT_LOCATION_KEY, 50),
      fulfillmentPolicyId: cleanText(process.env.EBAY_FULFILLMENT_POLICY_ID, 120),
      paymentPolicyId: cleanText(process.env.EBAY_PAYMENT_POLICY_ID, 120),
      returnPolicyId: cleanText(process.env.EBAY_RETURN_POLICY_ID, 120),
      missing: error instanceof EbaySetupError ? error.missing : [],
      error: message,
    };
  }
}

function descriptorValue(descriptor: any, desired: string, aliases: string[] = []) {
  const desiredTokens = [desired, ...aliases].map(normalized).filter(Boolean);
  const values = Array.isArray(descriptor?.conditionDescriptorValues)
    ? descriptor.conditionDescriptorValues
    : [];
  const exact = values.find((value: any) =>
    desiredTokens.includes(normalized(value?.conditionDescriptorValueName)),
  );
  if (exact) return cleanText(exact.conditionDescriptorValueId, 80);

  const partial = values.find((value: any) => {
    const candidate = normalized(value?.conditionDescriptorValueName);
    return desiredTokens.some(
      (needle) => candidate.includes(needle) || needle.includes(candidate),
    );
  });
  return cleanText(partial?.conditionDescriptorValueId, 80);
}

function graderAliases(grader: string) {
  const value = normalized(grader);
  const aliases = [grader];
  if (value === "psa" || value.includes("professional sports authenticator")) {
    aliases.push("Professional Sports Authenticator PSA", "PSA");
  }
  if (value === "bgs" || value.includes("beckett")) {
    aliases.push("Beckett Grading Services BGS", "BGS", "Beckett");
  }
  if (value === "sgc") aliases.push("Sportscard Guaranty Corporation SGC", "SGC");
  if (value === "hga") aliases.push("Hybrid Grading Approach HGA", "HGA");
  if (value === "cgc") aliases.push("Certified Guaranty Company CGC", "CGC");
  return aliases;
}

async function conditionDescriptors(params: {
  accessToken: string;
  marketplaceId: string;
  categoryId: string;
  condition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber?: string | null;
}) {
  const response = await ebayRequest<any>({
    accessToken: params.accessToken,
    marketplaceId: params.marketplaceId,
    path: `/sell/metadata/v1/marketplace/${encodeURIComponent(
      params.marketplaceId,
    )}/get_item_condition_policies?filter=${encodeURIComponent(
      `categoryIds:{${params.categoryId}}`,
    )}`,
  });
  const policies = Array.isArray(response?.itemConditionPolicies)
    ? response.itemConditionPolicies
    : [];
  const policy =
    policies.find((row: any) => String(row?.categoryId) === params.categoryId) ||
    policies[0];
  const conditions = Array.isArray(policy?.itemConditions)
    ? policy.itemConditions
    : [];
  const conditionId = params.condition === "LIKE_NEW" ? "2750" : "4000";
  const condition = conditions.find(
    (row: any) => String(row?.conditionId) === conditionId,
  );
  const descriptors = Array.isArray(condition?.conditionDescriptors)
    ? condition.conditionDescriptors
    : [];

  if (!condition || descriptors.length === 0) {
    throw new Error(
      `eBay did not return trading-card condition descriptors for category ${params.categoryId}.`,
    );
  }

  if (params.condition === "LIKE_NEW") {
    const graderDescriptor = descriptors.find(
      (row: any) => normalized(row?.conditionDescriptorName) === "grader",
    );
    const gradeDescriptor = descriptors.find(
      (row: any) => normalized(row?.conditionDescriptorName) === "grade",
    );
    const certificationDescriptor = descriptors.find((row: any) =>
      normalized(row?.conditionDescriptorName).includes("certification number"),
    );
    const graderValue = descriptorValue(
      graderDescriptor,
      params.grader,
      graderAliases(params.grader),
    );
    const gradeValue = descriptorValue(gradeDescriptor, params.grade);

    if (!graderDescriptor || !graderValue || !gradeDescriptor || !gradeValue) {
      throw new Error(
        "The graded card needs an eBay-supported grader and grade. Edit those fields before publishing.",
      );
    }

    const output: Array<{
      name: string;
      values?: string[];
      additionalInfo?: string;
    }> = [
      {
        name: String(graderDescriptor.conditionDescriptorId),
        values: [graderValue],
      },
      {
        name: String(gradeDescriptor.conditionDescriptorId),
        values: [gradeValue],
      },
    ];
    const certificationNumber = cleanText(params.certificationNumber, 30);

    if (certificationDescriptor && certificationNumber) {
      output.push({
        name: String(certificationDescriptor.conditionDescriptorId),
        additionalInfo: certificationNumber,
      });
    }

    return output;
  }

  const cardConditionDescriptor = descriptors.find((row: any) =>
    normalized(row?.conditionDescriptorName).includes("card condition"),
  );
  const cardConditionValue = descriptorValue(
    cardConditionDescriptor,
    params.cardCondition,
  );

  if (!cardConditionDescriptor || !cardConditionValue) {
    throw new Error(
      "The raw card needs an eBay-supported Card Condition. Review the condition before publishing.",
    );
  }

  return [
    {
      name: String(cardConditionDescriptor.conditionDescriptorId),
      values: [cardConditionValue],
    },
  ];
}

function warningMessages(value: unknown) {
  return errorDetails({ warnings: Array.isArray(value) ? value : [] });
}

export async function publishEbayInventoryItem(params: {
  supabase: SupabaseClient;
  storeId: string;
  item: EbayInventoryPublishInput;
}): Promise<EbayInventoryPublishResult> {
  const rawTitle = String(params.item.title || "").trim();
  const sku = cleanText(params.item.sku, 120);
  const listingDescription = String(params.item.description || "").trim();
  const quantity = positiveQuantity(params.item.quantity);
  const price = money(params.item.price);
  const categoryId = cleanText(params.item.categoryId, 32);

  if (!sku || !rawTitle || !listingDescription || !categoryId) {
    throw new Error("SKU, eBay title, description, and category are required.");
  }
  if (rawTitle.length > 80) throw new Error("eBay title must be 80 characters or fewer.");
  if (!/^\d+$/.test(categoryId)) throw new Error("eBay category ID must be numeric.");
  if (quantity < 1) throw new Error("eBay quantity must be at least 1.");
  if (price <= 0) throw new Error("eBay price must be greater than 0.");

  assertSafeEbayListingContent(listingDescription);
  const productDescription = plainTextFromEbayHtml(listingDescription, 4_000);
  if (!productDescription) throw new Error("eBay description must contain readable text.");
  const imageUrls = validatedHttpsImageUrls(params.item.imageUrls, 24);
  if (!imageUrls.length) throw new Error("At least one public HTTPS card image is required.");
  const aspects = normalizeEbayAspects(params.item.aspects || {});

  if (!Object.keys(aspects).length && categoryId === "261328") {
    aspects.Type = ["Sports Trading Card"];
  }

  const token = await getSellerAccessToken({
    supabase: params.supabase,
    storeId: params.storeId,
  });
  const setup = await resolveEbaySetup(token);
  const descriptors = await conditionDescriptors({
    accessToken: token.accessToken,
    marketplaceId: setup.marketplaceId,
    categoryId,
    condition: params.item.condition,
    cardCondition: params.item.cardCondition,
    grader: params.item.grader,
    grade: params.item.grade,
    certificationNumber: params.item.certificationNumber,
  });

  await ebayRequest<unknown>({
    accessToken: token.accessToken,
    marketplaceId: setup.marketplaceId,
    method: "PUT",
    path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    body: {
      availability: {
        shipToLocationAvailability: { quantity },
      },
      condition: params.item.condition,
      conditionDescriptors: descriptors,
      product: {
        title: rawTitle,
        description: productDescription,
        aspects,
        imageUrls,
      },
    },
  });

  const offersResponse = await ebayRequest<any>({
    accessToken: token.accessToken,
    marketplaceId: setup.marketplaceId,
    path: `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
  });
  const offers = Array.isArray(offersResponse?.offers) ? offersResponse.offers : [];
  const existingOffer = offers.find(
    (offer: any) =>
      String(offer?.marketplaceId || "") === setup.marketplaceId &&
      String(offer?.format || "FIXED_PRICE") === "FIXED_PRICE",
  );
  const listingPolicies: Record<string, unknown> = {
    fulfillmentPolicyId: setup.fulfillmentPolicyId,
    paymentPolicyId: setup.paymentPolicyId,
    returnPolicyId: setup.returnPolicyId,
    bestOfferTerms: {
      bestOfferEnabled: params.item.bestOfferEnabled === true,
    },
  };
  const offerPayload = {
    sku,
    marketplaceId: setup.marketplaceId,
    format: "FIXED_PRICE",
    availableQuantity: quantity,
    categoryId,
    merchantLocationKey: setup.merchantLocationKey,
    listingDescription,
    listingDuration: "GTC",
    listingPolicies,
    pricingSummary: {
      price: {
        currency: "USD",
        value: price.toFixed(2),
      },
    },
  };
  let offerId = cleanText(existingOffer?.offerId, 120);
  let createdOffer = false;
  const warnings: string[] = [];

  if (offerId) {
    const updateResponse = await ebayRequest<any>({
      accessToken: token.accessToken,
      marketplaceId: setup.marketplaceId,
      method: "PUT",
      path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`,
      body: offerPayload,
    });
    warnings.push(...warningMessages(updateResponse?.warnings));
  } else {
    const createResponse = await ebayRequest<any>({
      accessToken: token.accessToken,
      marketplaceId: setup.marketplaceId,
      method: "POST",
      path: "/sell/inventory/v1/offer",
      body: offerPayload,
    });
    offerId = cleanText(createResponse?.offerId, 120);
    warnings.push(...warningMessages(createResponse?.warnings));
    createdOffer = true;
  }

  if (!offerId) throw new Error("eBay did not return an offer ID.");

  const existingListingId = cleanText(existingOffer?.listing?.listingId, 120);
  const alreadyPublished =
    String(existingOffer?.status || "").toUpperCase() === "PUBLISHED" &&
    Boolean(existingListingId);

  if (alreadyPublished && existingListingId) {
    return {
      offerId,
      listingId: existingListingId,
      createdOffer,
      publishedOffer: false,
      warnings,
    };
  }

  const publishResponse = await ebayRequest<any>({
    accessToken: token.accessToken,
    marketplaceId: setup.marketplaceId,
    method: "POST",
    path: `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
  });
  const listingId = cleanText(publishResponse?.listingId, 120);
  warnings.push(...warningMessages(publishResponse?.warnings));

  if (!listingId) {
    throw new Error("eBay accepted the offer but did not return a listing ID.");
  }

  return {
    offerId,
    listingId,
    createdOffer,
    publishedOffer: true,
    warnings,
  };
}

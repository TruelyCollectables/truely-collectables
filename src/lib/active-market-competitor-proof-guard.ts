import "server-only";

import { createHash } from "node:crypto";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import {
  canonicalActiveMarketProofItemId,
  reconcileActiveMarketDirectProofs,
  type ActiveMarketDirectCompetitorProof,
  type ActiveMarketTargetIdentity,
} from "./active-market-competitor-proof";
import { handleActiveMarketAttackWithProofGuard } from "./active-market-proof-guard";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
const MARKET_POSTAL_CODE =
  process.env.INSTACOMP_MARKET_POSTAL_CODE ||
  process.env.EBAY_MARKET_POSTAL_CODE ||
  "80202";

let tokenCache: { token: string; expiresAt: number } | null = null;

type Json = Record<string, any>;

type ProductRow = {
  title: string | null;
  player: string | null;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  const result = String(value || "").trim();
  return result || null;
}

function money(value: unknown, allowZero = false): number | null {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) {
    return null;
  }
  return Math.round(result * 100) / 100;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9#/+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function printRun(value: unknown): number | null {
  const input = normalize(value);
  const match =
    input.match(/(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/) ||
    input.match(/\bof\s+(\d{1,4})(?!\d)/);
  const result = match ? Number(match[1]) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function hasAuto(value: unknown): boolean {
  return /\b(auto|autograph|autographs|autographed|signed|au)\b/.test(
    normalize(value),
  );
}

function hasRelic(value: unknown): boolean {
  return /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn|rpa)\b/.test(
    normalize(value),
  );
}

function hasGrade(value: unknown): boolean {
  return /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(
    normalize(value),
  );
}

function shipping(options: unknown) {
  return list(options)
    .map(record)
    .map((option) => ({
      cost: money(record(option.shippingCost).value, true),
      type: text(option.shippingCostType),
    }))
    .filter(
      (entry): entry is { cost: number; type: string | null } =>
        entry.cost !== null,
    )
    .sort((left, right) => left.cost - right.cost)[0] || null;
}

function aspectText(values: unknown): string {
  return list(values)
    .map(record)
    .flatMap((aspect) => {
      const name = text(aspect.localizedName || aspect.name);
      const rawValues = list(aspect.localizedValues || aspect.values || aspect.value);
      const valueText = rawValues.map((value) => String(value || "")).join(" ");
      return name || valueText ? [`${name || ""} ${valueText}`.trim()] : [];
    })
    .join(" | ");
}

function shoppingAspectText(value: unknown): string {
  const specifics = record(value);
  return list(specifics.NameValueList || specifics.nameValueList)
    .map(record)
    .flatMap((entry) => {
      const name = text(entry.Name || entry.name);
      const values = list(entry.Value || entry.value).map((item) => String(item || ""));
      return name || values.length
        ? [`${name || ""} ${values.join(" ")}`.trim()]
        : [];
    })
    .join(" | ");
}

async function ebayToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const clientId = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) return null;
  const payload = await response.json();
  const token = text(payload?.access_token);
  if (token) {
    const expires = Number(payload?.expires_in);
    tokenCache = {
      token,
      expiresAt:
        Date.now() +
        (Number.isFinite(expires) ? Math.max(60, expires - 90) : 3600) * 1000,
    };
  }
  return token;
}

function browseHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=US,zip=${MARKET_POSTAL_CODE}`,
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
  };
}

function failureProof(input: {
  itemId: string;
  source?: ActiveMarketDirectCompetitorProof["source"];
  code: string;
  message: string;
}): ActiveMarketDirectCompetitorProof {
  return {
    itemId: input.itemId,
    confirmed: false,
    source: input.source || "none",
    checkedAt: new Date().toISOString(),
    title: null,
    evidenceText: null,
    price: null,
    shippingCost: null,
    shippingKnown: false,
    shippingCostType: null,
    landedPrice: null,
    url: null,
    listingStatus: null,
    fixedPrice: null,
    failureCode: input.code,
    failureMessage: input.message.slice(0, 500),
  };
}

async function browseDirectProof(
  token: string,
  itemId: string,
): Promise<ActiveMarketDirectCompetitorProof> {
  const url = new URL(
    "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id",
  );
  url.searchParams.set("legacy_item_id", itemId);
  const response = await fetch(url, {
    headers: browseHeaders(token),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    return failureProof({
      itemId,
      source: "browse_direct",
      code: `browse_direct_http_${response.status}`,
      message: (await response.text().catch(() => "")).slice(0, 500),
    });
  }

  const payload = await response.json();
  const title = text(payload?.title);
  const price = money(record(payload?.price).value);
  const itemUrl = text(payload?.itemWebUrl) || `https://www.ebay.com/itm/${itemId}`;
  const buyingOptions = list(payload?.buyingOptions).map((value) => String(value));
  const fixedPrice = buyingOptions.includes("FIXED_PRICE");
  const ship = shipping(payload?.shippingOptions);
  const endDate = text(payload?.itemEndDate);
  const endMs = endDate ? new Date(endDate).getTime() : null;
  const active = endMs === null || !Number.isFinite(endMs) || endMs > Date.now();
  const aspects = aspectText(payload?.localizedAspects);
  if (!title || price === null) {
    return failureProof({
      itemId,
      source: "browse_direct",
      code: "browse_direct_missing_required_fields",
      message: "The direct Browse item response did not include a usable title and price.",
    });
  }
  if (!active) {
    return failureProof({
      itemId,
      source: "browse_direct",
      code: "browse_direct_listing_ended",
      message: `The direct item lookup reports an end date of ${endDate}.`,
    });
  }

  return {
    itemId,
    confirmed: true,
    source: "browse_direct",
    checkedAt: new Date().toISOString(),
    title,
    evidenceText: `${title}${aspects ? ` | ${aspects}` : ""}`,
    price,
    shippingCost: ship?.cost ?? null,
    shippingKnown: Boolean(ship),
    shippingCostType: ship?.type || null,
    landedPrice: ship ? round(price + ship.cost) : null,
    url: itemUrl,
    listingStatus: "Active",
    fixedPrice,
    failureCode: null,
    failureMessage: null,
  };
}

async function shoppingDirectProof(
  itemId: string,
): Promise<ActiveMarketDirectCompetitorProof> {
  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) {
    return failureProof({
      itemId,
      code: "shopping_direct_client_id_missing",
      message: "EBAY_CLIENT_ID is unavailable for direct item proof.",
    });
  }
  const url = new URL("https://open.api.ebay.com/shopping");
  url.searchParams.set("callname", "GetSingleItem");
  url.searchParams.set("responseencoding", "JSON");
  url.searchParams.set("appid", clientId);
  url.searchParams.set("siteid", "0");
  url.searchParams.set("version", "967");
  url.searchParams.set("ItemID", itemId);
  url.searchParams.set(
    "IncludeSelector",
    "Details,ShippingCosts,ItemSpecifics",
  );
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const payload: any = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    return failureProof({
      itemId,
      source: "shopping_direct",
      code: `shopping_direct_http_${response.status}`,
      message: (await response.text().catch(() => "")).slice(0, 500),
    });
  }

  const item = record(payload.Item);
  const ack = String(payload.Ack || "").toLowerCase();
  const status = String(item.ListingStatus || "");
  const title = text(item.Title);
  const price =
    money(record(item.ConvertedCurrentPrice).Value) ||
    money(record(item.CurrentPrice).Value);
  const shippingCost = money(
    record(record(item.ShippingCostSummary).ShippingServiceCost).Value,
    true,
  );
  const listingType = String(item.ListingType || "");
  const fixedPrice =
    ["fixedpriceitem", "fixedprice", "storeinventory"].includes(
      listingType.toLowerCase(),
    ) || item.BuyItNowAvailable === true;
  const aspects = shoppingAspectText(item.ItemSpecifics);
  const itemUrl =
    text(item.ViewItemURLForNaturalSearch) ||
    text(item.ViewItemURL) ||
    `https://www.ebay.com/itm/${itemId}`;
  if (ack !== "success" && ack !== "warning") {
    return failureProof({
      itemId,
      source: "shopping_direct",
      code: "shopping_direct_api_rejected",
      message: text(payload.Errors?.LongMessage || payload.Errors?.ShortMessage) || "The Shopping API rejected the direct item lookup.",
    });
  }
  if (status && status.toLowerCase() !== "active") {
    return failureProof({
      itemId,
      source: "shopping_direct",
      code: "shopping_direct_listing_not_active",
      message: `The direct Shopping lookup reports listing status ${status}.`,
    });
  }
  if (!title || price === null) {
    return failureProof({
      itemId,
      source: "shopping_direct",
      code: "shopping_direct_missing_required_fields",
      message: "The direct Shopping response did not include a usable title and price.",
    });
  }

  return {
    itemId,
    confirmed: true,
    source: "shopping_direct",
    checkedAt: new Date().toISOString(),
    title,
    evidenceText: `${title}${aspects ? ` | ${aspects}` : ""}`,
    price,
    shippingCost,
    shippingKnown: shippingCost !== null,
    shippingCostType: "Shopping API",
    landedPrice: shippingCost === null ? null : round(price + shippingCost),
    url: itemUrl,
    listingStatus: status || "Active",
    fixedPrice,
    failureCode: null,
    failureMessage: null,
  };
}

async function directProof(
  itemId: string,
  token: string | null,
): Promise<ActiveMarketDirectCompetitorProof> {
  if (token) {
    try {
      const browse = await browseDirectProof(token, itemId);
      if (browse.confirmed) return browse;
    } catch {
      // Shopping fallback below.
    }
  }
  try {
    return await shoppingDirectProof(itemId);
  } catch (error) {
    return failureProof({
      itemId,
      code: "direct_item_proof_request_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function targetIdentity(
  targetTitle: string,
  tracking: Json,
  fallbackPlayer: string | null,
): ActiveMarketTargetIdentity {
  const identity = record(tracking.identity);
  return {
    player: text(identity.player) || fallbackPlayer,
    year: text(identity.year),
    setName: text(identity.setName),
    parallel: text(identity.parallel),
    cardNumber: text(identity.cardNumber),
    printRun: printRun(identity.serialNumber) || printRun(targetTitle),
    isAuto: identity.isAuto === true || hasAuto(targetTitle),
    isRelic: identity.isRelic === true || hasRelic(targetTitle),
    isGraded:
      Boolean(identity.gradingCompany || identity.gradeValue) ||
      hasGrade(targetTitle),
  };
}

function stripOldDirectProofNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*ACTIVE MARKET DIRECT COMPETITOR PROOF:[\s\S]*$/i, "")
    .trim();
}

function receipt(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

export async function handleActiveMarketAttackWithCompetitorProofGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const baseResponse = await handleActiveMarketAttackWithProofGuard(
    request,
    context,
  );
  const payload: any = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || payload.success !== true) {
    return Response.json(
      payload || { error: "Active Market Attack Mode failed." },
      { status: baseResponse.status },
    );
  }

  const tracking = record(payload.tracking);
  if (Number(tracking.soldCompCount || 0) > 0) {
    return Response.json(payload, { status: baseResponse.status });
  }

  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json(payload, { status: baseResponse.status });
  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });

  const { inventoryItemId } = await context.params;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id,seller_account_id,title,metadata")
    .eq("id", inventoryItemId)
    .eq("store_id", storeId)
    .single();
  if (itemError || !item) {
    return Response.json(payload, { status: baseResponse.status });
  }
  if (
    !(
      item.seller_account_id === account.id ||
      (owner && item.seller_account_id === null)
    )
  ) {
    return Response.json(payload, { status: baseResponse.status });
  }

  let targetTitle = String(item.title || "");
  let fallbackPlayer: string | null = null;
  if (item.legacy_product_id) {
    const { data: product } = await supabase
      .from("products")
      .select("title,player")
      .eq("id", item.legacy_product_id)
      .eq("store_id", storeId)
      .maybeSingle();
    const typed = product as ProductRow | null;
    targetTitle = targetTitle || String(typed?.title || "");
    fallbackPlayer = text(typed?.player);
  }

  const attack = record(tracking.activeMarketAttack || payload.attack);
  const competitorIds = uniqueStrings(
    list(attack.competitors)
      .map((candidate) => canonicalActiveMarketProofItemId(candidate))
      .filter(Boolean),
  ).slice(0, 10);
  const token = competitorIds.length ? await ebayToken() : null;
  const proofs = await Promise.all(
    competitorIds.map((itemId) => directProof(itemId, token)),
  );
  const reconciled = reconcileActiveMarketDirectProofs({
    attack,
    targetTitle,
    identity: targetIdentity(targetTitle, tracking, fallbackPlayer),
    proofs,
  });
  const reconciledAttack = record(reconciled.attack);
  const proofReceipt = receipt({
    targetTitle,
    competitorIds,
    proofs,
    verified: list(reconciledAttack.competitors).map((value) => {
      const candidate = record(value);
      return {
        itemId: canonicalActiveMarketProofItemId(candidate),
        price: candidate.price,
        shippingCost: candidate.shippingCost,
        landedPrice: candidate.landedPrice,
      };
    }),
  });
  const allDirectlyProved =
    reconciled.directAttemptedCount === reconciled.directConfirmedCount;
  const baseTax =
    stripOldDirectProofNote(reconciledAttack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const directMessage = `ACTIVE MARKET DIRECT COMPETITOR PROOF: ${reconciled.directConfirmedCount}/${reconciled.directAttemptedCount} previously verified competitors remained eligible after direct item lookup. Receipt ${proofReceipt}.`;
  const marketLabel = String(
    record(reconciledAttack.marketLocation).label || "US estimate",
  )
    .replace(/\s*·\s*direct proof \d+\/\d+.*$/i, "")
    .trim();
  const nextAttack: Json = {
    ...reconciledAttack,
    competitorDirectProofReceipt: proofReceipt,
    competitorDirectProofPassed: allDirectlyProved,
    competitorDirectProofCheckedAt: new Date().toISOString(),
    taxNote: `${baseTax} ${directMessage}`,
    marketLocation: {
      ...record(reconciledAttack.marketLocation),
      label: `${marketLabel} · direct proof ${reconciled.directConfirmedCount}/${reconciled.directAttemptedCount}`,
    },
    updatedAt: new Date().toISOString(),
  };
  const existingReasons = Array.isArray(tracking.reviewReasons)
    ? tracking.reviewReasons
        .map(String)
        .filter(
          (reason: string) =>
            reason !== "active_market_competitor_direct_proof_passed" &&
            reason !== "active_market_competitor_direct_proof_partial" &&
            reason !== "active_market_competitor_direct_proof_no_verified_competitors",
        )
    : [];
  const nextTracking: Json = {
    ...tracking,
    activeMarketAttack: nextAttack,
    marketCompCount: Number(nextAttack.exactActiveCount || 0),
    trustedForPricing:
      tracking.trustedForPricing === true &&
      Number(nextAttack.exactActiveCount || 0) > 0,
    pricingEvidenceMode:
      Number(nextAttack.exactActiveCount || 0) > 0
        ? "active_market_attack"
        : Number(nextAttack.scoutingCount || 0) > 0
          ? "active_market_scouting"
          : "active_market_no_results",
    reviewReasons: uniqueStrings([
      ...existingReasons,
      reconciled.directAttemptedCount === 0
        ? "active_market_competitor_direct_proof_no_verified_competitors"
        : allDirectlyProved
          ? "active_market_competitor_direct_proof_passed"
          : "active_market_competitor_direct_proof_partial",
    ]),
    topMarketComps: nextAttack.competitors,
    competitorDirectProofReceipt: proofReceipt,
    updatedAt: nextAttack.updatedAt,
  };

  const metadata = record(item.metadata);
  const root = record(metadata.instacomp_tracking);
  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      metadata: {
        ...metadata,
        instacomp_tracking: {
          ...root,
          schema: "truely.instacompInventoryTrackingHistory.v14",
          current: nextTracking,
        },
      },
      updated_at: nextTracking.updatedAt,
    })
    .eq("id", inventoryItemId)
    .eq("store_id", storeId);
  if (updateError) throw updateError;

  return Response.json({
    ...payload,
    tracking: nextTracking,
    attack: nextAttack,
    mode:
      Number(nextAttack.exactActiveCount || 0) > 0
        ? "active_market_attack"
        : Number(nextAttack.scoutingCount || 0) > 0
          ? "active_market_scouting"
          : "no_exact_active_market",
    diagnostics: {
      ...record(payload.diagnostics),
      competitorDirectProofAttemptedCount:
        reconciled.directAttemptedCount,
      competitorDirectProofConfirmedCount:
        reconciled.directConfirmedCount,
      competitorDirectProofFailedCount:
        reconciled.directAttemptedCount - reconciled.directConfirmedCount,
      competitorDirectProofPassed: allDirectlyProved,
      competitorDirectProofReceipt: proofReceipt,
      competitorDirectProofSources: uniqueStrings(
        proofs.map((proof) => proof.source),
      ),
    },
  });
}

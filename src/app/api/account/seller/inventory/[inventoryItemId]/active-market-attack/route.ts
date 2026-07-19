import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { classifyCollectibleCategory } from "../../../../../../../lib/collectible-category-policy";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
const MARKET_POSTAL_CODE =
  process.env.INSTACOMP_MARKET_POSTAL_CODE ||
  process.env.EBAY_MARKET_POSTAL_CODE ||
  "80202";
const DEFAULT_CARD_SHIPPING = 6.99;
const FREE_GROUND_THRESHOLD = 149;
let tokenCache: { token: string; expiresAt: number } | null = null;

type Json = Record<string, unknown>;
type Competitor = {
  itemId: string | null;
  legacyItemId: string | null;
  title: string;
  price: number;
  shippingCost: number | null;
  shippingKnown: boolean;
  shippingCostType: string | null;
  landedPrice: number | null;
  url: string;
  matchScore: number;
  flags: string[];
};

function rec(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function text(value: unknown) {
  const result = String(value || "").trim();
  return result || null;
}
function money(value: unknown, allowZero = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) return null;
  return Math.round(result * 100) / 100;
}
function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function norm(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9#/+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function year(value: unknown) {
  return norm(value).match(/\b(?:19|20)\d{2}(?:[-/]\d{2,4})?\b/)?.[0] || null;
}
function printRun(value: unknown) {
  const input = norm(value);
  const match =
    input.match(/(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/) ||
    input.match(/\bof\s+(\d{1,4})(?!\d)/);
  const result = match ? Number(match[1]) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}
function cardNumber(value: unknown) {
  return norm(value).match(/#([a-z0-9][a-z0-9-]{0,15})\b/)?.[1] || null;
}
function hasAuto(value: unknown) {
  return /\b(auto|autograph|autographed|signed)\b/.test(norm(value));
}
function hasRelic(value: unknown) {
  return /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn)\b/.test(norm(value));
}
function hasGrading(value: unknown) {
  return /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(norm(value));
}
function badListing(value: unknown) {
  return /\b(lot of|pick your|choose your|custom|reprint|digital|break|case break|box break|team lot|player lot|facsimile|proxy|replica)\b/.test(norm(value));
}

const STOP = new Set([
  "the", "and", "with", "card", "cards", "trading", "sports", "hockey",
  "baseball", "basketball", "football", "golf", "near", "mint", "nm",
  "condition", "authentic", "authenticity", "upper", "deck", "panini", "topps",
]);
function tokens(value: unknown) {
  return norm(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token) && !/^\d+$/.test(token));
}

function identityFrom(title: string, player: string | null, tracking: Json) {
  const identity = rec(tracking.identity);
  return {
    player: text(identity.player) || player,
    year: text(identity.year) || year(title),
    cardNumber: text(identity.cardNumber) || cardNumber(title),
    printRun: printRun(identity.serialNumber) || printRun(title),
    isAuto: identity.isAuto === true || hasAuto(title),
    isRelic: identity.isRelic === true || hasRelic(title),
    isGraded: Boolean(identity.gradingCompany || identity.gradeValue) || hasGrading(title),
  };
}

function exactMatch(params: {
  title: string;
  competitor: Competitor;
  identity: ReturnType<typeof identityFrom>;
  currentEbayId: string | null;
}) {
  const candidate = norm(params.competitor.title);
  if (!candidate || badListing(candidate)) return null;
  if (
    params.currentEbayId &&
    (params.competitor.legacyItemId === params.currentEbayId ||
      params.competitor.url.includes(params.currentEbayId))
  ) return null;

  const targetYear = year(params.title) || params.identity.year;
  const targetCard = cardNumber(params.title) || norm(params.identity.cardNumber);
  const targetRun = printRun(params.title) || params.identity.printRun;
  const targetPlayer = norm(params.identity.player);
  if (targetYear && !candidate.includes(targetYear)) return null;
  if (targetRun && printRun(candidate) !== targetRun) return null;
  if (targetCard) {
    const padded = ` ${candidate} `;
    if (![ `#${targetCard}`, ` ${targetCard} `, `-${targetCard} `, `/${targetCard} `,
      ` card ${targetCard} `, ` no ${targetCard} ` ].some((needle) => padded.includes(needle))) return null;
  }
  if (targetPlayer && !candidate.includes(targetPlayer)) return null;
  if (params.identity.isAuto !== hasAuto(candidate)) return null;
  if (params.identity.isRelic !== hasRelic(candidate)) return null;
  if (params.identity.isGraded !== hasGrading(candidate)) return null;

  const targetTokens = Array.from(new Set(tokens(params.title)));
  const candidateTokens = new Set(tokens(candidate));
  const overlap = targetTokens.length
    ? targetTokens.filter((token) => candidateTokens.has(token)).length / targetTokens.length
    : 0;
  let score = overlap * 70;
  const flags = [`title overlap ${Math.round(overlap * 100)}%`];
  if (targetPlayer) score += 18;
  if (targetYear) score += 8;
  if (targetCard) score += 18;
  if (targetRun) score += 18;
  if (params.identity.isAuto) score += 8;
  if (params.identity.isRelic) score += 8;
  if (overlap < 0.48 || score < 58) return null;
  return { ...params.competitor, matchScore: Math.round(score), flags };
}

async function ebayToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const clientId = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !secret) return null;
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
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
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const token = text(payload?.access_token);
  if (token) {
    const expires = Number(payload?.expires_in);
    tokenCache = {
      token,
      expiresAt: Date.now() + (Number.isFinite(expires) ? Math.max(60, expires - 90) : 3600) * 1000,
    };
  }
  return token;
}
function ebayHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=US,zip=${MARKET_POSTAL_CODE}`,
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
  };
}
function shipping(options: unknown) {
  return list(options)
    .map(rec)
    .map((option) => ({
      cost: money(rec(option.shippingCost).value, true),
      type: text(option.shippingCostType),
    }))
    .filter((option): option is { cost: number; type: string | null } => option.cost !== null)
    .sort((a, b) => a.cost - b.cost)[0] || null;
}
function fromSummary(value: unknown): Competitor | null {
  const row = rec(value);
  const title = text(row.title);
  const price = money(rec(row.price).value);
  const url = text(row.itemWebUrl);
  if (!title || !price || !url) return null;
  const ship = shipping(row.shippingOptions);
  return {
    itemId: text(row.itemId),
    legacyItemId: text(row.legacyItemId),
    title,
    price,
    shippingCost: ship?.cost ?? null,
    shippingKnown: Boolean(ship),
    shippingCostType: ship?.type || null,
    landedPrice: ship ? round(price + ship.cost) : null,
    url,
    matchScore: 0,
    flags: [],
  };
}
async function hydrate(token: string, item: Competitor) {
  if (item.shippingKnown || !item.itemId) return item;
  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(item.itemId)}`,
    { headers: ebayHeaders(token), signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) return item;
  const payload = await response.json();
  const ship = shipping(payload?.shippingOptions);
  return ship
    ? { ...item, shippingCost: ship.cost, shippingKnown: true, shippingCostType: ship.type,
        landedPrice: round(item.price + ship.cost) }
    : item;
}

async function activeMarket(params: {
  title: string;
  identity: ReturnType<typeof identityFrom>;
  currentEbayId: string | null;
}) {
  const token = await ebayToken();
  if (!token) return { tokenAvailable: false, rawCount: 0, exact: [] as Competitor[] };
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", params.title);
  url.searchParams.set("limit", "50");
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},deliveryCountry:US");
  const response = await fetch(url, {
    headers: ebayHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.error("Active Market Attack search failed:", await response.text());
    return { tokenAvailable: true, rawCount: 0, exact: [] as Competitor[] };
  }
  const payload = await response.json();
  const raw = list(payload?.itemSummaries)
    .map(fromSummary)
    .filter((item): item is Competitor => Boolean(item));
  const exact = raw
    .map((competitor) => exactMatch({
      title: params.title,
      competitor,
      identity: params.identity,
      currentEbayId: params.currentEbayId,
    }))
    .filter((item): item is Competitor => Boolean(item))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 12);
  const hydrated = await Promise.all(exact.map((item) => hydrate(token, item)));
  return {
    tokenAvailable: true,
    rawCount: raw.length,
    exact: hydrated.sort((a, b) => {
      if (a.landedPrice !== null && b.landedPrice !== null) return a.landedPrice - b.landedPrice;
      if (a.landedPrice !== null) return -1;
      if (b.landedPrice !== null) return 1;
      return a.price - b.price;
    }),
  };
}

function recordedCost(metadata: Json) {
  return [
    metadata.total_cost, metadata.totalCost, metadata.landed_cost, metadata.landedCost,
    metadata.cost_basis, metadata.costBasis, metadata.acquisition_cost, metadata.acquisitionCost,
    metadata.purchase_price, metadata.purchasePrice,
  ].map((entry) => money(entry)).find((value) => value !== null) || null;
}
function charm(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, round(Math.floor(maximum - 0.99) + 0.99));
}
function strategy(label: string, key: string, target: number, shippingCost: number, floor: number | null) {
  const itemPrice = charm(Math.max(0.99, target - shippingCost));
  return {
    label,
    key,
    itemPrice,
    shipping: shippingCost,
    landedPrice: round(itemPrice + shippingCost),
    profitFloor: floor,
    meetsProfitFloor: floor === null ? null : itemPrice >= floor,
  };
}
function attack(exact: Competitor[], itemPrice: number, cost: number | null) {
  const known = exact.filter(
    (item): item is Competitor & { landedPrice: number; shippingCost: number } =>
      item.landedPrice !== null && item.shippingCost !== null,
  );
  const lowest = known[0] || null;
  const ourShipping = itemPrice > FREE_GROUND_THRESHOLD ? 0 : DEFAULT_CARD_SHIPPING;
  const ourLanded = round(itemPrice + ourShipping);
  const floor = cost ? round(cost * 1.2) : null;
  const gap = lowest ? round(ourLanded - lowest.landedPrice) : null;
  const position = !lowest
    ? "shipping_unknown"
    : ourLanded < lowest.landedPrice
      ? "best_deal"
      : ourLanded <= lowest.landedPrice + 1
        ? "within_striking_distance"
        : "over_market";
  const suggestions = lowest ? [
    strategy("Beat by $0.01", "beat_by_cent", lowest.landedPrice - 0.01, ourShipping, floor),
    strategy("Beat by $1", "beat_by_dollar", lowest.landedPrice - 1, ourShipping, floor),
    strategy("5% lower landed", "undercut_5", lowest.landedPrice * 0.95, ourShipping, floor),
    strategy("10% lower landed — King Price", "undercut_10", lowest.landedPrice * 0.90, ourShipping, floor),
    strategy("15% lower landed — Aggressive", "undercut_15", lowest.landedPrice * 0.85, ourShipping, floor),
  ] : [];
  return {
    schema: "truely.activeMarketAttack.v1",
    mode: "no_sold_comps_active_attack",
    updatedAt: new Date().toISOString(),
    marketLocation: { country: "US", postalCode: MARKET_POSTAL_CODE, label: "Denver shipping estimate" },
    taxIncluded: false,
    taxNote: "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.",
    exactActiveCount: exact.length,
    landedKnownCount: known.length,
    shippingUnknownCount: exact.length - known.length,
    lowestCompetitor: lowest,
    lowestCompetitorLanded: lowest?.landedPrice || null,
    ourItemPrice: itemPrice,
    ourShipping,
    ourShippingLabel: ourShipping === 0
      ? "TCOS Ground Advantage — free over $149"
      : "TCOS Ground Advantage estimate",
    ourLanded,
    position,
    gapToLowest: gap,
    costBasis: cost,
    profitFloor: floor,
    suggestions,
    competitors: exact.slice(0, 8),
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const { inventoryItemId } = await context.params;
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,title,category,status,price,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .single();
    if (error || !data) return Response.json({ error: "Inventory item was not found." }, { status: 404 });
    const item = data as InventoryRow;
    if (!(item.seller_account_id === account.id || (owner && item.seller_account_id === null))) {
      return Response.json({ error: "Inventory item was not found." }, { status: 404 });
    }
    if (item.status !== "active") {
      return Response.json({ error: "Active Market Attack Mode is limited to active inventory." }, { status: 409 });
    }

    const productResult = item.legacy_product_id
      ? await supabase
          .from("products")
          .select("id,title,ebay_item_id,sport,player")
          .eq("id", item.legacy_product_id)
          .eq("store_id", storeId)
          .maybeSingle()
      : { data: null, error: null };
    if (productResult.error) throw productResult.error;
    const product = productResult.data as ProductRow | null;
    const metadata = rec(item.metadata);
    const trackingRoot = rec(metadata.instacomp_tracking);
    const current = rec(trackingRoot.current);
    if (Number(current.soldCompCount || 0) > 0) {
      return Response.json({ success: true, mode: "sold_comps_available", tracking: current });
    }
    const title = item.title || product?.title || "Untitled sports card";
    const category = classifyCollectibleCategory({ title, category: item.category, sport: product?.sport, metadata });
    if (!category.isTradingCard) {
      return Response.json({ error: "Active Market Attack Mode is currently limited to trading cards." }, { status: 409 });
    }
    const result = await activeMarket({
      title,
      identity: identityFrom(title, product?.player || null, current),
      currentEbayId: product?.ebay_item_id || null,
    });
    const mode = attack(result.exact, money(item.price) || 0, recordedCost(metadata));
    const updatedAt = new Date().toISOString();
    const nextTracking = {
      ...current,
      activeMarketAttack: mode,
      updatedAt,
      pricingEvidenceMode: mode.exactActiveCount ? "active_market_attack" : current.pricingEvidenceMode || "no_exact_market",
      marketCompCount: mode.exactActiveCount || Number(current.marketCompCount || 0),
      topMarketComps: mode.exactActiveCount
        ? mode.competitors.map((competitor) => ({
            title: competitor.title,
            price: competitor.price,
            url: competitor.url,
            source: "ebay_active",
            sourceLabel: "eBay Active",
            observedAt: updatedAt,
            matchScore: competitor.matchScore,
            flags: competitor.flags,
            shippingCost: competitor.shippingCost,
            shippingKnown: competitor.shippingKnown,
            shippingCostType: competitor.shippingCostType,
            landedPrice: competitor.landedPrice,
            itemId: competitor.itemId,
          }))
        : current.topMarketComps,
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({
        metadata: {
          ...metadata,
          instacomp_tracking: {
            ...trackingRoot,
            schema: "truely.instacompInventoryTrackingHistory.v3",
            current: nextTracking,
          },
        },
        updated_at: updatedAt,
      })
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    if (updateError) throw updateError;
    return Response.json({
      success: true,
      mode: mode.exactActiveCount ? "active_market_attack" : "no_exact_active_market",
      tracking: nextTracking,
      attack: mode,
      diagnostics: {
        ebayTokenAvailable: result.tokenAvailable,
        rawCandidateCount: result.rawCount,
        exactActiveCount: result.exact.length,
        shippingKnownCount: mode.landedKnownCount,
      },
    });
  } catch (error: any) {
    return Response.json({ error: error?.message || "Active Market Attack Mode failed." }, { status: 500 });
  }
}

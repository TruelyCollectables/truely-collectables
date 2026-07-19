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
const MAX_SEARCH_QUERIES = 5;

let tokenCache: { token: string; expiresAt: number } | null = null;

type Json = Record<string, unknown>;

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  seller_account_id: string | null;
  title: string | null;
  category: string | null;
  status: string | null;
  price: number | string | null;
  metadata: Json | null;
};

type ProductRow = {
  id: number;
  title: string | null;
  ebay_item_id: string | null;
  sport: string | null;
  player: string | null;
};

type CardIdentity = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  printRun: number | null;
  isAuto: boolean;
  isRelic: boolean;
  isGraded: boolean;
};

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
  matchLevel: "exact" | "strong" | "scouting";
  flags: string[];
  queryUsed: string | null;
};

type SearchOutcome = {
  tokenAvailable: boolean;
  rawCount: number;
  verified: Competitor[];
  scouting: Competitor[];
  strictExactCount: number;
  strongMatchCount: number;
  searchQueries: string[];
  searchUrl: string;
};

function rec(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  const result = String(value || "").trim();
  return result || null;
}

function money(value: unknown, allowZero = false) {
  const result = Number(value);
  if (
    !Number.isFinite(result) ||
    result < 0 ||
    (!allowZero && result === 0)
  ) {
    return null;
  }
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
    input.match(
      /(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/,
    ) || input.match(/\bof\s+(\d{1,4})(?!\d)/);
  const result = match ? Number(match[1]) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function cardNumber(value: unknown) {
  return norm(value).match(/#([a-z0-9][a-z0-9-]{0,15})\b/)?.[1] || null;
}

function hasAuto(value: unknown) {
  return /\b(auto|autograph|autographed|signed|au)\b/.test(norm(value));
}

function hasRelic(value: unknown) {
  return /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn|rpa)\b/.test(
    norm(value),
  );
}

function hasGrading(value: unknown) {
  return /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(norm(value));
}

function badListing(value: unknown) {
  return /\b(lot of|pick your|choose your|custom|reprint|digital|break|case break|box break|team lot|player lot|facsimile|proxy|replica)\b/.test(
    norm(value),
  );
}

const STOP = new Set([
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

function tokens(value: unknown) {
  return norm(value)
    .split(" ")
    .filter(
      (token) =>
        token.length > 1 && !STOP.has(token) && !/^\d+$/.test(token),
    );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function identityFrom(title: string, player: string | null, tracking: Json): CardIdentity {
  const identity = rec(tracking.identity);
  return {
    player: text(identity.player) || player,
    year: text(identity.year) || year(title),
    brand: text(identity.brand),
    setName: text(identity.setName),
    cardNumber: text(identity.cardNumber) || cardNumber(title),
    parallel: text(identity.parallel),
    printRun: printRun(identity.serialNumber) || printRun(title),
    isAuto: identity.isAuto === true || hasAuto(title),
    isRelic: identity.isRelic === true || hasRelic(title),
    isGraded:
      Boolean(identity.gradingCompany || identity.gradeValue) || hasGrading(title),
  };
}

function cleanQueryTitle(title: string) {
  return title
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQueries(title: string, identity: CardIdentity) {
  const card = identity.cardNumber
    ? `#${String(identity.cardNumber).replace(/^#/, "")}`
    : null;
  const run = identity.printRun ? `/${identity.printRun}` : null;
  const feature = identity.isAuto
    ? "autograph"
    : identity.isRelic
      ? "patch relic"
      : null;

  return uniqueStrings([
    title,
    cleanQueryTitle(title),
    [
      identity.year,
      identity.player,
      identity.brand,
      identity.setName,
      card,
      identity.parallel,
      feature,
      run,
    ]
      .filter(Boolean)
      .join(" "),
    [
      identity.year,
      identity.player,
      card,
      identity.parallel,
      feature,
      run,
    ]
      .filter(Boolean)
      .join(" "),
    [identity.player, identity.brand, identity.setName, card, feature]
      .filter(Boolean)
      .join(" "),
  ])
    .filter((query) => query.length >= 4)
    .slice(0, MAX_SEARCH_QUERIES);
}

function containsCardNumber(candidate: string, target: string) {
  const padded = ` ${candidate} `;
  return [
    `#${target}`,
    ` ${target} `,
    `-${target} `,
    `/${target} `,
    ` card ${target} `,
    ` no ${target} `,
  ].some((needle) => padded.includes(needle));
}

function scoreCandidate(params: {
  title: string;
  competitor: Competitor;
  identity: CardIdentity;
  currentEbayId: string | null;
}) {
  const candidate = norm(params.competitor.title);
  if (!candidate || badListing(candidate)) return null;
  if (
    params.currentEbayId &&
    (params.competitor.legacyItemId === params.currentEbayId ||
      params.competitor.url.includes(params.currentEbayId))
  ) {
    return null;
  }

  const flags: string[] = [];
  let penalties = 0;
  let anchors = 0;

  const targetYear = year(params.title) || params.identity.year;
  const candidateYear = year(candidate);
  if (targetYear && candidateYear && candidateYear !== targetYear) return null;
  if (targetYear && candidateYear === targetYear) anchors += 1;
  if (targetYear && !candidateYear) {
    penalties += 6;
    flags.push("year omitted from competitor title");
  }

  const targetPlayer = norm(params.identity.player);
  if (targetPlayer) {
    const playerTokens = tokens(targetPlayer);
    if (!playerTokens.every((token) => candidate.includes(token))) return null;
    anchors += 2;
    flags.push("player");
  }

  const targetCard = norm(params.identity.cardNumber || cardNumber(params.title));
  const candidateCard = cardNumber(candidate);
  if (targetCard && candidateCard && candidateCard !== targetCard) return null;
  if (targetCard && containsCardNumber(candidate, targetCard)) {
    anchors += 2;
    flags.push("card #");
  } else if (targetCard) {
    penalties += 14;
    flags.push("card number omitted from competitor title");
  }

  const targetRun = params.identity.printRun || printRun(params.title);
  const candidateRun = printRun(candidate);
  if (targetRun && candidateRun && candidateRun !== targetRun) return null;
  if (targetRun && candidateRun === targetRun) {
    anchors += 2;
    flags.push(`print run /${targetRun}`);
  } else if (targetRun) {
    penalties += 10;
    flags.push(`print run /${targetRun} omitted from competitor title`);
  }

  const candidateAuto = hasAuto(candidate);
  const candidateRelic = hasRelic(candidate);
  const candidateGraded = hasGrading(candidate);
  if (!params.identity.isAuto && candidateAuto) return null;
  if (!params.identity.isRelic && candidateRelic) return null;
  if (params.identity.isGraded !== candidateGraded) return null;
  if (params.identity.isAuto && candidateAuto) {
    anchors += 1;
    flags.push("autograph");
  } else if (params.identity.isAuto) {
    penalties += 8;
    flags.push("autograph wording omitted");
  }
  if (params.identity.isRelic && candidateRelic) {
    anchors += 1;
    flags.push("relic");
  } else if (params.identity.isRelic) {
    penalties += 8;
    flags.push("relic wording omitted");
  }

  const featureTokens = uniqueStrings([
    params.identity.brand,
    params.identity.setName,
    params.identity.parallel,
  ]).flatMap(tokens);
  const featureMatches = featureTokens.filter((token) => candidate.includes(token));
  if (featureMatches.length >= Math.min(2, Math.max(1, featureTokens.length))) {
    anchors += 1;
    flags.push("set/parallel");
  }

  const targetTokens = Array.from(new Set(tokens(params.title)));
  const candidateTokens = new Set(tokens(candidate));
  const overlap = targetTokens.length
    ? targetTokens.filter((token) => candidateTokens.has(token)).length /
      targetTokens.length
    : 0;
  const score = Math.round(overlap * 70 + anchors * 10 - penalties);
  flags.unshift(`title overlap ${Math.round(overlap * 100)}%`);

  const verified = overlap >= 0.3 && score >= 48 && anchors >= 2;
  const scouting = overlap >= 0.2 && score >= 28 && anchors >= 1;
  if (!verified && !scouting) return null;

  return {
    ...params.competitor,
    matchScore: score,
    matchLevel: verified
      ? penalties === 0
        ? ("exact" as const)
        : ("strong" as const)
      : ("scouting" as const),
    flags: Array.from(new Set(flags)),
  };
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
      expiresAt:
        Date.now() +
        (Number.isFinite(expires) ? Math.max(60, expires - 90) : 3600) * 1000,
    };
  }
  return token;
}

function ebayHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    "X-EBAY-C-ENDUSERCTX": `contextualLocation=country%3DUS%2Czip%3D${encodeURIComponent(
      MARKET_POSTAL_CODE,
    )}`,
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
    .filter(
      (option): option is { cost: number; type: string | null } =>
        option.cost !== null,
    )
    .sort((left, right) => left.cost - right.cost)[0] || null;
}

function fromSummary(value: unknown, queryUsed: string): Competitor | null {
  const row = rec(value);
  const buyingOptions = list(row.buyingOptions).map((option) => String(option));
  if (buyingOptions.length > 0 && !buyingOptions.includes("FIXED_PRICE")) {
    return null;
  }

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
    matchLevel: "scouting",
    flags: [],
    queryUsed,
  };
}

async function hydrate(token: string, item: Competitor) {
  if (item.shippingKnown || !item.itemId) return item;
  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(item.itemId)}`,
    {
      headers: ebayHeaders(token),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) return item;

  const payload = await response.json();
  const ship = shipping(payload?.shippingOptions);
  return ship
    ? {
        ...item,
        shippingCost: ship.cost,
        shippingKnown: true,
        shippingCostType: ship.type,
        landedPrice: round(item.price + ship.cost),
      }
    : item;
}

function competitorKey(item: Competitor) {
  return item.legacyItemId || item.itemId || item.url;
}

function dedupeHighest(values: Competitor[]) {
  const map = new Map<string, Competitor>();
  for (const item of values) {
    const key = competitorKey(item);
    const current = map.get(key);
    if (!current || item.matchScore > current.matchScore) map.set(key, item);
  }
  return Array.from(map.values());
}

async function searchQuery(token: string, query: string) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set(
    "filter",
    `deliveryPostalCode:${MARKET_POSTAL_CODE},deliveryCountry:US`,
  );

  const response = await fetch(url, {
    headers: ebayHeaders(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.error(
      `Active Market Attack search failed for ${query}:`,
      await response.text(),
    );
    return [] as Competitor[];
  }

  const payload = await response.json();
  return list(payload?.itemSummaries)
    .map((item) => fromSummary(item, query))
    .filter((item): item is Competitor => Boolean(item));
}

async function activeMarket(params: {
  title: string;
  identity: CardIdentity;
  currentEbayId: string | null;
}): Promise<SearchOutcome> {
  const queries = buildQueries(params.title, params.identity);
  const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(
    queries[0] || params.title,
  )}&LH_BIN=1`;
  const token = await ebayToken();
  if (!token) {
    return {
      tokenAvailable: false,
      rawCount: 0,
      verified: [],
      scouting: [],
      strictExactCount: 0,
      strongMatchCount: 0,
      searchQueries: queries,
      searchUrl,
    };
  }

  const queryResults = await Promise.all(
    queries.map((query) => searchQuery(token, query)),
  );
  const raw = dedupeHighest(queryResults.flat());
  const scored = raw
    .map((competitor) =>
      scoreCandidate({
        title: params.title,
        competitor,
        identity: params.identity,
        currentEbayId: params.currentEbayId,
      }),
    )
    .filter((item): item is Competitor => Boolean(item));

  const verifiedRaw = dedupeHighest(
    scored.filter((item) => item.matchLevel !== "scouting"),
  )
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 15);
  const verifiedKeys = new Set(verifiedRaw.map(competitorKey));
  const scoutingRaw = dedupeHighest(
    scored.filter(
      (item) =>
        item.matchLevel === "scouting" && !verifiedKeys.has(competitorKey(item)),
    ),
  )
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 8);

  const [verified, scouting] = await Promise.all([
    Promise.all(verifiedRaw.map((item) => hydrate(token, item))),
    Promise.all(scoutingRaw.map((item) => hydrate(token, item))),
  ]);

  const landedSort = (left: Competitor, right: Competitor) => {
    if (left.landedPrice !== null && right.landedPrice !== null) {
      return left.landedPrice - right.landedPrice;
    }
    if (left.landedPrice !== null) return -1;
    if (right.landedPrice !== null) return 1;
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    return left.price - right.price;
  };

  return {
    tokenAvailable: true,
    rawCount: raw.length,
    verified: verified.sort(landedSort),
    scouting: scouting.sort(landedSort),
    strictExactCount: verified.filter((item) => item.matchLevel === "exact").length,
    strongMatchCount: verified.filter((item) => item.matchLevel === "strong").length,
    searchQueries: queries,
    searchUrl,
  };
}

function recordedCost(metadata: Json) {
  return [
    metadata.total_cost,
    metadata.totalCost,
    metadata.landed_cost,
    metadata.landedCost,
    metadata.cost_basis,
    metadata.costBasis,
    metadata.acquisition_cost,
    metadata.acquisitionCost,
    metadata.purchase_price,
    metadata.purchasePrice,
  ]
    .map((entry) => money(entry))
    .find((value) => value !== null) || null;
}

function charm(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, round(Math.floor(maximum - 0.99) + 0.99));
}

function strategy(
  label: string,
  key: string,
  target: number,
  shippingCost: number,
  floor: number | null,
) {
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

function attack(result: SearchOutcome, itemPrice: number, cost: number | null) {
  const known = result.verified.filter(
    (
      item,
    ): item is Competitor & { landedPrice: number; shippingCost: number } =>
      item.landedPrice !== null && item.shippingCost !== null,
  );
  const lowest = known[0] || null;
  const ourShipping =
    itemPrice > FREE_GROUND_THRESHOLD ? 0 : DEFAULT_CARD_SHIPPING;
  const ourLanded = round(itemPrice + ourShipping);
  const floor = cost ? round(cost * 1.2) : null;
  const gap = lowest ? round(ourLanded - lowest.landedPrice) : null;
  const position = !lowest
    ? result.verified.length > 0
      ? "shipping_unknown"
      : "no_verified_matches"
    : ourLanded < lowest.landedPrice
      ? "best_deal"
      : ourLanded <= lowest.landedPrice + 1
        ? "within_striking_distance"
        : "over_market";
  const suggestions = lowest
    ? [
        strategy(
          "Beat by $0.01",
          "beat_by_cent",
          lowest.landedPrice - 0.01,
          ourShipping,
          floor,
        ),
        strategy(
          "Beat by $1",
          "beat_by_dollar",
          lowest.landedPrice - 1,
          ourShipping,
          floor,
        ),
        strategy(
          "5% lower landed",
          "undercut_5",
          lowest.landedPrice * 0.95,
          ourShipping,
          floor,
        ),
        strategy(
          "10% lower landed — King Price",
          "undercut_10",
          lowest.landedPrice * 0.9,
          ourShipping,
          floor,
        ),
        strategy(
          "15% lower landed — Aggressive",
          "undercut_15",
          lowest.landedPrice * 0.85,
          ourShipping,
          floor,
        ),
      ]
    : [];

  return {
    schema: "truely.activeMarketAttack.v2",
    mode: "no_sold_comps_active_attack",
    status: !result.tokenAvailable
      ? "ebay_unavailable"
      : result.verified.length > 0
        ? "ready"
        : result.scouting.length > 0
          ? "scouting_only"
          : "no_candidates",
    updatedAt: new Date().toISOString(),
    marketLocation: {
      country: "US",
      postalCode: MARKET_POSTAL_CODE,
      label: "Denver shipping estimate",
    },
    taxIncluded: false,
    taxNote:
      "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.",
    rawCandidateCount: result.rawCount,
    exactActiveCount: result.verified.length,
    strictExactCount: result.strictExactCount,
    strongMatchCount: result.strongMatchCount,
    scoutingCount: result.scouting.length,
    landedKnownCount: known.length,
    shippingUnknownCount: result.verified.length - known.length,
    lowestCompetitor: lowest,
    lowestCompetitorLanded: lowest?.landedPrice || null,
    ourItemPrice: itemPrice,
    ourShipping,
    ourShippingLabel:
      ourShipping === 0
        ? "TCOS Ground Advantage — free over $149"
        : "TCOS Ground Advantage estimate",
    ourLanded,
    position,
    gapToLowest: gap,
    costBasis: cost,
    profitFloor: floor,
    suggestions,
    competitors: result.verified.slice(0, 8),
    scoutingCandidates: result.scouting.slice(0, 6),
    searchQueries: result.searchQueries,
    searchUrl: result.searchUrl,
  };
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
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());
    const { data, error } = await supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,title,category,status,price,metadata",
      )
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .single();
    if (error || !data) {
      return Response.json(
        { error: "Inventory item was not found." },
        { status: 404 },
      );
    }

    const item = data as InventoryRow;
    if (
      !(
        item.seller_account_id === account.id ||
        (owner && item.seller_account_id === null)
      )
    ) {
      return Response.json(
        { error: "Inventory item was not found." },
        { status: 404 },
      );
    }
    if (item.status !== "active") {
      return Response.json(
        { error: "Active Market Attack Mode is limited to active inventory." },
        { status: 409 },
      );
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
      return Response.json({
        success: true,
        mode: "sold_comps_available",
        tracking: current,
      });
    }

    const title = item.title || product?.title || "Untitled sports card";
    const category = classifyCollectibleCategory({
      title,
      category: item.category,
      sport: product?.sport,
      metadata,
    });
    if (!category.isTradingCard) {
      return Response.json(
        {
          error:
            "Active Market Attack Mode is currently limited to trading cards.",
        },
        { status: 409 },
      );
    }

    const result = await activeMarket({
      title,
      identity: identityFrom(title, product?.player || null, current),
      currentEbayId: product?.ebay_item_id || null,
    });
    const mode = attack(
      result,
      money(item.price) || 0,
      recordedCost(metadata),
    );
    const updatedAt = new Date().toISOString();
    const existingReasons = list(current.reviewReasons).map((reason) =>
      String(reason),
    );
    const nextReasons = Array.from(
      new Set([
        ...existingReasons,
        ...(mode.exactActiveCount === 0
          ? ["active_market_no_verified_matches"]
          : []),
        ...(mode.strongMatchCount > 0
          ? ["active_market_strong_matches_used"]
          : []),
      ]),
    );
    const nextTracking = {
      ...current,
      activeMarketAttack: mode,
      updatedAt,
      pricingEvidenceMode:
        mode.exactActiveCount > 0
          ? "active_market_attack"
          : mode.scoutingCount > 0
            ? "active_market_scouting"
            : "active_market_no_results",
      marketCompCount: mode.exactActiveCount,
      reviewReasons: nextReasons,
      topMarketComps:
        mode.exactActiveCount > 0
          ? mode.competitors.map((competitor) => ({
              title: competitor.title,
              price: competitor.price,
              url: competitor.url,
              source: "ebay_active",
              sourceLabel: "eBay Active",
              observedAt: updatedAt,
              matchScore: competitor.matchScore,
              matchLevel: competitor.matchLevel,
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
            schema: "truely.instacompInventoryTrackingHistory.v4",
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
      mode:
        mode.exactActiveCount > 0
          ? "active_market_attack"
          : mode.scoutingCount > 0
            ? "active_market_scouting"
            : "no_exact_active_market",
      tracking: nextTracking,
      attack: mode,
      diagnostics: {
        ebayTokenAvailable: result.tokenAvailable,
        rawCandidateCount: result.rawCount,
        exactActiveCount: result.verified.length,
        strictExactCount: result.strictExactCount,
        strongMatchCount: result.strongMatchCount,
        scoutingCount: result.scouting.length,
        shippingKnownCount: mode.landedKnownCount,
        searchQueries: result.searchQueries,
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Active Market Attack Mode failed." },
      { status: 500 },
    );
  }
}

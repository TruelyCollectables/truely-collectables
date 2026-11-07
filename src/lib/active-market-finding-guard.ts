import "server-only";

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "./account-auth";
import { handleActiveMarketAttackWithDiscoveryGuard } from "./active-market-discovery-guard";
import { collectiblePackagingState } from "./active-market-packaging-guard";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);
const MAX_RESULTS = 50;

type Json = Record<string, any>;
type Candidate = Json & {
  legacyItemId: string;
  title: string;
  price: number;
  shippingCost: number | null;
  shippingKnown: boolean;
  shippingCostType: string | null;
  landedPrice: number | null;
  url: string;
  fixedPrice: boolean;
  matchScore: number;
  matchLevel: "exact" | "strong" | "scouting";
  flags: string[];
  queryUsed: string;
  discoveryLane: "finding_keyword";
};

type FindingFailure = {
  query: string;
  status: number | null;
  message: string;
};

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const text = (value: unknown): string | null => {
  const result = String(value || "").trim();
  return result || null;
};
const money = (value: unknown, allowZero = false): number | null => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (!allowZero && result === 0)) {
    return null;
  }
  return Math.round(result * 100) / 100;
};
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const normalize = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9#/+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const unique = (values: unknown[]) =>
  Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );

function year(value: unknown) {
  return normalize(value).match(/\b(?:19|20)\d{2}(?:[-/]\d{2,4})?\b/)?.[0] || null;
}

function cardNumber(value: unknown) {
  return normalize(value).match(/#([a-z0-9][a-z0-9-]{0,15})\b/)?.[1] || null;
}

function printRun(value: unknown) {
  const input = normalize(value);
  const match =
    input.match(/(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/) ||
    input.match(/\bof\s+(\d{1,4})(?!\d)/);
  const result = match ? Number(match[1]) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}

const hasAuto = (value: unknown) =>
  /\b(auto|autograph|autographs|autographed|signed|au)\b/.test(normalize(value));
const hasRelic = (value: unknown) =>
  /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn|rpa)\b/.test(
    normalize(value),
  );
const hasGrade = (value: unknown) =>
  /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(normalize(value));
const badListing = (value: unknown) =>
  /\b(lot of|pick your|choose your|custom|reprint|digital|break|case break|box break|team lot|player lot|facsimile|proxy|replica)\b/.test(
    normalize(value),
  );

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "card",
  "cards",
  "trading",
  "sports",
  "hockey",
  "upper",
  "deck",
  "sealed",
  "factory",
  "unopened",
  "opened",
  "open",
  "unsealed",
  "ripped",
  "unripped",
]);

function words(value: unknown) {
  return normalize(value)
    .split(" ")
    .filter(
      (word) =>
        word.length > 1 && !STOP_WORDS.has(word) && !/^\d+$/.test(word),
    );
}

function containsCard(candidate: string, target: string) {
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

function identity(title: string, tracking: Json, fallbackPlayer: string | null) {
  const current = record(tracking.identity);
  return {
    player: text(current.player) || fallbackPlayer,
    year: text(current.year) || year(title),
    setName: text(current.setName),
    parallel: text(current.parallel),
    cardNumber: text(current.cardNumber) || cardNumber(title),
    printRun: printRun(current.serialNumber) || printRun(title),
    isAuto: current.isAuto === true || hasAuto(title),
    isRelic: current.isRelic === true || hasRelic(title),
    isGraded:
      Boolean(current.gradingCompany || current.gradeValue) || hasGrade(title),
  };
}

function queries(title: string, card: ReturnType<typeof identity>, attack: Json) {
  const number = card.cardNumber
    ? String(card.cardNumber).replace(/^#/, "")
    : null;
  const stripped = title
    .replace(
      /\b(factory sealed|still sealed|sealed|unopened|never opened|unripped|opened|open|unsealed|ripped)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return unique([
    stripped,
    [card.player, number, card.year, card.setName, card.parallel]
      .filter(Boolean)
      .join(" "),
    [card.player, number, card.setName].filter(Boolean).join(" "),
    [card.player, number, card.year].filter(Boolean).join(" "),
    [card.player, number].filter(Boolean).join(" "),
    ...list(attack.searchQueries),
  ])
    .filter((query) => query.length >= 4)
    .slice(0, 6);
}

function findingCandidate(value: unknown, query: string): Candidate | null {
  const row = record(value);
  const title = text(first(row.title));
  const legacyItemId = text(first(row.itemId));
  const url = text(first(row.viewItemURL));
  const selling = record(first(row.sellingStatus));
  const price = money(record(first(selling.currentPrice)).__value__);
  if (!title || !legacyItemId || !url || price === null) return null;

  const shipping = record(first(row.shippingInfo));
  const shippingCost = money(
    record(first(shipping.shippingServiceCost)).__value__,
    true,
  );
  const listing = record(first(row.listingInfo));
  const listingType = String(first(listing.listingType) || "");
  const buyItNow =
    String(first(listing.buyItNowAvailable) || "").toLowerCase() === "true";
  const fixedPrice =
    listingType === "FixedPrice" ||
    listingType === "StoreInventory" ||
    buyItNow;

  return {
    legacyItemId,
    title,
    price,
    shippingCost,
    shippingKnown: shippingCost !== null,
    shippingCostType: text(first(shipping.shippingType)),
    landedPrice:
      shippingCost === null ? null : round(price + shippingCost),
    url,
    fixedPrice,
    matchScore: 0,
    matchLevel: "scouting",
    flags: [],
    queryUsed: query,
    discoveryLane: "finding_keyword",
  };
}

async function searchFinding(query: string) {
  const clientId = process.env.EBAY_CLIENT_ID;
  if (!clientId) {
    return {
      items: [] as Candidate[],
      failure: {
        query,
        status: null,
        message: "EBAY_CLIENT_ID is missing.",
      } as FindingFailure,
    };
  }

  const url = new URL(
    "https://svcs.ebay.com/services/search/FindingService/v1",
  );
  url.searchParams.set("OPERATION-NAME", "findItemsAdvanced");
  url.searchParams.set("SERVICE-VERSION", "1.13.0");
  url.searchParams.set("SECURITY-APPNAME", clientId);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "");
  url.searchParams.set("GLOBAL-ID", "EBAY-US");
  url.searchParams.set("keywords", query);
  url.searchParams.set("paginationInput.entriesPerPage", String(MAX_RESULTS));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    return {
      items: [] as Candidate[],
      failure: {
        query,
        status: response.status,
        message: (await response.text().catch(() => "")).slice(0, 300),
      } as FindingFailure,
    };
  }

  const payload = await response.json();
  const root = record(first(payload?.findItemsAdvancedResponse));
  const ack = String(first(root.ack) || "").toLowerCase();
  if (ack && ack !== "success" && ack !== "warning") {
    const message = list(root.errorMessage)
      .flatMap((entry) => list(record(entry).error))
      .map((entry) => text(first(record(entry).message)))
      .filter(Boolean)
      .join(" | ");
    return {
      items: [] as Candidate[],
      failure: {
        query,
        status: response.status,
        message: message || `Finding API returned ${ack}.`,
      } as FindingFailure,
    };
  }

  const searchResult = record(first(root.searchResult));
  return {
    items: list(searchResult.item)
      .map((entry) => findingCandidate(entry, query))
      .filter((entry): entry is Candidate => Boolean(entry)),
    failure: null,
  };
}

function score(
  targetTitle: string,
  card: ReturnType<typeof identity>,
  candidate: Candidate,
): Candidate | null {
  const title = normalize(candidate.title);
  if (!title || badListing(title)) return null;

  let result = 0;
  let anchors = 0;
  const flags: string[] = [];
  const playerWords = words(card.player);
  if (playerWords.length) {
    if (!playerWords.every((word) => title.includes(word))) return null;
    result += 30;
    anchors += 1;
    flags.push("player");
  }

  const targetYear = year(targetTitle) || card.year;
  const candidateYear = year(title);
  if (targetYear && candidateYear && targetYear !== candidateYear) return null;
  if (targetYear && candidateYear === targetYear) {
    result += 10;
    flags.push("year");
  }

  const targetCard = normalize(card.cardNumber || cardNumber(targetTitle));
  const candidateCard = cardNumber(title);
  if (targetCard) {
    if (candidateCard && candidateCard !== targetCard) return null;
    if (!candidateCard && !containsCard(title, targetCard)) return null;
    result += 30;
    anchors += 1;
    flags.push("card #");
  }

  const targetRun = card.printRun || printRun(targetTitle);
  const candidateRun = printRun(title);
  if (targetRun !== candidateRun && (targetRun !== null || candidateRun !== null)) {
    return null;
  }
  if (targetRun !== null) {
    result += 10;
    flags.push(`print run /${targetRun}`);
  }

  if (card.isAuto !== hasAuto(title)) return null;
  if (card.isRelic !== hasRelic(title)) return null;
  if (card.isGraded !== hasGrade(title)) return null;

  for (const [label, value] of [
    ["set", card.setName],
    ["parallel", card.parallel],
  ] as const) {
    const targetWords = words(value);
    const overlap = targetWords.length
      ? targetWords.filter((word) => title.includes(word)).length /
        targetWords.length
      : 0;
    if (targetWords.length && overlap === 0) return null;
    result += Math.round(overlap * 10);
    if (overlap) flags.push(`${label} overlap ${Math.round(overlap * 100)}%`);
  }

  const targetWords = Array.from(new Set(words(targetTitle)));
  const candidateWords = new Set(words(title));
  const overlap = targetWords.length
    ? targetWords.filter((word) => candidateWords.has(word)).length /
      targetWords.length
    : 0;
  result += Math.round(overlap * 20);
  flags.unshift(`title overlap ${Math.round(overlap * 100)}%`);

  const verified = anchors >= 2 && result >= 70;
  const scouting = anchors >= 1 && result >= 45;
  if (!verified && !scouting) return null;
  return {
    ...candidate,
    matchScore: result,
    matchLevel: verified ? (result >= 85 ? "exact" : "strong") : "scouting",
    flags,
  };
}

function dedupe(values: Candidate[]) {
  const map = new Map<string, Candidate>();
  for (const value of values) {
    const current = map.get(value.legacyItemId);
    if (!current || value.matchScore > current.matchScore) {
      map.set(value.legacyItemId, value);
    }
  }
  return Array.from(map.values());
}

function charm(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, round(Math.floor(maximum - 0.99) + 0.99));
}

function suggestion(
  key: string,
  label: string,
  target: number,
  shipping: number,
  floor: number | null,
) {
  const itemPrice = charm(Math.max(0.99, target - shipping));
  return {
    key,
    label,
    itemPrice,
    shipping,
    landedPrice: round(itemPrice + shipping),
    profitFloor: floor,
    meetsProfitFloor: floor === null ? null : itemPrice >= floor,
  };
}

function rebuild(
  attack: Json,
  raw: Candidate[],
  scored: Candidate[],
  searchQueries: string[],
  failures: FindingFailure[],
  targetTitle: string,
) {
  const targetState =
    String(attack.packagingState || "unknown") === "unknown"
      ? collectiblePackagingState(targetTitle)
      : String(attack.packagingState);
  const verified = list(attack.competitors).map(record) as Candidate[];
  const scouting = list(attack.scoutingCandidates).map(record) as Candidate[];
  const rejected = list(attack.packagingRejectedCandidates).map(record) as Candidate[];

  for (const candidate of scored) {
    const packaging = collectiblePackagingState(candidate.title);
    if (
      targetState !== "unknown" &&
      packaging !== "unknown" &&
      packaging !== targetState
    ) {
      rejected.push({ ...candidate, packagingState: packaging });
    } else if (targetState !== "unknown" && packaging === "unknown") {
      scouting.push({
        ...candidate,
        matchLevel: "scouting",
        packagingState: packaging,
        flags: unique([
          ...candidate.flags,
          `packaging state not stated; ${targetState} required`,
        ]),
      });
    } else if (!candidate.fixedPrice || candidate.matchLevel === "scouting") {
      scouting.push({
        ...candidate,
        matchLevel: "scouting",
        packagingState: packaging,
        flags: unique([
          ...candidate.flags,
          ...(candidate.fixedPrice ? [] : ["auction — review only"]),
        ]),
      });
    } else {
      verified.push({
        ...candidate,
        packagingState: packaging,
        flags: unique([
          ...candidate.flags,
          targetState === "unknown"
            ? "packaging not required"
            : `${targetState} packaging confirmed`,
        ]),
      });
    }
  }

  const exact = dedupe(verified).sort((left, right) => {
    if (left.landedPrice !== null && right.landedPrice !== null) {
      return left.landedPrice - right.landedPrice;
    }
    if (left.landedPrice !== null) return -1;
    if (right.landedPrice !== null) return 1;
    return right.matchScore - left.matchScore;
  });
  const review = dedupe(scouting)
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 12);
  const conflicts = dedupe(rejected).slice(0, 20);
  const known = exact.filter((candidate) => candidate.landedPrice !== null);
  const lowest = known[0] || null;
  const ourPrice = Number(attack.ourItemPrice || 0);
  const ourShipping = Number(attack.ourShipping || 0);
  const ourLanded = round(ourPrice + ourShipping);
  const rawFloor = attack.profitFloor;
  const floor =
    rawFloor === null || rawFloor === undefined || !Number.isFinite(Number(rawFloor))
      ? null
      : Number(rawFloor);
  const lowestLanded = lowest?.landedPrice ?? null;
  const gap = lowestLanded === null ? null : round(ourLanded - lowestLanded);
  const position =
    lowestLanded === null
      ? exact.length
        ? "shipping_unknown"
        : "no_verified_matches"
      : ourLanded < lowestLanded
        ? "best_deal"
        : ourLanded <= lowestLanded + 1
          ? "within_striking_distance"
          : "over_market";
  const suggestions =
    lowestLanded === null
      ? []
      : [
          suggestion("beat_by_cent", "Beat by $0.01", lowestLanded - 0.01, ourShipping, floor),
          suggestion("beat_by_dollar", "Beat by $1", lowestLanded - 1, ourShipping, floor),
          suggestion("undercut_5", "5% lower landed", lowestLanded * 0.95, ourShipping, floor),
          suggestion("undercut_10", "10% lower landed — King Price", lowestLanded * 0.9, ourShipping, floor),
          suggestion("undercut_15", "15% lower landed — Aggressive", lowestLanded * 0.85, ourShipping, floor),
        ];
  const unknownCount = review.filter(
    (candidate) => candidate.packagingState === "unknown",
  ).length;
  const opposite = targetState === "sealed" ? "OPENED" : "SEALED";
  const failuresText = failures.length
    ? ` ${failures.length} Finding request${failures.length === 1 ? "" : "s"} failed.`
    : "";
  const sourceNote = `Finding fallback checked ${raw.length} external listing${
    raw.length === 1 ? "" : "s"
  }.${failuresText}`;
  const packagingNote =
    targetState === "unknown"
      ? "No packaging state was required."
      : `Packaging rejected ${conflicts.length} incompatible ${opposite} listing${
          conflicts.length === 1 ? "" : "s"
        }; ${unknownCount} unknown-state listing${unknownCount === 1 ? "" : "s"} remain scouting-only.`;
  const originalTax =
    text(attack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";

  return {
    ...attack,
    schema: "truely.activeMarketAttack.v9",
    updatedAt: new Date().toISOString(),
    findingSearchUsed: true,
    findingRawCandidateCount: raw.length,
    findingSearchFailureCount: failures.length,
    findingSearchFailures: failures,
    externalRawCandidateCount: raw.length,
    rawCandidateCount: raw.length,
    searchQueries: unique([...list(attack.searchQueries), ...searchQueries]),
    discoveryNote: sourceNote,
    packagingNote,
    taxNote: `${originalTax} ${sourceNote}`,
    marketLocation: {
      ...record(attack.marketLocation),
      label: `Denver shipping estimate · Finding external ${raw.length} · packaging rejected ${conflicts.length} · unknown ${unknownCount}`,
    },
    packagingState: targetState,
    packagingExactCount: exact.length,
    packagingUnknownCount: unknownCount,
    packagingRejectedCount: conflicts.length,
    packagingRejectedCandidates: conflicts,
    status: exact.length ? "ready" : review.length ? "scouting_only" : "no_candidates",
    exactActiveCount: exact.length,
    strictExactCount: exact.filter((candidate) => candidate.matchLevel === "exact").length,
    strongMatchCount: exact.filter((candidate) => candidate.matchLevel === "strong").length,
    scoutingCount: review.length,
    landedKnownCount: known.length,
    shippingUnknownCount: exact.length - known.length,
    lowestCompetitor: lowest,
    lowestCompetitorLanded: lowestLanded,
    ourLanded,
    position,
    gapToLowest: gap,
    suggestions,
    competitors: exact.slice(0, 10),
    scoutingCandidates: review,
  };
}

export async function handleActiveMarketAttackWithFindingGuard(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  const response = await handleActiveMarketAttackWithDiscoveryGuard(request, context);
  const payload = await response.json().catch(() => null);
  if (!payload || !response.ok || payload.success !== true) {
    return Response.json(payload || { error: "Active Market Attack Mode failed." }, {
      status: response.status,
    });
  }

  const tracking = record(payload.tracking);
  if (Number(tracking.soldCompCount || 0) > 0) {
    return Response.json(payload, { status: response.status });
  }
  const attack = record(tracking.activeMarketAttack || payload.attack);
  if (Number(attack.exactActiveCount || 0) > 0 || Number(attack.scoutingCount || 0) > 0) {
    return Response.json(payload, { status: response.status });
  }

  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return Response.json(payload, { status: response.status });
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
  if (itemError || !item) return Response.json(payload, { status: response.status });
  if (!(item.seller_account_id === account.id || (owner && item.seller_account_id === null))) {
    return Response.json(payload, { status: response.status });
  }

  let title = String(item.title || "");
  let ebayItemId: string | null = null;
  let fallbackPlayer: string | null = null;
  if (item.legacy_product_id) {
    const { data: product } = await supabase
      .from("products")
      .select("title,ebay_item_id,player")
      .eq("id", item.legacy_product_id)
      .eq("store_id", storeId)
      .maybeSingle();
    title = title || String(product?.title || "");
    ebayItemId = text(product?.ebay_item_id);
    fallbackPlayer = text(product?.player);
  }

  const card = identity(title, tracking, fallbackPlayer);
  const searchQueries = queries(title, card, attack);
  const batches = await Promise.all(searchQueries.map((query) => searchFinding(query)));
  const failures = batches
    .map((batch) => batch.failure)
    .filter((failure): failure is FindingFailure => Boolean(failure));
  const ownIds = unique([
    ebayItemId,
    text(record(attack.selfListing).legacyItemId),
    text(record(attack.selfListing).itemId),
  ]);
  const raw = dedupe(batches.flatMap((batch) => batch.items)).filter(
    (candidate) =>
      ![candidate.legacyItemId, candidate.url].some((value) =>
        ownIds.some((ownId) => ownId && String(value || "").includes(ownId)),
      ),
  );
  const scored = raw
    .map((candidate) => score(title, card, candidate))
    .filter((candidate): candidate is Candidate => Boolean(candidate));
  const nextAttack = rebuild(
    attack,
    raw,
    scored,
    searchQueries,
    failures,
    title,
  );
  const reasons = unique([
    ...list(tracking.reviewReasons),
    "active_market_finding_search_used",
    ...(nextAttack.packagingRejectedCount > 0
      ? ["active_market_packaging_conflicts_removed"]
      : []),
    ...(nextAttack.packagingUnknownCount > 0
      ? ["active_market_packaging_unknown_scouting_only"]
      : []),
    ...(raw.length === 0 ? ["active_market_no_external_listings_returned"] : []),
    ...(failures.length ? ["active_market_finding_search_had_errors"] : []),
  ]);
  const nextTracking = {
    ...tracking,
    activeMarketAttack: nextAttack,
    marketCompCount: nextAttack.exactActiveCount,
    pricingEvidenceMode:
      nextAttack.exactActiveCount > 0
        ? "active_market_attack"
        : nextAttack.scoutingCount > 0
          ? "active_market_scouting"
          : "active_market_no_results",
    reviewReasons: reasons,
    topMarketComps: nextAttack.competitors,
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
          schema: "truely.instacompInventoryTrackingHistory.v9",
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
      nextAttack.exactActiveCount > 0
        ? "active_market_attack"
        : nextAttack.scoutingCount > 0
          ? "active_market_scouting"
          : "no_exact_active_market",
    diagnostics: {
      ...record(payload.diagnostics),
      findingSearchUsed: true,
      findingRawCandidateCount: nextAttack.findingRawCandidateCount,
      findingSearchFailureCount: nextAttack.findingSearchFailureCount,
      externalRawCandidateCount: nextAttack.externalRawCandidateCount,
      packagingRejectedCount: nextAttack.packagingRejectedCount,
      packagingUnknownCount: nextAttack.packagingUnknownCount,
      packagingExactCount: nextAttack.packagingExactCount,
    },
  });
}

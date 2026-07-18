import "server-only";

import { growthProfessionalCardEligibility } from "./market-intel-card-scope";
import { createSupabaseServerClient } from "./supabase-server";

type EbayMoney = { value?: string; currency?: string };
type EbayItemSummary = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  shortDescription?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  price?: EbayMoney;
  currentBidPrice?: EbayMoney;
  buyingOptions?: string[];
  itemCreationDate?: string;
  itemEndDate?: string;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  shippingOptions?: Array<{ shippingCost?: EbayMoney }>;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
};

type EbaySearchResponse = {
  itemSummaries?: EbayItemSummary[];
  errors?: Array<{ message?: string; longMessage?: string }>;
};

type DiscoverySubject = {
  id: string;
  name: string;
  priority: number;
  sport_or_category: string | null;
  league_or_brand: string | null;
  team_or_affiliation: string | null;
  notes: string | null;
};

type ParsedCandidate = {
  year: string | null;
  manufacturer: string | null;
  brand: string | null;
  productLine: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallelName: string | null;
  insertName: string | null;
  variationName: string | null;
  serialNumberedTo: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookieDesignation: boolean;
  conditionType: "raw" | "graded";
  gradingCompany: string | null;
  grade: string | null;
  quantity: number;
  nonBaseReasons: string[];
  parseConfidence: number;
  licensedScope: string;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function allNameTokensMatch(title: string, name: string) {
  const normalizedTitle = normalize(title);
  return normalize(name)
    .split(" ")
    .filter((token) => token.length >= 2)
    .every((token) => normalizedTitle.includes(token));
}

async function getEbayToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const credentials = Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
  ).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || `eBay OAuth failed (${response.status}).`,
    );
  }
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + numberValue(payload.expires_in, 7200) * 1000,
  };
  return tokenCache.token;
}

async function searchEbay(token: string, query: string, limit: number) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "newlyListed");
  url.searchParams.set("fieldgroups", "EXTENDED");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as EbaySearchResponse;
  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage || error?.message || `eBay discovery search failed (${response.status}).`,
    );
  }
  return payload.itemSummaries || [];
}

const PRODUCT_LINES = [
  "Bowman Chrome Sapphire",
  "Bowman Chrome Mega",
  "Bowman Chrome",
  "Bowman Draft",
  "Bowman Sterling",
  "Bowman Sapphire",
  "Topps Chrome Sapphire",
  "Topps Chrome",
  "Topps Finest",
  "Topps Heritage",
  "Topps Pro Debut",
  "Panini Prizm WNBA",
  "Panini Select WNBA",
  "Panini Mosaic WNBA",
  "Panini Revolution WNBA",
  "Panini Origins WNBA",
  "Panini Donruss WNBA",
];

const PARALLELS = [
  "Superfractor",
  "Gold Shimmer",
  "Orange Shimmer",
  "Blue Shimmer",
  "Green Shimmer",
  "Aqua Lava",
  "Speckle Refractor",
  "Atomic Refractor",
  "Mini-Diamond Refractor",
  "RayWave Refractor",
  "Wave Refractor",
  "Refractor",
  "Sapphire",
  "Mojo",
  "Cracked Ice",
  "Silver Prizm",
  "Silver",
  "Holo",
  "Red Wave",
  "Blue Wave",
  "Green Wave",
  "Gold Wave",
  "Purple Wave",
  "Fast Break",
  "Disco",
  "Choice",
  "Scope",
  "Tri-Color",
  "Zebra",
  "Tiger",
  "Elephant",
  "Black Gold",
  "Gold",
  "Orange",
  "Purple",
  "Pink",
  "Green",
  "Red",
  "Blue",
];

const INSERTS = [
  "Color Blast",
  "Downtown",
  "Kaboom",
  "Stained Glass",
  "Instant Impact",
  "Emergent",
  "Fireworks",
  "Get Hyped",
  "All Out",
  "Short Print",
  "Super Short Print",
  "Image Variation",
  "Case Hit",
];

function firstMatchingPhrase(title: string, values: string[]) {
  const normalized = normalize(title);
  return values.find((value) => normalized.includes(normalize(value))) || null;
}

function detectYear(title: string) {
  return title.match(/\b(20\d{2}(?:[-/]\d{2})?)\b/)?.[1]?.replace("/", "-") || null;
}

function detectManufacturer(title: string) {
  const normalized = normalize(title);
  if (normalized.includes("bowman")) return { manufacturer: "Bowman", brand: "Topps" };
  if (normalized.includes("topps")) return { manufacturer: "Topps", brand: "Topps" };
  if (normalized.includes("panini")) return { manufacturer: "Panini", brand: "Panini" };
  if (normalized.includes("fanatics")) return { manufacturer: "Fanatics", brand: "Fanatics" };
  return { manufacturer: null, brand: null };
}

function detectCardNumber(title: string) {
  const hash = title.match(/(?:^|\s)#([A-Z0-9-]{1,14})(?=\s|$|,|\))/i)?.[1];
  if (hash) return hash.toUpperCase();
  const labeled = title.match(/\b(?:card|no\.?|number)\s*#?\s*([A-Z]{0,5}\d{1,4}[A-Z-]*)\b/i)?.[1];
  return labeled ? labeled.toUpperCase() : null;
}

function detectSerialNumber(title: string) {
  const match = title.match(/(?:\b(?:numbered|serial|out of)\s*)?(?:\/|of\s+)(\d{1,4})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function detectQuantity(title: string) {
  const patterns = [
    /\blot\s+of\s+(\d{1,3})\b/i,
    /\b(\d{1,3})\s*[- ]?card\s+lot\b/i,
    /\bx\s*(\d{1,3})\b/i,
    /\bqty\.?\s*(\d{1,3})\b/i,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) return Math.max(1, Number(match[1]));
  }
  return 1;
}

function detectGrade(title: string) {
  const match = title.match(/\b(PSA|BGS|SGC|CGC|CSG|TAG|HGA)\s*(10|9\.5|9|8\.5|8|7\.5|7)?\b/i);
  if (!match) return { conditionType: "raw" as const, gradingCompany: null, grade: null };
  return {
    conditionType: "graded" as const,
    gradingCompany: match[1].toUpperCase(),
    grade: match[2] || null,
  };
}

function parseCandidate(subject: DiscoverySubject, title: string): ParsedCandidate | null {
  if (!allNameTokensMatch(title, subject.name)) return null;
  const year = detectYear(title);
  const maker = detectManufacturer(title);
  const productLine = firstMatchingPhrase(title, PRODUCT_LINES);
  const parallelName = firstMatchingPhrase(title, PARALLELS);
  const insertName = firstMatchingPhrase(title, INSERTS);
  const serialNumberedTo = detectSerialNumber(title);
  const autograph = /\b(auto|autograph|autographed)\b/i.test(title);
  const memorabilia = /\b(relic|patch|jersey|memorabilia|game[- ]used)\b/i.test(title);
  const rookieDesignation = /\b(rookie|rc|1st bowman|first bowman)\b/i.test(title);
  const variationName = /\b(image variation|photo variation|short print|\bsp\b|\bssp\b)\b/i.test(title)
    ? firstMatchingPhrase(title, ["Image Variation", "Photo Variation", "Super Short Print", "Short Print"]) || "Variation"
    : null;
  const nonBaseReasons = [
    parallelName,
    insertName ? `Insert: ${insertName}` : null,
    variationName,
    serialNumberedTo ? `Numbered /${serialNumberedTo}` : null,
    autograph ? "Autograph" : null,
    memorabilia ? "Memorabilia" : null,
  ].filter((value): value is string => Boolean(value));
  if (nonBaseReasons.length === 0) return null;

  const professional = growthProfessionalCardEligibility({
    sportOrCategory: subject.sport_or_category,
    leagueOrBrand: subject.league_or_brand,
    manufacturer: maker.manufacturer,
    brand: maker.brand,
    productLine,
    setName: productLine,
    displayName: title,
    listingTitle: title,
  });
  if (!professional.eligible) return null;

  const cardNumber = detectCardNumber(title);
  const grade = detectGrade(title);
  const quantity = detectQuantity(title);
  let confidence = 25;
  confidence += 20;
  confidence += 20;
  if (year) confidence += 10;
  if (productLine) confidence += 10;
  if (cardNumber) confidence += 10;
  if (parallelName || insertName || variationName) confidence += 5;
  if (quantity > 1) confidence += 5;

  return {
    year,
    manufacturer: maker.manufacturer,
    brand: maker.brand,
    productLine,
    setName: productLine,
    cardNumber,
    parallelName,
    insertName,
    variationName,
    serialNumberedTo,
    autograph,
    memorabilia,
    rookieDesignation,
    conditionType: grade.conditionType,
    gradingCompany: grade.gradingCompany,
    grade: grade.grade,
    quantity,
    nonBaseReasons,
    parseConfidence: clamp(confidence),
    licensedScope: professional.scope,
  };
}

function querySet(subject: DiscoverySubject) {
  if (String(subject.league_or_brand || "").toUpperCase() === "WNBA") {
    return [
      `${subject.name} WNBA Prizm Silver`,
      `${subject.name} WNBA Select parallel`,
      `${subject.name} WNBA Mosaic lot`,
    ];
  }
  return [
    `${subject.name} Bowman Chrome refractor`,
    `${subject.name} Bowman autograph`,
    `${subject.name} Topps Chrome parallel lot`,
  ];
}

function itemPrice(item: EbayItemSummary) {
  return numberValue(item.currentBidPrice?.value ?? item.price?.value, Number.NaN);
}

function shippingPrice(item: EbayItemSummary) {
  const costs = (item.shippingOptions || [])
    .map((option) => numberValue(option.shippingCost?.value, Number.NaN))
    .filter(Number.isFinite);
  return costs.length ? Math.min(...costs) : 0;
}

function imageUrls(item: EbayItemSummary) {
  return Array.from(
    new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((image) => image.imageUrl)]
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

async function loadDiscoverySubjects(maxSubjects: number) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: watchRows, error: watchError } = await supabase
    .from("tcos_mi_watchlist")
    .select("subject_id,priority,notes")
    .eq("active", true)
    .not("subject_id", "is", null);
  if (watchError) throw new Error(watchError.message);
  const growthRows = (watchRows || []).filter((row) =>
    String(row.notes || "").includes("[GROWTH_PROSPECT]"),
  );
  const ids = Array.from(new Set(growthRows.map((row) => String(row.subject_id))));
  if (ids.length === 0) return [];
  const { data: subjects, error: subjectError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name,priority,sport_or_category,league_or_brand,team_or_affiliation,notes")
    .eq("active", true)
    .in("id", ids);
  if (subjectError) throw new Error(subjectError.message);
  const priorityById = new Map(
    growthRows.map((row) => [String(row.subject_id), numberValue(row.priority)]),
  );
  const ordered = ((subjects || []) as DiscoverySubject[])
    .map((subject) => ({
      ...subject,
      priority: Math.max(numberValue(subject.priority), priorityById.get(subject.id) || 0),
    }))
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  if (ordered.length <= maxSubjects) return ordered;
  const cycle = Math.floor(Date.now() / 3_600_000);
  const start = (cycle * maxSubjects) % ordered.length;
  return Array.from({ length: maxSubjects }, (_, index) => ordered[(start + index) % ordered.length]);
}

async function saveCandidate(input: {
  subject: DiscoverySubject;
  marketplaceId: string;
  item: EbayItemSummary;
  parsed: ParsedCandidate;
  query: string;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const externalListingId = input.item.legacyItemId || input.item.itemId || null;
  const directUrl = input.item.itemWebUrl || input.item.itemAffiliateWebUrl || "";
  const askingPrice = itemPrice(input.item);
  const shipping = shippingPrice(input.item);
  const delivered = askingPrice + shipping;
  const unitCost = delivered / Math.max(1, input.parsed.quantity);
  if (!externalListingId || !directUrl || !Number.isFinite(askingPrice) || unitCost > 10) {
    return "rejected" as const;
  }
  let existingQuery = supabase
    .from("tcos_mi_identity_candidates")
    .select("id,status,first_seen_at")
    .eq("marketplace_id", input.marketplaceId);
  existingQuery = externalListingId
    ? existingQuery.eq("external_listing_id", externalListingId)
    : existingQuery.eq("direct_url", directUrl);
  const { data: existing, error: existingError } = await existingQuery.limit(1).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const now = new Date().toISOString();
  const payload = {
    subject_id: input.subject.id,
    marketplace_id: input.marketplaceId,
    external_listing_id: externalListingId,
    direct_url: directUrl,
    original_title: input.item.title || "",
    description: input.item.shortDescription || null,
    image_urls: imageUrls(input.item),
    asking_price: askingPrice,
    shipping_price: shipping,
    quantity: input.parsed.quantity,
    detected_year: input.parsed.year,
    detected_manufacturer: input.parsed.manufacturer,
    detected_brand: input.parsed.brand,
    detected_product_line: input.parsed.productLine,
    detected_set_name: input.parsed.setName,
    detected_card_number: input.parsed.cardNumber,
    detected_parallel_name: input.parsed.parallelName,
    detected_insert_name: input.parsed.insertName,
    detected_variation_name: input.parsed.variationName,
    serial_numbered_to: input.parsed.serialNumberedTo,
    autograph: input.parsed.autograph,
    memorabilia: input.parsed.memorabilia,
    rookie_designation: input.parsed.rookieDesignation,
    condition_type: input.parsed.conditionType,
    grading_company: input.parsed.gradingCompany,
    grade: input.parsed.grade,
    licensed_scope: input.parsed.licensedScope,
    non_base_reasons: input.parsed.nonBaseReasons,
    parse_confidence: input.parsed.parseConfidence,
    last_seen_at: now,
    metadata: {
      source_adapter: "ebay_identity_discovery",
      discovery_query: input.query,
      buying_options: input.item.buyingOptions || [],
      seller_name: input.item.seller?.username || null,
      seller_feedback_pct: input.item.seller?.feedbackPercentage || null,
      seller_feedback_count: input.item.seller?.feedbackScore || null,
      listed_at: input.item.itemCreationDate || null,
      auction_end_at: input.item.itemEndDate || null,
      currency: input.item.price?.currency || input.item.currentBidPrice?.currency || "USD",
    },
  };
  if (existing) {
    const { error } = await supabase
      .from("tcos_mi_identity_candidates")
      .update(payload)
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return "updated" as const;
  }
  const { error } = await supabase.from("tcos_mi_identity_candidates").insert({
    ...payload,
    status: "pending",
    first_seen_at: now,
  });
  if (error) throw new Error(error.message);
  return "created" as const;
}

export async function scanEbayForIdentityCandidates(options?: {
  maxSubjects?: number;
  resultsPerQuery?: number;
}) {
  const maxSubjects = Math.max(1, Math.min(15, Math.round(options?.maxSubjects || 5)));
  const resultsPerQuery = Math.max(1, Math.min(25, Math.round(options?.resultsPerQuery || 15)));
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: marketplace, error: marketplaceError } = await supabase
    .from("tcos_mi_marketplaces")
    .select("id")
    .eq("slug", "ebay")
    .eq("active", true)
    .single();
  if (marketplaceError) throw new Error(marketplaceError.message);
  const subjects = await loadDiscoverySubjects(maxSubjects);
  if (subjects.length === 0) {
    return { subjects: 0, queries: 0, returned: 0, parsed: 0, created: 0, updated: 0, rejected: 0 };
  }
  const token = await getEbayToken();
  let queries = 0;
  let returned = 0;
  let parsed = 0;
  let created = 0;
  let updated = 0;
  let rejected = 0;
  const errors: Array<{ subject: string; query: string; error: string }> = [];
  for (const subject of subjects) {
    for (const query of querySet(subject)) {
      queries += 1;
      try {
        const items = await searchEbay(token, query, resultsPerQuery);
        returned += items.length;
        for (const item of items) {
          if (!item.title) continue;
          const candidate = parseCandidate(subject, item.title);
          if (!candidate || candidate.parseConfidence < 55) continue;
          parsed += 1;
          const outcome = await saveCandidate({
            subject,
            marketplaceId: marketplace.id,
            item,
            parsed: candidate,
            query,
          });
          if (outcome === "created") created += 1;
          else if (outcome === "updated") updated += 1;
          else rejected += 1;
        }
      } catch (error) {
        errors.push({
          subject: subject.name,
          query,
          error: error instanceof Error ? error.message : "Unknown discovery error.",
        });
      }
    }
  }
  return {
    subjects: subjects.length,
    queries,
    returned,
    parsed,
    created,
    updated,
    rejected,
    errors,
    scannedAt: new Date().toISOString(),
  };
}

import "server-only";

import { detectCardNumberFromTitle } from "./market-intel-card-number-enrichment";
import { createSupabaseServerClient } from "./supabase-server";

type JsonRecord = Record<string, unknown>;

type EbayMoney = { value?: string; currency?: string };
type EbayAspect = { name?: string; value?: string };
type EbayItemDetail = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  shortDescription?: string;
  price?: EbayMoney;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  localizedAspects?: EbayAspect[];
  lotSize?: number;
  errors?: Array<{ message?: string; longMessage?: string }>;
};

export type PurchaseInboxBucket = "resale" | "hold" | "skip";

export type StageEbayPurchaseInput = {
  ebayItem: string;
  playerName: string;
  sportOrCategory: string;
  purchaseDate: string;
  quantity: number;
  itemSubtotal: number;
  inboundShipping: number;
  salesTax: number;
  buyerFees: number;
  otherCost: number;
  targetBucket: PurchaseInboxBucket;
  externalOrderId?: string | null;
};

export type PurchaseInboxRow = {
  id: string;
  external_order_id: string | null;
  external_listing_id: string | null;
  direct_url: string;
  title: string;
  image_urls: string[];
  player_name: string;
  sport_or_category: string;
  purchased_at: string;
  quantity: number;
  item_subtotal: number;
  inbound_shipping: number;
  sales_tax: number;
  buyer_fees: number;
  other_cost: number;
  total_paid: number;
  target_bucket: PurchaseInboxBucket;
  status: string;
  identity_candidate_id: string | null;
  purchase_lot_id: string | null;
  metadata: JsonRecord;
  marketplace: { id: string; name: string; slug: string } | null;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIds(ids: string[]) {
  return Array.from(
    new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)),
  ).slice(0, 100);
}

function legacyItemId(value: string) {
  const trimmed = value.trim();
  if (/^\d{9,15}$/.test(trimmed)) return trimmed;
  return (
    trimmed.match(/(?:\/itm\/(?:[^/]+\/)?|[?&]item=)(\d{9,15})(?:\D|$)/i)?.[1] ||
    null
  );
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

async function fetchEbayItem(ebayItem: string) {
  const token = await getEbayToken();
  const value = ebayItem.trim();
  let url: URL;
  if (value.startsWith("v1|")) {
    url = new URL(
      `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(value)}`,
    );
  } else {
    const legacy = legacyItemId(value);
    if (!legacy) {
      throw new Error("Enter a valid eBay item URL, legacy item number, or Browse item ID.");
    }
    url = new URL(
      "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id",
    );
    url.searchParams.set("legacy_item_id", legacy);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as EbayItemDetail;
  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage || error?.message || `eBay item lookup failed (${response.status}).`,
    );
  }
  return payload;
}

function aspectValue(aspects: EbayAspect[] | undefined, names: string[]) {
  const normalizedNames = names.map(normalize);
  for (const aspect of aspects || []) {
    if (normalizedNames.includes(normalize(aspect.name))) {
      const value = String(aspect.value || "").trim();
      if (value) return value;
    }
  }
  return null;
}

function yearFromDetail(detail: EbayItemDetail) {
  return (
    aspectValue(detail.localizedAspects, ["Year Manufactured", "Season", "Year"]) ||
    detail.title?.match(/\b(20\d{2}(?:[-/]\d{2})?)\b/)?.[1]?.replace("/", "-") ||
    null
  );
}

function manufacturerFromDetail(detail: EbayItemDetail) {
  const aspect = aspectValue(detail.localizedAspects, ["Manufacturer", "Brand"]);
  if (aspect) return aspect;
  const title = normalize(detail.title);
  if (title.includes("bowman")) return "Bowman";
  if (title.includes("topps")) return "Topps";
  if (title.includes("panini")) return "Panini";
  if (title.includes("upper deck")) return "Upper Deck";
  return null;
}

function cardNumberFromDetail(detail: EbayItemDetail) {
  return (
    aspectValue(detail.localizedAspects, ["Card Number", "Card No", "Card #"]) ||
    detectCardNumberFromTitle(detail.title || "")
  );
}

function serialNumberedTo(title: string) {
  const match = title.match(/(?:^|\s)(?:\d{1,4}\s*)?\/\s*(\d{1,4})(?:\s|$|[),])/);
  const value = match ? Number(match[1]) : null;
  return value && Number.isInteger(value) && value > 0 ? value : null;
}

function imageUrls(detail: EbayItemDetail) {
  return Array.from(
    new Set(
      [detail.image?.imageUrl, ...(detail.additionalImages || []).map((image) => image.imageUrl)]
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function detectedFields(detail: EbayItemDetail) {
  const title = detail.title || "";
  const setName = aspectValue(detail.localizedAspects, ["Set", "Card Set"]);
  const parallel = aspectValue(detail.localizedAspects, ["Parallel/Variety", "Parallel"]);
  const insert = aspectValue(detail.localizedAspects, ["Insert Set", "Insert"]);
  const features = aspectValue(detail.localizedAspects, ["Features"]);
  const autographed =
    normalize(aspectValue(detail.localizedAspects, ["Autographed"])) === "yes" ||
    /\b(auto|autograph|autographed|signed)\b/i.test(title);
  const memorabilia = /\b(relic|patch|jersey|memorabilia|game used)\b/i.test(title);
  const rookie =
    /\b(rookie|\brc\b|1st bowman|first bowman)\b/i.test(title) ||
    normalize(features).includes("rookie");
  const serialTo = serialNumberedTo(title);
  const reasons = [
    parallel,
    insert ? `Insert: ${insert}` : null,
    serialTo ? `Numbered /${serialTo}` : null,
    autographed ? "Autograph" : null,
    memorabilia ? "Memorabilia" : null,
  ].filter((value): value is string => Boolean(value));
  const grader = aspectValue(detail.localizedAspects, ["Professional Grader", "Grader"]);
  const grade = aspectValue(detail.localizedAspects, ["Grade"]);

  return {
    year: yearFromDetail(detail),
    manufacturer: manufacturerFromDetail(detail),
    brand: aspectValue(detail.localizedAspects, ["Brand"]) || manufacturerFromDetail(detail),
    productLine: setName,
    setName,
    cardNumber: cardNumberFromDetail(detail),
    parallel,
    insert,
    serialTo,
    autographed,
    memorabilia,
    rookie,
    conditionType: grader || grade ? "graded" : "raw",
    grader,
    grade,
    reasons,
  };
}

async function ebayMarketplace() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_marketplaces")
    .select("id,name,slug")
    .eq("slug", "ebay")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function stageEbayPurchase(input: StageEbayPurchaseInput) {
  if (!input.playerName.trim()) throw new Error("Player name is required.");
  if (!input.purchaseDate) throw new Error("Purchase date is required.");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  const costs = [
    input.itemSubtotal,
    input.inboundShipping,
    input.salesTax,
    input.buyerFees,
    input.otherCost,
  ];
  if (!costs.every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("All cost fields must be zero or greater.");
  }

  const [detail, marketplace] = await Promise.all([
    fetchEbayItem(input.ebayItem),
    ebayMarketplace(),
  ]);
  const externalListingId =
    detail.legacyItemId || legacyItemId(input.ebayItem) || detail.itemId || null;
  const directUrl = externalListingId && /^\d+$/.test(externalListingId)
    ? `https://www.ebay.com/itm/${externalListingId}`
    : input.ebayItem.trim();
  const total = roundMoney(costs.reduce((sum, value) => sum + value, 0));
  const fields = detectedFields(detail);
  const supabase = createSupabaseServerClient({ admin: true });

  const payload = {
    marketplace_id: marketplace.id,
    external_order_id: input.externalOrderId?.trim() || null,
    external_listing_id: externalListingId,
    direct_url: directUrl,
    title: detail.title || `eBay item ${externalListingId || "purchase"}`,
    image_urls: imageUrls(detail),
    player_name: input.playerName.trim(),
    sport_or_category: input.sportOrCategory.trim() || "Baseball",
    purchased_at: new Date(`${input.purchaseDate}T12:00:00`).toISOString(),
    quantity: input.quantity,
    item_subtotal: roundMoney(input.itemSubtotal),
    inbound_shipping: roundMoney(input.inboundShipping),
    sales_tax: roundMoney(input.salesTax),
    buyer_fees: roundMoney(input.buyerFees),
    other_cost: roundMoney(input.otherCost),
    target_bucket: input.targetBucket,
    status: input.targetBucket === "skip" ? "skipped" : "pending",
    metadata: {
      source: "manual_ebay_purchase_intake",
      ebay_browse_item_id: detail.itemId || null,
      ebay_legacy_item_id: detail.legacyItemId || externalListingId,
      ebay_price_at_lookup: numberValue(detail.price?.value, 0),
      currency: detail.price?.currency || "USD",
      item_short_description: detail.shortDescription || null,
      localized_aspects: detail.localizedAspects || [],
      detected_fields: fields,
      receipt_total_paid: total,
    },
  };

  const { data, error } = await supabase
    .from("tcos_mi_purchase_inbox")
    .insert(payload)
    .select("id,total_paid")
    .single();
  if (error) throw new Error(error.message);
  return { id: String(data.id), totalPaid: numberValue(data.total_paid, total) };
}

export async function getEbayPurchaseInbox() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_purchase_inbox")
    .select("*")
    .order("status", { ascending: true })
    .order("purchased_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const marketplaceIds = Array.from(
    new Set((data || []).map((row) => String(row.marketplace_id))),
  );
  const { data: marketplaces, error: marketplaceError } = marketplaceIds.length
    ? await supabase
        .from("tcos_mi_marketplaces")
        .select("id,name,slug")
        .in("id", marketplaceIds)
    : { data: [], error: null };
  if (marketplaceError) throw new Error(marketplaceError.message);
  const marketplaceById = new Map(
    (marketplaces || []).map((row) => [String(row.id), row]),
  );

  return (data || []).map((row): PurchaseInboxRow => ({
    id: String(row.id),
    external_order_id: row.external_order_id ? String(row.external_order_id) : null,
    external_listing_id: row.external_listing_id ? String(row.external_listing_id) : null,
    direct_url: String(row.direct_url),
    title: String(row.title),
    image_urls: Array.isArray(row.image_urls)
      ? row.image_urls.map((value: unknown) => String(value))
      : [],
    player_name: String(row.player_name),
    sport_or_category: String(row.sport_or_category),
    purchased_at: String(row.purchased_at),
    quantity: Math.max(1, numberValue(row.quantity, 1)),
    item_subtotal: numberValue(row.item_subtotal),
    inbound_shipping: numberValue(row.inbound_shipping),
    sales_tax: numberValue(row.sales_tax),
    buyer_fees: numberValue(row.buyer_fees),
    other_cost: numberValue(row.other_cost),
    total_paid: numberValue(row.total_paid),
    target_bucket: row.target_bucket as PurchaseInboxBucket,
    status: String(row.status),
    identity_candidate_id: row.identity_candidate_id
      ? String(row.identity_candidate_id)
      : null,
    purchase_lot_id: row.purchase_lot_id ? String(row.purchase_lot_id) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as JsonRecord)
        : {},
    marketplace: marketplaceById.get(String(row.marketplace_id)) || null,
  }));
}

async function resolveSubject(row: PurchaseInboxRow) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: existing, error: lookupError } = await supabase
    .from("tcos_mi_subjects")
    .select("id")
    .eq("subject_type", "player")
    .ilike("name", row.player_name)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing?.id) return String(existing.id);

  const { data, error } = await supabase
    .from("tcos_mi_subjects")
    .insert({
      subject_type: "player",
      name: row.player_name,
      sport_or_category: row.sport_or_category,
      league_or_brand: "Purchase Inbox",
      team_or_affiliation: null,
      priority: 50,
      active: true,
      notes: "[PURCHASE_INBOX] User-entered eBay purchase awaiting exact-card review.",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(data.id);
}

export async function movePurchaseInboxToReview(
  inboxIds: string[],
  bucket: Exclude<PurchaseInboxBucket, "skip">,
) {
  const ids = cleanIds(inboxIds);
  const result = { requested: ids.length, moved: 0, skipped: 0, errors: [] as string[] };
  if (ids.length === 0) return result;
  const supabase = createSupabaseServerClient({ admin: true });
  const rows = (await getEbayPurchaseInbox()).filter(
    (row) => ids.includes(row.id) && row.status === "pending",
  );

  for (const row of rows) {
    try {
      const subjectId = await resolveSubject(row);
      const detailFields =
        row.metadata.detected_fields && typeof row.metadata.detected_fields === "object"
          ? (row.metadata.detected_fields as JsonRecord)
          : {};
      const existingQuery = row.external_listing_id
        ? supabase
            .from("tcos_mi_identity_candidates")
            .select("id,status,metadata")
            .eq("marketplace_id", row.marketplace?.id || "")
            .eq("external_listing_id", row.external_listing_id)
            .limit(1)
        : supabase
            .from("tcos_mi_identity_candidates")
            .select("id,status,metadata")
            .eq("direct_url", row.direct_url)
            .limit(1);
      const { data: existingRows, error: existingError } = await existingQuery;
      if (existingError) throw new Error(existingError.message);
      const existing = existingRows?.[0] || null;
      if (existing && existing.status !== "pending") {
        throw new Error(`Listing already has a ${existing.status} identity candidate.`);
      }

      const metadata = {
        ...(existing?.metadata || {}),
        purchase_inbox: true,
        purchase_inbox_id: row.id,
        portfolio_bucket: bucket,
        actual_item_subtotal: row.item_subtotal,
        actual_inbound_shipping: row.inbound_shipping,
        actual_sales_tax: row.sales_tax,
        actual_buyer_fees: row.buyer_fees,
        actual_other_cost: row.other_cost,
        actual_total_paid: row.total_paid,
        actual_purchase_date: row.purchased_at,
        external_order_id: row.external_order_id,
        source_adapter: "ebay_purchase_inbox",
        currency: String(row.metadata.currency || "USD"),
      };
      const candidatePayload = {
        subject_id: subjectId,
        marketplace_id: row.marketplace?.id,
        external_listing_id: row.external_listing_id,
        direct_url: row.direct_url,
        original_title: row.title,
        description: row.metadata.item_short_description
          ? String(row.metadata.item_short_description)
          : null,
        image_urls: row.image_urls,
        asking_price: row.item_subtotal,
        shipping_price: row.inbound_shipping,
        quantity: row.quantity,
        detected_year: detailFields.year ? String(detailFields.year) : null,
        detected_manufacturer: detailFields.manufacturer
          ? String(detailFields.manufacturer)
          : null,
        detected_brand: detailFields.brand ? String(detailFields.brand) : null,
        detected_product_line: detailFields.productLine
          ? String(detailFields.productLine)
          : null,
        detected_set_name: detailFields.setName ? String(detailFields.setName) : null,
        detected_card_number: detailFields.cardNumber
          ? String(detailFields.cardNumber).toUpperCase()
          : null,
        detected_parallel_name: detailFields.parallel
          ? String(detailFields.parallel)
          : "Base",
        detected_insert_name: detailFields.insert ? String(detailFields.insert) : null,
        detected_variation_name: null,
        serial_numbered_to: detailFields.serialTo
          ? numberValue(detailFields.serialTo)
          : null,
        autograph: Boolean(detailFields.autographed),
        memorabilia: Boolean(detailFields.memorabilia),
        rookie_designation: Boolean(detailFields.rookie),
        condition_type: detailFields.conditionType === "graded" ? "graded" : "raw",
        grading_company: detailFields.grader ? String(detailFields.grader) : null,
        grade: detailFields.grade ? String(detailFields.grade) : null,
        licensed_scope: "purchase_inbox_manual_review",
        non_base_reasons: Array.isArray(detailFields.reasons)
          ? detailFields.reasons
          : [],
        parse_confidence: detailFields.cardNumber ? 80 : 55,
        last_seen_at: new Date().toISOString(),
        metadata,
      };

      let candidateId: string;
      if (existing) {
        const { error } = await supabase
          .from("tcos_mi_identity_candidates")
          .update(candidatePayload)
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        candidateId = String(existing.id);
      } else {
        const { data, error } = await supabase
          .from("tcos_mi_identity_candidates")
          .insert({ ...candidatePayload, status: "pending" })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        candidateId = String(data.id);
      }

      const { error: inboxError } = await supabase
        .from("tcos_mi_purchase_inbox")
        .update({
          target_bucket: bucket,
          status: "moved_to_review",
          identity_candidate_id: candidateId,
          metadata: {
            ...row.metadata,
            moved_to_review_at: new Date().toISOString(),
          },
        })
        .eq("id", row.id)
        .eq("status", "pending");
      if (inboxError) throw new Error(inboxError.message);
      result.moved += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push(
        `${row.player_name}: ${error instanceof Error ? error.message : "Unable to move purchase to review."}`,
      );
    }
  }

  result.skipped += Math.max(0, ids.length - rows.length);
  return result;
}

export async function skipPurchaseInboxRows(inboxIds: string[]) {
  const ids = cleanIds(inboxIds);
  if (ids.length === 0) return { skipped: 0 };
  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase
    .from("tcos_mi_purchase_inbox")
    .update({ status: "skipped", target_bucket: "skip" })
    .in("id", ids)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return { skipped: ids.length };
}

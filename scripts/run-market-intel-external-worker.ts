import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateMarketIntelEbayIdentityMatch,
  normalizeMarketIntelCandidateText,
} from "../src/lib/market-intel-ebay-candidate-match.ts";
import {
  buildEbayProfitHunterQueries,
  minimumConfidenceForEbayQuery,
  type EbayProfitHunterIdentity,
  type EbayProfitHunterQueryMode,
} from "../src/lib/market-intel-ebay-queries.ts";

type JsonRecord = Record<string, unknown>;
type Money = { value?: string; currency?: string };
type EbayItem = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  shortDescription?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  price?: Money;
  currentBidPrice?: Money;
  buyingOptions?: string[];
  itemCreationDate?: string;
  itemEndDate?: string;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  seller?: {
    username?: string;
    feedbackPercentage?: string;
    feedbackScore?: number;
  };
  shippingOptions?: Array<{ shippingCost?: Money }>;
  condition?: string;
  conditionId?: string;
  categories?: Array<{ categoryId?: string; categoryName?: string }>;
};

type Subject = {
  id: string;
  name: string;
  priority: number | null;
};

type ExistingCandidateRow = {
  candidate_fingerprint: string;
  status: string;
  evidence: JsonRecord | null;
  collectible_identity_id: string | null;
  reviewed_at: string | null;
  promoted_listing_id: string | null;
};

type IdentityRow = EbayProfitHunterIdentity & {
  id: string;
  identity_key: string;
  subject_id: string | null;
  display_name: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function envNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function itemPrice(item: EbayItem) {
  return num(item.currentBidPrice?.value ?? item.price?.value, Number.NaN);
}

function shippingPrice(item: EbayItem) {
  const values = (item.shippingOptions || [])
    .map((row) => num(row.shippingCost?.value, Number.NaN))
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : 0;
}

function listingFormat(item: EbayItem) {
  const options = item.buyingOptions || [];
  if (options.includes("AUCTION")) return "auction";
  if (options.includes("BEST_OFFER")) return "best_offer";
  if (options.includes("FIXED_PRICE")) return "fixed_price";
  return "unknown";
}

function imageUrls(item: EbayItem) {
  return Array.from(
    new Set(
      [
        item.image?.imageUrl,
        ...(item.additionalImages || []).map((image) => image.imageUrl),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function exactQuery(identity: IdentityRow) {
  return [
    identity.subject_name,
    identity.season_year,
    identity.manufacturer,
    identity.product_line,
    identity.set_name,
    identity.insert_name,
    identity.card_number ? `#${identity.card_number}` : null,
    normalizeMarketIntelCandidateText(identity.parallel_name) !== "base"
      ? identity.parallel_name
      : null,
    identity.variation_name,
    identity.autograph ? "auto" : null,
    identity.memorabilia ? "relic" : null,
    identity.condition_type === "graded" ? identity.grading_company : null,
    identity.condition_type === "graded" ? identity.grade : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 350);
}

function candidateFingerprint(
  sourceSlug: string,
  externalListingId: string,
  identityId: string,
) {
  return createHash("sha256")
    .update(`${sourceSlug}|${externalListingId}|${identityId}`)
    .digest("hex");
}

function sourceListingKey(row: JsonRecord) {
  const source = String(row.source_slug || "");
  const externalListingId = String(row.external_listing_id || "");
  const directUrl = String(row.direct_url || "");
  return externalListingId
    ? `${source}|${externalListingId}`
    : `${source}|url:${directUrl}`;
}

function proofFields(evidence: JsonRecord) {
  return Object.fromEntries(
    Object.entries(evidence).filter(([key]) => key.startsWith("identity_proof_")),
  );
}

function preservedStatus(existingStatus: string, incomingStatus: string) {
  if (["promoted", "rejected"].includes(existingStatus)) return existingStatus;
  if (["probable_exact", "conflict_detected"].includes(existingStatus)) {
    return existingStatus;
  }
  if (incomingStatus === "conflict_detected") return incomingStatus;
  return existingStatus || incomingStatus;
}

async function ebayToken() {
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
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || `eBay OAuth failed (${response.status}).`);
  }
  return payload.access_token;
}

async function ebaySearch(token: string, query: string, limit: number) {
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
  });
  const payload = (await response.json()) as {
    itemSummaries?: EbayItem[];
    errors?: Array<{ message?: string; longMessage?: string }>;
  };
  if (!response.ok) {
    throw new Error(
      payload.errors?.[0]?.longMessage ||
        payload.errors?.[0]?.message ||
        `eBay search failed (${response.status}).`,
    );
  }
  return payload.itemSummaries || [];
}

async function main() {
  const supabase = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const maxSubjects = envNumber("MARKET_INTEL_WORKER_MAX_SUBJECTS", 3, 1, 10);
  const maxIdentities = envNumber("MARKET_INTEL_WORKER_MAX_IDENTITIES", 4, 1, 20);
  const maxQueries = envNumber("MARKET_INTEL_WORKER_MAX_QUERIES", 8, 2, 10);
  const resultsPerQuery = envNumber("MARKET_INTEL_WORKER_RESULTS_PER_QUERY", 5, 1, 10);
  const minimumConfidence = envNumber(
    "MARKET_INTEL_WORKER_MINIMUM_CONFIDENCE",
    55,
    45,
    90,
  );
  const intervalMinutes = envNumber(
    "MARKET_INTEL_WORKER_INTERVAL_MINUTES",
    15,
    1,
    1440,
  );

  const maximumCallsPerRun = maxIdentities * maxQueries;
  const estimatedCallsPerDay = Math.ceil(1440 / intervalMinutes) * maximumCallsPerRun;
  if (estimatedCallsPerDay > 4500) {
    throw new Error(
      `Configured worker could use about ${estimatedCallsPerDay} Browse API calls/day. Reduce frequency, identities, or query families to preserve the default eBay daily quota.`,
    );
  }

  const { data: watches, error: watchError } = await supabase
    .from("tcos_mi_watchlist")
    .select("subject_id,priority")
    .eq("active", true)
    .not("subject_id", "is", null)
    .order("priority", { ascending: false });
  if (watchError) throw new Error(watchError.message);

  const subjectIds = Array.from(
    new Set((watches || []).map((row) => String(row.subject_id)).filter(Boolean)),
  ).slice(0, maxSubjects);
  if (!subjectIds.length) {
    console.log("No active Profit Hunter subjects. Worker exited without marketplace calls.");
    return;
  }

  const [{ data: subjects, error: subjectError }, { data: identities, error: identityError }] =
    await Promise.all([
      supabase
        .from("tcos_mi_subjects")
        .select("id,name,priority")
        .in("id", subjectIds)
        .eq("active", true),
      supabase
        .from("tcos_mi_collectible_identities")
        .select(
          "id,identity_key,subject_id,display_name,season_year,manufacturer,product_line,set_name,insert_name,card_number,parallel_name,variation_name,condition_type,grading_company,grade,autograph,memorabilia,serial_numbered_to",
        )
        .in("subject_id", subjectIds)
        .eq("active", true),
    ]);
  if (subjectError) throw new Error(subjectError.message);
  if (identityError) throw new Error(identityError.message);

  const subjectById = new Map(
    ((subjects || []) as Subject[]).map((subject) => [subject.id, subject]),
  );
  const ranked = ((identities || []) as Omit<IdentityRow, "subject_name">[])
    .map((identity) => ({
      ...identity,
      subject_name: subjectById.get(String(identity.subject_id))?.name || "Tracked subject",
      rank:
        num(subjectById.get(String(identity.subject_id))?.priority) +
        (identity.card_number ? 15 : 0) +
        (normalizeMarketIntelCandidateText(identity.parallel_name) !== "base" ? 10 : 0) +
        (identity.autograph ? 8 : 0) +
        (identity.memorabilia ? 5 : 0),
    }))
    .sort((left, right) => right.rank - left.rank)
    .slice(0, maxIdentities) as Array<IdentityRow & { rank: number }>;

  const token = await ebayToken();
  const staged = new Map<string, JsonRecord>();
  let calls = 0;
  let conflictsSuppressed = 0;
  let lotCandidatesQuarantined = 0;

  for (const identity of ranked) {
    const specs = buildEbayProfitHunterQueries(identity, exactQuery(identity), maxQueries);
    for (const spec of specs) {
      const items = await ebaySearch(token, spec.query, resultsPerQuery);
      calls += 1;
      for (const item of items) {
        const externalListingId = String(item.legacyItemId || item.itemId || "").trim();
        const directUrl = String(item.itemWebUrl || item.itemAffiliateWebUrl || "").trim();
        const price = itemPrice(item);
        if (!externalListingId || !directUrl || !item.title || !Number.isFinite(price)) {
          continue;
        }

        const match = evaluateMarketIntelEbayIdentityMatch(identity, item);
        const requiresLotWorkflow = spec.mode === "lot" || match.lotListing;
        if (match.hardConflict && !requiresLotWorkflow) {
          conflictsSuppressed += 1;
          continue;
        }

        const effectiveScore = requiresLotWorkflow ? match.baseScore : match.score;
        const threshold = minimumConfidenceForEbayQuery(
          spec.mode as EbayProfitHunterQueryMode,
          minimumConfidence,
        );
        if (effectiveScore < threshold) continue;

        const fingerprint = candidateFingerprint("ebay", externalListingId, identity.id);
        const priority = effectiveScore + spec.priority / 10;
        const current = staged.get(fingerprint);
        if (current && num(current.candidate_priority_score) >= priority) continue;

        if (requiresLotWorkflow) lotCandidatesQuarantined += 1;
        const now = new Date().toISOString();
        staged.set(fingerprint, {
          candidate_fingerprint: fingerprint,
          source_slug: "ebay",
          collectible_identity_id: identity.id,
          external_listing_id: externalListingId,
          direct_url: directUrl,
          original_title: item.title,
          description: item.shortDescription || null,
          image_urls: imageUrls(item),
          listing_format: requiresLotWorkflow ? "lot" : listingFormat(item),
          asking_price: price,
          shipping_price: shippingPrice(item),
          buyer_fee: 0,
          quantity: 1,
          seller_name: item.seller?.username || null,
          seller_rating: item.seller?.feedbackPercentage
            ? num(item.seller.feedbackPercentage)
            : null,
          listed_at: item.itemCreationDate || null,
          auction_end_at: item.itemEndDate || null,
          query_mode: spec.mode,
          query_text: spec.query,
          candidate_confidence: effectiveScore,
          candidate_priority_score: priority,
          status: requiresLotWorkflow ? "conflict_detected" : "pending_review",
          evidence: {
            worker_schema: "tcos.marketIntel.externalWorker.v2",
            identity_key: identity.identity_key,
            identity_display_name: identity.display_name,
            query_intent: spec.intent,
            query_requires_image_review: spec.requiresImageReview,
            identity_match_reasons: match.reasons,
            identity_match_conflicts: match.conflicts,
            requires_lot_workflow: requiresLotWorkflow,
            ebay_condition: item.condition || null,
            ebay_condition_id: item.conditionId || null,
            ebay_categories: item.categories || [],
            seller_feedback_count: item.seller?.feedbackScore || null,
          },
          last_seen_at: now,
          updated_at: now,
        });
      }
    }
  }

  const stagedBySourceListing = new Map<string, JsonRecord[]>();
  for (const row of staged.values()) {
    const key = sourceListingKey(row);
    const rows = stagedBySourceListing.get(key) || [];
    rows.push(row);
    stagedBySourceListing.set(key, rows);
  }
  let crossIdentityGroupsQuarantined = 0;
  for (const rows of stagedBySourceListing.values()) {
    const identityIds = new Set(rows.map((row) => String(row.collectible_identity_id || "")));
    if (identityIds.size <= 1) continue;
    crossIdentityGroupsQuarantined += 1;
    for (const row of rows) {
      row.status = "conflict_detected";
      row.evidence = {
        ...recordValue(row.evidence),
        cross_identity_listing_conflict: true,
        sibling_identity_ids: Array.from(identityIds),
      };
    }
  }

  const rows = Array.from(staged.values()).slice(0, 100);
  if (rows.length) {
    const fingerprints = rows.map((row) => String(row.candidate_fingerprint));
    const { data: existing, error: existingError } = await supabase
      .from("tcos_mi_search_candidates")
      .select(
        "candidate_fingerprint,status,evidence,collectible_identity_id,reviewed_at,promoted_listing_id",
      )
      .in("candidate_fingerprint", fingerprints);
    if (existingError && existingError.code !== "42P01") {
      throw new Error(existingError.message);
    }
    if (existingError?.code === "42P01") {
      throw new Error(
        "Search candidate queue is not installed. Apply migration 20260719153000_market_intel_identity_proof_gate.sql first.",
      );
    }

    const existingByFingerprint = new Map<string, ExistingCandidateRow>(
      ((existing || []) as ExistingCandidateRow[]).map((row) => [
        String(row.candidate_fingerprint),
        row,
      ]),
    );
    for (const row of rows) {
      const prior = existingByFingerprint.get(String(row.candidate_fingerprint));
      if (!prior) continue;

      row.status = preservedStatus(String(prior.status || ""), String(row.status || ""));
      if (prior.reviewed_at || String(prior.status || "") !== "pending_review") {
        row.collectible_identity_id = prior.collectible_identity_id || row.collectible_identity_id;
      }
      const oldEvidence = recordValue(prior.evidence);
      row.evidence = {
        ...oldEvidence,
        ...recordValue(row.evidence),
        ...proofFields(oldEvidence),
      };
    }

    const { error: upsertError } = await supabase
      .from("tcos_mi_search_candidates")
      .upsert(rows, { onConflict: "candidate_fingerprint" });
    if (upsertError) throw new Error(upsertError.message);
  }

  console.log(
    JSON.stringify(
      {
        worker: "tcos.marketIntel.externalWorker.v2",
        completedAt: new Date().toISOString(),
        identities: ranked.length,
        marketplaceCalls: calls,
        candidatesStaged: rows.length,
        conflictsSuppressed,
        lotCandidatesQuarantined,
        crossIdentityGroupsQuarantined,
        estimatedMaximumCallsPerDay: estimatedCallsPerDay,
        vercelSearchInvocations: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

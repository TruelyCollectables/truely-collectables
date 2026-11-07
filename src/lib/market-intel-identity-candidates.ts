import "server-only";

import { ingestMarketIntelListings } from "./market-intel-ingestion";
import { growthProfessionalCardEligibility } from "./market-intel-card-scope";
import { growthIdentityEligibility } from "./market-intel-growth";
import { createSupabaseServerClient } from "./supabase-server";

export type IdentityCandidate = {
  id: string;
  subject_id: string;
  marketplace_id: string;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  description: string | null;
  image_urls: string[];
  asking_price: number;
  shipping_price: number;
  delivered_price: number;
  quantity: number;
  unit_delivered_cost: number;
  detected_year: string | null;
  detected_manufacturer: string | null;
  detected_brand: string | null;
  detected_product_line: string | null;
  detected_set_name: string | null;
  detected_card_number: string | null;
  detected_parallel_name: string | null;
  detected_insert_name: string | null;
  detected_variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookie_designation: boolean;
  condition_type: string;
  grading_company: string | null;
  grade: string | null;
  licensed_scope: string | null;
  non_base_reasons: string[];
  parse_confidence: number;
  status: string;
  rejection_reason: string | null;
  first_seen_at: string;
  last_seen_at: string;
  metadata: Record<string, unknown>;
  subject: {
    id: string;
    name: string;
    sport_or_category: string | null;
    league_or_brand: string | null;
    team_or_affiliation: string | null;
    priority: number;
  };
  marketplace: { id: string; name: string; slug: string };
};

export type CandidateApprovalInput = {
  candidateId: string;
  seasonYear: string;
  manufacturer: string;
  brand: string;
  productLine: string;
  setName: string;
  insertName: string;
  cardNumber: string;
  parallelName: string;
  variationName: string;
  serialNumberedTo: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookieDesignation: boolean;
  conditionType: "raw" | "graded";
  gradingCompany: string;
  grade: string;
  quantity: number;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function slug(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getIdentityDiscoveryWorkbench() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: candidateData, error: candidateError } = await supabase
    .from("tcos_mi_identity_candidates")
    .select("*")
    .order("status", { ascending: true })
    .order("parse_confidence", { ascending: false })
    .order("unit_delivered_cost", { ascending: true })
    .limit(250);
  if (candidateError) throw new Error(candidateError.message);

  const subjectIds = Array.from(
    new Set((candidateData || []).map((row) => String(row.subject_id))),
  );
  const marketplaceIds = Array.from(
    new Set((candidateData || []).map((row) => String(row.marketplace_id))),
  );
  const [subjectResult, marketplaceResult] = await Promise.all([
    subjectIds.length
      ? supabase
          .from("tcos_mi_subjects")
          .select("id,name,sport_or_category,league_or_brand,team_or_affiliation,priority")
          .in("id", subjectIds)
      : Promise.resolve({ data: [], error: null }),
    marketplaceIds.length
      ? supabase
          .from("tcos_mi_marketplaces")
          .select("id,name,slug")
          .in("id", marketplaceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (subjectResult.error) throw new Error(subjectResult.error.message);
  if (marketplaceResult.error) throw new Error(marketplaceResult.error.message);
  const subjectById = new Map(
    (subjectResult.data || []).map((row) => [String(row.id), row]),
  );
  const marketplaceById = new Map(
    (marketplaceResult.data || []).map((row) => [String(row.id), row]),
  );

  const candidates = (candidateData || [])
    .map((row): IdentityCandidate | null => {
      const subject = subjectById.get(String(row.subject_id));
      const marketplace = marketplaceById.get(String(row.marketplace_id));
      if (!subject || !marketplace) return null;
      return {
        id: String(row.id),
        subject_id: String(row.subject_id),
        marketplace_id: String(row.marketplace_id),
        external_listing_id: row.external_listing_id
          ? String(row.external_listing_id)
          : null,
        direct_url: String(row.direct_url),
        original_title: String(row.original_title),
        description: row.description ? String(row.description) : null,
        image_urls: stringArray(row.image_urls),
        asking_price: numberValue(row.asking_price),
        shipping_price: numberValue(row.shipping_price),
        delivered_price: numberValue(row.delivered_price),
        quantity: Math.max(1, numberValue(row.quantity, 1)),
        unit_delivered_cost: numberValue(row.unit_delivered_cost),
        detected_year: row.detected_year ? String(row.detected_year) : null,
        detected_manufacturer: row.detected_manufacturer
          ? String(row.detected_manufacturer)
          : null,
        detected_brand: row.detected_brand ? String(row.detected_brand) : null,
        detected_product_line: row.detected_product_line
          ? String(row.detected_product_line)
          : null,
        detected_set_name: row.detected_set_name
          ? String(row.detected_set_name)
          : null,
        detected_card_number: row.detected_card_number
          ? String(row.detected_card_number)
          : null,
        detected_parallel_name: row.detected_parallel_name
          ? String(row.detected_parallel_name)
          : null,
        detected_insert_name: row.detected_insert_name
          ? String(row.detected_insert_name)
          : null,
        detected_variation_name: row.detected_variation_name
          ? String(row.detected_variation_name)
          : null,
        serial_numbered_to: nullableNumber(row.serial_numbered_to),
        autograph: Boolean(row.autograph),
        memorabilia: Boolean(row.memorabilia),
        rookie_designation: Boolean(row.rookie_designation),
        condition_type: String(row.condition_type || "raw"),
        grading_company: row.grading_company ? String(row.grading_company) : null,
        grade: row.grade ? String(row.grade) : null,
        licensed_scope: row.licensed_scope ? String(row.licensed_scope) : null,
        non_base_reasons: stringArray(row.non_base_reasons),
        parse_confidence: numberValue(row.parse_confidence),
        status: String(row.status),
        rejection_reason: row.rejection_reason ? String(row.rejection_reason) : null,
        first_seen_at: String(row.first_seen_at),
        last_seen_at: String(row.last_seen_at),
        metadata: recordValue(row.metadata),
        subject: {
          id: String(subject.id),
          name: String(subject.name),
          sport_or_category: subject.sport_or_category
            ? String(subject.sport_or_category)
            : null,
          league_or_brand: subject.league_or_brand
            ? String(subject.league_or_brand)
            : null,
          team_or_affiliation: subject.team_or_affiliation
            ? String(subject.team_or_affiliation)
            : null,
          priority: numberValue(subject.priority),
        },
        marketplace: {
          id: String(marketplace.id),
          name: String(marketplace.name),
          slug: String(marketplace.slug),
        },
      };
    })
    .filter((value): value is IdentityCandidate => Boolean(value));

  return {
    candidates,
    pending: candidates.filter((candidate) => candidate.status === "pending"),
    approved: candidates.filter((candidate) => candidate.status === "approved"),
    rejected: candidates.filter((candidate) => candidate.status === "rejected"),
    totals: {
      all: candidates.length,
      pending: candidates.filter((candidate) => candidate.status === "pending").length,
      approved: candidates.filter((candidate) => candidate.status === "approved").length,
      rejected: candidates.filter((candidate) => candidate.status === "rejected").length,
      underFive: candidates.filter(
        (candidate) =>
          candidate.status === "pending" && candidate.unit_delivered_cost <= 5,
      ).length,
    },
  };
}

export async function approveIdentityCandidate(input: CandidateApprovalInput) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: candidate, error: candidateError } = await supabase
    .from("tcos_mi_identity_candidates")
    .select("*")
    .eq("id", input.candidateId)
    .single();
  if (candidateError) throw new Error(candidateError.message);
  if (candidate.status === "approved") {
    return {
      identityId: String(candidate.approved_identity_id),
      listingId: candidate.approved_listing_id
        ? String(candidate.approved_listing_id)
        : null,
      alreadyApproved: true,
    };
  }

  const [{ data: subject, error: subjectError }, { data: marketplace, error: marketplaceError }] =
    await Promise.all([
      supabase
        .from("tcos_mi_subjects")
        .select("id,name,sport_or_category,league_or_brand")
        .eq("id", candidate.subject_id)
        .single(),
      supabase
        .from("tcos_mi_marketplaces")
        .select("id,slug")
        .eq("id", candidate.marketplace_id)
        .single(),
    ]);
  if (subjectError) throw new Error(subjectError.message);
  if (marketplaceError) throw new Error(marketplaceError.message);

  const seasonYear = input.seasonYear.trim();
  const manufacturer = input.manufacturer.trim();
  const brand = input.brand.trim() || manufacturer;
  const productLine = input.productLine.trim();
  const setName = input.setName.trim();
  const insertName = input.insertName.trim();
  const cardNumber = input.cardNumber.trim().toUpperCase();
  const parallelName = input.parallelName.trim() || "Base";
  const variationName = input.variationName.trim();
  const gradingCompany = input.gradingCompany.trim().toUpperCase();
  const grade = input.grade.trim();

  if (!seasonYear || !manufacturer || !productLine || !cardNumber) {
    throw new Error(
      "Year, manufacturer, product line, and exact card number are required before approval.",
    );
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Lot quantity must be a positive whole number.");
  }
  if (
    input.serialNumberedTo !== null &&
    (!Number.isInteger(input.serialNumberedTo) || input.serialNumberedTo <= 0)
  ) {
    throw new Error("Serial numbering must be a positive whole number.");
  }
  if (input.conditionType === "graded" && (!gradingCompany || !grade)) {
    throw new Error("Graded candidates require a grading company and grade.");
  }

  const nonBase = growthIdentityEligibility({
    parallel_name: parallelName,
    insert_name: insertName,
    variation_name: variationName,
    serial_numbered_to: input.serialNumberedTo,
    autograph: input.autograph,
    memorabilia: input.memorabilia,
  });
  if (!nonBase.eligible) {
    throw new Error("Base cards are blocked. Confirm a real parallel, insert, variation, numbering, autograph, or memorabilia signal.");
  }
  const professional = growthProfessionalCardEligibility({
    sportOrCategory: subject.sport_or_category,
    leagueOrBrand: subject.league_or_brand,
    manufacturer,
    brand,
    productLine,
    setName,
    displayName: String(candidate.original_title),
    listingTitle: String(candidate.original_title),
  });
  if (!professional.eligible) {
    throw new Error(professional.rejectionReasons.join(" "));
  }

  const conditionLabel =
    input.conditionType === "graded"
      ? `${gradingCompany} ${grade}`
      : "raw";
  const displayName = [
    seasonYear,
    manufacturer,
    productLine,
    setName && setName !== productLine ? setName : null,
    insertName || null,
    subject.name,
    `#${cardNumber}`,
    parallelName !== "Base" ? parallelName : null,
    variationName || null,
    input.serialNumberedTo ? `/${input.serialNumberedTo}` : null,
    input.autograph ? "Autograph" : null,
    input.memorabilia ? "Memorabilia" : null,
    conditionLabel,
  ]
    .filter(Boolean)
    .join(" — ");
  const identityKey = [
    "sports-card",
    subject.name,
    seasonYear,
    manufacturer,
    brand,
    productLine,
    setName,
    insertName,
    cardNumber,
    parallelName,
    variationName,
    input.serialNumberedTo ? String(input.serialNumberedTo) : "unnumbered",
    input.autograph ? "auto" : "no-auto",
    input.memorabilia ? "memorabilia" : "no-memorabilia",
    input.conditionType,
    gradingCompany,
    grade,
  ]
    .map(slug)
    .join("|");

  const { data: existingIdentity, error: identityLookupError } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id")
    .eq("identity_key", identityKey)
    .maybeSingle();
  if (identityLookupError) throw new Error(identityLookupError.message);
  let identityId = existingIdentity?.id as string | undefined;
  if (!identityId) {
    const { data: createdIdentity, error: identityCreateError } = await supabase
      .from("tcos_mi_collectible_identities")
      .insert({
        subject_id: subject.id,
        collectible_type: "sports_card",
        sport_or_category: subject.sport_or_category,
        season_year: seasonYear,
        manufacturer,
        brand,
        product_line: productLine,
        set_name: setName || null,
        insert_name: insertName || null,
        card_number: cardNumber,
        parallel_name: parallelName,
        variation_name: variationName || null,
        serial_numbered_to: input.serialNumberedTo,
        autograph: input.autograph,
        memorabilia: input.memorabilia,
        rookie_designation: input.rookieDesignation,
        condition_type: input.conditionType,
        grading_company:
          input.conditionType === "graded" ? gradingCompany : null,
        grade: input.conditionType === "graded" ? grade : null,
        identity_key: identityKey,
        display_name: displayName,
        identity_confidence: 100,
        active: true,
      })
      .select("id")
      .single();
    if (identityCreateError) throw new Error(identityCreateError.message);
    identityId = String(createdIdentity.id);
  }

  const ingest = await ingestMarketIntelListings([
    {
      marketplaceSlug: String(marketplace.slug),
      collectibleIdentityId: identityId,
      externalListingId: candidate.external_listing_id
        ? String(candidate.external_listing_id)
        : null,
      directUrl: String(candidate.direct_url),
      originalTitle: String(candidate.original_title),
      description: candidate.description ? String(candidate.description) : null,
      imageUrls: stringArray(candidate.image_urls),
      listingFormat: Array.isArray(candidate.metadata?.buying_options)
        ? (candidate.metadata.buying_options as string[]).includes("AUCTION")
          ? "auction"
          : (candidate.metadata.buying_options as string[]).includes("BEST_OFFER")
            ? "best_offer"
            : "fixed_price"
        : input.quantity > 1
          ? "lot"
          : "fixed_price",
      askingPrice: numberValue(candidate.asking_price),
      shippingPrice: numberValue(candidate.shipping_price),
      buyerFee: 0,
      currency: String(candidate.metadata?.currency || "USD"),
      quantity: input.quantity,
      sellerName: candidate.metadata?.seller_name
        ? String(candidate.metadata.seller_name)
        : null,
      sellerRating: nullableNumber(candidate.metadata?.seller_feedback_pct),
      sellerFeedbackCount: nullableNumber(candidate.metadata?.seller_feedback_count),
      listedAt: candidate.metadata?.listed_at
        ? String(candidate.metadata.listed_at)
        : null,
      lastSeenAt: String(candidate.last_seen_at),
      auctionEndAt: candidate.metadata?.auction_end_at
        ? String(candidate.metadata.auction_end_at)
        : null,
      identityMatchConfidence: 100,
      identityMatchMethod: "admin_approved_identity_discovery",
      metadata: {
        discovery_candidate_id: input.candidateId,
        discovery_parse_confidence: numberValue(candidate.parse_confidence),
        licensed_scope: professional.scope,
        non_base_reasons: nonBase.reasons,
      },
    },
  ]);
  const result = ingest.results[0];
  if (!result || result.status === "rejected" || result.status === "error") {
    throw new Error(result?.message || "The approved candidate could not be ingested.");
  }
  const listingId = result.listingId || null;
  const { error: candidateUpdateError } = await supabase
    .from("tcos_mi_identity_candidates")
    .update({
      status: "approved",
      approved_identity_id: identityId,
      approved_listing_id: listingId,
      rejection_reason: null,
      reviewed_at: new Date().toISOString(),
      quantity: input.quantity,
      detected_year: seasonYear,
      detected_manufacturer: manufacturer,
      detected_brand: brand,
      detected_product_line: productLine,
      detected_set_name: setName || null,
      detected_insert_name: insertName || null,
      detected_card_number: cardNumber,
      detected_parallel_name: parallelName,
      detected_variation_name: variationName || null,
      serial_numbered_to: input.serialNumberedTo,
      autograph: input.autograph,
      memorabilia: input.memorabilia,
      rookie_designation: input.rookieDesignation,
      condition_type: input.conditionType,
      grading_company:
        input.conditionType === "graded" ? gradingCompany : null,
      grade: input.conditionType === "graded" ? grade : null,
      licensed_scope: professional.scope,
      non_base_reasons: nonBase.reasons,
    })
    .eq("id", input.candidateId);
  if (candidateUpdateError) throw new Error(candidateUpdateError.message);

  return { identityId, listingId, alreadyApproved: false };
}

export async function rejectIdentityCandidate(candidateId: string, reason: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase
    .from("tcos_mi_identity_candidates")
    .update({
      status: "rejected",
      rejection_reason: reason.trim() || "Rejected during admin review.",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", candidateId);
  if (error) throw new Error(error.message);
}

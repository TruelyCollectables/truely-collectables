import "server-only";

import { ingestMarketIntelListings } from "./market-intel-ingestion";
import type { CandidateApprovalInput } from "./market-intel-identity-candidates";
import { createSupabaseServerClient } from "./supabase-server";

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
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "none"
  );
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export async function approvePurchaseInboxCandidate(input: CandidateApprovalInput) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: candidate, error: candidateError } = await supabase
    .from("tcos_mi_identity_candidates")
    .select("*")
    .eq("id", input.candidateId)
    .single();
  if (candidateError) throw new Error(candidateError.message);
  if (candidate.metadata?.purchase_inbox !== true) {
    throw new Error("This candidate is not a Purchase Inbox row.");
  }
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
      "Year, manufacturer, product line, and exact card number are required before recording this purchase.",
    );
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Purchase quantity must be a positive whole number.");
  }
  if (
    input.serialNumberedTo !== null &&
    (!Number.isInteger(input.serialNumberedTo) || input.serialNumberedTo <= 0)
  ) {
    throw new Error("Serial numbering must be a positive whole number.");
  }
  if (input.conditionType === "graded" && (!gradingCompany || !grade)) {
    throw new Error("Graded purchases require a grading company and grade.");
  }

  const conditionLabel =
    input.conditionType === "graded" ? `${gradingCompany} ${grade}` : "raw";
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

  const { data: identityRows, error: identityLookupError } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id")
    .eq("identity_key", identityKey)
    .limit(2);
  if (identityLookupError) throw new Error(identityLookupError.message);
  let identityId = identityRows?.[0]?.id as string | undefined;
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
      listingFormat: input.quantity > 1 ? "lot" : "fixed_price",
      askingPrice: numberValue(candidate.asking_price),
      shippingPrice: numberValue(candidate.shipping_price),
      buyerFee: numberValue(candidate.metadata?.actual_buyer_fees),
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
      auctionEndAt: null,
      identityMatchConfidence: 100,
      identityMatchMethod: "purchase_inbox_manual_approval",
      metadata: {
        discovery_candidate_id: input.candidateId,
        purchase_inbox_id: candidate.metadata?.purchase_inbox_id || null,
        portfolio_bucket: candidate.metadata?.portfolio_bucket || "resale",
        purchase_inbox: true,
      },
    },
  ]);
  const result = ingest.results[0];
  if (!result || result.status === "rejected" || result.status === "error") {
    throw new Error(result?.message || "The Purchase Inbox listing could not be ingested.");
  }
  const listingId = result.listingId || null;

  const reasons = [
    parallelName !== "Base" ? parallelName : null,
    insertName ? `Insert: ${insertName}` : null,
    variationName || null,
    input.serialNumberedTo ? `Numbered /${input.serialNumberedTo}` : null,
    input.autograph ? "Autograph" : null,
    input.memorabilia ? "Memorabilia" : null,
    parallelName === "Base" && !insertName && !variationName && !input.serialNumberedTo && !input.autograph && !input.memorabilia
      ? "User-entered base purchase"
      : null,
  ].filter((value): value is string => Boolean(value));

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
      licensed_scope: "purchase_inbox_manual_review",
      non_base_reasons: reasons,
    })
    .eq("id", input.candidateId);
  if (candidateUpdateError) throw new Error(candidateUpdateError.message);

  return { identityId, listingId, alreadyApproved: false };
}

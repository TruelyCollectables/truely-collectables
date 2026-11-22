import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/kingmaker-local-auth";
import {
  archiveInstaCompAiLocalSupervisedScan,
} from "../../../../lib/instacomp-ai-local";
import {
  createMacKingmakerDraft, findMacDuplicateByImagePair,
  getMacMasterListingRow, kingmakerScanImageUrl,
  listMacMasterListingRows, sha256File,
} from "../../../../lib/kingmaker-mac-scan-server";
import {
  buildDirectDescription, finalPublicationBlockers,
  formatDirectTitle, identitySufficient, sameCardVariant, normalizeDirectIdentity,
  type DirectCardIdentity,
} from "../../../../lib/obbfb-intake-rules";
import { identifyOBBFBVision } from "../../../../lib/obbfb-direct-vision";
import { researchOBBFBComps } from "../../../../lib/obbfb-market-comps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const maxDuration = 300;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
function validateImage(value: FormDataEntryValue | null, side: string): File {
  if (!(value instanceof File) || value.size < 1 || value.size > 12 * 1024 * 1024 || !ALLOWED_TYPES.has(value.type)) {
    throw new Error(`Valid JPEG/PNG/WebP ${side} image (12 MB maximum) required.`);
  }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function imagePairSignature(frontHash: string, backHash: string) {
  return createHash("sha256").update(`front:${frontHash}|back:${backHash}`).digest("hex");
}
function fromOldStoredIdentity(row: Record<string, unknown>): DirectCardIdentity | null {
  const metadata = record(row.metadata);
  const ai = record(record(metadata.instacomp).ai);
  const manual = record(record(metadata.instacomp).manualIdentity);
  const choice = Object.keys(manual).length ? manual : ai;
  if (!choice.year || !(choice.player || choice.playerName)) return null;
  const identity = normalizeDirectIdentity({
    year: choice.year, brandSet: choice.brandSet || choice.setName || choice.product,
    player: choice.player || choice.playerName, cardNumber: choice.cardNumber || choice.card_number,
    parallel: choice.parallel, subset: choice.subset,
    serialNumber: choice.serialNumber || choice.serial_number,
    isRookie: choice.isRookie || choice.rookie,
    isAutograph: choice.isAutograph || choice.isAuto,
    autographEvidence: choice.autographEvidence || (/(\bauto\b|autograph)/i.test(String(row.title || "")) ? "Auto in existing operator-reviewed title" : null),
    isRelic: choice.isRelic || choice.memorabilia,
    relicEvidence: choice.relicEvidence || (/(relic|patch|jersey)/i.test(String(row.title || "")) ? "Relic in existing operator-reviewed title" : null),
    confidence: 1,
  });
  return identity;
}
function isLiveItem(row: Record<string, unknown>) {
  const metadata = record(row.metadata);
  const dual = record(metadata.dual_marketplace);
  return row.status === "active" ||
    ["website", "ebay", "mercari", "both", "all3", "website_mercari", "ebay_mercari"].includes(String(row.folder || "")) ||
    ["website", "ebay", "mercari"].some(channel => {
      const value = record(dual[channel]);
      return ["active", "live", "linked"].includes(String(value.status || "").toLowerCase());
    });
}
function respond(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: NextRequest) {
  let archived: { scan_id: string; card_uuid: string; front_sha256: string; back_sha256: string; image_pair_sha256: string } | null = null;
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return respond({ success: false, code: "UNAUTHORIZED" }, 401);
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const form = await request.formData();
    const front = validateImage(form.get("front"), "front");
    const back = validateImage(form.get("back"), "back");
    const [frontSha, backSha] = await Promise.all([sha256File(front), sha256File(back)]);
    if (frontSha === backSha) return respond({ success: false, code: "FRONT_BACK_SAME_IMAGE" }, 409);
    const pairHash = imagePairSignature(frontSha, backSha);
    const duplicate = await findMacDuplicateByImagePair(pairHash, 10_000);
    if (duplicate) return respond({
      success: true, stage: "review_required", identityComplete: false,
      intakeEngine: "obbfb_direct_vision_v1",
      code: "DUPLICATE_SCAN", inventoryItemId: duplicate.inventoryItemId,
      title: duplicate.title, duplicate,
      reviewHref: "/kingmaker/need-to-merge",
      error: "The original physical image pair already exists in inventory; it was not overwritten.",
    }, 202);

    // Safe photo archiving only: this endpoint does NOT read checklist_registry.sqlite3,
    // invoke Ollama, issue model lessons, or publish. It creates durable scan photos.
    archived = await archiveInstaCompAiLocalSupervisedScan({ front, back, timeoutMs: 45_000 });
    // Archive UUIDs can be reused for the same physical image; never clobber a
    // prior seller-approved record if another request already stored it.
    const already = await getMacMasterListingRow(archived.card_uuid, 10_000);
    if (already) return respond({
      success: true, stage: "review_required", code: "DUPLICATE_SCAN",
      intakeEngine: "obbfb_direct_vision_v1",
      inventoryItemId: archived.card_uuid, title: already.title,
      error: "Existing inventory record found for the archived image pair. No mutation performed.",
    }, 202);

    let identity: DirectCardIdentity | null = null;
    let visionError: string | null = null;
    let model: string | null = null;
    try {
      const receipt = await identifyOBBFBVision(front, back);
      identity = receipt.identity; model = receipt.model;
    } catch (error) {
      visionError = error instanceof Error ? error.message.slice(0, 240) : "Direct vision unavailable.";
    }
    const identityComplete = Boolean(identity && identitySufficient(identity));
    const title = identity ? formatDirectTitle(identity) : "Unidentified card — seller vision review required";
    const description = identity ? buildDirectDescription(identity) : "Front/back images archived. Seller must identify and price this item before publishing.";
    const frontImageUrl = kingmakerScanImageUrl(archived.scan_id, "front");
    const backImageUrl = kingmakerScanImageUrl(archived.scan_id, "back");
    const blockers = identity ? finalPublicationBlockers(identity, title, description, frontImageUrl, backImageUrl) : ["visual_identity_review_required"];

    let market: Awaited<ReturnType<typeof researchOBBFBComps>> | null = null;
    if (identityComplete && identity) market = await researchOBBFBComps(identity, title);
    let matching: Record<string, unknown> | null = null;
    if (identityComplete && identity) {
      try {
        const rows = await listMacMasterListingRows({ compact: true, timeoutMs: 30_000 });
        matching = (rows as Array<Record<string, unknown>>).find(row => {
          if (!isLiveItem(row)) return false;
          const candidate = fromOldStoredIdentity(row);
          return candidate && sameCardVariant(identity!, candidate);
        }) || null;
      } catch { /* Non-blocking duplicate discovery; physical duplicate guard already ran. */ }
    }
    const needToMerge = Boolean(matching);
    // Never move an uncertain OBBFB card to the retired Pending Verification
    // bucket. It remains in Resale Pending until the seller explicitly acts.
    const queue = needToMerge ? "need_to_merge" : "pending_listings";
    const ai = identity ? {
      ...identity, setName: identity.brandSet, brand: identity.manufacturer,
      isAuto: identity.isAutograph, isRookie: identity.isRookie, isRelic: identity.isRelic,
    } : {};
    const metadata = {
      instacomp: {
        intakeEngine: "obbfb_direct_vision_v1", source: "obbfb_direct_vision_v1", model,
        scanId: archived.scan_id, cardUuid: archived.card_uuid,
        imagePairSha256: archived.image_pair_sha256 || pairHash,
        frontSha256: archived.front_sha256, backSha256: archived.back_sha256,
        frontImageUrl, backImageUrl, imagePersistenceVerified: true,
        imageOrientation: { status: "completed", source: "sharp_exif_normalized_multimodal_vision" },
        imageOrientationPersisted: true,
        ai, identityComplete, trustedForIdentity: identityComplete,
        humanVerified: false, manualIdentityLocked: false, sellerPriceOverride: false,
        manualListingTitleLocked: false,
        suggestedPrice: market?.suggestedPrice || null, medianComp: market?.medianComp || null,
        pricingStatus: market?.status || (identityComplete ? "0 Comps — Seller Price Required" : "identity_review_required"),
        soldCompEvidence: market?.accepted || [], rejectedSoldComps: market?.rejected || [],
        activeCompetition: market?.activeListings || [], providerCoverage: market?.providerCoverage || [],
        priceGuide: market?.priceGuide || null, pricingSource: market?.source || "unpriced",
        pricingCheckedAt: new Date().toISOString(),
        visualFailure: visionError,
        listingPublishBlocked: true, publicationStatus: "pending_operator_review",
        publishReadinessBlockers: [...blockers, "operator_review_required"],
        possibleDuplicatePhysicalPhotoId: matching?.inventoryItemId || matching?.id || null,
      },
      obbfbSellerAccountId: account.id,
      listingWorkflow: { queue, publishAllowed: false, mergeStatus: needToMerge ? "NEED_TO_MERGE" : null },
      merge: needToMerge ? {
        status: "NEED_TO_MERGE", existingInventoryItemId: matching?.inventoryItemId || matching?.id,
        existingTitle: matching?.title, reason: "Same variant already active; seller must confirm physical copy and stock.",
      } : null,
      seller_review: { identity_confirmed: false, price_confirmed: false },
      collectible_asset: { exact_serial_number: identity?.serialNumber || null, print_run: identity?.serialNumber?.split("/")[1] || null },
      inventory_lifecycle: { state: "received", disposition: "resale_pending", receivedAt: new Date().toISOString() },
    };
    const item = await createMacKingmakerDraft({
      inventoryItemId: archived.card_uuid, cardUuid: archived.card_uuid,
      sellerAccountId: account.id, seller_account_id: account.id, title,
      sku: `KM-${archived.card_uuid.slice(0,12).toUpperCase()}`,
      description, status: "draft", quantity: 1, price: market?.suggestedPrice || 0,
      player: identity?.player || null, category: "Trading Card Singles",
      imageUrl: frontImageUrl, folder: "pending", pendingQueue: needToMerge ? "need_to_merge" : "listings",
      metadata,
    });
    return respond({
      success: true, stage: needToMerge ? "need_to_merge" : identityComplete ? "complete" : "review_required",
      identityComplete, cardUuid: archived.card_uuid, inventoryItemId: item.inventoryItemId || archived.card_uuid,
      title, description, ai, code: needToMerge ? "NEED_TO_MERGE" : undefined,
      pricing: market ? { suggestedPrice: market.suggestedPrice, medianComp: market.medianComp, status: market.status, soldCompEvidence: market.accepted, providerCoverage: market.providerCoverage } : { suggestedPrice: null, status: identityComplete ? "0 Comps — Seller Price Required" : "identity_review_required" },
      pricingSucceeded: Boolean(market?.accepted.length),
      reviewHref: needToMerge ? "/kingmaker/need-to-merge" : "/kingmaker/listings?folder=pending",
      normalizedImages: { frontImageUrl, backImageUrl },
      exactMatch: matching ? { found: true, existingInventoryItemId: matching.inventoryItemId || matching.id, existingTitle: matching.title, isLive: true } : null,
      sourceOfTruth: "mac_local", intakeEngine: "obbfb_direct_vision_v1", published: false,
      error: visionError || undefined, requiresSellerReview: true,
    }, identityComplete ? 200 : 202);
  } catch (error) {
    return respond({
      success: false, code: archived ? "PHOTOS_ARCHIVED_INTAKE_INCOMPLETE" : "OBBFB_INTAKE_FAILED",
      photosArchived: Boolean(archived),
      scanId: archived?.scan_id || null,
      error: error instanceof Error ? error.message.slice(0, 250) : "Direct intake failed.",
    }, 503);
  }
}

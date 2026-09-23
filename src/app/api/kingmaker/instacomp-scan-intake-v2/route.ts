import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { ensureAccountStoreMembership, getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  findMacDuplicateByImagePair,
  refreshKingmakerMacMarketForScan,
  runKingmakerMacScan,
  sha256File,
} from "../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

// Receiving identity is authoritative on the Mac-local InstaComp pipeline.
// Do not reintroduce a Supabase-first placeholder scan before this handoff.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function validateFile(value: FormDataEntryValue | null, side: "front" | "back") {
  if (!(value instanceof File) || value.size <= 0) throw new Error(`${side} image is required.`);
  if (value.size > MAX_IMAGE_BYTES) throw new Error(`${side} image is larger than 12MB.`);
  const type = value.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) throw new Error(`${side} image must be JPEG, PNG, or WebP.`);
  return value;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const form = await request.formData();
    const forceFreshIdentity = form.get("forceFreshIdentity") === "true";
    const replaceManualIdentity = form.get("replaceManualIdentity") === "true";
    const front = validateFile(form.get("front"), "front");
    const back = validateFile(form.get("back"), "back");
    const [frontSha256, backSha256] = await Promise.all([sha256File(front), sha256File(back)]);
    if (frontSha256 === backSha256) {
      return NextResponse.json({ success: false, code: "FRONT_BACK_IMAGES_DUPLICATE", error: "Front and back photos must be different images." }, { status: 409 });
    }
    const imagePairSha256 = createHash("sha256").update(`${frontSha256}:${backSha256}`).digest("hex");
    const duplicate = await findMacDuplicateByImagePair(imagePairSha256);
    if (duplicate && !forceFreshIdentity) {
      return NextResponse.json({
        success: true, stage: "review_required", identityComplete: false,
        inventoryItemId: duplicate.inventoryItemId, title: duplicate.title,
        code: "DUPLICATE_SCAN", error: "This exact front/back image pair already exists in Mac-local KINGMAKER inventory.",
        duplicate: { inventoryItemId: duplicate.inventoryItemId, title: duplicate.title, status: duplicate.status, price: duplicate.price, quantity: duplicate.quantity, matchType: "exact_scan_pair" },
      }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    const result = await runKingmakerMacScan({
      front,
      back,
      imagePairSha256,
      inventoryItemId: forceFreshIdentity ? duplicate?.inventoryItemId || null : null,
      searchMarket: false,
      forceFreshIdentity,
      replaceManualIdentity,
    });

    // Mac-local remains the identity authority. The website stores only the
    // staging/listing row so a successful receive can never disappear from the
    // Pending UI while a later Mac inventory projection is slow or unavailable.
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const macMetadata = recordValue(result.inventoryItem.metadata);
    const macInstaComp = recordValue(macMetadata.instacomp);
    const scanId = textValue(result.scan.scan_id) || textValue(macInstaComp.scanId);
    const projectedQueue = result.identityComplete
      ? "pending_listings"
      : "pending_verification";
    const projectedSource = result.identityComplete
      ? "mac_local_registry_exact"
      : "mac_local_received_review";
    const metadata = {
      ...macMetadata,
      listingReviewRequired: !result.identityComplete,
      listingWorkflow: {
        ...recordValue(macMetadata.listingWorkflow),
        queue: projectedQueue,
        source: "kingmaker_scan_intake_v2_staging_mirror",
      },
      pending_verification: {
        ...recordValue(macMetadata.pending_verification),
        status: result.identityComplete ? "resolved" : "pending_verification",
        source: "kingmaker_scan_intake_v2_staging_mirror",
      },
      instacomp: {
        ...macInstaComp,
        source: projectedSource,
        scanId,
        frontImageUrl:
          textValue(macInstaComp.frontImageUrl) ||
          (scanId
            ? "/api/kingmaker/scan-image?scanId=" +
              encodeURIComponent(scanId) +
              "&side=front"
            : null),
        backImageUrl:
          textValue(macInstaComp.backImageUrl) ||
          (scanId
            ? "/api/kingmaker/scan-image?scanId=" +
              encodeURIComponent(scanId) +
              "&side=back"
            : null),
        hasBackImage: true,
        identityComplete: result.identityComplete,
        trustedForIdentity: result.identityComplete,
        lastStatus: result.identityComplete
          ? "identity_complete"
          : "review_required",
        lastStage: result.identityComplete
          ? "registry_exact"
          : "received_review",
        pricingStatus: result.identityComplete
          ? "identity_complete_pricing_pending"
          : "blocked_identity_review_required",
      },
    };
    const { error: stagingError } = await supabase
      .from("inventory_items")
      .upsert(
        {
          id: result.inventoryItem.inventoryItemId,
          store_id: storeId,
          seller_account_id: account.id,
          card_uuid: result.scan.card_uuid || null,
          sku: result.inventoryItem.sku || null,
          title: result.inventoryItem.title || "Mac-local received card",
          description: result.inventoryItem.description || null,
          category: result.inventoryItem.category || "Trading Card Singles",
          condition: result.inventoryItem.condition || "Near Mint or Better",
          status: "draft",
          quantity: Math.max(1, Number(result.inventoryItem.quantity || 1)),
          price: Math.max(0, Number(result.inventoryItem.price || 0)),
          metadata,
        },
        { onConflict: "id" },
      );
    if (stagingError) throw stagingError;

    if (result.identityComplete) {
      after(async () => {
        try {
          await refreshKingmakerMacMarketForScan(
            result.scan,
            result.inventoryItem.inventoryItemId,
          );
        } catch (error) {
          console.error("KINGMAKER background market refresh failed", error);
        }
      });
    }
    return NextResponse.json({
      success: true,
      stage: result.identityComplete ? "complete" : "review_required",
      identityComplete: result.identityComplete,
      cardUuid: result.scan.card_uuid || null,
      inventoryItemId: result.inventoryItem.inventoryItemId,
      title: result.inventoryItem.title,
      ai: result.ai,
      checklistDecision: result.inventoryItem.metadata?.instacomp && (result.inventoryItem.metadata.instacomp as Record<string, unknown>).checklistDecision || null,
      parallelDecision: result.inventoryItem.metadata?.instacomp && (result.inventoryItem.metadata.instacomp as Record<string, unknown>).parallelDecision || null,
      normalizedImages: {
        frontImageUrl: (result.inventoryItem.metadata?.instacomp as Record<string, unknown> | undefined)?.frontImageUrl || null,
        backImageUrl: (result.inventoryItem.metadata?.instacomp as Record<string, unknown> | undefined)?.backImageUrl || null,
      },
      pricing: result.identityComplete
        ? { status: "background_refresh_queued", suggestedPrice: null }
        : null,
      pricingSucceeded: false,
      pricingBackgroundQueued: result.identityComplete,
      imagesPreserved: true,
      sourceOfTruth: "mac_local",
      durationMs: Date.now() - startedAt,
    }, { status: result.identityComplete ? 201 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, code: "SCANNER_INTAKE_FAILED", error: error instanceof Error ? error.message : "Scanner intake failed.", durationMs: Date.now() - startedAt }, { status: 500 });
  }
}

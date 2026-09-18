import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import { instaCompPendingQueueFromMetadata } from "../../../../lib/instacomp-pending-queue";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { POST as runVerifiedPricing } from "../../account/seller/inventory/instacomp-verified/route";
import { POST as runExactFrontBack } from "../instacomp-front-back-exact/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function validateFile(value: FormDataEntryValue | null, side: "front" | "back") {
  if (!(value instanceof File) || value.size <= 0) {
    throw new Error(`${side} image is required.`);
  }
  if (value.size > MAX_IMAGE_BYTES) {
    throw new Error(`${side} image is larger than 12MB.`);
  }
  const type = value.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${side} image must be JPEG, PNG, or WebP.`);
  }
  return value;
}

async function digest(file: File) {
  return createHash("sha256")
    .update(Buffer.from(await file.arrayBuffer()))
    .digest("hex");
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  const next = String(value ?? "").trim();
  return next.length ? next : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function masterListingFolderFromMetadata(metadataValue: unknown) {
  const metadata = objectRecord(metadataValue);
  const lifecycle = objectRecord(metadata.inventory_lifecycle);
  if (
    text(lifecycle.disposition) === "investment_stash" ||
    text(lifecycle.state) === "investment_stash"
  ) {
    return "investment";
  }
  const dual = objectRecord(metadata.dual_marketplace);
  const website = objectRecord(dual.website);
  const ebay = objectRecord(dual.ebay);
  const mercari = objectRecord(dual.mercari);
  const websiteActive = text(website.status) === "active";
  const ebayActive = ["active", "linked"].includes(text(ebay.status) || "");
  const mercariActive = ["active", "linked", "live"].includes(
    text(mercari.status) || "",
  );
  if (websiteActive && ebayActive && mercariActive) return "all3";
  if (websiteActive && ebayActive) return "both";
  if (websiteActive && mercariActive) return "website_mercari";
  if (ebayActive && mercariActive) return "ebay_mercari";
  if (websiteActive) return "website";
  if (ebayActive) return "ebay";
  if (mercariActive) return "mercari";
  return "pending";
}

function masterListingReviewHref(inventoryItemId: string, metadata: unknown) {
  const queue = instaCompPendingQueueFromMetadata(metadata);
  const folder = queue === "verification" ? "pending" : masterListingFolderFromMetadata(metadata);
  const params = new URLSearchParams({ queue, folder, focus: inventoryItemId });
  return `/kingmaker/listings?${params.toString()}`;
}

function forwardedHeaders(request: NextRequest, contentType?: string) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let inventoryItemId: string | null = null;
  let seedTitle = "InstaComp scan pending";
  let resumedExisting = false;
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const form = await request.formData();
    const front = validateFile(form.get("front"), "front");
    const back = validateFile(form.get("back"), "back");
    const [frontSha256, backSha256] = await Promise.all([
      digest(front),
      digest(back),
    ]);
    if (frontSha256 === backSha256) {
      return NextResponse.json(
        {
          success: false,
          code: "FRONT_BACK_IMAGES_DUPLICATE",
          error: "Front and back photos must be different images.",
        },
        { status: 409 },
      );
    }
    const imagePairSha256 = createHash("sha256")
      .update(`${frontSha256}:${backSha256}`, "utf8")
      .digest("hex");

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: duplicateRows, error: duplicateError } = await supabase
      .from("inventory_items")
      .select("id,title,status,price,quantity,card_uuid,metadata")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .neq("status", "archived")
      .contains("metadata", { instacomp: { imagePairSha256 } })
      .limit(1);
    if (duplicateError) throw duplicateError;
    const duplicate = duplicateRows?.[0] || null;
    if (duplicate) {
      const metadata = objectRecord(duplicate.metadata);
      const acquisition = objectRecord(metadata.acquisition);
      const pendingImport = objectRecord(metadata.pendingImport);
      const instacomp = objectRecord(metadata.instacomp);
      const purchaseId =
        text(acquisition.purchaseId) ||
        text(acquisition.purchase_id) ||
        text(pendingImport.purchaseId) ||
        text(pendingImport.purchase_id);
      const duplicateCardUuid = text(duplicate.card_uuid) || text(instacomp.cardUuid);
      const duplicateSerialNumber =
        text(instacomp.serialNumber) ||
        text(metadata.serialNumber) ||
        text(metadata.serial_number);
      const lastStatus = text(instacomp.lastStatus);
      const hasPersistedImagePair =
        instacomp.imageOrientationPersisted === true &&
        instacomp.imagePersistenceVerified === true;
      const isRecoverableScannerStub =
        duplicate.status === "draft" &&
        text(instacomp.source) === "kingmaker_exact_scan_intake_v2" &&
        instacomp.identityComplete !== true &&
        !duplicateCardUuid &&
        (!hasPersistedImagePair ||
          lastStatus === "processing" ||
          lastStatus === "failed");

      if (isRecoverableScannerStub) {
        inventoryItemId = String(duplicate.id);
        seedTitle = text(duplicate.title) || seedTitle;
        resumedExisting = true;
        const resumedAt = new Date().toISOString();
        const { error: resumeError } = await supabase
          .from("inventory_items")
          .update({
            metadata: {
              ...metadata,
              inventory_lifecycle: {
                ...objectRecord(metadata.inventory_lifecycle),
                state: "received",
                disposition:
                  text(objectRecord(metadata.inventory_lifecycle).disposition) ||
                  "resale",
                receivedAt:
                  text(objectRecord(metadata.inventory_lifecycle).receivedAt) ||
                  resumedAt,
                receiptSource: "physical_front_back_scan",
                imagePairSha256,
              },
              instacomp: {
                ...instacomp,
                imagePairSha256,
                frontSha256,
                backSha256,
                hasBackImage: true,
                lastStatus: "processing",
                lastStage: "duplicate_scan_resume",
                lastError: null,
                lastErrorCode: null,
                resumedAt,
              },
            },
            updated_at: resumedAt,
          })
          .eq("id", inventoryItemId)
          .eq("store_id", storeId)
          .eq("seller_account_id", account.id)
          .eq("status", "draft");
        if (resumeError) throw resumeError;
      } else {
        return NextResponse.json(
          {
            success: true,
            stage: "review_required",
            identityComplete: instacomp.identityComplete === true,
            inventoryItemId: duplicate.id,
            title: duplicate.title,
            reviewHref: masterListingReviewHref(String(duplicate.id), metadata),
            code: duplicateCardUuid ? "DUPLICATE_PHYSICAL_CARD" : "DUPLICATE_SCAN",
            error: purchaseId
              ? duplicateCardUuid
                ? `This physical card is already in inventory as an existing copy. It appears to belong to Purchase ${purchaseId}.`
                : `This exact front/back image pair already exists in inventory. It appears to belong to Purchase ${purchaseId}.`
              : duplicateCardUuid
                ? "This physical card is already in inventory as an existing copy."
                : "This exact front/back image pair already exists in inventory.",
            duplicate: {
              inventoryItemId: duplicate.id,
              title: duplicate.title,
              status: duplicate.status,
              purchaseId,
              matchType: duplicateCardUuid ? "physical_card" : "exact_scan_pair",
              cardUuid: duplicateCardUuid,
              serialNumber: duplicateSerialNumber,
              serialRun: null,
              price: numberValue(duplicate.price),
              quantity: Number(duplicate.quantity || 0) || null,
              addCopyAllowed: true,
            },
          },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const now = new Date().toISOString();
    if (!inventoryItemId) {
      const { data: inserted, error: insertError } = await supabase
        .from("inventory_items")
        .insert({
          store_id: storeId,
          seller_account_id: account.id,
          title: seedTitle,
          description:
            "Front and back are preserved. Automatic orientation and exact checklist identity review are in progress.",
          category: "Trading Card Singles",
          condition: "Ungraded",
          status: "draft",
          quantity: 1,
          price: 0,
          metadata: {
            inventory_lifecycle: {
              state: "received",
              disposition: "resale",
              receivedAt: now,
              receiptSource: "physical_front_back_scan",
              imagePairSha256,
            },
            instacomp: {
              source: "kingmaker_exact_scan_intake_v2",
              imagePairSha256,
              frontSha256,
              backSha256,
              hasBackImage: true,
              identityComplete: false,
              identityRefreshRequired: true,
              pricingStatus: "blocked_identity_scan_in_progress",
              pricingReason:
                "Exact identity must be resolved before pricing.",
              lastStatus: "processing",
              lastStage: "orientation",
              lastError: null,
              lastErrorCode: null,
              createdAt: now,
            },
            seller_review: { identity_confirmed: false },
          },
        })
        .select("id,title")
        .single();
      if (insertError) throw insertError;
      inventoryItemId = String(inserted.id);
      seedTitle = text(inserted.title) || seedTitle;
    }
    if (!inventoryItemId) throw new Error("Scanner intake did not create or recover an inventory item.");

    const exactForm = new FormData();
    exactForm.set("inventoryItemId", inventoryItemId);
    exactForm.set("frontImage", front);
    exactForm.set("backImage", back);
    exactForm.set("replaceManualIdentity", "true");
    exactForm.set("aiCouncilTier", "adaptive");
    const exactRequest = new NextRequest(
      new URL("/api/kingmaker/instacomp-front-back-exact", request.url),
      {
        method: "POST",
        headers: forwardedHeaders(request),
        body: exactForm,
      },
    );
    const exactResponse = await runExactFrontBack(exactRequest);
    const exactPayload = await exactResponse.json().catch(() => ({}));

    const { data: updatedItem } = await supabase
      .from("inventory_items")
      .select("title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .maybeSingle();
    const title = String(updatedItem?.title || seedTitle);
    const identityComplete = exactPayload?.identityComplete === true;
    const reviewHref = masterListingReviewHref(
      inventoryItemId,
      updatedItem?.metadata || {},
    );

    if (!exactResponse.ok || exactPayload?.success !== true) {
      return NextResponse.json(
        {
          success: true,
          stage: "review_required",
          identityComplete: false,
          inventoryItemId,
          title,
          reviewHref,
          resumedExisting,
          code: exactPayload?.code || `HTTP_${exactResponse.status}`,
          error:
            exactPayload?.error ||
            "The card was saved, but exact identity needs review.",
          imagesPreserved: true,
          pricingSucceeded: false,
          durationMs: Date.now() - startedAt,
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!identityComplete) {
      return NextResponse.json(
        {
          success: true,
          stage: exactPayload?.stage || "parallel_review",
          identityComplete: false,
          inventoryItemId,
          title,
          reviewHref,
          resumedExisting,
          ai: exactPayload?.ai || null,
          checklistDecision: exactPayload?.checklistDecision || null,
          parallelDecision: exactPayload?.parallelDecision || null,
          normalizedImages: exactPayload?.normalizedImages || null,
          pricingSucceeded: false,
          imagesPreserved: true,
          durationMs: Date.now() - startedAt,
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }

    const requestId = `scan-${inventoryItemId}`;
    const pricingRequest = new NextRequest(
      new URL(
        "/api/account/seller/inventory/instacomp-verified",
        request.url,
      ),
      {
        method: "POST",
        headers: forwardedHeaders(request, "application/json"),
        body: JSON.stringify({
          inventoryItemId,
          aiCouncilTier: "adaptive",
          requestId,
        }),
      },
    );
    const pricingResponse = await runVerifiedPricing(pricingRequest);
    const pricing = await pricingResponse.json().catch(() => ({}));

    return NextResponse.json(
      {
        success: true,
        stage: "complete",
        identityComplete: true,
        inventoryItemId,
        title,
        reviewHref,
        resumedExisting,
        ai: exactPayload?.ai || null,
        checklistDecision: exactPayload?.checklistDecision || null,
        parallelDecision: exactPayload?.parallelDecision || null,
        normalizedImages: exactPayload?.normalizedImages || null,
        pricing,
        pricingSucceeded: pricingResponse.ok,
        imagesPreserved: true,
        durationMs: Date.now() - startedAt,
      },
      {
        status: pricingResponse.ok ? 201 : 207,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const failure =
      error instanceof Error ? error.message : "Scanner intake failed.";
    if (inventoryItemId) {
      return NextResponse.json(
        {
          success: true,
          stage: "review_required",
          identityComplete: false,
          inventoryItemId,
          reviewHref: `/kingmaker/listings?queue=verification&folder=pending&focus=${encodeURIComponent(inventoryItemId)}`,
          resumedExisting,
          error: failure,
          code: "SCANNER_INTAKE_REVIEW_REQUIRED",
          imagesPreserved: true,
          pricingSucceeded: false,
          durationMs: Date.now() - startedAt,
        },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        success: false,
        code: "SCANNER_INTAKE_FAILED",
        error: failure,
        durationMs: Date.now() - startedAt,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

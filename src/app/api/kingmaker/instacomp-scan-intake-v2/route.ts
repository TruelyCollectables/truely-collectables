import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import type { InstaCompOrientationDecision } from "../../../../lib/instacomp-image-orientation";
import { persistNormalizedInstaCompImagePair } from "../../../../lib/instacomp-normalized-image-storage";
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

function forwardedHeaders(request: NextRequest, contentType?: string) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

const PROVISIONAL_ORIENTATION: InstaCompOrientationDecision = {
  status: "not_configured",
  model: null,
  frontRotation: 0,
  backRotation: 0,
  frontConfidence: 0,
  backConfidence: 0,
  frontEvidenceText: [],
  backEvidenceText: [],
  backStandalonePrizm: null,
  backDesignationConfidence: 0,
  reason:
    "Original front and back were preserved before the exact automatic orientation and identity pass.",
};

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let inventoryItemId: string | null = null;
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
      .select("id,title,status")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .contains("metadata", { instacomp: { imagePairSha256 } })
      .limit(1);
    if (duplicateError) throw duplicateError;
    const duplicate = duplicateRows?.[0] || null;
    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          code: "DUPLICATE_SCAN",
          error: "This exact front/back image pair already exists in inventory.",
          duplicate: {
            inventoryItemId: duplicate.id,
            title: duplicate.title,
            status: duplicate.status,
          },
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from("inventory_items")
      .insert({
        store_id: storeId,
        seller_account_id: account.id,
        title: "InstaComp scan pending",
        description:
          "Front and back are preserved. Automatic orientation and exact checklist identity review are in progress.",
        category: "Trading Card Singles",
        condition: "Ungraded",
        status: "draft",
        quantity: 1,
        price: 0,
        metadata: {
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

    await persistNormalizedInstaCompImagePair({
      supabase,
      storeId,
      inventoryItemId,
      title: inserted.title,
      frontFile: front,
      backFile: back,
      orientation: PROVISIONAL_ORIENTATION,
    });

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
    const title = String(updatedItem?.title || inserted.title);
    const identityComplete = exactPayload?.identityComplete === true;

    if (!exactResponse.ok || exactPayload?.success !== true) {
      return NextResponse.json(
        {
          success: true,
          stage: "review_required",
          identityComplete: false,
          inventoryItemId,
          title,
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

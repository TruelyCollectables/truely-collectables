import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
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
      return NextResponse.json(
        {
          success: true,
          stage: "review_required",
          identityComplete: false,
          inventoryItemId: duplicate.id,
          title: duplicate.title,
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

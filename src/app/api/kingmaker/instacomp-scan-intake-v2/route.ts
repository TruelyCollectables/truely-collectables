import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { ensureAccountStoreMembership, getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
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

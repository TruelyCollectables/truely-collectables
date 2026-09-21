import { NextRequest, NextResponse } from "next/server";
import { ensureAccountStoreMembership, getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import { fetchInstaCompAiLocalScanImage } from "../../../../lib/instacomp-ai-local";
import { getMacKingmakerInventoryItem, runKingmakerMacScan } from "../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
function validFile(value: unknown, side: "front" | "back") {
  if (!(value instanceof File) || value.size <= 0) return null;
  if (value.size > MAX_IMAGE_BYTES) throw new Error(`${side} image is larger than 12MB.`);
  if (!ALLOWED_TYPES.has(value.type.split(";")[0].trim().toLowerCase())) throw new Error(`${side} image must be JPEG, PNG, or WebP.`);
  return value;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const isOwner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(String(account.email || "").toLowerCase());
    if (!isOwner) return NextResponse.json({ success: false, error: "KINGMAKER exact scan is owner-only." }, { status: 403 });
    const multipart = request.headers.get("content-type")?.includes("multipart/form-data") === true;
    const body = multipart ? await request.formData() : await request.json().catch(() => ({}));
    const value = (key: string) => multipart ? (body as FormData).get(key) : (body as Record<string, unknown>)[key];
    const inventoryItemId = String(value("inventoryItemId") || "").trim();
    if (!inventoryItemId) return NextResponse.json({ success: false, error: "Choose a card to scan." }, { status: 400 });
    const item = await getMacKingmakerInventoryItem(inventoryItemId);
    if (!item) return NextResponse.json({ success: false, error: "The selected Mac-local KINGMAKER draft was not found." }, { status: 404 });
    const instacomp = record(item.metadata?.instacomp);
    if (instacomp.manualIdentityLocked === true && value("replaceManualIdentity") !== true && value("replaceManualIdentity") !== "true") {
      return NextResponse.json({ success: true, identityComplete: instacomp.identityComplete === true, title: item.title, stage: "manual_lock", locked: true });
    }
    let front = validFile(value("frontImage"), "front");
    let back = validFile(value("backImage"), "back");
    if (!front || !back) {
      const scanId = String(instacomp.scanId || "").trim();
      if (!scanId) return NextResponse.json({ success: false, code: "INVALID_STORED_PAIR", error: "No Mac-local scan archive is available for this draft." }, { status: 409 });
      [front, back] = await Promise.all([
        fetchInstaCompAiLocalScanImage({ scanId, side: "front" }),
        fetchInstaCompAiLocalScanImage({ scanId, side: "back" }),
      ]);
    }
    const result = await runKingmakerMacScan({ front, back, inventoryItemId, searchMarket: false });
    const nextInstaComp = record(result.inventoryItem.metadata?.instacomp);
    return NextResponse.json({
      success: true, stage: result.identityComplete ? "complete" : "review_required", identityComplete: result.identityComplete,
      scanId: result.scan.scan_id, cardUuid: result.scan.card_uuid || null, title: result.inventoryItem.title, ai: result.ai,
      checklistDecision: nextInstaComp.checklistDecision || null, parallelDecision: nextInstaComp.parallelDecision || null,
      imageOrientation: nextInstaComp.imageOrientation || null,
      normalizedImages: { frontImageUrl: nextInstaComp.frontImageUrl || null, backImageUrl: nextInstaComp.backImageUrl || null },
      pricing: result.pricing, pricingSucceeded: Boolean(result.pricing?.suggestedPrice), nothingPublished: true, sourceOfTruth: "mac_local",
    }, { status: result.identityComplete ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, code: "INSTACOMP_MAC_SCAN_FAILED", error: error instanceof Error ? error.message : "Mac-local exact scan failed." }, { status: 500 });
  }
}

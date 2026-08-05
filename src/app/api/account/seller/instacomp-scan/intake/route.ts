import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { analyzeWithInstaCompAiLocal } from "../../../../../../../lib/instacomp-ai-local";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";
import { POST as runVerifiedPricing } from "../../inventory/instacomp-verified/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function text(value: unknown, max = 240) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function lockedIdentity(scan: Awaited<ReturnType<typeof analyzeWithInstaCompAiLocal>>) {
  const identity = scan.trusted_identity;
  return identity && typeof identity === "object" && !Array.isArray(identity)
    ? (identity as Record<string, unknown>)
    : null;
}

function receiptValue(scan: Awaited<ReturnType<typeof analyzeWithInstaCompAiLocal>>, prefix: string) {
  return scan.checklist?.source_receipts?.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function canonicalFields(identity: Record<string, unknown>) {
  return {
    sport: text(identity.sport, 80),
    league: text(identity.league, 80),
    year: text(identity.year, 20),
    manufacturer: text(identity.manufacturer || identity.brand, 100),
    brand: text(identity.brand, 100),
    setName: text(identity.set_name, 160),
    player: text(identity.player, 180),
    team: text(identity.team, 160),
    cardNumber: text(identity.card_number, 80),
    parallel: text(identity.parallel, 160),
    variation: text(identity.variation, 160),
    serialNumber: text(identity.serial_number, 80),
    serialRun: typeof identity.serial_run === "number" ? identity.serial_run : null,
    isAuto: identity.autograph === true,
    isRelic: identity.memorabilia === true,
  };
}

function titleFor(fields: ReturnType<typeof canonicalFields>) {
  return [
    fields.year,
    fields.manufacturer,
    fields.setName,
    fields.player,
    fields.cardNumber ? `#${fields.cardNumber}` : null,
    fields.parallel,
    fields.isAuto ? "Auto" : null,
    fields.isRelic ? "Relic" : null,
  ].filter(Boolean).join(" ");
}

function forwardedHeaders(request: NextRequest, requestId: string) {
  const headers = new Headers({ "content-type": "application/json", "x-instacomp-request-id": requestId });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof Blob)) {
      return NextResponse.json({ success: false, code: "FRONT_IMAGE_REQUIRED", error: "Front image is required." }, { status: 400 });
    }

    const scan = await analyzeWithInstaCompAiLocal({ front, back: back instanceof Blob && back.size > 0 ? back : null });
    const identity = lockedIdentity(scan);
    const registryIdentityId = scan.checklist?.identity_id || receiptValue(scan, "registry_identity:");
    const registryFingerprint = receiptValue(scan, "registry_fingerprint:");

    if (!scan.pricing_allowed || !identity || !registryIdentityId || !registryFingerprint) {
      return NextResponse.json({
        success: false,
        code: "CHECKLIST_IDENTITY_REQUIRED",
        error: scan.next_action || "Checklist Registry review is required before pricing.",
        scan,
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const fields = canonicalFields(identity);
    if (!fields.year || !fields.manufacturer || !fields.cardNumber || !fields.player) {
      return NextResponse.json({ success: false, code: "INCOMPLETE_REGISTRY_RECEIPT", error: "Registry receipt is missing canonical publish fields.", scan }, { status: 409 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const imagePairSha256 = text(scan.image_pair_sha256, 128);
    const { data: existingRows, error: duplicateError } = await supabase
      .from("inventory_items")
      .select("id,title,status,metadata")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .contains("metadata", { instacomp: { imagePairSha256 } })
      .limit(1);
    if (duplicateError) throw duplicateError;
    const duplicate = existingRows?.[0] || null;
    if (duplicate) {
      return NextResponse.json({
        success: false,
        code: "DUPLICATE_SCAN",
        error: "This exact front/back image pair already exists in inventory.",
        duplicate: { inventoryItemId: duplicate.id, title: duplicate.title, status: duplicate.status },
        scan,
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const checkedAt = new Date().toISOString();
    const title = titleFor(fields) || `InstaComp scan ${scan.scan_id}`;
    const metadata = {
      instacomp: {
        source: "mac_registry_scanner",
        scanId: scan.scan_id,
        imagePairSha256,
        frontSha256: scan.front_sha256,
        backSha256: scan.back_sha256 || null,
        hasBackImage: Boolean(scan.back_sha256),
        humanVerified: false,
        pricingStatus: "not_run",
        scanReceipt: scan,
        checklistIdentity: {
          status: "identified",
          source: "checklist_registry",
          registryIdentityId,
          registryFingerprintSha256: registryFingerprint,
          checkedAt,
          reasons: scan.checklist?.reasons || [],
          lockedFields: fields,
        },
      },
      collectible_asset: {
        exact_serial_number: fields.serialNumber,
        serial_run: fields.serialRun,
      },
      seller_review: { identity_confirmed: false },
    };

    const { data: inserted, error: insertError } = await supabase
      .from("inventory_items")
      .insert({
        store_id: storeId,
        seller_account_id: account.id,
        title,
        description: "Registry-locked InstaComp scan. Review before publishing.",
        category: "Trading Card Singles",
        condition: "Ungraded",
        status: "draft",
        quantity: 1,
        price: 0,
        metadata,
      })
      .select("id,title,status,price,metadata")
      .single();
    if (insertError) throw insertError;

    const requestId = `scan-${scan.scan_id}`;
    const pricingRequest = new NextRequest(new URL("/api/account/seller/inventory/instacomp-verified", request.url), {
      method: "POST",
      headers: forwardedHeaders(request, requestId),
      body: JSON.stringify({ inventoryItemId: inserted.id, aiCouncilTier: "adaptive", requestId }),
    });
    const pricingResponse = await runVerifiedPricing(pricingRequest);
    const pricing = await pricingResponse.json().catch(() => ({}));

    return NextResponse.json({
      success: true,
      inventoryItemId: inserted.id,
      title: inserted.title,
      scan,
      pricing,
      pricingSucceeded: pricingResponse.ok,
      durationMs: Date.now() - startedAt,
    }, { status: pricingResponse.ok ? 201 : 207, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      code: "SCANNER_INTAKE_FAILED",
      error: error instanceof Error ? error.message : "Scanner intake failed.",
      durationMs: Date.now() - startedAt,
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

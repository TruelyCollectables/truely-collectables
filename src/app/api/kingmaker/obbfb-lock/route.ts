import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership, getAuthenticatedAccountFromRequest,
} from "../../../../lib/kingmaker-local-auth";
import {
  getMacMasterListingRow, updateMacKingmakerDraft,
} from "../../../../lib/kingmaker-mac-scan-server";
import {
  normalizeDirectIdentity, finalPublicationBlockers, identitySufficient, isValidOBBFBSellerPrice, isOBBFBClearanceDraft, sameCardVariant, select365DayComps,
  type VerifiedSale,
} from "../../../../lib/obbfb-intake-rules";

import { researchOBBFBComps } from "../../../../lib/obbfb-market-comps";

export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const payload = await request.json().catch(() => null);
    const body = record(payload);
    if (body.confirmed !== true) return NextResponse.json({ error: "Explicit seller verification required." }, { status: 400 });
    const inventoryItemId = String(body.inventoryItemId || "");
    if (!/^[0-9a-f-]{36}$/i.test(inventoryItemId)) {
      return NextResponse.json({ error: "Invalid card ID." }, { status: 400 });
    }
    const existing = await getMacMasterListingRow(inventoryItemId, 15_000);
    if (!existing || existing.status !== "draft") {
      return NextResponse.json({ error: "OBBFB draft not found or not editable." }, { status: 409 });
    }
    const metadata = record(existing.metadata);
    const draftSellerAccountId = String(metadata.obbfbSellerAccountId || "").trim();
    if (!draftSellerAccountId || draftSellerAccountId !== account.id) {
      return NextResponse.json({ error: "OBBFB draft not found or seller mismatch." }, { status: 404 });
    }
    const instacomp = record(metadata.instacomp);
    if (instacomp.intakeEngine !== "obbfb_direct_vision_v1") {
      return NextResponse.json({ error: "This card is not in OBBFB intake." }, { status: 409 });
    }
    const clearance = body.mode === "bulk_clearance";
    if (clearance && (!isOBBFBClearanceDraft(existing.price, existing.status, instacomp) ||
      record(metadata.seller_review).price_confirmed || record(metadata.seller_review).identity_confirmed)) {
      return NextResponse.json({ error: "This card is no longer an unlocked $0 pricing draft." }, { status: 409 });
    }
    const identity = normalizeDirectIdentity(record(clearance ? instacomp.ai : body.identity));
    const title = String((clearance ? existing.title : body.title) || "").trim();
    const description = String((clearance ? existing.description : body.description) || "").trim();
    const price = Number(body.price);
    if (!identity.parallel || !identitySufficient({ ...identity, confidence: 1 })) {
      return NextResponse.json({ error: "Verify year, brand/set, player and card number before locking." }, { status: 400 });
    }
    if (!isValidOBBFBSellerPrice(price)) {
      return NextResponse.json({ error: "Enter a positive dollar amount with no more than two decimals." }, { status: 400 });
    }
    const blockers = finalPublicationBlockers(
      { ...identity, confidence: 1 }, title, description,
      String(instacomp.frontImageUrl || ""), String(instacomp.backImageUrl || ""),
    );
    if (blockers.length || !title || title.length >= 80 || /\b(?:Base Set|Base)\b/i.test(title)) {
      return NextResponse.json({ error: "Title, full serial description or front/back verification failed.", blockers }, { status: 409 });
    }
    if (identity.serialNumber && !title.includes(`/${Number(identity.serialNumber.split("/")[1])}`)) {
      return NextResponse.json({ error: "Title must include the print-run denominator (e.g., /99), not the copy number." }, { status: 409 });
    }
    if (record(metadata.merge).status === "NEED_TO_MERGE") {
      return NextResponse.json({ error: "Resolve NEED TO MERGE before price/identity locking." }, { status: 409 });
    }
    const previousIdentity = normalizeDirectIdentity(record(instacomp.ai));
    const storedEvidence = Array.isArray(instacomp.soldCompEvidence) ? instacomp.soldCompEvidence as VerifiedSale[] : [];
    const validStored = sameCardVariant(previousIdentity, identity) && previousIdentity.serialNumber === identity.serialNumber
      && instacomp.pricingStatus === "comped" && storedEvidence.length > 0
      ? select365DayComps(storedEvidence, identity) : null;
    if (clearance && (validStored?.status !== "comped" || validStored.suggestedPrice !== 0)) {
      return NextResponse.json({ error: "Current exact sold comps no longer qualify for under-$2 pricing." }, { status: 422 });
    }
    const comps = validStored?.status === "comped" ? validStored : await researchOBBFBComps(identity, title);
    if (comps.status !== "comped" || !comps.accepted.length) {
      return NextResponse.json({ error: "Verified sold comps for this exact identity are required before saving and locking the card." }, { status: 422 });
    }
    const now = new Date().toISOString();
    const verifiedIdentity = { ...identity, confidence: 1 };
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instacomp, ai: {
          ...verifiedIdentity, setName: verifiedIdentity.brandSet, brand: verifiedIdentity.manufacturer,
          isAuto: verifiedIdentity.isAutograph, isRelic: verifiedIdentity.isRelic,
          isRookie: verifiedIdentity.isRookie,
        },
        manualIdentity: verifiedIdentity, manualIdentityLocked: true,
        sellerPriceOverride: true, humanVerified: true, trustedForIdentity: true,
        manualListingTitleLocked: true, manualListingTitle: title,
        listingPrice: price, suggestedPrice: comps.suggestedPrice, medianComp: comps.medianComp,
        soldCompEvidence: comps.accepted, rejectedSoldComps: comps.rejected, pricingStatus: comps.status,
        pricingCheckedAt: now,
        listingPriceSource: "seller_operator_locked",
        sellerPriceLockedAt: now, manualIdentityLockedAt: now,
        listingPublishBlocked: true, publicationStatus: "operator_locked_not_published",
        publishReadinessBlockers: ["explicit_publish_action_still_required"],
      },
      seller_review: {
        ...record(metadata.seller_review), identity_confirmed: true, price_confirmed: true,
        verifiedAt: now, verifiedBy: account.id,
      },
      collectible_asset: {
        ...record(metadata.collectible_asset),
        exact_serial_number: identity.serialNumber,
        print_run: identity.serialNumber?.split("/")[1] || null,
      },
      listingWorkflow: { ...record(metadata.listingWorkflow), queue: "pending_listings", publishAllowed: false },
    };
    const item = await updateMacKingmakerDraft(inventoryItemId, {
      title, description, price, metadata: nextMetadata, status: "draft",
      obbfbOperatorSave: !clearance,
    });
    if (!item) throw new Error("Mac-local OBBFB save returned no record.");
    return NextResponse.json({
      success: true, inventoryItemId, price, title, description, locked: true,
      manualIdentityLocked: true, sellerPriceOverride: true,
      humanVerified: true, manualListingTitleLocked: true,
      published: false, folder: "pending", pendingQueue: "listings",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 250) : "Seller lock failed." }, { status: 500 });
  }
}

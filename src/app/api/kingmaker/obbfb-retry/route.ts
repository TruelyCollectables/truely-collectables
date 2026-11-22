import { NextRequest, NextResponse } from "next/server";
import { ensureAccountStoreMembership, getAuthenticatedAccountFromRequest } from "../../../../lib/kingmaker-local-auth";
import { getMacMasterListingRow, updateMacKingmakerDraft } from "../../../../lib/kingmaker-mac-scan-server";
import { fetchInstaCompAiLocalScanImage } from "../../../../lib/instacomp-ai-local";
import { identifyOBBFBVision } from "../../../../lib/obbfb-direct-vision";
import { buildDirectDescription, formatDirectTitle, identitySufficient, finalPublicationBlockers } from "../../../../lib/obbfb-intake-rules";
import { researchOBBFBComps } from "../../../../lib/obbfb-market-comps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type J = Record<string, unknown>;
const rec = (v: unknown): J => v && typeof v === "object" && !Array.isArray(v) ? v as J : {};
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return fail("Sign in to Kingmaker before retrying vision.", 401);
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const body = rec(await request.json().catch(() => null));
    const id = String(body.inventoryItemId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Invalid card ID.", 400);
    const current = await getMacMasterListingRow(id, 15_000);
    if (!current) return fail("Archived card not found.", 404);
    const metadata = rec(current.metadata);
    const insta = rec(metadata.instacomp);
    // Do not modify anyone else's card or an existing verified/locked listing.
    if (String(metadata.obbfbSellerAccountId || "") !== account.id) return fail("Archived card not found.", 404);
    if (insta.intakeEngine !== "obbfb_direct_vision_v1" || current.status !== "draft") return fail("Only unpublished OBBFB drafts can retry.", 409);
    if (insta.humanVerified === true || insta.manualIdentityLocked === true || insta.sellerPriceOverride === true)
      return fail("Seller-locked cards cannot be reprocessed.", 409);
    if (rec(metadata.merge).status === "NEED_TO_MERGE") return fail("Resolve NEED TO MERGE first.", 409);
    const scanId = String(insta.scanId || "");
    if (!/^[0-9a-f-]{36}$/i.test(scanId)) return fail("Archived photo pair is missing.", 409);
    const [front, back] = await Promise.all([
      fetchInstaCompAiLocalScanImage({ scanId, side: "front", timeoutMs: 20_000 }),
      fetchInstaCompAiLocalScanImage({ scanId, side: "back", timeoutMs: 20_000 }),
    ]);
    let vision;
    try { vision = await identifyOBBFBVision(front, back); }
    catch (error) { return fail(error instanceof Error ? error.message.slice(0, 240) : "Vision providers unavailable.", 503); }
    const identity = vision.identity;
    const complete = identitySufficient(identity);
    const title = formatDirectTitle(identity) || "Unidentified card — seller review required";
    const description = buildDirectDescription(identity);
    let comps: Awaited<ReturnType<typeof researchOBBFBComps>> | null = null;
    let marketFailure: string | null = null;
    if (complete) {
      try { comps = await researchOBBFBComps(identity, title); }
      catch (error) { marketFailure = error instanceof Error ? error.message.slice(0, 120) : "Market source unavailable"; }
    }
    const blockers = finalPublicationBlockers(identity, title, description, String(insta.frontImageUrl || ""), String(insta.backImageUrl || ""));
    if (!complete || blockers.length || comps?.status !== "comped" || !comps.accepted.length) {
      return fail(!complete || blockers.length
        ? "The saved photos could not establish the exact card identity. The draft was left untouched."
        : "Verified sold comps were unavailable. The draft was left untouched.", 422);
    }
    const updated = {
      ...metadata,
      instacomp: {
        ...insta,
        model: vision.model,
        ai: { ...identity, setName: identity.brandSet, brand: identity.manufacturer,
          isAuto: identity.isAutograph, isRelic: identity.isRelic, isRookie: identity.isRookie },
        identityComplete: complete, trustedForIdentity: complete, visualFailure: null,
        pricingStatus: comps?.status || (complete ? "0 Comps — Seller Price Required" : "identity_review_required"),
        suggestedPrice: comps?.suggestedPrice ?? null, medianComp: comps?.medianComp ?? null,
        soldCompEvidence: comps?.accepted || [], rejectedSoldComps: comps?.rejected || [],
        providerCoverage: comps?.providerCoverage || [], activeCompetition: comps?.activeListings || [],
        priceGuide: comps?.priceGuide || null, pricingSource: comps?.source || "unpriced",
        pricingCheckedAt: new Date().toISOString(), marketFailure,
        publishReadinessBlockers: [...blockers, "operator_review_required", "explicit_publish_action_required"],
        listingPublishBlocked: true, publicationStatus: "pending_operator_review",
      },
      listingWorkflow: { ...rec(metadata.listingWorkflow), queue: "pending_listings", publishAllowed: false },
    };
    // No new card, no duplicate images, no marketplace publication or seller lock.
    const saved = await updateMacKingmakerDraft(id, { title, description, price: comps?.suggestedPrice || 0, metadata: updated, status: "draft" });
    if (!saved) return fail("Mac inventory did not confirm the reprocessed draft.", 503);
    return NextResponse.json({
      success: true, inventoryItemId: id, title, description, ai: identity,
      identityComplete: complete, model: vision.model, archivedImagesReused: true,
      pricing: comps
        ? { status: comps.status, suggestedPrice: comps.suggestedPrice, medianComp: comps.medianComp, soldCompEvidence: comps.accepted, providerCoverage: comps.providerCoverage }
        : { status: complete ? "0 Comps — Seller Price Required" : "identity_review_required", suggestedPrice: null },
      published: false, folder: "pending", pendingQueue: "listings", requiresSellerReview: true,
    }, { status: complete ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 240) : "Archived vision retry failed.", 503);
  }
}

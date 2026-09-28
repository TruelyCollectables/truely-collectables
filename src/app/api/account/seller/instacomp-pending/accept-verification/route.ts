import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  getMacMasterListingRow,
  updateMacKingmakerDraft,
} from "../../../../../../lib/kingmaker-mac-scan-server";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function hasDistinctMacPair(metadata: Record<string, unknown>) {
  const instaComp = record(metadata.instacomp);
  const macReceipt = record(instaComp.macReceipt);
  const frontUrl = text(instaComp.frontImageUrl);
  const backUrl = text(instaComp.backImageUrl);
  const frontSha = text(
    instaComp.frontSha256 ?? instaComp.front_sha256 ?? macReceipt.frontSha256,
  );
  const backSha = text(
    instaComp.backSha256 ?? instaComp.back_sha256 ?? macReceipt.backSha256,
  );
  const scanId = text(instaComp.scanId ?? macReceipt.scanId);
  return Boolean(
    (frontUrl && backUrl && frontUrl !== backUrl) ||
      (frontSha && backSha && frontSha !== backSha) ||
      (scanId && instaComp.imagePersistenceVerified === true),
  );
}

function identityReady(metadata: Record<string, unknown>) {
  const instaComp = record(metadata.instacomp);
  const sellerReview = record(metadata.seller_review);
  return Boolean(
    instaComp.identityComplete === true ||
      instaComp.trustedForIdentity === true ||
      instaComp.manualIdentityLocked === true ||
      instaComp.humanVerified === true ||
      sellerReview.identity_confirmed === true ||
      text(instaComp.lastStatus) === "identity_complete",
  );
}
export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = record(await request.json().catch(() => ({})));
    const inventoryItemId = text(body.inventoryItemId);
    if (!inventoryItemId) {
      return Response.json({ error: "Pending card is required." }, { status: 400 });
    }

    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const item = await getMacMasterListingRow(inventoryItemId);
    if (!item) {
      return Response.json({ error: "Pending verification card was not found." }, { status: 404 });
    }
    const sellerAccountId = text(item.seller_account_id ?? item.sellerAccountId);
    if (!isOwner && sellerAccountId && sellerAccountId !== account.id) {
      return Response.json({ error: "Pending verification card was not found." }, { status: 404 });
    }
    if (text(item.status) === "archived" || text(item.status) === "sold") {
      return Response.json({ error: "This card is no longer pending." }, { status: 409 });
    }

    const metadata = record(item.metadata);
    if (!identityReady(metadata)) {
      return Response.json(
        { error: "Finish or confirm the card identity before moving it to Pending Listings." },
        { status: 409 },
      );
    }
    if (!hasDistinctMacPair(metadata)) {
      return Response.json(
        { error: "A distinct Mac-local front and back are required before accepting verification." },
        { status: 409 },
      );
    }
    const instaComp = record(metadata.instacomp);
    const orientation = record(instaComp.imageOrientation);
    const workflow = record(metadata.listingWorkflow);
    const sellerReview = record(metadata.seller_review);
    const now = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        imageOrientation: {
          ...orientation,
          status: "completed",
          verified: true,
          source: "seller_verification_accept",
          frontRotation: 0,
          backRotation: 0,
          frontConfidence: 1,
          backConfidence: 1,
          reason: "Seller visually accepted the stored front/back pair as correctly oriented.",
        },
        imageOrientationVerified: true,
        imageOrientationPersisted: true,
        imagePersistenceVerified: true,
      },
      listingWorkflow: {
        ...workflow,
        label: "Pending Listings",
        queue: "pending_listings",
        reason: "seller_accepted_verification",
        movedAt: now,
        reversible: true,
        previousQueue: "pending_verification",
      },
      seller_review: {
        ...sellerReview,
        image_orientation_confirmed_at: now,
        image_orientation_confirmed_by: account.id,
        image_orientation_confirmed_source: "pending_verification_accept",
      },
    };

    await updateMacKingmakerDraft(inventoryItemId, {
      metadata: nextMetadata,
      updatedAt: now,
    });

    return Response.json({
      success: true,
      inventoryItemId,
      title: item.title,
      queue: "listings",
      published: false,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not accept pending verification.",
      },
      { status: 500 },
    );
  }
}

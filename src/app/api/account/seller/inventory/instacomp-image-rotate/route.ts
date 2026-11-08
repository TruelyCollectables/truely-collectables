import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/kingmaker-local-auth";
import { archiveInstaCompAiLocalSupervisedScan } from "../../../../../../lib/instacomp-ai-local";
import {
  getMacMasterListingRow,
  updateMacKingmakerDraft,
} from "../../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validImage(value: FormDataEntryValue | null): value is File {
  return (
    value instanceof File &&
    value.size >= 1_000 &&
    value.size <= 12 * 1024 * 1024 &&
    value.type.toLowerCase().startsWith("image/")
  );
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const form = await request.formData();
    const inventoryItemId = clean(form.get("inventoryItemId"), 100);
    const rotatedSide = clean(form.get("rotatedSide"), 20).toLowerCase();
    const front = form.get("frontImage") ?? form.get("front");
    const back = form.get("backImage") ?? form.get("back");

    if (!inventoryItemId) {
      return NextResponse.json({ error: "Pending card is required." }, { status: 400 });
    }
    if (rotatedSide !== "front" && rotatedSide !== "back") {
      return NextResponse.json({ error: "rotatedSide must be front or back." }, { status: 400 });
    }
    if (!validImage(front) || !validImage(back)) {
      return NextResponse.json(
        { error: "Both rotated front and back image files are required. Reload the card and try the rotation again." },
        { status: 400 },
      );
    }

    const item = await getMacMasterListingRow(inventoryItemId);
    if (!item) {
      return NextResponse.json({ error: "Pending card was not found." }, { status: 404 });
    }
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    const sellerAccountId = clean(item.seller_account_id ?? item.sellerAccountId, 200);
    if (!isOwner && sellerAccountId && sellerAccountId !== account.id) {
      return NextResponse.json({ error: "Pending card was not found." }, { status: 404 });
    }
    const status = clean(item.status, 80);
    if (status === "archived" || status === "sold") {
      return NextResponse.json({ error: "This card is no longer editable." }, { status: 409 });
    }

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const sellerReview = record(metadata.seller_review);
    const cardUuid =
      clean(item.card_uuid ?? item.cardUuid, 200) ||
      clean(instaComp.cardUuid ?? instaComp.internalCardUuid, 200) ||
      inventoryItemId;

    const archive = await archiveInstaCompAiLocalSupervisedScan({
      front,
      back,
      cardUuid,
      timeoutMs: 45_000,
    });
    const updatedAt = new Date().toISOString();
    const frontImageUrl =
      "/api/kingmaker/scan-image?scanId=" +
      encodeURIComponent(archive.scan_id) +
      "&side=front";
    const backImageUrl =
      "/api/kingmaker/scan-image?scanId=" +
      encodeURIComponent(archive.scan_id) +
      "&side=back";
    const nextMetadata = {
      ...metadata,
      seller_review: {
        ...sellerReview,
        image_rotation_corrected_at: updatedAt,
        image_rotation_corrected_by: account.id,
        image_rotation_corrected_side: rotatedSide,
      },
      instacomp: {
        ...instaComp,
        scanId: archive.scan_id,
        cardUuid: archive.card_uuid,
        frontSha256: archive.front_sha256,
        backSha256: archive.back_sha256,
        imagePairSha256: archive.image_pair_sha256,
        frontImageUrl,
        backImageUrl,
        hasBackImage: true,
        imagePersistenceVerified: true,
        imageOrientation: {
          status: "completed",
          model: null,
          source: "seller_manual_pixel_rotation",
          frontRotation: 0,
          backRotation: 0,
          frontConfidence: 1,
          backConfidence: 1,
          reason:
            "Seller manually rotated the stored " +
            rotatedSide +
            " image pixels 90 degrees clockwise and verified the Mac-local pair.",
        },
        imageOrientationVerified: true,
        imageOrientationPersisted: true,
        imageRotationCorrectedAt: updatedAt,
      },
    };

    await updateMacKingmakerDraft(inventoryItemId, {
      metadata: nextMetadata,
      updatedAt,
    });

    return NextResponse.json({
      success: true,
      rotatedSide,
      scanId: archive.scan_id,
      frontImageUrl,
      backImageUrl,
      persisted: true,
      sourceAuthority: "mac_local",
      published: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not rotate pending card image." },
      { status: 500 },
    );
  }
}

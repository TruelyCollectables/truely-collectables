import { getInstaCompAiLocalArchivedImage } from "./instacomp-ai-local";
import { persistNormalizedInstaCompImagePair } from "./instacomp-normalized-image-storage";
import type { KingmakerMacScanResult } from "./kingmaker-mac-scan-server";
import { createSupabaseServerClient } from "./supabase-server";
import { getActiveStoreId } from "./stores";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isMissingCardUuidColumn(error: unknown) {
  const row = record(error);
  const code = String(row.code || "").toUpperCase();
  const message = [row.message, row.details, row.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    (message.includes("card_uuid") &&
      (message.includes("does not exist") ||
        message.includes("could not find") ||
        message.includes("schema cache")))
  );
}

export type KingmakerPendingStagingReceipt = {
  inventoryItemId: string;
  scanId: string;
  title: string;
  storeId: string;
  orientation: Record<string, unknown>;
};

export async function mirrorKingmakerScanToPendingStaging(params: {
  accountId: string;
  result: KingmakerMacScanResult;
}): Promise<KingmakerPendingStagingReceipt> {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const item = params.result.inventoryItem;
  const scan = params.result.scan;
  const macMetadata = record(item.metadata);
  const macInstaComp = record(macMetadata.instacomp);
  const scanId = text(scan.scan_id) || text(macInstaComp.scanId);
  if (!scanId) throw new Error("Mac scan ID is required for Pending staging.");

  const exact = params.result.identityComplete === true;
  const queue = exact ? "pending_listings" : "pending_verification";
  const source = exact
    ? "mac_local_registry_exact"
    : "mac_local_received_review";
  const metadata = {
    ...macMetadata,
    listingReviewRequired: !exact,
    listingWorkflow: {
      ...record(macMetadata.listingWorkflow),
      queue,
      source: "kingmaker_scan_intake_v2_staging_mirror",
    },
    pending_verification: {
      ...record(macMetadata.pending_verification),
      status: exact ? "resolved" : "pending_verification",
      source: "kingmaker_scan_intake_v2_staging_mirror",
    },
    instacomp: {
      ...macInstaComp,
      source,
      scanId,
      frontImageUrl:
        text(macInstaComp.frontImageUrl) ||
        "/api/kingmaker/scan-image?scanId=" +
          encodeURIComponent(scanId) +
          "&side=front",
      backImageUrl:
        text(macInstaComp.backImageUrl) ||
        "/api/kingmaker/scan-image?scanId=" +
          encodeURIComponent(scanId) +
          "&side=back",
      hasBackImage: true,
      identityComplete: exact,
      trustedForIdentity: exact,
      lastStatus: exact ? "identity_complete" : "review_required",
      lastStage: exact ? "registry_exact" : "received_review",
      pricingStatus: exact
        ? "identity_complete_pricing_pending"
        : "blocked_identity_review_required",
      pricingReason: exact
        ? "Exact trusted Mac Registry identity is complete; pricing pending."
        : "Exact Registry identity is required before pricing.",
    },
    seller_review: {
      ...record(macMetadata.seller_review),
      identity_confirmed: false,
    },
  };

  const stagingRow: Record<string, unknown> = {
    id: item.inventoryItemId,
    store_id: storeId,
    seller_account_id: params.accountId,
    card_uuid: scan.card_uuid || null,
    sku: item.sku || null,
    title: item.title || "Mac-local received card",
    description: item.description || null,
    category: item.category || "Trading Card Singles",
    condition: item.condition || "Near Mint or Better",
    status: "draft",
    quantity: Math.max(1, Number(item.quantity || 1)),
    price: Math.max(0, Number(item.price || 0)),
    metadata,
  };

  let write = await supabase
    .from("inventory_items")
    .upsert(stagingRow, { onConflict: "id" });
  if (write.error && isMissingCardUuidColumn(write.error)) {
    delete stagingRow.card_uuid;
    write = await supabase
      .from("inventory_items")
      .upsert(stagingRow, { onConflict: "id" });
  }
  if (write.error) throw write.error;

  return {
    inventoryItemId: item.inventoryItemId,
    scanId,
    title: item.title || "Mac-local received card",
    storeId,
    orientation: record(macInstaComp.imageOrientation),
  };
}

export async function persistKingmakerPendingStagingImages(
  receipt: KingmakerPendingStagingReceipt,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const [frontArchive, backArchive] = await Promise.all([
    getInstaCompAiLocalArchivedImage({
      scanId: receipt.scanId,
      side: "front",
      timeoutMs: 30_000,
    }),
    getInstaCompAiLocalArchivedImage({
      scanId: receipt.scanId,
      side: "back",
      timeoutMs: 30_000,
    }),
  ]);

  const orientation = receipt.orientation;
  return persistNormalizedInstaCompImagePair({
    supabase,
    storeId: receipt.storeId,
    inventoryItemId: receipt.inventoryItemId,
    title: receipt.title,
    frontFile: new File(
      [frontArchive.bytes],
      receipt.inventoryItemId + "-front.jpg",
      { type: frontArchive.contentType || "image/jpeg" },
    ),
    backFile: new File(
      [backArchive.bytes],
      receipt.inventoryItemId + "-back.jpg",
      { type: backArchive.contentType || "image/jpeg" },
    ),
    orientation: {
      status: text(orientation.status) || "review_required",
      model: text(orientation.model) || text(orientation.source) || "mac_local",
      source: text(orientation.source) || text(orientation.model) || "mac_local",
      frontRotation: Number(orientation.frontRotation || 0),
      backRotation: Number(orientation.backRotation || 0),
      frontConfidence: Number(orientation.frontConfidence || 0),
      backConfidence: Number(orientation.backConfidence || 0),
      frontEvidenceText: Array.isArray(orientation.frontEvidenceText)
        ? orientation.frontEvidenceText.map(String)
        : [],
      backEvidenceText: Array.isArray(orientation.backEvidenceText)
        ? orientation.backEvidenceText.map(String)
        : [],
      reason:
        text(orientation.reason) ||
        "Mac-local scan received and mirrored into website Pending staging.",
    },
  });
}

export type InstaCompPendingQueue = "listings" | "verification";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function instaCompPendingQueueFromMetadata(
  metadataValue: unknown,
): InstaCompPendingQueue {
  const metadata = record(metadataValue);
  const instacomp = record(metadata.instacomp);
  const imageOrientation = record(instacomp.imageOrientation);
  const workflow = record(metadata.listingWorkflow);
  const legacyWorkflow = record(metadata.listing_workflow);
  const queue =
    text(workflow.queue) ||
    text(legacyWorkflow.queue) ||
    text(record(metadata.pending_verification).status);

  const explicitlyHeld =
    queue === "pending_verification" || queue === "pending";
  const identityComplete =
    instacomp.identityComplete === true ||
    text(instacomp.lastStatus) === "identity_complete";
  const orientationVerified =
    text(imageOrientation.status) === "completed" &&
    instacomp.imageOrientationPersisted === true &&
    instacomp.imagePersistenceVerified === true;

  // A verification hold is a recovery state, not a permanent prison. Once the
  // stored physical pair is proven and exact Mac identity is complete, promote
  // automatically. Pricing/comps are a separate lifecycle and may still be
  // pending or blocked without turning an identified card back into review.
  if (!orientationVerified) return "verification";
  if (explicitlyHeld && !identityComplete) return "verification";
  return "listings";
}

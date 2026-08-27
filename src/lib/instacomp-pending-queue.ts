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
  const orientationVerified =
    text(imageOrientation.status) === "completed" &&
    instacomp.imageOrientationPersisted === true &&
    instacomp.imagePersistenceVerified === true;

  // Pending Listings is an executable seller workspace, not a raw-upload
  // gallery. A card cannot enter it until both Mac-canonical image files were
  // stored and read back. Uploads with a timeout or ambiguous orientation stay
  // in the verification lane for automatic recovery instead of displaying bad
  // pixels as if they were listing-ready.
  return explicitlyHeld || !orientationVerified ? "verification" : "listings";
}

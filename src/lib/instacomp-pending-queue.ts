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
  const workflow = record(metadata.listingWorkflow);
  const legacyWorkflow = record(metadata.listing_workflow);
  const queue =
    text(workflow.queue) ||
    text(legacyWorkflow.queue) ||
    text(record(metadata.pending_verification).status);

  return queue === "pending_verification" || queue === "pending"
    ? "verification"
    : "listings";
}

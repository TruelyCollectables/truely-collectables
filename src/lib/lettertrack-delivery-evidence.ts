export type LetterTrackDeliveryEvidenceEvent = {
  id?: string | null;
  provider?: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  event_type?: string | null;
  event_code?: string | null;
  event_status?: string | null;
  message?: string | null;
  location?: string | null;
  occurred_at?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export type LetterTrackDeliveryEvidenceSummary = {
  provider: "LetterTrack / USPS IMb";
  eventCount: number;
  deliveredEvidencePresent: boolean;
  claimReviewSupported: boolean;
  latestStatus: string | null;
  latestEventType: string | null;
  latestOccurredAt: string | null;
  latestTrackingNumber: string | null;
  latestMessage: string | null;
  latestLocation: string | null;
  deliveredAt: string | null;
  claimReviewReason: string;
};

const deliveredStatuses = new Set(["delivered"]);
const claimReviewStatuses = new Set([
  "not_delivered",
  "delivery_exception",
  "returned",
]);

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function eventTime(value: string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLetterTrackEvent(event: LetterTrackDeliveryEvidenceEvent) {
  return (
    normalized(event.provider).includes("lettertrack") ||
    normalized(event.carrier).includes("imb") ||
    normalized(event.event_type).startsWith("lettertrack_")
  );
}

export function buildLetterTrackDeliveryEvidenceSummary(
  events: LetterTrackDeliveryEvidenceEvent[],
): LetterTrackDeliveryEvidenceSummary {
  const letterTrackEvents = events
    .filter(isLetterTrackEvent)
    .sort((a, b) => eventTime(a.occurred_at) - eventTime(b.occurred_at));
  const latest = letterTrackEvents[letterTrackEvents.length - 1] || null;
  const deliveredEvent =
    [...letterTrackEvents]
      .reverse()
      .find((event) => deliveredStatuses.has(normalized(event.event_status))) ||
    null;
  const reviewEvent =
    [...letterTrackEvents]
      .reverse()
      .find((event) => claimReviewStatuses.has(normalized(event.event_status))) ||
    null;
  const deliveredEvidencePresent = Boolean(deliveredEvent);
  const claimReviewSupported = Boolean(reviewEvent) && !deliveredEvidencePresent;

  return {
    provider: "LetterTrack / USPS IMb",
    eventCount: letterTrackEvents.length,
    deliveredEvidencePresent,
    claimReviewSupported,
    latestStatus: latest?.event_status || null,
    latestEventType: latest?.event_type || null,
    latestOccurredAt: latest?.occurred_at || null,
    latestTrackingNumber: latest?.tracking_number || null,
    latestMessage: latest?.message || null,
    latestLocation: latest?.location || null,
    deliveredAt: deliveredEvent?.occurred_at || null,
    claimReviewReason: deliveredEvidencePresent
      ? "Delivered IMb evidence is present; seller-protection payout should not proceed unless an operator documents an override reason."
      : claimReviewSupported
        ? "No delivered IMb evidence is present and LetterTrack evidence shows not-delivered, exception, or returned status."
        : letterTrackEvents.length > 0
          ? "LetterTrack evidence exists but does not yet prove delivered or not-delivered outcome."
          : "No LetterTrack delivery evidence has been recorded yet.",
  };
}

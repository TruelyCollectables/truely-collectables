export const MAX_INSTACOMP_JOB_CARDS = 500;
export const DEFAULT_INSTACOMP_JOB_MAX_ATTEMPTS = 3;
export const DEFAULT_INSTACOMP_JOB_LEASE_MS = 2 * 60 * 1000;

export type InstaCompJobStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelling"
  | "cancelled";

export type InstaCompJobItemStatus =
  | "awaiting_upload"
  | "queued"
  | "processing"
  | "retry_wait"
  | "completed"
  | "review_required"
  | "failed"
  | "cancelled";

export type InstaCompQueueItemState = {
  status: InstaCompJobItemStatus;
  attemptCount: number;
  leaseExpiresAt: string | null;
  lastError?: string | null;
};

export type InstaCompJobCounts = {
  total: number;
  awaitingUpload: number;
  queued: number;
  processing: number;
  retryWait: number;
  completed: number;
  reviewRequired: number;
  failed: number;
  cancelled: number;
  finished: number;
  retryable: number;
  progressPercent: number;
};

export type InstaCompClaimDecision = {
  claimed: boolean;
  reason:
    | "claimed"
    | "active_lease"
    | "attempts_exhausted"
    | "terminal";
  item: InstaCompQueueItemState;
};

export type InstaCompIdempotencyRecord = {
  jobId: string;
  idempotencyKey: string;
  requestFingerprint: string;
};

export type InstaCompIdempotencyDecision =
  | { action: "create"; jobId: null }
  | { action: "replay"; jobId: string }
  | { action: "conflict"; jobId: string };

export class InstaCompJobStateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstaCompJobStateError";
    this.code = code;
  }
}

const JOB_TRANSITIONS: Record<InstaCompJobStatus, Set<InstaCompJobStatus>> = {
  uploading: new Set(["queued", "failed", "cancelling", "cancelled"]),
  queued: new Set(["processing", "failed", "cancelling", "cancelled"]),
  processing: new Set([
    "queued",
    "completed",
    "completed_with_errors",
    "failed",
    "cancelling",
    "cancelled",
  ]),
  completed: new Set(),
  completed_with_errors: new Set(["queued", "processing", "cancelled"]),
  failed: new Set(["queued", "processing", "cancelled"]),
  cancelling: new Set(["cancelled"]),
  cancelled: new Set(),
};

const ITEM_TRANSITIONS: Record<
  InstaCompJobItemStatus,
  Set<InstaCompJobItemStatus>
> = {
  awaiting_upload: new Set(["queued", "failed", "cancelled"]),
  queued: new Set(["processing", "cancelled"]),
  processing: new Set([
    "retry_wait",
    "completed",
    "review_required",
    "failed",
    "cancelled",
  ]),
  retry_wait: new Set(["processing", "failed", "cancelled"]),
  completed: new Set(),
  review_required: new Set(["queued", "cancelled"]),
  failed: new Set(["queued", "processing", "cancelled"]),
  cancelled: new Set(),
};

function requireNonNegativeInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new InstaCompJobStateError(
      "invalid_number",
      `${label} must be a non-negative integer.`,
    );
  }

  return value;
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new InstaCompJobStateError(
      "invalid_number",
      `${label} must be a positive integer.`,
    );
  }

  return value;
}

function requireFiniteTimestamp(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new InstaCompJobStateError(
      "invalid_timestamp",
      `${label} must be a finite timestamp.`,
    );
  }

  return value;
}

function cloneItem(item: InstaCompQueueItemState): InstaCompQueueItemState {
  return {
    status: item.status,
    attemptCount: item.attemptCount,
    leaseExpiresAt: item.leaseExpiresAt,
    lastError: item.lastError ?? null,
  };
}

function cleanIdempotencyValue(value: string, label: string, maxLength: number) {
  const cleaned = String(value || "").trim();

  if (!cleaned) {
    throw new InstaCompJobStateError(
      "invalid_idempotency",
      `${label} is required.`,
    );
  }

  if (cleaned.length > maxLength) {
    throw new InstaCompJobStateError(
      "invalid_idempotency",
      `${label} must be ${maxLength} characters or fewer.`,
    );
  }

  return cleaned;
}

export function validateInstaCompJobCardCount(value: number) {
  const count = requirePositiveInteger(value, "Card count");

  if (count > MAX_INSTACOMP_JOB_CARDS) {
    throw new InstaCompJobStateError(
      "card_limit_exceeded",
      `InstaComp jobs support at most ${MAX_INSTACOMP_JOB_CARDS} cards.`,
    );
  }

  return count;
}

export function canTransitionInstaCompJob(
  current: InstaCompJobStatus,
  next: InstaCompJobStatus,
) {
  return current === next || JOB_TRANSITIONS[current].has(next);
}

export function transitionInstaCompJob(
  current: InstaCompJobStatus,
  next: InstaCompJobStatus,
) {
  if (!canTransitionInstaCompJob(current, next)) {
    throw new InstaCompJobStateError(
      "invalid_job_transition",
      `InstaComp job cannot transition from ${current} to ${next}.`,
    );
  }

  return next;
}

export function canTransitionInstaCompJobItem(
  current: InstaCompJobItemStatus,
  next: InstaCompJobItemStatus,
) {
  return current === next || ITEM_TRANSITIONS[current].has(next);
}

export function transitionInstaCompJobItem(
  current: InstaCompJobItemStatus,
  next: InstaCompJobItemStatus,
) {
  if (!canTransitionInstaCompJobItem(current, next)) {
    throw new InstaCompJobStateError(
      "invalid_item_transition",
      `InstaComp job item cannot transition from ${current} to ${next}.`,
    );
  }

  return next;
}

export function summarizeInstaCompJobItems(
  items: ReadonlyArray<InstaCompQueueItemState>,
  maxAttempts = DEFAULT_INSTACOMP_JOB_MAX_ATTEMPTS,
): InstaCompJobCounts {
  requirePositiveInteger(maxAttempts, "Maximum attempts");

  if (items.length > MAX_INSTACOMP_JOB_CARDS) {
    throw new InstaCompJobStateError(
      "card_limit_exceeded",
      `InstaComp jobs support at most ${MAX_INSTACOMP_JOB_CARDS} cards.`,
    );
  }

  const counts: InstaCompJobCounts = {
    total: items.length,
    awaitingUpload: 0,
    queued: 0,
    processing: 0,
    retryWait: 0,
    completed: 0,
    reviewRequired: 0,
    failed: 0,
    cancelled: 0,
    finished: 0,
    retryable: 0,
    progressPercent: 0,
  };

  for (const item of items) {
    requireNonNegativeInteger(item.attemptCount, "Attempt count");
    if (item.status === "awaiting_upload") counts.awaitingUpload += 1;
    if (item.status === "queued") counts.queued += 1;
    if (item.status === "processing") counts.processing += 1;
    if (item.status === "retry_wait") counts.retryWait += 1;
    if (item.status === "completed") counts.completed += 1;
    if (item.status === "review_required") counts.reviewRequired += 1;
    if (item.status === "failed") counts.failed += 1;
    if (item.status === "cancelled") counts.cancelled += 1;

    if (
      ["completed", "review_required", "failed", "cancelled"].includes(
        item.status,
      )
    ) {
      counts.finished += 1;
    }

    if (item.status === "failed" && item.attemptCount < maxAttempts) {
      counts.retryable += 1;
    }
  }

  counts.progressPercent = counts.total
    ? Math.round((counts.finished / counts.total) * 100)
    : 0;

  return counts;
}

export function deriveInstaCompJobStatus(
  counts: InstaCompJobCounts,
  currentStatus: InstaCompJobStatus = "queued",
): InstaCompJobStatus {
  if (currentStatus === "cancelled" || currentStatus === "completed") {
    return currentStatus;
  }

  if (currentStatus === "uploading" && counts.awaitingUpload > 0) {
    return "uploading";
  }

  if (currentStatus === "cancelling") {
    return counts.finished === counts.total ? "cancelled" : "cancelling";
  }

  if (counts.total === 0) return "queued";
  if (counts.cancelled === counts.total) return "cancelled";
  if (counts.completed === counts.total) return "completed";

  if (counts.finished === counts.total) {
    if (counts.failed === counts.total) return "failed";
    return counts.failed > 0 ||
      counts.reviewRequired > 0 ||
      counts.cancelled > 0
      ? "completed_with_errors"
      : "completed";
  }

  return counts.processing > 0 ? "processing" : "queued";
}

export function isInstaCompLeaseExpired(
  leaseExpiresAt: string | null | undefined,
  nowMs = Date.now(),
) {
  requireFiniteTimestamp(nowMs, "Current time");

  if (!leaseExpiresAt) return true;

  const leaseTime = Date.parse(leaseExpiresAt);
  return !Number.isFinite(leaseTime) || leaseTime <= nowMs;
}

export function claimInstaCompJobItem(
  item: InstaCompQueueItemState,
  options?: {
    nowMs?: number;
    leaseMs?: number;
    maxAttempts?: number;
  },
): InstaCompClaimDecision {
  const nowMs = requireFiniteTimestamp(options?.nowMs ?? Date.now(), "Current time");
  const leaseMs = requirePositiveInteger(
    options?.leaseMs ?? DEFAULT_INSTACOMP_JOB_LEASE_MS,
    "Lease duration",
  );
  const maxAttempts = requirePositiveInteger(
    options?.maxAttempts ?? DEFAULT_INSTACOMP_JOB_MAX_ATTEMPTS,
    "Maximum attempts",
  );
  const attemptCount = requireNonNegativeInteger(
    item.attemptCount,
    "Attempt count",
  );
  const unchanged = cloneItem(item);

  if (
    [
      "awaiting_upload",
      "completed",
      "review_required",
      "failed",
      "cancelled",
    ].includes(item.status)
  ) {
    return { claimed: false, reason: "terminal", item: unchanged };
  }

  if (attemptCount >= maxAttempts) {
    return { claimed: false, reason: "attempts_exhausted", item: unchanged };
  }

  if (
    item.status === "processing" &&
    !isInstaCompLeaseExpired(item.leaseExpiresAt, nowMs)
  ) {
    return { claimed: false, reason: "active_lease", item: unchanged };
  }

  return {
    claimed: true,
    reason: "claimed",
    item: {
      status: "processing",
      attemptCount: attemptCount + 1,
      leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(),
      lastError: null,
    },
  };
}

export function completeInstaCompJobItem(
  item: InstaCompQueueItemState,
): InstaCompQueueItemState {
  transitionInstaCompJobItem(item.status, "completed");

  return {
    ...cloneItem(item),
    status: "completed",
    leaseExpiresAt: null,
    lastError: null,
  };
}

export function failInstaCompJobItem(
  item: InstaCompQueueItemState,
  error: unknown,
): InstaCompQueueItemState {
  transitionInstaCompJobItem(item.status, "failed");

  const message =
    error instanceof Error
      ? error.message
      : String(error || "InstaComp scan failed");

  return {
    ...cloneItem(item),
    status: "failed",
    leaseExpiresAt: null,
    lastError: message.slice(0, 1000),
  };
}

export function retryInstaCompJobItem(
  item: InstaCompQueueItemState,
  maxAttempts = DEFAULT_INSTACOMP_JOB_MAX_ATTEMPTS,
): InstaCompQueueItemState {
  requirePositiveInteger(maxAttempts, "Maximum attempts");
  const attemptCount = requireNonNegativeInteger(
    item.attemptCount,
    "Attempt count",
  );

  if (item.status !== "failed") {
    throw new InstaCompJobStateError(
      "item_not_retryable",
      "Only failed InstaComp job items can be retried.",
    );
  }

  if (attemptCount >= maxAttempts) {
    throw new InstaCompJobStateError(
      "attempts_exhausted",
      "InstaComp job item has exhausted its retry attempts.",
    );
  }

  return {
    ...cloneItem(item),
    status: "queued",
    leaseExpiresAt: null,
    lastError: null,
  };
}

export function resolveInstaCompJobIdempotency(params: {
  idempotencyKey: string;
  requestFingerprint: string;
  existing?: InstaCompIdempotencyRecord | null;
}): InstaCompIdempotencyDecision {
  const idempotencyKey = cleanIdempotencyValue(
    params.idempotencyKey,
    "Idempotency key",
    200,
  );
  const requestFingerprint = cleanIdempotencyValue(
    params.requestFingerprint,
    "Request fingerprint",
    200,
  );
  const existing = params.existing;

  if (!existing) {
    return { action: "create", jobId: null };
  }

  const existingKey = cleanIdempotencyValue(
    existing.idempotencyKey,
    "Existing idempotency key",
    200,
  );
  const existingFingerprint = cleanIdempotencyValue(
    existing.requestFingerprint,
    "Existing request fingerprint",
    200,
  );

  if (existingKey !== idempotencyKey) {
    throw new InstaCompJobStateError(
      "idempotency_lookup_mismatch",
      "Existing job does not match the requested idempotency key.",
    );
  }

  return existingFingerprint === requestFingerprint
    ? { action: "replay", jobId: existing.jobId }
    : { action: "conflict", jobId: existing.jobId };
}

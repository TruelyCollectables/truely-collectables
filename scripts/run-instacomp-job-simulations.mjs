import {
  MAX_INSTACOMP_JOB_CARDS,
  InstaCompJobStateError,
  claimInstaCompJobItem,
  completeInstaCompJobItem,
  deriveInstaCompJobStatus,
  failInstaCompJobItem,
  resolveInstaCompJobIdempotency,
  retryInstaCompJobItem,
  summarizeInstaCompJobItems,
  transitionInstaCompJob,
  transitionInstaCompJobItem,
  validateInstaCompJobCardCount,
} from "../src/lib/instacomp-job-state.ts";

const scenarios = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectStateError(callback, expectedCode) {
  try {
    callback();
  } catch (error) {
    assert(
      error instanceof InstaCompJobStateError,
      `Expected InstaCompJobStateError, received ${error?.constructor?.name || typeof error}`,
    );
    assert(
      error.code === expectedCode,
      `Expected error code ${expectedCode}, received ${error.code}`,
    );
    return;
  }

  throw new Error(`Expected ${expectedCode} error, but no error was thrown`);
}

async function scenario(name, callback) {
  const startedAt = Date.now();

  try {
    await callback();
    scenarios.push({ name, status: "passed", elapsedMs: Date.now() - startedAt });
  } catch (error) {
    scenarios.push({
      name,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await scenario("card limit accepts 500 and rejects invalid totals", () => {
  assert(
    validateInstaCompJobCardCount(MAX_INSTACOMP_JOB_CARDS) === 500,
    "The 500-card boundary must be accepted",
  );
  expectStateError(() => validateInstaCompJobCardCount(0), "invalid_number");
  expectStateError(
    () => validateInstaCompJobCardCount(MAX_INSTACOMP_JOB_CARDS + 1),
    "card_limit_exceeded",
  );
});

await scenario("helper states match the persistent SQL queue", () => {
  assert(
    transitionInstaCompJob("uploading", "queued") === "queued",
    "Uploaded jobs must become queued",
  );
  assert(
    transitionInstaCompJob("processing", "cancelling") === "cancelling",
    "Processing jobs must support cancellation",
  );
  assert(
    transitionInstaCompJobItem("awaiting_upload", "queued") === "queued",
    "Confirmed uploads must become queued",
  );
  assert(
    transitionInstaCompJobItem("processing", "retry_wait") === "retry_wait",
    "Retryable failures must enter retry_wait",
  );
  assert(
    transitionInstaCompJobItem("processing", "review_required") ===
      "review_required",
    "Uncertain scans must enter review_required",
  );
  assert(
    transitionInstaCompJobItem("completed", "cancelled") === "cancelled",
    "Operator removal must be able to cancel a completed saved scan row",
  );

  const counts = summarizeInstaCompJobItems([
    { status: "awaiting_upload", attemptCount: 0, leaseExpiresAt: null },
    { status: "retry_wait", attemptCount: 1, leaseExpiresAt: null },
    { status: "review_required", attemptCount: 1, leaseExpiresAt: null },
  ]);
  assert(counts.awaitingUpload === 1, "awaiting_upload must be counted");
  assert(counts.retryWait === 1, "retry_wait must be counted");
  assert(counts.reviewRequired === 1, "review_required must be counted");
});

await scenario("job status transitions reject terminal-state reopening", () => {
  assert(
    transitionInstaCompJob("queued", "processing") === "processing",
    "Queued job should start processing",
  );
  assert(
    transitionInstaCompJob("completed_with_errors", "queued") === "queued",
    "A partially failed job should reopen for explicit retries",
  );
  expectStateError(
    () => transitionInstaCompJob("completed", "processing"),
    "invalid_job_transition",
  );
  expectStateError(
    () => transitionInstaCompJob("cancelled", "queued"),
    "invalid_job_transition",
  );
});

await scenario("counts and derived status remain internally consistent", () => {
  const items = [
    { status: "queued", attemptCount: 0, leaseExpiresAt: null },
    { status: "processing", attemptCount: 1, leaseExpiresAt: "2030-01-01T00:00:00.000Z" },
    { status: "completed", attemptCount: 1, leaseExpiresAt: null },
    { status: "failed", attemptCount: 1, leaseExpiresAt: null },
    { status: "cancelled", attemptCount: 0, leaseExpiresAt: null },
  ];
  const counts = summarizeInstaCompJobItems(items);

  assert(counts.total === 5, "Total count should equal item count");
  assert(counts.finished === 3, "Completed, failed, and cancelled items are finished");
  assert(counts.retryable === 1, "Failed item below max attempts should be retryable");
  assert(counts.progressPercent === 60, "Progress should be rounded to 60 percent");
  assert(
    deriveInstaCompJobStatus(counts) === "processing",
    "A job with an active worker should derive processing status",
  );

  const finishedCounts = summarizeInstaCompJobItems([
    { status: "completed", attemptCount: 1, leaseExpiresAt: null },
    { status: "failed", attemptCount: 3, leaseExpiresAt: null },
  ]);
  assert(
    deriveInstaCompJobStatus(finishedCounts) === "completed_with_errors",
    "A finished job containing failures should require review",
  );

  const completedCounts = summarizeInstaCompJobItems([
    { status: "completed", attemptCount: 1, leaseExpiresAt: null },
  ]);
  assert(
    deriveInstaCompJobStatus(completedCounts, "processing") === "completed",
    "A processing job should become terminal after its final worker completes",
  );
});

await scenario("active leases prevent duplicate work and stale leases recover", () => {
  const nowMs = Date.parse("2026-07-11T12:00:00.000Z");
  const queued = { status: "queued", attemptCount: 0, leaseExpiresAt: null };
  const firstClaim = claimInstaCompJobItem(queued, {
    nowMs,
    leaseMs: 60_000,
  });

  assert(firstClaim.claimed, "Queued item should be claimed");
  assert(firstClaim.item.attemptCount === 1, "First claim should count as attempt one");

  const duplicateClaim = claimInstaCompJobItem(firstClaim.item, {
    nowMs: nowMs + 30_000,
    leaseMs: 60_000,
  });
  assert(!duplicateClaim.claimed, "Active lease must reject duplicate work");
  assert(duplicateClaim.reason === "active_lease", "Duplicate should report active lease");

  const staleClaim = claimInstaCompJobItem(firstClaim.item, {
    nowMs: nowMs + 60_001,
    leaseMs: 60_000,
  });
  assert(staleClaim.claimed, "Expired lease should be recoverable");
  assert(staleClaim.item.attemptCount === 2, "Lease recovery should consume a retry attempt");
});

await scenario("failed work retries safely and stops at the attempt ceiling", () => {
  const nowMs = Date.parse("2026-07-11T12:00:00.000Z");
  let item = { status: "queued", attemptCount: 0, leaseExpiresAt: null };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claim = claimInstaCompJobItem(item, { nowMs: nowMs + attempt * 1000 });
    assert(claim.claimed, `Attempt ${attempt} should be claimable`);
    item = failInstaCompJobItem(claim.item, new Error(`failure ${attempt}`));

    if (attempt < 3) {
      item = retryInstaCompJobItem(item);
      assert(item.status === "queued", "Retry should return failed work to the queue");
    }
  }

  expectStateError(() => retryInstaCompJobItem(item), "attempts_exhausted");
  const exhaustedClaim = claimInstaCompJobItem(item);
  assert(!exhaustedClaim.claimed, "Exhausted item must not be claimed again");
  assert(
    exhaustedClaim.reason === "terminal",
    "A terminal failed row must not bypass the retry action",
  );
});

await scenario("successful retry reaches one terminal completion", () => {
  const nowMs = Date.parse("2026-07-11T12:00:00.000Z");
  const first = claimInstaCompJobItem(
    { status: "queued", attemptCount: 0, leaseExpiresAt: null },
    { nowMs },
  );
  const failed = failInstaCompJobItem(first.item, "temporary OCR failure");
  const retried = retryInstaCompJobItem(failed);
  const second = claimInstaCompJobItem(retried, { nowMs: nowMs + 5000 });
  const completed = completeInstaCompJobItem(second.item);
  const duplicate = claimInstaCompJobItem(completed, { nowMs: nowMs + 6000 });

  assert(completed.status === "completed", "Successful retry should complete");
  assert(completed.attemptCount === 2, "Completion should preserve attempt count");
  assert(!duplicate.claimed, "Completed work must not be processed twice");
  assert(duplicate.reason === "terminal", "Completed replay should be terminal");
});

await scenario("idempotency replays identical requests and rejects key reuse", () => {
  const existing = {
    jobId: "job-123",
    idempotencyKey: "upload-session-abc",
    requestFingerprint: "sha256:front-back-manifest-v1",
  };
  const create = resolveInstaCompJobIdempotency({
    idempotencyKey: existing.idempotencyKey,
    requestFingerprint: existing.requestFingerprint,
  });
  const replay = resolveInstaCompJobIdempotency({
    idempotencyKey: existing.idempotencyKey,
    requestFingerprint: existing.requestFingerprint,
    existing,
  });
  const conflict = resolveInstaCompJobIdempotency({
    idempotencyKey: existing.idempotencyKey,
    requestFingerprint: "sha256:different-manifest",
    existing,
  });

  assert(create.action === "create", "New idempotency key should create a job");
  assert(replay.action === "replay", "Identical request should replay its job");
  assert(replay.jobId === existing.jobId, "Replay should return the original job id");
  assert(conflict.action === "conflict", "Reused key with new input must conflict");
});

const failed = scenarios.filter((item) => item.status === "failed");

for (const item of scenarios) {
  const prefix = item.status === "passed" ? "PASS" : "FAIL";
  const detail = item.error ? ` - ${item.error}` : "";
  console.log(`${prefix} ${item.name} (${item.elapsedMs}ms)${detail}`);
}

console.log(
  `InstaComp™ job simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;

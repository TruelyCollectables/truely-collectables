import assert from "node:assert/strict";
import {
  databaseApprovalPresentation,
  launchCheckBadge,
  launchCheckTone,
  launchSummaryTone,
} from "../src/lib/live-payment-status-presentation";

assert.equal(
  launchCheckTone({ key: "seller_connect", status: "blocked" }),
  "red",
  "A real approval blocker must be red.",
);
assert.equal(
  launchCheckBadge({ key: "seller_connect", status: "blocked" }),
  "Approval blocker",
  "A real failure must be labeled as an approval blocker.",
);

for (const key of ["database_approval", "runtime_switch"]) {
  assert.equal(
    launchCheckTone({ key, status: "blocked" }),
    "amber",
    `${key} is an intentional launch lock and must not be red.`,
  );
  assert.equal(
    launchCheckBadge({ key, status: "blocked" }),
    "Launch lock",
    `${key} must be labeled as a launch lock.`,
  );
}

assert.equal(
  launchCheckTone({ key: "review_warning", status: "warning" }),
  "yellow",
  "Review warnings must be yellow.",
);
assert.equal(
  launchCheckTone({ key: "passed_check", status: "passed" }),
  "emerald",
  "Passed checks must be green.",
);

assert.equal(
  launchSummaryTone({
    livePaymentsEnabled: false,
    approvalBlockingCount: 1,
    launchLockCount: 1,
  }),
  "red",
  "A summary with a real approval blocker must be red.",
);
assert.equal(
  launchSummaryTone({
    livePaymentsEnabled: false,
    approvalBlockingCount: 0,
    launchLockCount: 1,
  }),
  "amber",
  "A summary with only intentional launch locks must be amber.",
);
assert.equal(
  launchSummaryTone({
    livePaymentsEnabled: false,
    approvalBlockingCount: 0,
    launchLockCount: 0,
  }),
  "sky",
  "A ready-but-not-enabled summary must be neutral sky, not red.",
);
assert.equal(
  launchSummaryTone({
    livePaymentsEnabled: true,
    approvalBlockingCount: 0,
    launchLockCount: 0,
  }),
  "emerald",
  "An enabled runtime must be green.",
);

assert.deepEqual(
  databaseApprovalPresentation({
    databaseApproved: false,
    approvalReady: false,
  }),
  { status: "NOT APPROVABLE", tone: "red" },
  "Database approval is red only when real blockers prevent approval.",
);
assert.deepEqual(
  databaseApprovalPresentation({
    databaseApproved: false,
    approvalReady: true,
  }),
  { status: "READY TO APPROVE", tone: "amber" },
  "A ready database approval is amber, not red or falsely green.",
);
assert.deepEqual(
  databaseApprovalPresentation({
    databaseApproved: true,
    approvalReady: true,
  }),
  { status: "APPROVED", tone: "emerald" },
  "A recorded approval must be green.",
);

console.log("Live payment semantic status color simulations passed: 15/15");

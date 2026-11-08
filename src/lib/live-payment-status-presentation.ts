import type { LivePaymentCheckStatus } from "./live-payment-launch-core";

export type LaunchSemanticTone =
  | "emerald"
  | "yellow"
  | "amber"
  | "red"
  | "sky";

type LaunchCheckLike = {
  key: string;
  status: LivePaymentCheckStatus;
};

export const LIVE_PAYMENT_LAUNCH_LOCK_KEYS = new Set([
  "database_approval",
  "runtime_switch",
]);

export function isIntentionalLaunchLock(check: LaunchCheckLike) {
  return (
    check.status === "blocked" && LIVE_PAYMENT_LAUNCH_LOCK_KEYS.has(check.key)
  );
}

export function launchCheckTone(
  check: LaunchCheckLike,
): Exclude<LaunchSemanticTone, "sky"> {
  if (check.status === "passed") return "emerald";
  if (check.status === "warning") return "yellow";
  if (isIntentionalLaunchLock(check)) return "amber";
  return "red";
}

export function launchCheckBadge(check: LaunchCheckLike) {
  if (check.status === "passed") return "Passed";
  if (check.status === "warning") return "Review";
  if (isIntentionalLaunchLock(check)) return "Launch lock";
  return "Approval blocker";
}

export function launchSummaryTone(params: {
  livePaymentsEnabled: boolean;
  approvalBlockingCount: number;
  launchLockCount: number;
}): Exclude<LaunchSemanticTone, "yellow"> {
  if (params.livePaymentsEnabled) return "emerald";
  if (params.approvalBlockingCount > 0) return "red";
  if (params.launchLockCount > 0) return "amber";
  return "sky";
}

export function databaseApprovalPresentation(params: {
  databaseApproved: boolean;
  approvalReady: boolean;
}): {
  status: string;
  tone: "emerald" | "amber" | "red";
} {
  if (params.databaseApproved) {
    return { status: "APPROVED", tone: "emerald" };
  }

  if (params.approvalReady) {
    return { status: "READY TO APPROVE", tone: "amber" };
  }

  return { status: "NOT APPROVABLE", tone: "red" };
}

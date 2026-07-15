import { evaluateLivePaymentLaunch } from "../src/lib/live-payment-launch";
import { createSupabaseServerClient } from "../src/lib/supabase-server";
import { getActiveStoreId } from "../src/lib/stores";

type LiveMoneyState =
  | "BLOCKED_UNEVALUATED"
  | "BLOCKED_APPROVAL"
  | "READY_FOR_DATABASE_APPROVAL"
  | "READY_FOR_RUNTIME_SWITCH"
  | "LIVE_MONEY_OPEN"
  | "BLOCKED_LAUNCH_GATE";

const allowBlocked = process.argv.includes("--allow-blocked");

function redact(value: unknown) {
  return String(value)
    .replace(/\bsk_(live|test)_[A-Za-z0-9_]+\b/g, "sk_$1_[redacted]")
    .replace(/\bpk_(live|test)_[A-Za-z0-9_]+\b/g, "pk_$1_[redacted]")
    .replace(/\bwhsec_[A-Za-z0-9_]+\b/g, "whsec_[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "jwt_[redacted]");
}

function classify(report: Awaited<ReturnType<typeof evaluateLivePaymentLaunch>>): {
  state: LiveMoneyState;
  readyForRuntimeSwitch: boolean;
  detail: string;
  next: string;
} {
  if (report.livePaymentsEnabled) {
    return {
      state: "LIVE_MONEY_OPEN",
      readyForRuntimeSwitch: true,
      detail: "Live Checkout is open through the dual-lock gate.",
      next: "Monitor Stripe webhooks, reconciliation, refunds, disputes, seller payout holds, and emergency revocation readiness.",
    };
  }

  if (!report.approvalDatabaseReady) {
    return {
      state: "BLOCKED_APPROVAL",
      readyForRuntimeSwitch: false,
      detail:
        "The live-payment approval database cannot be fully verified, so the database approval cannot be trusted.",
      next: "Apply or repair the live-payment launch gate migration before approving live Checkout.",
    };
  }

  if (report.summary.approvalBlockingCount > 0) {
    const firstBlocker = report.summary.approvalBlockers[0];
    return {
      state: "BLOCKED_APPROVAL",
      readyForRuntimeSwitch: false,
      detail: `Live Checkout is locked by ${report.summary.approvalBlockingCount} approval blocker(s).`,
      next: firstBlocker
        ? `${firstBlocker.label}: ${firstBlocker.action}`
        : "Open /admin/live-payment-launch and clear the payment approval blockers.",
    };
  }

  if (!report.summary.databaseApproved) {
    return {
      state: "READY_FOR_DATABASE_APPROVAL",
      readyForRuntimeSwitch: false,
      detail:
        "Approval blockers are clear, but the auditable database approval has not been recorded.",
      next: "Record the database approval from /admin/live-payment-launch, then rerun npm run preflight:live-money before changing the runtime switch.",
    };
  }

  if (!report.summary.runtimeSwitchEnabled) {
    return {
      state: "READY_FOR_RUNTIME_SWITCH",
      readyForRuntimeSwitch: true,
      detail:
        "Database approval is current and no payment approval blockers remain; the environment runtime switch is the final intentional lock.",
      next: "Only during the go-live window, set TCOS_LIVE_PAYMENTS_ENABLED=true, deploy/restart, and rerun production smoke.",
    };
  }

  return {
    state: "BLOCKED_LAUNCH_GATE",
    readyForRuntimeSwitch: false,
    detail:
      "The runtime switch is enabled, but the live-payment report still does not allow live Checkout.",
    next: "Open /admin/live-payment-launch and reconcile database approval, approval blockers, and runtime switch evidence.",
  };
}

function printItems(
  title: string,
  items: Awaited<ReturnType<typeof evaluateLivePaymentLaunch>>["summary"]["nextActions"],
) {
  if (!items.length) return;
  console.log(`${title}:`);
  for (const item of items.slice(0, 10)) {
    console.log(`- ${redact(item.label)}: ${redact(item.action)}`);
  }
  if (items.length > 10) {
    console.log(`- ...${items.length - 10} more item(s) omitted; open /admin/live-payment-launch for the full list.`);
  }
}

async function main() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const report = await evaluateLivePaymentLaunch({ supabase, storeId });
  const classification = classify(report);

  console.log("Live money go/no-go status:");
  console.log(`- state: ${classification.state}`);
  console.log(`- ready for runtime switch: ${classification.readyForRuntimeSwitch ? "yes" : "no"}`);
  console.log(`- payment mode: ${report.paymentMode}`);
  console.log(`- approval database ready: ${report.approvalDatabaseReady ? "yes" : "no"}`);
  console.log(`- database approved: ${report.summary.databaseApproved ? "yes" : "no"}`);
  console.log(`- runtime switch enabled: ${report.summary.runtimeSwitchEnabled ? "yes" : "no"}`);
  console.log(`- live Checkout: ${report.livePaymentsEnabled ? "OPEN" : "LOCKED"}`);
  console.log(`- approval blockers: ${report.summary.approvalBlockingCount}`);
  console.log(`- launch locks: ${report.summary.launchLockCount}`);
  console.log(`- warnings: ${report.summary.warningCount}`);
  console.log(`- generated at: ${report.generatedAt}`);
  console.log(`- summary: ${redact(report.summary.operatorSummary)}`);
  console.log(`- detail: ${redact(classification.detail)}`);
  console.log(`- next: ${redact(classification.next)}`);
  printItems("Approval blockers", report.summary.approvalBlockers);
  printItems("Launch locks", report.summary.launchLocks);
  printItems("Warnings", report.summary.warnings);
  console.log(
    "Read-only guarantee: no Checkout Sessions, Customers, PaymentIntents, refunds, disputes, payouts, labels, postage purchases, Coverage policies, launch approvals, or revocations were created.",
  );

  if (!classification.readyForRuntimeSwitch && !allowBlocked) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log("Live money go/no-go status:");
  console.log("- state: BLOCKED_UNEVALUATED");
  console.log("- ready for runtime switch: no");
  console.log(`- detail: ${redact(error?.message || error || "unknown error")}`);
  console.log(
    "- next: Restore the required Supabase/live-payment environment, then rerun npm run status:live-money.",
  );
  console.log(
    "Read-only guarantee: the command failed before any launch approval, revocation, Checkout, postage, or payout action could be created.",
  );
  if (!allowBlocked) {
    process.exitCode = 1;
  }
});

import { loadEnvConfig } from "@next/env";
import { evaluateLivePaymentLaunch } from "../src/lib/live-payment-launch";
import { LIVE_MONEY_JSON_EVIDENCE } from "../src/lib/live-money-evidence";
import { createSupabaseServerClient } from "../src/lib/supabase-server";
import { getActiveStoreId } from "../src/lib/stores";

loadEnvConfig(process.cwd());

type LiveMoneyState =
  | "BLOCKED_UNEVALUATED"
  | "BLOCKED_APPROVAL"
  | "READY_FOR_DATABASE_APPROVAL"
  | "READY_FOR_RUNTIME_SWITCH"
  | "LIVE_MONEY_OPEN"
  | "BLOCKED_LAUNCH_GATE";

const allowBlocked = process.argv.includes("--allow-blocked");
const jsonOutput = process.argv.includes("--json");

const readOnlyGuarantee =
  "No Checkout Sessions, Customers, PaymentIntents, refunds, disputes, payouts, labels, postage purchases, Coverage policies, launch approvals, or revocations were created.";
const failedReadOnlyGuarantee =
  "The command failed before any launch approval, revocation, Checkout, postage, or payout action could be created.";

function configured(value: string | undefined) {
  return Boolean(value?.trim());
}

function hasPrefix(value: string | undefined, prefix: string) {
  return Boolean(value?.trim().startsWith(prefix));
}

function missingEnvironmentVariables() {
  const missing: string[] = [];

  if (!configured(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (
    !configured(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    !configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  ) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return missing;
}

function liveSecretStatus(primary: string | undefined, fallback: string | undefined, prefix: string) {
  if (hasPrefix(primary, prefix)) return "configured";
  if (hasPrefix(fallback, prefix)) return "configured via fallback";
  if (configured(primary) || configured(fallback)) return "present but not live-shaped";
  return "missing";
}

function localEnvironmentStatus() {
  return {
    supabaseBootstrap: [
      {
        label: "NEXT_PUBLIC_SUPABASE_URL",
        status: configured(process.env.NEXT_PUBLIC_SUPABASE_URL) ? "configured" : "missing",
      },
      {
        label: "SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY",
        status:
          configured(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
          configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
            ? "configured"
            : "missing",
      },
    ],
    finalLivePaymentRuntime: [
      {
        label: "Stripe live secret key",
        status: liveSecretStatus(
          process.env.STRIPE_LIVE_SECRET_KEY,
          process.env.STRIPE_SECRET_KEY,
          "sk_live_",
        ),
      },
      {
        label: "Stripe live publishable key",
        status: liveSecretStatus(
          process.env.NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY,
          process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
          "pk_live_",
        ),
      },
      {
        label: "Stripe live webhook secret",
        status: liveSecretStatus(
          process.env.STRIPE_LIVE_WEBHOOK_SECRET,
          process.env.STRIPE_WEBHOOK_SECRET,
          "whsec_",
        ),
      },
      {
        label: "HTTPS production origin",
        status: process.env.NEXT_PUBLIC_SITE_URL?.trim().startsWith("https://")
          ? "configured"
          : configured(process.env.NEXT_PUBLIC_SITE_URL)
            ? "present but not HTTPS"
            : "missing local NEXT_PUBLIC_SITE_URL; active store primary domain may satisfy deployed context",
      },
      {
        label: "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED",
        status:
          process.env.STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED === "true"
            ? "true"
            : "not true",
      },
      {
        label: "TCOS_LIVE_PAYMENTS_ENABLED",
        status:
          process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true"
            ? "true - only valid during final go-live window after accepted preflight evidence"
            : "off - expected until final go-live window",
      },
    ],
  };
}

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

function printEnvironmentChecklist() {
  console.log(
    `Supabase bootstrap environment: ${LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.supabaseBootstrap.join("; ")}`,
  );
  console.log(
    `Final live-payment runtime environment: ${LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.finalLivePaymentRuntime.join("; ")}`,
  );
  const missing = missingEnvironmentVariables();
  console.log(
    `Missing local bootstrap environment: ${missing.length ? missing.join(", ") : "none detected"}`,
  );
  const localStatus = localEnvironmentStatus();
  console.log("Local Supabase bootstrap status:");
  for (const item of localStatus.supabaseBootstrap) {
    console.log(`- ${item.label}: ${item.status}`);
  }
  console.log("Local final live-payment runtime status:");
  for (const item of localStatus.finalLivePaymentRuntime) {
    console.log(`- ${item.label}: ${item.status}`);
  }
}

function actionPayload(
  items: Awaited<ReturnType<typeof evaluateLivePaymentLaunch>>["summary"]["nextActions"],
) {
  return items.map((item) => ({
    key: item.key,
    label: redact(item.label),
    status: item.status,
    detail: redact(item.detail),
    action: redact(item.action),
  }));
}

function statusPayload(
  report: Awaited<ReturnType<typeof evaluateLivePaymentLaunch>>,
  classification: ReturnType<typeof classify>,
) {
  return {
    schema: LIVE_MONEY_JSON_EVIDENCE.schema,
    liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
    state: classification.state,
    readyForRuntimeSwitch: classification.readyForRuntimeSwitch,
    paymentMode: report.paymentMode,
    approvalVersion: report.approvalVersion,
    approvalDatabaseReady: report.approvalDatabaseReady,
    databaseApproved: report.summary.databaseApproved,
    runtimeSwitchEnabled: report.summary.runtimeSwitchEnabled,
    liveCheckout: report.livePaymentsEnabled ? "OPEN" : "LOCKED",
    counts: {
      approvalBlockers: report.summary.approvalBlockingCount,
      launchLocks: report.summary.launchLockCount,
      warnings: report.summary.warningCount,
      passed: report.summary.passedCount,
      blocked: report.summary.blockedCount,
      totalChecks: report.summary.totalChecks,
    },
    generatedAt: report.generatedAt,
    summary: redact(report.summary.operatorSummary),
    detail: redact(classification.detail),
    next: redact(classification.next),
    approvalBlockers: actionPayload(report.summary.approvalBlockers),
    launchLocks: actionPayload(report.summary.launchLocks),
    warnings: actionPayload(report.summary.warnings),
    environmentChecklist: LIVE_MONEY_JSON_EVIDENCE.environmentChecklist,
    localEnvironmentStatus: localEnvironmentStatus(),
    missingEnvironmentVariables: missingEnvironmentVariables(),
    readOnlyGuarantee,
  };
}

async function main() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const report = await evaluateLivePaymentLaunch({ supabase, storeId });
  const classification = classify(report);

  if (jsonOutput) {
    console.log(JSON.stringify(statusPayload(report, classification), null, 2));
    if (!classification.readyForRuntimeSwitch && !allowBlocked) {
      process.exitCode = 1;
    }
    return;
  }

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
  console.log(`Evidence schema: ${LIVE_MONEY_JSON_EVIDENCE.schema}`);
  console.log(`Post-smoke raw JSON command: ${LIVE_MONEY_JSON_EVIDENCE.statusCommand}`);
  console.log(`Final-window raw preflight command: ${LIVE_MONEY_JSON_EVIDENCE.preflightCommand}`);
  console.log(`Accepted go-live states: ${LIVE_MONEY_JSON_EVIDENCE.readyStates.join(", ")}`);
  console.log(`Halt states: ${LIVE_MONEY_JSON_EVIDENCE.blockedStates.join(", ")}`);
  console.log(`Archive requirement: ${LIVE_MONEY_JSON_EVIDENCE.archiveRequirement}`);
  printEnvironmentChecklist();
  console.log(`Read-only guarantee: ${readOnlyGuarantee}`);

  if (!classification.readyForRuntimeSwitch && !allowBlocked) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const payload = {
    schema: LIVE_MONEY_JSON_EVIDENCE.schema,
    liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
    state: "BLOCKED_UNEVALUATED" as const,
    readyForRuntimeSwitch: false,
    detail: redact(error?.message || error || "unknown error"),
    next: "Restore the missing bootstrap environment listed in missingEnvironmentVariables, then rerun npm run status:live-money.",
    environmentChecklist: LIVE_MONEY_JSON_EVIDENCE.environmentChecklist,
    localEnvironmentStatus: localEnvironmentStatus(),
    missingEnvironmentVariables: missingEnvironmentVariables(),
    readOnlyGuarantee: failedReadOnlyGuarantee,
  };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
    if (!allowBlocked) {
      process.exitCode = 1;
    }
    return;
  }

  console.log("Live money go/no-go status:");
  console.log("- state: BLOCKED_UNEVALUATED");
  console.log("- ready for runtime switch: no");
  console.log(`- detail: ${payload.detail}`);
  console.log(
    `- next: ${payload.next}`,
  );
  console.log(`Evidence schema: ${LIVE_MONEY_JSON_EVIDENCE.schema}`);
  console.log(`Post-smoke raw JSON command: ${LIVE_MONEY_JSON_EVIDENCE.statusCommand}`);
  console.log(`Final-window raw preflight command: ${LIVE_MONEY_JSON_EVIDENCE.preflightCommand}`);
  console.log(`Accepted go-live states: ${LIVE_MONEY_JSON_EVIDENCE.readyStates.join(", ")}`);
  console.log(`Halt states: ${LIVE_MONEY_JSON_EVIDENCE.blockedStates.join(", ")}`);
  console.log(`Archive requirement: ${LIVE_MONEY_JSON_EVIDENCE.archiveRequirement}`);
  printEnvironmentChecklist();
  console.log(`Read-only guarantee: ${failedReadOnlyGuarantee}`);
  if (!allowBlocked) {
    process.exitCode = 1;
  }
});

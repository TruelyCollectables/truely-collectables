import type { SupabaseClient } from "@supabase/supabase-js";
import { getDryRunShippingCleanupSummary } from "./shipping-dry-run-cleanup";
import { buildShippingProviderSetupPacket } from "./shipping-provider-setup";
import { runShippingSimulationSuite } from "./shipping-simulations";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

export const LIVE_SHIPPING_APPROVAL_VERSION = "tcos-live-shipping-v1";

export type LiveShippingCheckStatus = "passed" | "warning" | "blocked";

export type LiveShippingLaunchCheck = {
  key: string;
  label: string;
  status: LiveShippingCheckStatus;
  detail: string;
};

export type LiveShippingLaunchReport = {
  approvalVersion: string;
  generatedAt: string;
  purchaseMode: "dry_run" | "live";
  approvalDatabaseReady: boolean;
  approvalReady: boolean;
  liveShippingEnabled: boolean;
  checks: LiveShippingLaunchCheck[];
};

type GateRow = {
  gate_status?: string | null;
  approval_version?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
};

function check(
  key: string,
  label: string,
  status: LiveShippingCheckStatus,
  detail: string,
): LiveShippingLaunchCheck {
  return { key, label, status, detail };
}

function shippingPurchaseMode() {
  return process.env.TCOS_SHIPPING_PURCHASE_MODE === "live"
    ? ("live" as const)
    : ("dry_run" as const);
}

export function getLiveShippingGateErrorDetail(error: {
  code?: string;
  message?: string;
}): string {
  const message = error.message || "Unknown Supabase error.";
  const missingGateTable =
    error.code === "42P01" ||
    /live_shipping_launch_(gates|events)|schema cache|does not exist|relation .* not found/i.test(
      message,
    );

  if (missingGateTable) {
    return "Live shipping approval tables are unavailable. Apply supabase/migrations/20260711185500_create_live_shipping_launch_gate.sql before enabling live postage.";
  }

  return `Live shipping approval could not be verified: ${message}`;
}

export async function getLiveShippingRuntimeGate(params?: {
  supabase?: SupabaseClient;
  storeId?: string;
}) {
  const purchaseMode = shippingPurchaseMode();

  if (purchaseMode === "dry_run") {
    return {
      allowed: true,
      mode: "dry_run" as const,
      reason: null,
    };
  }

  if (process.env.TCOS_LIVE_SHIPPING_ENABLED !== "true") {
    return {
      allowed: false,
      mode: "live" as const,
      reason: "Live shipping is administratively locked.",
    };
  }

  const supabase =
    params?.supabase || createSupabaseServerClient({ admin: true });
  const storeId = params?.storeId || getActiveStoreId();
  const { data, error } = await supabase
    .from("live_shipping_launch_gates")
    .select("gate_status,approval_version")
    .eq("store_id", storeId)
    .maybeSingle();

  const approved =
    !error &&
    data?.gate_status === "approved" &&
    data?.approval_version === LIVE_SHIPPING_APPROVAL_VERSION;

  if (!approved) {
    return {
      allowed: false,
      mode: "live" as const,
      reason: error
        ? getLiveShippingGateErrorDetail(error)
        : "Live shipping requires current administrator launch approval.",
    };
  }

  const providerSetup = buildShippingProviderSetupPacket();
  const requirementBlockers = providerSetup.liveRequirements
    .filter((requirement) => requirement.status !== "ready")
    .map((requirement) => requirement.label);
  const setupBlocked = ["needs_provider_setup", "live_blocked"].includes(
    providerSetup.decision.status,
  );

  if (setupBlocked || requirementBlockers.length > 0) {
    return {
      allowed: false,
      mode: "live" as const,
      reason: `Live shipping is blocked by provider setup or approval requirements: ${[
        ...providerSetup.decision.blockers,
        ...requirementBlockers,
      ].join(", ") || providerSetup.decision.summary}.`,
    };
  }

  const dryRunShippingCleanup = await getDryRunShippingCleanupSummary({
    supabase,
    storeId,
  });

  if (dryRunShippingCleanup.error || dryRunShippingCleanup.total > 0) {
    return {
      allowed: false,
      mode: "live" as const,
      reason: dryRunShippingCleanup.error
        ? `Live shipping is blocked because dry-run shipping cleanup could not be verified: ${dryRunShippingCleanup.error.message}`
        : `Live shipping is blocked until dry-run shipping cleanup is complete. ${dryRunShippingCleanup.detail}`,
    };
  }

  return {
    allowed: true,
    mode: "live" as const,
    reason: null,
  };
}

export async function evaluateLiveShippingLaunch(params?: {
  supabase?: SupabaseClient;
  storeId?: string;
}): Promise<LiveShippingLaunchReport> {
  const supabase =
    params?.supabase || createSupabaseServerClient({ admin: true });
  const storeId = params?.storeId || getActiveStoreId();
  const purchaseMode = shippingPurchaseMode();
  const checks: LiveShippingLaunchCheck[] = [];

  const [gateResult, dryRunShippingCleanup, simulationResult] = await Promise.all([
    supabase
      .from("live_shipping_launch_gates")
      .select("gate_status,approval_version,approved_at,approved_by")
      .eq("store_id", storeId)
      .maybeSingle(),
    getDryRunShippingCleanupSummary({ supabase, storeId }),
    runShippingSimulationSuite(),
  ]);
  const providerSetup = buildShippingProviderSetupPacket();
  const gate = (gateResult.data || null) as GateRow | null;
  const databaseApproved =
    !gateResult.error &&
    gate?.gate_status === "approved" &&
    gate?.approval_version === LIVE_SHIPPING_APPROVAL_VERSION;
  const approvalDatabaseReady = !gateResult.error;

  checks.push(
    check(
      "database_approval",
      "Administrator Approval",
      databaseApproved ? "passed" : "blocked",
      databaseApproved
        ? `Approved by ${gate?.approved_by || "TCOS admin"} at ${gate?.approved_at || "an unknown time"}.`
        : gateResult.error
          ? getLiveShippingGateErrorDetail(gateResult.error)
          : "The auditable database launch approval is locked or stale.",
    ),
  );

  checks.push(
    check(
      "runtime_switch",
      "Environment Kill Switch",
      process.env.TCOS_LIVE_SHIPPING_ENABLED === "true" ? "passed" : "blocked",
      process.env.TCOS_LIVE_SHIPPING_ENABLED === "true"
        ? "TCOS_LIVE_SHIPPING_ENABLED is true. Database revocation can still stop live shipping."
        : "TCOS_LIVE_SHIPPING_ENABLED is not true, so live shipping is hard-locked.",
    ),
  );

  checks.push(
    check(
      "purchase_mode",
      "Shipping Purchase Mode",
      purchaseMode === "live" ? "warning" : "passed",
      purchaseMode === "live"
        ? "TCOS_SHIPPING_PURCHASE_MODE is live. Keep the database gate revoked unless the adapter has passed all live requirements."
        : "TCOS_SHIPPING_PURCHASE_MODE is dry_run, which is the safe staging mode for approval review.",
    ),
  );

  checks.push(
    check(
      "provider_setup",
      "Provider Setup Verdict",
      providerSetup.decision.status === "needs_provider_setup" ||
        providerSetup.decision.status === "live_blocked"
        ? "blocked"
        : "warning",
      `${providerSetup.decision.summary} ${providerSetup.decision.nextAction}`,
    ),
  );

  checks.push(
    check(
      "live_requirements",
      "Live Adapter Approval Checklist",
      providerSetup.liveRequirements.every(
        (requirement) => requirement.status === "ready",
      )
        ? "passed"
        : "blocked",
      `${providerSetup.liveRequirements.filter((requirement) => requirement.status === "ready").length}/${providerSetup.liveRequirements.length} live-shipping requirement(s) ready. Blockers: ${
        providerSetup.liveRequirements
          .filter((requirement) => requirement.status !== "ready")
          .map((requirement) => requirement.label)
          .join(", ") || "none"
      }.`,
    ),
  );

  checks.push(
    check(
      "shipping_simulations",
      "Shipping Simulation Suite",
      simulationResult.run_status === "passed" ? "passed" : "blocked",
      `${simulationResult.passed_count}/${simulationResult.scenario_count} shipping simulation scenario(s) passed.`,
    ),
  );

  checks.push(
    check(
      "live_approval_report",
      "Live Shipping Approval Report",
      simulationResult.live_approval.approval_status ===
        "ready_to_request_live_mode"
        ? "passed"
        : "blocked",
      `${simulationResult.live_approval.detail} Blockers: ${
        simulationResult.live_approval.blockers.join(", ") || "none"
      }.`,
    ),
  );

  checks.push(
    check(
      "dry_run_shipping_cleanup",
      "Dry-Run Shipping Cleanup",
      !dryRunShippingCleanup.error && dryRunShippingCleanup.total === 0
        ? "passed"
        : "blocked",
      dryRunShippingCleanup.error
        ? `Dry-run shipping cleanup could not be checked: ${dryRunShippingCleanup.error.message}`
        : dryRunShippingCleanup.detail,
    ),
  );

  const approvalExclusions = new Set(["database_approval", "runtime_switch"]);
  const approvalReady = checks.every(
    (item) => item.status !== "blocked" || approvalExclusions.has(item.key),
  );
  const liveShippingEnabled =
    approvalReady &&
    databaseApproved &&
    process.env.TCOS_LIVE_SHIPPING_ENABLED === "true" &&
    purchaseMode === "live";

  return {
    approvalVersion: LIVE_SHIPPING_APPROVAL_VERSION,
    generatedAt: new Date().toISOString(),
    purchaseMode,
    approvalDatabaseReady,
    approvalReady,
    liveShippingEnabled,
    checks,
  };
}

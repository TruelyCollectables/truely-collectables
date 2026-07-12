import { NextResponse } from "next/server";
import { getDryRunShippingCleanupSummary } from "../../../../lib/shipping-dry-run-cleanup";
import { buildShippingProviderSetupPacket } from "../../../../lib/shipping-provider-setup";
import { evaluateLivePaymentLaunch } from "../../../../lib/live-payment-launch";
import { evaluateLiveShippingLaunch } from "../../../../lib/live-shipping-launch";
import { runLaunchGateDrill } from "../../../../lib/launch-gate-drill";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type BriefItem = {
  label: string;
  status: "ready" | "review" | "blocked";
  detail: string;
  action: string;
};

function statusFromCheck(status: "passed" | "warning" | "blocked") {
  if (status === "passed") return "ready" as const;
  if (status === "warning") return "review" as const;
  return "blocked" as const;
}

function summarize(items: BriefItem[]) {
  return {
    ready: items.filter((item) => item.status === "ready").length,
    review: items.filter((item) => item.status === "review").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}

function sortAttentionItems(items: BriefItem[]) {
  const rank: Record<BriefItem["status"], number> = {
    blocked: 0,
    review: 1,
    ready: 2,
  };

  return items
    .filter((item) => item.status !== "ready")
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

function markdownList(items: BriefItem[]) {
  if (items.length === 0) return "- None";

  return items
    .map(
      (item) =>
        `- **${item.status.toUpperCase()} — ${item.label}:** ${item.detail} Next: ${item.action}`,
    )
    .join("\n");
}

function markdownForBrief(brief: Awaited<ReturnType<typeof buildBrief>>) {
  return [
    "# TCOS Launch Readiness Brief",
    "",
    `Generated: ${brief.generatedAt}`,
    `Store: ${brief.storeId}`,
    "",
    "## Summary",
    "",
    `- Ready: ${brief.summary.ready}`,
    `- Review: ${brief.summary.review}`,
    `- Blocked: ${brief.summary.blocked}`,
    "",
    "## Payment",
    "",
    `- Mode: ${brief.payment.mode}`,
    `- Live enabled: ${brief.payment.livePaymentsEnabled ? "yes" : "no"}`,
    `- Approval ready: ${brief.payment.approvalReady ? "yes" : "no"}`,
    `- Posture: ${brief.payment.posture}`,
    "",
    "## Shipping",
    "",
    `- Mode: ${brief.shipping.mode}`,
    `- Live enabled: ${brief.shipping.liveShippingEnabled ? "yes" : "no"}`,
    `- Approval ready: ${brief.shipping.approvalReady ? "yes" : "no"}`,
    `- Posture: ${brief.shipping.posture}`,
    `- Dry-run cleanup: ${brief.shipping.dryRunCleanup}`,
    "",
    "## Attention Items",
    "",
    markdownList(brief.attentionItems),
    "",
    "## Launch Drill",
    "",
    `- Passed: ${brief.drill.passed}`,
    `- Review: ${brief.drill.warning}`,
    `- Failed: ${brief.drill.failed}`,
    "",
  ].join("\n");
}

async function buildBrief() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();

  const [
    paymentReport,
    shippingReport,
    drillReport,
    dryRunCleanup,
  ] = await Promise.all([
    evaluateLivePaymentLaunch({ supabase, storeId }),
    evaluateLiveShippingLaunch({ supabase, storeId }),
    runLaunchGateDrill({ supabase, storeId }),
    getDryRunShippingCleanupSummary({ supabase, storeId, sampleLimit: 500 }),
  ]);
  const providerSetup = buildShippingProviderSetupPacket();

  const paymentItems: BriefItem[] = paymentReport.checks.map((check) => ({
    label: `Payment: ${check.label}`,
    status: statusFromCheck(check.status),
    detail: check.detail,
    action: "Open /admin/live-payment-launch and clear this payment launch check.",
  }));
  const shippingItems: BriefItem[] = shippingReport.checks.map((check) => ({
    label: `Shipping: ${check.label}`,
    status: statusFromCheck(check.status),
    detail: check.detail,
    action: "Open /admin/live-shipping-launch or /admin/shipping and clear this shipping launch check.",
  }));
  const providerItems: BriefItem[] = providerSetup.readiness.map((item) => ({
    label: `Provider: ${item.label}`,
    status:
      item.status === "ready"
        ? "ready"
        : item.status === "blocked"
          ? "blocked"
          : "review",
    detail: item.detail,
    action: item.action,
  }));
  const dryRunCleanupItem: BriefItem = dryRunCleanup.error
    ? {
        label: "Dry-Run Shipping Cleanup",
        status: "blocked",
        detail: `Dry-run cleanup could not be checked: ${dryRunCleanup.error.message}`,
        action: "Open /admin/shipping#dry-run-cleanup after shipping migrations are available.",
      }
    : dryRunCleanup.total > 0
      ? {
          label: "Dry-Run Shipping Cleanup",
          status: "blocked",
          detail: dryRunCleanup.detail,
          action: "Open /admin/shipping#dry-run-cleanup and retire simulated proof before launch.",
        }
      : {
          label: "Dry-Run Shipping Cleanup",
          status: "ready",
          detail: dryRunCleanup.detail,
          action: "Keep dry-run cleanup clear before seller payout release or shipping launch.",
        };

  const items = [
    ...paymentItems,
    ...shippingItems,
    ...providerItems,
    dryRunCleanupItem,
  ];
  const attentionItems = sortAttentionItems(items).slice(0, 15);

  return {
    generatedAt: new Date().toISOString(),
    storeId,
    summary: summarize(items),
    payment: {
      mode: paymentReport.paymentMode,
      livePaymentsEnabled: paymentReport.livePaymentsEnabled,
      approvalDatabaseReady: paymentReport.approvalDatabaseReady,
      approvalReady: paymentReport.approvalReady,
      posture: drillReport.posture.payment.label,
    },
    shipping: {
      mode: shippingReport.purchaseMode,
      liveShippingEnabled: shippingReport.liveShippingEnabled,
      approvalDatabaseReady: shippingReport.approvalDatabaseReady,
      approvalReady: shippingReport.approvalReady,
      posture: drillReport.posture.shipping.label,
      dryRunCleanup: dryRunCleanup.detail,
      providerSetupStatus: providerSetup.decision.status,
      providerSetupSummary: providerSetup.decision.summary,
    },
    drill: {
      passed: drillReport.summary.passed,
      warning: drillReport.summary.warning,
      failed: drillReport.summary.failed,
    },
    attentionItems,
  };
}

export async function GET(request: Request) {
  try {
    const brief = await buildBrief();
    const format = new URL(request.url).searchParams.get("format");

    if (format === "markdown" || format === "md") {
      return new Response(markdownForBrief(brief), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="tcos-launch-readiness-brief.md"',
          "Content-Type": "text/markdown; charset=utf-8",
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        brief,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not build launch readiness brief.",
      },
      { status: 500 },
    );
  }
}

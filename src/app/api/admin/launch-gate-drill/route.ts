import { NextResponse, type NextRequest } from "next/server";
import {
  runLaunchGateDrill,
  type LaunchGateDrillReport,
  type LaunchGatePosture,
} from "../../../../lib/launch-gate-drill";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function markdownList(items: string[]) {
  if (items.length === 0) return "- None.";

  return items.map((item) => `- ${item}`).join("\n");
}

function postureMarkdown(title: string, posture: LaunchGatePosture) {
  return [
    `## ${title}`,
    "",
    `- Status: ${posture.status}`,
    `- Label: ${posture.label}`,
    `- Detail: ${posture.detail}`,
    "",
    "### Blocking Checks",
    "",
    markdownList(posture.blockedChecks),
    "",
    "### Warning Checks",
    "",
    markdownList(posture.warningChecks),
    "",
    "### Next Actions",
    "",
    markdownList(posture.nextActions),
    "",
  ].join("\n");
}

function reportMarkdown(report: LaunchGateDrillReport) {
  return [
    "# TCOS Launch Gate Drill Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Store: ${report.storeId}`,
    "",
    "## Summary",
    "",
    `- Passed: ${report.summary.passed}`,
    `- Review: ${report.summary.warning}`,
    `- Failed: ${report.summary.failed}`,
    `- Payment runtime: ${report.payment.paymentMode}; live payments ${report.payment.livePaymentsEnabled ? "enabled" : "locked"}`,
    `- Shipping runtime: ${report.shipping.purchaseMode}; live shipping ${report.shipping.liveShippingEnabled ? "enabled" : "locked"}`,
    "",
    postureMarkdown("Payment Launch Posture", report.posture.payment),
    postureMarkdown("Shipping Launch Posture", report.posture.shipping),
    "## Drill Checks",
    "",
    ...report.checks.flatMap((check) => [
      `### ${check.label}`,
      "",
      `- Key: ${check.key}`,
      `- Status: ${check.status}`,
      `- Detail: ${check.detail}`,
      "",
    ]),
    "## Side-effect Guardrails",
    "",
    report.sideEffectPolicy.assurance,
    "",
    "### Allowed Operations",
    "",
    markdownList(report.sideEffectPolicy.allowedOperations),
    "",
    "### Forbidden Operations",
    "",
    markdownList(report.sideEffectPolicy.forbiddenOperations),
    "",
  ].join("\n");
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const report = await runLaunchGateDrill({ supabase });

    if (request.nextUrl.searchParams.get("format") === "markdown") {
      return new NextResponse(reportMarkdown(report), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="tcos-launch-gate-drill-report.md"',
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ success: true, report });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not run the launch gate drill.",
      },
      { status: 500 },
    );
  }
}

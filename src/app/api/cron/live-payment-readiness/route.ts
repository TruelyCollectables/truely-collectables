import { timingSafeEqual } from "node:crypto";
import { evaluateLivePaymentLaunch } from "../../../../lib/live-payment-launch";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Protected live-payment readiness is not configured." },
      { status: 503 },
    );
  }

  if (!validCronAuthorization(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const originalSwitch = process.env.TCOS_LIVE_PAYMENTS_ENABLED;
  process.env.TCOS_LIVE_PAYMENTS_ENABLED = "true";

  try {
    const report = await evaluateLivePaymentLaunch({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
    });

    return Response.json(
      {
        success: true,
        evaluatedAt: new Date().toISOString(),
        simulatedFinalRuntimeSwitch: true,
        actualRuntimeSwitchEnabled: originalSwitch === "true",
        paymentMode: report.paymentMode,
        livePaymentsEnabled: report.livePaymentsEnabled,
        approvalDatabaseReady: report.approvalDatabaseReady,
        approvalReady: report.approvalReady,
        summary: report.summary,
        checks: report.checks.map((check) => ({
          key: check.key,
          label: check.label,
          status: check.status,
          detail: check.detail,
        })),
        readOnlyGuarantee:
          "This protected endpoint performs read-only launch evaluation only. It does not create Checkout Sessions, payments, refunds, disputes, payouts, postage, approvals, revocations, deployments, or environment changes.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Protected live-payment readiness failed.",
      },
      { status: 500 },
    );
  } finally {
    if (originalSwitch === undefined) {
      delete process.env.TCOS_LIVE_PAYMENTS_ENABLED;
    } else {
      process.env.TCOS_LIVE_PAYMENTS_ENABLED = originalSwitch;
    }
  }
}

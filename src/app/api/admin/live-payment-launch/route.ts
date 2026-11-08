import { NextResponse } from "next/server";
import {
  evaluateLivePaymentLaunch,
  getLivePaymentGateErrorDetail,
  LIVE_PAYMENT_APPROVAL_VERSION,
} from "../../../../lib/live-payment-launch";
import { LIVE_MONEY_JSON_EVIDENCE } from "../../../../lib/live-money-evidence";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const report = await evaluateLivePaymentLaunch({ supabase });
    return NextResponse.json({
      success: true,
      report,
      liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || "Could not evaluate the live payment gate.",
        liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action, 20);
    const operator = clean(body.operator, 120);
    const note = clean(body.note, 1000) || null;
    const confirmation = clean(body.confirmation, 80);

    if (!operator) {
      return NextResponse.json(
        {
          error: "Operator name is required for the immutable launch audit.",
          liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
        },
        { status: 400 },
      );
    }

    if (action === "approve" && confirmation !== "APPROVE LIVE PAYMENTS") {
      return NextResponse.json(
        {
          error: "Type APPROVE LIVE PAYMENTS exactly.",
          liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
        },
        { status: 400 },
      );
    }
    if (action === "revoke" && confirmation !== "REVOKE LIVE PAYMENTS") {
      return NextResponse.json(
        {
          error: "Type REVOKE LIVE PAYMENTS exactly.",
          liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
        },
        { status: 400 },
      );
    }
    if (action !== "approve" && action !== "revoke") {
      return NextResponse.json(
        {
          error: "Invalid gate action.",
          liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const report = await evaluateLivePaymentLaunch({ supabase, storeId });

    if (action === "approve" && !report.approvalDatabaseReady) {
      return NextResponse.json(
        {
          error:
            "Live payment approval tables are unavailable. Apply the live-payment launch gate migration before approving live Checkout.",
          report,
          liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
        },
        { status: 409 },
      );
    }

    if (action === "approve" && !report.approvalReady) {
      return NextResponse.json(
        {
          error: "Live payment approval is blocked until every required check passes.",
          report,
          liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const gatePayload: Record<string, unknown> =
      action === "approve"
        ? {
            store_id: storeId,
            gate_status: "approved",
            approval_version: LIVE_PAYMENT_APPROVAL_VERSION,
            approved_at: now,
            approved_by: operator,
            approval_note: note,
            revoked_at: null,
            revoked_by: null,
            last_report: report,
            updated_at: now,
          }
        : {
            store_id: storeId,
            gate_status: "revoked",
            approval_version: LIVE_PAYMENT_APPROVAL_VERSION,
            approved_at: null,
            approved_by: null,
            approval_note: null,
            revoked_at: now,
            revoked_by: operator,
            last_report: report,
            updated_at: now,
          };

    const { error: gateError } = await supabase
      .from("live_payment_launch_gates")
      .upsert(gatePayload, { onConflict: "store_id" });
    if (gateError) throw gateError;

    const { error: eventError } = await supabase
      .from("live_payment_launch_events")
      .insert({
        store_id: storeId,
        event_type: action === "approve" ? "approved" : "revoked",
        approval_version: LIVE_PAYMENT_APPROVAL_VERSION,
        actor: operator,
        note,
        report,
      });
    if (eventError) throw eventError;

    return NextResponse.json({
      success: true,
      action,
      liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
      runtimeSwitchEnabled:
        process.env.TCOS_LIVE_PAYMENTS_ENABLED === "true",
    });
  } catch (error: any) {
    const detail = error?.message || "Could not change the live payment gate.";
    const status =
      /live_payment_launch_|schema cache|does not exist|relation .* not found/i.test(
        detail,
      )
        ? 409
        : 500;

    return NextResponse.json(
      {
        error: getLivePaymentGateErrorDetail(error || { message: detail }),
        liveMoneyEvidence: LIVE_MONEY_JSON_EVIDENCE,
      },
      { status },
    );
  }
}

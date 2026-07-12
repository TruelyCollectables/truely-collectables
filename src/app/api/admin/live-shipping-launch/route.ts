import { NextResponse } from "next/server";
import {
  evaluateLiveShippingLaunch,
  LIVE_SHIPPING_APPROVAL_VERSION,
} from "../../../../lib/live-shipping-launch";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const report = await evaluateLiveShippingLaunch({ supabase });
    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not evaluate the live shipping gate." },
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
        { error: "Operator name is required for the immutable launch audit." },
        { status: 400 },
      );
    }

    if (action === "approve" && confirmation !== "APPROVE LIVE SHIPPING") {
      return NextResponse.json(
        { error: "Type APPROVE LIVE SHIPPING exactly." },
        { status: 400 },
      );
    }
    if (action === "revoke" && confirmation !== "REVOKE LIVE SHIPPING") {
      return NextResponse.json(
        { error: "Type REVOKE LIVE SHIPPING exactly." },
        { status: 400 },
      );
    }
    if (action !== "approve" && action !== "revoke") {
      return NextResponse.json({ error: "Invalid gate action." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const report = await evaluateLiveShippingLaunch({ supabase, storeId });

    if (action === "approve" && !report.approvalReady) {
      return NextResponse.json(
        {
          error:
            "Live shipping approval is blocked until every required check passes.",
          report,
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
            approval_version: LIVE_SHIPPING_APPROVAL_VERSION,
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
            approval_version: LIVE_SHIPPING_APPROVAL_VERSION,
            approved_at: null,
            approved_by: null,
            approval_note: null,
            revoked_at: now,
            revoked_by: operator,
            last_report: report,
            updated_at: now,
          };

    const { error: gateError } = await supabase
      .from("live_shipping_launch_gates")
      .upsert(gatePayload, { onConflict: "store_id" });
    if (gateError) throw gateError;

    const { error: eventError } = await supabase
      .from("live_shipping_launch_events")
      .insert({
        store_id: storeId,
        event_type: action === "approve" ? "approved" : "revoked",
        approval_version: LIVE_SHIPPING_APPROVAL_VERSION,
        actor: operator,
        note,
        report,
      });
    if (eventError) throw eventError;

    return NextResponse.json({
      success: true,
      action,
      runtimeSwitchEnabled: process.env.TCOS_LIVE_SHIPPING_ENABLED === "true",
      purchaseMode: report.purchaseMode,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not change the live shipping gate." },
      { status: 500 },
    );
  }
}

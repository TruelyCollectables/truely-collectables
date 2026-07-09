import { NextResponse } from "next/server";
import { refreshTransactionEvidenceReportForOrder } from "../../../../lib/transaction-evidence";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

    const body = await req.json();

    const orderId = Number(body.orderId);
    const carrier = String(body.carrier || "").trim();
    const trackingNumber = String(body.trackingNumber || "").trim();

    if (!orderId || !carrier || !trackingNumber) {
      return NextResponse.json(
        { error: "Missing orderId, carrier, or trackingNumber" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("orders")
      .update({
        carrier,
        tracking_number: trackingNumber,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    try {
      await refreshTransactionEvidenceReportForOrder({
        supabase,
        orderId,
        storeId,
      });
    } catch (reportError: any) {
      console.error(
        "Evidence report refresh after tracking update failed:",
        reportError.message || reportError
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Tracking update failed" },
      { status: 500 }
    );
  }
}

import {
  buildLetterTrackExport,
  letterTrackCsvContent,
  type LetterTrackExportLabel,
  type LetterTrackExportOrder,
} from "../../../../../lib/lettertrack-export";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const exportableStatuses = ["planned", "purchase_pending", "rate_selected"];

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

    const { data: labelsData, error: labelsError } = await supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,label_status,requested_shipping_method,resolved_shipping_method,coverage_amount,coverage_status,metadata,created_at",
      )
      .eq("store_id", storeId)
      .eq("resolved_shipping_method", "STANDARD_ENVELOPE")
      .in("label_status", exportableStatuses)
      .order("created_at", { ascending: true })
      .limit(500);

    if (labelsError) throw labelsError;

    const labels = (labelsData || []) as LetterTrackExportLabel[];
    const orderIds = Array.from(new Set(labels.map((label) => label.order_id)));

    const ordersResult =
      orderIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("orders")
            .select(
              "id,customer_email,customer_name,shipping_name,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_postal_code,shipping_country,subtotal,total,item_count",
            )
            .eq("store_id", storeId)
            .in("id", orderIds);

    if (ordersResult.error) throw ordersResult.error;

    const ordersById = new Map(
      ((ordersResult.data || []) as LetterTrackExportOrder[]).map((order) => [
        order.id,
        order,
      ]),
    );
    const exportResult = buildLetterTrackExport({
      labels,
      ordersById,
    });
    const csv = letterTrackCsvContent(exportResult.rows);
    const exportedAt = exportResult.exportedAt.replace(/[:.]/g, "-");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tcos-lettertrack-standard-envelope-${exportedAt}.csv"`,
        "Cache-Control": "no-store",
        "X-TCOS-LetterTrack-Rows": String(exportResult.rows.length),
        "X-TCOS-LetterTrack-Skipped": String(exportResult.skipped.length),
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not export LetterTrack CSV." },
      { status: 500 },
    );
  }
}

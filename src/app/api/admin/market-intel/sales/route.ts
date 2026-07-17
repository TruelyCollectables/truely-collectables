import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

function numberValue(formData: FormData, name: string, fallback = 0) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid number.`);
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const purchaseLotId = String(formData.get("purchaseLotId") ?? "").trim();

  if (!purchaseLotId) {
    return NextResponse.redirect(
      new URL("/admin/market-intel/purchases?error=Missing purchase lot", request.url),
      303,
    );
  }

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const quantitySold = numberValue(formData, "quantitySold");

    if (!Number.isInteger(quantitySold) || quantitySold <= 0) {
      throw new Error("Quantity sold must be a positive whole number.");
    }

    const { data: performance, error: performanceError } = await supabase
      .from("tcos_mi_purchase_performance")
      .select("quantity_remaining")
      .eq("purchase_lot_id", purchaseLotId)
      .single();

    if (performanceError) {
      throw new Error(
        `Unable to verify remaining inventory: ${performanceError.message}`,
      );
    }

    if (quantitySold > Number(performance.quantity_remaining)) {
      throw new Error(
        `Cannot sell ${quantitySold}; only ${performance.quantity_remaining} remain.`,
      );
    }

    const soldAt = String(formData.get("soldAt") ?? "").trim();
    if (!soldAt) throw new Error("Sale date is required.");

    const payload = {
      purchase_lot_id: purchaseLotId,
      marketplace_id:
        String(formData.get("marketplaceId") ?? "").trim() || null,
      sold_at: new Date(`${soldAt}T12:00:00`).toISOString(),
      quantity_sold: quantitySold,
      gross_item_sales: numberValue(formData, "grossItemSales"),
      shipping_charged: numberValue(formData, "shippingCharged"),
      marketplace_fees: numberValue(formData, "marketplaceFees"),
      payment_processing_fees: numberValue(
        formData,
        "paymentProcessingFees",
      ),
      actual_postage: numberValue(formData, "actualPostage"),
      supplies_cost: numberValue(formData, "suppliesCost"),
      refunds_and_adjustments: numberValue(
        formData,
        "refundsAndAdjustments",
      ),
      external_order_id:
        String(formData.get("externalOrderId") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    };

    const { error: insertError } = await supabase
      .from("tcos_mi_inventory_sales")
      .insert(payload);

    if (insertError) {
      throw new Error(`Unable to save sale: ${insertError.message}`);
    }

    const nextRemaining = Number(performance.quantity_remaining) - quantitySold;
    const nextStatus = nextRemaining === 0 ? "sold_out" : "partially_sold";

    const { error: updateError } = await supabase
      .from("tcos_mi_purchase_lots")
      .update({ status: nextStatus })
      .eq("id", purchaseLotId);

    if (updateError) {
      throw new Error(
        `Sale saved, but purchase status update failed: ${updateError.message}`,
      );
    }

    return NextResponse.redirect(
      new URL(
        `/admin/market-intel/purchases/${purchaseLotId}?saved=1`,
        request.url,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save sale.";
    return NextResponse.redirect(
      new URL(
        `/admin/market-intel/purchases/${purchaseLotId}?error=${encodeURIComponent(
          message,
        )}`,
        request.url,
      ),
      303,
    );
  }
}

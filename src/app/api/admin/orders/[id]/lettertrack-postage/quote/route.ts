import { quoteLetterTrackShipStationPostage } from "@/src/lib/lettertrack-shipstation";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return Response.json({ error: "Missing order id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const ounces = Number(body?.ounces ?? 1);
    if (!Number.isFinite(ounces) || ounces <= 0 || ounces > 3.5) {
      return Response.json(
        { error: "Letter quote weight must be greater than 0 and no more than 3.5 ounces." },
        { status: 422 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: order, error } = await supabase
      .from("orders")
      .select(
        "id,shipping_name,customer_name,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_postal_code,shipping_country",
      )
      .eq("id", orderId)
      .eq("store_id", storeId)
      .single();

    if (error || !order) {
      return Response.json(
        { error: error?.message || "Order not found." },
        { status: 404 },
      );
    }

    const shipTo = {
      name: clean(order.shipping_name) || clean(order.customer_name),
      addressLine1: clean(order.shipping_address_line1),
      addressLine2: clean(order.shipping_address_line2) || null,
      city: clean(order.shipping_city),
      state: clean(order.shipping_state),
      postalCode: clean(order.shipping_postal_code),
      countryCode: clean(order.shipping_country) || "US",
    };
    const missing = Object.entries({
      name: shipTo.name,
      addressLine1: shipTo.addressLine1,
      city: shipTo.city,
      state: shipTo.state,
      postalCode: shipTo.postalCode,
    })
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) {
      return Response.json(
        { error: `The order shipping address is incomplete: ${missing.join(", ")}.`, missing },
        { status: 422 },
      );
    }

    const quote = await quoteLetterTrackShipStationPostage({
      orderId,
      ounces,
      shipTo,
    });

    return Response.json(
      {
        success: true,
        postagePurchased: false,
        orderId,
        ounces,
        destination: {
          city: shipTo.city,
          state: shipTo.state,
          postalCode: shipTo.postalCode,
        },
        ...quote,
        message: `ShipStation API quoted $${quote.postageAmount.toFixed(2)} for ${ounces.toFixed(2)} oz USPS First-Class Mail letter postage. No label was purchased.`,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-TCOS-ShipStation-Quote": "no-purchase",
        },
      },
    );
  } catch (error: any) {
    return Response.json(
      {
        error: error?.message || "Could not quote ShipStation letter postage.",
        postagePurchased: false,
      },
      { status: 502 },
    );
  }
}

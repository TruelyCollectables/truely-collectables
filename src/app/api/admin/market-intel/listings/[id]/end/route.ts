import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { requestOrigin } from "../../../../../../../lib/request-origin";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const origin = requestOrigin(request);
  const json = wantsJson(request);

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("tcos_mi_listings")
      .update({
        listing_status: "ended",
        ended_at: now,
        last_seen_at: now,
      })
      .eq("id", id)
      .eq("listing_status", "active")
      .select("id,original_title,quantity")
      .maybeSingle();

    if (error) {
      const missingEndedAt =
        error.message?.toLowerCase().includes("ended_at") ||
        error.message?.toLowerCase().includes("schema cache");

      if (!missingEndedAt) {
        throw new Error(error.message);
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .from("tcos_mi_listings")
        .update({
          listing_status: "ended",
          last_seen_at: now,
        })
        .eq("id", id)
        .eq("listing_status", "active")
        .select("id,original_title,quantity")
        .maybeSingle();

      if (fallbackError) throw new Error(fallbackError.message);
      if (!fallbackData?.id) {
        throw new Error("Listing was not found or is no longer active.");
      }

      if (json) {
        return NextResponse.json({
          success: true,
          listingId: fallbackData.id,
          message: `Ended listing${fallbackData.quantity ? ` with qty ${fallbackData.quantity}` : ""}.`,
        });
      }
    } else if (!data?.id) {
      throw new Error("Listing was not found or is no longer active.");
    } else if (json) {
      return NextResponse.json({
        success: true,
        listingId: data.id,
        message: `Ended listing${data.quantity ? ` with qty ${data.quantity}` : ""}.`,
      });
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/deals?ended=1",
        origin,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to end listing.";
    if (json) {
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/deals?error=${encodeURIComponent(message)}`,
        origin,
        handoff,
      ),
      303,
    );
  }
}

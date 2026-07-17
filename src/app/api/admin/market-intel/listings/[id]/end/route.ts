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

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("tcos_mi_listings")
      .update({
        listing_status: "ended",
        ended_at: now,
        last_seen_at: now,
      })
      .eq("id", id);

    if (error) {
      const missingEndedAt =
        error.message?.toLowerCase().includes("ended_at") ||
        error.message?.toLowerCase().includes("schema cache");

      if (!missingEndedAt) {
        throw new Error(error.message);
      }

      const { error: fallbackError } = await supabase
        .from("tcos_mi_listings")
        .update({
          listing_status: "ended",
          last_seen_at: now,
        })
        .eq("id", id);

      if (fallbackError) throw new Error(fallbackError.message);
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/deals?ended=1",
        requestOrigin(request),
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to end listing.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/deals?error=${encodeURIComponent(message)}`,
        requestOrigin(request),
        handoff,
      ),
      303,
    );
  }
}

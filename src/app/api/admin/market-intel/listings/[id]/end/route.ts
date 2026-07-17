import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { error } = await supabase
      .from("tcos_mi_listings")
      .update({
        listing_status: "ended",
        ended_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(error.message);

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/deals?ended=1",
        request.url,
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
        request.url,
        handoff,
      ),
      303,
    );
  }
}

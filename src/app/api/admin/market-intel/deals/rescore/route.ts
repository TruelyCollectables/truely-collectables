import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { scoreMarketIntelListing } from "../../../../../../lib/market-intel-deals";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("tcos_mi_listings")
      .select("id")
      .eq("listing_status", "active")
      .order("first_seen_at", { ascending: true });

    if (error) throw new Error(error.message);

    let scored = 0;
    const failures: string[] = [];

    for (const listing of data || []) {
      try {
        await scoreMarketIntelListing(listing.id);
        scored += 1;
      } catch (error) {
        failures.push(
          error instanceof Error ? error.message : `Unable to score ${listing.id}`,
        );
      }
    }

    const destination = failures.length
      ? `/admin/market-intel/deals?rescored=${scored}&scoreErrors=${failures.length}`
      : `/admin/market-intel/deals?rescored=${scored}`;

    return NextResponse.redirect(
      adminRedirectUrl(destination, request.url, handoff),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to rescore listings.";
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

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
    const { data, error: readError } = await supabase
      .from("tcos_mi_watchlist")
      .select("active")
      .eq("id", id)
      .single();

    if (readError) throw new Error(readError.message);

    const { error: updateError } = await supabase
      .from("tcos_mi_watchlist")
      .update({ active: !Boolean(data.active) })
      .eq("id", id);

    if (updateError) throw new Error(updateError.message);

    return NextResponse.redirect(
      adminRedirectUrl("/admin/market-intel/watchlist", request.url, handoff),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update watchlist.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/watchlist?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

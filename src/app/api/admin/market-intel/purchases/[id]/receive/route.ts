import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "@/src/lib/admin-handoff";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const adminHandoff = adminHandoffFromUrl(request.nextUrl);

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { error } = await supabase
      .from("tcos_mi_purchase_lots")
      .update({
        status: "in_inventory",
        received_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(error.message);

    const url = adminRedirectUrl(
      `/admin/market-intel/purchases/${id}`,
      request.url,
      adminHandoff,
    );
    url.searchParams.set("saved", "received");

    return NextResponse.redirect(url, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update purchase.";
    const url = adminRedirectUrl(
      `/admin/market-intel/purchases/${id}`,
      request.url,
      adminHandoff,
    );
    url.searchParams.set("error", message);

    return NextResponse.redirect(url, 303);
  }
}

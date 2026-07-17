import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

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

    return NextResponse.redirect(
      new URL(`/admin/market-intel/purchases/${id}?saved=received`, request.url),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update purchase.";
    return NextResponse.redirect(
      new URL(
        `/admin/market-intel/purchases/${id}?error=${encodeURIComponent(message)}`,
        request.url,
      ),
      303,
    );
  }
}

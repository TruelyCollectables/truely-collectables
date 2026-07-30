import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase.from("orders").select("id").limit(1);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        check: "admin-orders-service-role",
        error: error.message,
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      check: "admin-orders-service-role",
      deployment: "fulfillment-hotfix-2026-07-29-2018-mt",
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

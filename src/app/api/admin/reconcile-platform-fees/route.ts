import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("platform_fee_ledger_entries")
      .delete()
      .eq("store_id", storeId)
      .eq("source_type", "tcos_website_checkout")
      .is("seller_account_id", null)
      .select("id");

    if (error) throw error;

    return NextResponse.json({
      success: true,
      removedDirectStoreFeeRows: (data || []).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error?.message || "Unable to reconcile direct-store platform fees.",
      },
      { status: 500 },
    );
  }
}

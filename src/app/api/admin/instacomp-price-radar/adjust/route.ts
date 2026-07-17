import { NextResponse, type NextRequest } from "next/server";
import { adminHandoffFromUrl, adminRedirectUrl } from "../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

const ALLOWED_MULTIPLIERS = new Set([
  0.75,
  0.85,
  0.9,
  0.95,
  1,
  1.05,
  1.1,
  1.15,
  1.25,
]);

function adminRedirect(req: NextRequest, status: string) {
  const requestUrl = new URL(req.url);
  const url = adminRedirectUrl(
    "/admin",
    req.url,
    adminHandoffFromUrl(requestUrl),
  );
  url.searchParams.set("instacomp_price", status);

  return NextResponse.redirect(url, 303);
}

function cents(value: number) {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const productId = Number(formData.get("productId"));
  const multiplier = Number(formData.get("multiplier") || 1);

  if (!Number.isInteger(productId) || productId <= 0) {
    return adminRedirect(req, "bad_product");
  }

  if (!ALLOWED_MULTIPLIERS.has(multiplier)) {
    return adminRedirect(req, "bad_multiplier");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data: snapshot, error: snapshotError } = await supabase
    .from("sales_comp_snapshots")
    .select("suggested_price")
    .eq("store_id", storeId)
    .eq("legacy_product_id", productId)
    .not("suggested_price", "is", null)
    .gt("suggested_price", 0)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapshotError || !snapshot?.suggested_price) {
    return adminRedirect(req, "missing_comp");
  }

  const marketPrice = Number(snapshot.suggested_price);
  const nextPrice = cents(marketPrice * multiplier);
  const { error: updateError } = await supabase
    .from("products")
    .update({ price: nextPrice })
    .eq("store_id", storeId)
    .eq("id", productId);

  if (updateError) {
    return adminRedirect(req, "update_failed");
  }

  return adminRedirect(req, "updated");
}

import { NextResponse, type NextRequest } from "next/server";
import { adminHandoffFromUrl, adminRedirectUrl } from "../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

function adminRedirect(req: NextRequest, status: string) {
  const requestUrl = new URL(req.url);
  const url = adminRedirectUrl(
    "/admin",
    req.url,
    adminHandoffFromUrl(requestUrl),
  );
  url.searchParams.set("instacomp_ignore", status);

  return NextResponse.redirect(url, 303);
}

function ignoreUntil(duration: string) {
  if (duration === "forever") return null;

  const days = duration === "30d" ? 30 : duration === "14d" ? 14 : null;
  if (!days) return undefined;

  const date = new Date();
  date.setDate(date.getDate() + days);

  return date.toISOString();
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const productId = Number(formData.get("productId"));
  const duration = String(formData.get("duration") || "");
  const until = ignoreUntil(duration);

  if (!Number.isInteger(productId) || productId <= 0) {
    return adminRedirect(req, "bad_product");
  }

  if (until === undefined) {
    return adminRedirect(req, "bad_duration");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { error } = await supabase
    .from("instacomp_price_radar_ignores")
    .upsert(
      {
        store_id: storeId,
        legacy_product_id: productId,
        ignore_forever: duration === "forever",
        ignore_until: until,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,legacy_product_id" },
    );

  if (error) {
    return adminRedirect(req, "save_failed");
  }

  return adminRedirect(req, "saved");
}

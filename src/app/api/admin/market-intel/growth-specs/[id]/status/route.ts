import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUSES = new Set([
  "active",
  "watch",
  "bought",
  "passed",
  "sold",
  "expired",
]);

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const formData = await request.formData();
    const status = String(formData.get("status") ?? "").trim();
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error("Unsupported Growth Spec status.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { error } = await supabase
      .from("tcos_mi_growth_specs")
      .update({ status })
      .eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/growth-specs?status=${encodeURIComponent(status)}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update Growth Spec.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/growth-specs?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

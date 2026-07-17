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
    const formData = await request.formData();
    const status = String(formData.get("status") ?? "").trim();
    if (!["pending", "sent", "dismissed"].includes(status)) {
      throw new Error("Unsupported alert status.");
    }

    const now = new Date().toISOString();
    const payload = {
      status,
      sent_at: status === "sent" ? now : null,
      dismissed_at: status === "dismissed" ? now : null,
    };

    const supabase = createSupabaseServerClient({ admin: true });
    const { error } = await supabase
      .from("tcos_mi_alerts")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?alertUpdated=${status}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update alert.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/reports?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}

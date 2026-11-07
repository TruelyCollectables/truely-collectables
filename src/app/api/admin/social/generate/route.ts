import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { generateSocialCampaign } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await hasValidAdminRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const campaignId = String(body.campaignId || "").trim();
    if (!campaignId) return NextResponse.json({ error: "Campaign ID is required." }, { status: 400 });
    const result = await generateSocialCampaign({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      campaignId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Social posts could not be generated." }, { status: 400 });
  }
}

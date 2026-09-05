import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { getSocialCampaignState } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await hasValidAdminRequest(request))) {
    return NextResponse.json({ error: "Log in through the TCOS admin first." }, { status: 401 });
  }
  try {
    const campaignId = new URL(request.url).searchParams.get("campaignId");
    const state = await getSocialCampaignState({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      campaignId,
    });
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Social state could not be loaded." }, { status: 500 });
  }
}

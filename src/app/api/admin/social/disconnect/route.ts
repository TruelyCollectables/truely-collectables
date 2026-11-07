import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { disconnectSocialProvider, SOCIAL_PROVIDERS } from "@/src/lib/social-publisher";
import type { SocialProvider } from "@/src/lib/social-oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await hasValidAdminRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const provider = String(body.provider || "") as SocialProvider;
    if (!SOCIAL_PROVIDERS.includes(provider)) return NextResponse.json({ error: "Unknown social provider." }, { status: 400 });
    await disconnectSocialProvider({ supabase: createSupabaseServerClient({ admin: true }), storeId: getActiveStoreId(), provider });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Disconnect failed." }, { status: 400 });
  }
}
